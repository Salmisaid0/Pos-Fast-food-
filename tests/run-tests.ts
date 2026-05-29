import { acceptSyncEvent } from "@apps/api";
import { calculateCashPayment } from "@apps/pos-desktop";
import {
  calculateReceipt,
  FISCAL_ENGINE_VERSION,
  InvalidFiscalInputError,
  InvalidReceiptLineError,
  UnsupportedVatRateError,
} from "@packages/fiscal-engine";
import { flushOutbox, type LocalOutboxRepository, type RemoteSyncApi } from "@packages/sync-engine";
import type {
  EntityId,
  FiscalReceiptInput,
  IdempotencyKey,
  IsoDateTimeString,
  Order,
  OrderId,
  PaymentId,
  ProductCategory,
  ProductCategoryId,
  ProductId,
  ReceiptId,
  ReceiptNumber,
  SyncEvent,
  SyncEventId,
} from "@packages/shared-types";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectThrows(
  errorType: new (...args: never[]) => Error,
  action: () => unknown,
  message: string
): void {
  try {
    action();
  } catch (error) {
    assert(error instanceof errorType, message);
    return;
  }

  throw new Error(message);
}

const now = "2026-01-01T00:00:00.000Z" as IsoDateTimeString;
const orderId = "order-1" as OrderId;
const paymentId = "payment-1" as PaymentId;
const receiptId = "receipt-1" as ReceiptId;
const receiptNumber = "R-2026-000001" as ReceiptNumber;
const categoryId = "category-burgers" as ProductCategoryId;
const productId = "product-burger" as ProductId;

const category: ProductCategory = {
  id: categoryId,
  name: "Burgers",
  sortOrder: 1,
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

const fiscalInput: FiscalReceiptInput = {
  receiptId,
  receiptNumber,
  orderId,
  issuedAt: now,
  lines: [
    {
      productId,
      productSku: "BRG-001",
      productName: "Classic Burger",
      quantity: 2,
      unitPriceDZD: 500,
      vatRate: 0.09,
    },
  ],
};

async function testCashCalculation(): Promise<void> {
  const payment = calculateCashPayment({
    paymentId,
    orderId,
    amountDueDZD: 1090,
    receivedDZD: 1200,
    paidAt: now,
    createdAt: now,
  });

  assert(payment.changeDZD === 110, "Cash change should be 110");
  assert(payment.status === "RECORDED", "Cash payment should be recorded");
}

async function testFiscalCalculation(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  assert(receipt.vatAmountDZD === 90, "VAT should be 90 for subtotal 1000");
  assert(receipt.totalDZD === 1090, "Total should be 1090");
  assert(receipt.fiscalVersion === FISCAL_ENGINE_VERSION, "Fiscal version should be v1");
  assert(receipt.lines.length === 1, "Receipt should contain one line");
  assert(
    receipt.lines[0]?.productName === "Classic Burger",
    "Receipt should keep product name snapshot"
  );
}

async function testFiscalValidation(): Promise<void> {
  expectThrows(
    InvalidFiscalInputError,
    () => calculateReceipt({ ...fiscalInput, lines: [] }),
    "Empty receipt lines should be rejected"
  );

  expectThrows(
    InvalidReceiptLineError,
    () => calculateReceipt({ ...fiscalInput, lines: [{ ...fiscalInput.lines[0]!, quantity: 0 }] }),
    "Zero quantity should be rejected"
  );

  expectThrows(
    UnsupportedVatRateError,
    () =>
      calculateReceipt({
        ...fiscalInput,
        lines: [{ ...fiscalInput.lines[0]!, vatRate: 0.19 as 0.09 }],
      }),
    "Unsupported VAT rate should be rejected"
  );
}

async function testCompleteSaleContracts(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const payment = calculateCashPayment({
    paymentId,
    orderId,
    amountDueDZD: receipt.totalDZD,
    receivedDZD: 1200,
    paidAt: now,
    createdAt: now,
  });

  const order: Order = {
    id: orderId,
    localSequence: 1,
    status: "PENDING_SYNC",
    items: [
      {
        id: "order-item-1" as EntityId,
        ...receipt.lines[0]!,
      },
    ],
    subtotalDZD: receipt.subtotalDZD,
    vatAmountDZD: receipt.vatAmountDZD,
    totalDZD: receipt.totalDZD,
    receiptId: receipt.id,
    paymentId: payment.id,
    createdAt: now,
    finalizedAt: now,
    updatedAt: now,
  };

  assert(category.isActive, "Category fixture should be active");
  assert(
    order.totalDZD === payment.amountDueDZD,
    "Payment amount due should match receipt/order total"
  );
  assert(
    order.items[0]?.productName === receipt.lines[0]?.productName,
    "Order item should keep receipt product snapshot"
  );
}

async function testIdempotencyGuard(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const event: SyncEvent<"RECEIPT_ISSUED"> = {
    id: "event-1" as SyncEventId,
    type: "RECEIPT_ISSUED",
    schemaVersion: 1,
    aggregateId: receipt.id,
    aggregateType: "RECEIPT",
    payload: { receipt },
    createdAt: now,
    idempotencyKey: "idem-1" as IdempotencyKey,
    attemptCount: 0,
  };

  const first = acceptSyncEvent(event);
  const second = acceptSyncEvent(event);
  assert(first.accepted === true, "First event must be accepted");
  assert(second.accepted === false, "Duplicate event must be rejected");
}

async function testFlushOutbox(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const pending: SyncEvent[] = [
    {
      id: "event-2" as SyncEventId,
      type: "RECEIPT_ISSUED",
      schemaVersion: 1,
      aggregateId: receipt.id,
      aggregateType: "RECEIPT",
      payload: { receipt },
      createdAt: now,
      idempotencyKey: "k1" as IdempotencyKey,
      attemptCount: 0,
    },
  ];
  const synced = new Set<string>();

  const outbox: LocalOutboxRepository = {
    async enqueue() {},
    async listPending(limit: number) {
      return pending.slice(0, limit);
    },
    async markSynced(eventId: string) {
      synced.add(eventId);
    },
  };

  const api: RemoteSyncApi = {
    async pushEvent() {
      return;
    },
  };

  const count = await flushOutbox(outbox, api, 50);
  assert(count === 1, "flushOutbox should sync 1 event");
  assert(synced.has("event-2"), "Event should be marked synced");
}

async function main(): Promise<void> {
  await testCashCalculation();
  await testFiscalCalculation();
  await testFiscalValidation();
  await testCompleteSaleContracts();
  await testIdempotencyGuard();
  await testFlushOutbox();
  console.log("All tests passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
