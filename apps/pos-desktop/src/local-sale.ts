import { calculateReceipt } from "@packages/fiscal-engine";
import type {
  CashPayment,
  EntityId,
  FiscalReceiptInput,
  FiscalReceiptInputLine,
  IdempotencyKey,
  IsoDateTimeString,
  LocalOutboxEntry,
  Order,
  OrderId,
  PaymentId,
  PrinterId,
  PrinterJob,
  PrinterJobId,
  Receipt,
  ReceiptId,
  ReceiptNumber,
  SyncEvent,
  SyncEventId,
} from "@packages/shared-types";
import { calculateCashPayment } from "./cash";

export interface LocalOrderRepository {
  save(order: Order): Promise<void>;
  getById(orderId: OrderId): Promise<Order | undefined>;
  listRecent(limit: number): Promise<Order[]>;
}

export interface LocalPaymentRepository {
  save(payment: CashPayment): Promise<void>;
  getByOrderId(orderId: OrderId): Promise<CashPayment | undefined>;
}

export interface LocalReceiptRepository {
  save(receipt: Receipt): Promise<void>;
  getByOrderId(orderId: OrderId): Promise<Receipt | undefined>;
}

export interface LocalSaleOutboxRepository {
  enqueue(event: SyncEvent): Promise<void>;
  listPending(limit: number): Promise<SyncEvent[]>;
  markSynced(eventId: string, syncedAt?: IsoDateTimeString): Promise<void>;
  markFailed(eventId: string, error: Error, failedAt?: IsoDateTimeString): Promise<void>;
  listEntries(): Promise<LocalOutboxEntry[]>;
}

export interface LocalSaleRepositories {
  orders: LocalOrderRepository;
  payments: LocalPaymentRepository;
  receipts: LocalReceiptRepository;
  outbox: LocalSaleOutboxRepository;
}

export interface FinalizeCashSaleInput {
  orderId: OrderId;
  paymentId: PaymentId;
  receiptId: ReceiptId;
  receiptNumber: ReceiptNumber;
  localSequence: number;
  items: FiscalReceiptInputLine[];
  receivedDZD: number;
  finalizedAt: IsoDateTimeString;
  printer?: {
    printerJobId: PrinterJobId;
    targetPrinterId: PrinterId;
  };
}

export interface FinalizedCashSale {
  order: Order;
  receipt: Receipt;
  payment: CashPayment;
  syncEvents: SyncEvent[];
  printerJob?: PrinterJob;
}

export async function finalizeCashSale(
  input: FinalizeCashSaleInput,
  repositories: LocalSaleRepositories
): Promise<FinalizedCashSale> {
  const receiptInput: FiscalReceiptInput = {
    receiptId: input.receiptId,
    receiptNumber: input.receiptNumber,
    orderId: input.orderId,
    issuedAt: input.finalizedAt,
    lines: input.items,
  };

  const receipt = calculateReceipt(receiptInput);
  const payment = calculateCashPayment({
    paymentId: input.paymentId,
    orderId: input.orderId,
    amountDueDZD: receipt.totalDZD,
    receivedDZD: input.receivedDZD,
    paidAt: input.finalizedAt,
    createdAt: input.finalizedAt,
  });

  const order: Order = {
    id: input.orderId,
    localSequence: input.localSequence,
    status: "PENDING_SYNC",
    items: receipt.lines.map((line) => ({
      id: `${input.orderId}-line-${line.lineNumber}` as EntityId,
      ...line,
    })),
    subtotalDZD: receipt.subtotalDZD,
    vatAmountDZD: receipt.vatAmountDZD,
    totalDZD: receipt.totalDZD,
    receiptId: receipt.id,
    paymentId: payment.id,
    createdAt: input.finalizedAt,
    finalizedAt: input.finalizedAt,
    updatedAt: input.finalizedAt,
  };

  const printerJob = input.printer ? buildPrinterJob(input, receipt) : undefined;
  const syncEvents = buildSaleSyncEvents(order, payment, receipt, input.finalizedAt, printerJob);

  await repositories.orders.save(order);
  await repositories.receipts.save(receipt);
  await repositories.payments.save(payment);

  for (const event of syncEvents) {
    await repositories.outbox.enqueue(event);
  }

  return printerJob
    ? { order, receipt, payment, syncEvents, printerJob }
    : { order, receipt, payment, syncEvents };
}

export class InMemoryLocalSaleRepositories implements LocalSaleRepositories {
  readonly orders = new InMemoryOrderRepository();
  readonly payments = new InMemoryPaymentRepository();
  readonly receipts = new InMemoryReceiptRepository();
  readonly outbox = new InMemoryOutboxRepository();
}

class InMemoryOrderRepository implements LocalOrderRepository {
  private readonly orders = new Map<string, Order>();

  async save(order: Order): Promise<void> {
    this.orders.set(order.id, order);
  }

  async getById(orderId: OrderId): Promise<Order | undefined> {
    return this.orders.get(orderId);
  }

  async listRecent(limit: number): Promise<Order[]> {
    return [...this.orders.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }
}

class InMemoryPaymentRepository implements LocalPaymentRepository {
  private readonly paymentsByOrderId = new Map<string, CashPayment>();

  async save(payment: CashPayment): Promise<void> {
    this.paymentsByOrderId.set(payment.orderId, payment);
  }

  async getByOrderId(orderId: OrderId): Promise<CashPayment | undefined> {
    return this.paymentsByOrderId.get(orderId);
  }
}

class InMemoryReceiptRepository implements LocalReceiptRepository {
  private readonly receiptsByOrderId = new Map<string, Receipt>();

  async save(receipt: Receipt): Promise<void> {
    this.receiptsByOrderId.set(receipt.orderId, receipt);
  }

  async getByOrderId(orderId: OrderId): Promise<Receipt | undefined> {
    return this.receiptsByOrderId.get(orderId);
  }
}

class InMemoryOutboxRepository implements LocalSaleOutboxRepository {
  private readonly entries = new Map<string, LocalOutboxEntry>();

  async enqueue(event: SyncEvent): Promise<void> {
    this.entries.set(event.id, {
      event,
      status: "PENDING",
      createdAt: event.createdAt,
    });
  }

  async listPending(limit: number): Promise<SyncEvent[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.status === "PENDING" || entry.status === "FAILED")
      .slice(0, limit)
      .map((entry) => entry.event);
  }

  async markSynced(eventId: string, syncedAt?: IsoDateTimeString): Promise<void> {
    const entry = this.entries.get(eventId);
    if (!entry) return;

    this.entries.set(eventId, {
      ...entry,
      status: "SYNCED",
      syncedAt: syncedAt ?? (new Date().toISOString() as IsoDateTimeString),
    });
  }

  async markFailed(eventId: string, error: Error, failedAt?: IsoDateTimeString): Promise<void> {
    const entry = this.entries.get(eventId);
    if (!entry) return;

    const lastAttemptAt = failedAt ?? (new Date().toISOString() as IsoDateTimeString);

    this.entries.set(eventId, {
      ...entry,
      event: {
        ...entry.event,
        attemptCount: entry.event.attemptCount + 1,
        lastAttemptAt,
      },
      status: "FAILED",
      lastError: error.message,
    });
  }

  async listEntries(): Promise<LocalOutboxEntry[]> {
    return [...this.entries.values()];
  }
}

function buildPrinterJob(input: FinalizeCashSaleInput, receipt: Receipt): PrinterJob | undefined {
  if (!input.printer) return undefined;

  return {
    id: input.printer.printerJobId,
    orderId: input.orderId,
    receiptId: receipt.id,
    type: "RECEIPT",
    targetPrinterId: input.printer.targetPrinterId,
    payload: receipt,
    status: "QUEUED",
    attemptCount: 0,
    createdAt: input.finalizedAt,
    updatedAt: input.finalizedAt,
  };
}

function buildSaleSyncEvents(
  order: Order,
  payment: CashPayment,
  receipt: Receipt,
  createdAt: IsoDateTimeString,
  printerJob?: PrinterJob
): SyncEvent[] {
  const events: SyncEvent[] = [
    {
      id: `${order.id}:order-finalized` as SyncEventId,
      type: "ORDER_FINALIZED",
      schemaVersion: 1,
      aggregateId: order.id,
      aggregateType: "ORDER",
      payload: { order },
      createdAt,
      idempotencyKey: `${order.id}:order-finalized` as IdempotencyKey,
      attemptCount: 0,
    },
    {
      id: `${payment.id}:cash-payment-recorded` as SyncEventId,
      type: "CASH_PAYMENT_RECORDED",
      schemaVersion: 1,
      aggregateId: payment.id,
      aggregateType: "PAYMENT",
      payload: { payment },
      createdAt,
      idempotencyKey: `${payment.id}:cash-payment-recorded` as IdempotencyKey,
      attemptCount: 0,
    },
    {
      id: `${receipt.id}:receipt-issued` as SyncEventId,
      type: "RECEIPT_ISSUED",
      schemaVersion: 1,
      aggregateId: receipt.id,
      aggregateType: "RECEIPT",
      payload: { receipt },
      createdAt,
      idempotencyKey: `${receipt.id}:receipt-issued` as IdempotencyKey,
      attemptCount: 0,
    },
  ];

  if (printerJob) {
    events.push({
      id: `${printerJob.id}:print-job-requested` as SyncEventId,
      type: "PRINT_JOB_REQUESTED",
      schemaVersion: 1,
      aggregateId: printerJob.id,
      aggregateType: "PRINTER_JOB",
      payload: { printerJob },
      createdAt,
      idempotencyKey: `${printerJob.id}:print-job-requested` as IdempotencyKey,
      attemptCount: 0,
    });
  }

  return events;
}
