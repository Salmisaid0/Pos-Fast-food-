import {
  acceptSyncEvent,
  ingestSyncEvent,
  ingestSyncEvents,
  InMemorySyncIngestionRepository,
} from "@apps/api";
import {
  calculateCashPayment,
  finalizeCashSale,
  InMemoryLocalSaleRepositories,
} from "@apps/pos-desktop";
import {
  InMemoryPrintJobRepository,
  processPrintJob,
  RecordingPrinterTransport,
  type PrinterTransport,
} from "@apps/workers";
import {
  calculateReceipt,
  FISCAL_ENGINE_VERSION,
  InvalidFiscalInputError,
  InvalidReceiptLineError,
  UnsupportedVatRateError,
} from "@packages/fiscal-engine";
import {
  flushOutbox,
  flushOutboxDetailed,
  type LocalOutboxRepository,
  type RemoteSyncApi,
} from "@packages/sync-engine";
import type {
  EntityId,
  FiscalReceiptInput,
  IdempotencyKey,
  IsoDateTimeString,
  Order,
  OrderId,
  PaymentId,
  PrinterId,
  PrinterJob,
  PrinterJobId,
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
const printerId = "printer-receipt-1" as PrinterId;
const printerJobId = "printer-job-1" as PrinterJobId;
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
      vatRate: 0,
    },
  ],
};

async function testCashCalculation(): Promise<void> {
  const payment = calculateCashPayment({
    paymentId,
    orderId,
    amountDueDZD: 1000,
    receivedDZD: 1200,
    paidAt: now,
    createdAt: now,
  });

  assert(payment.changeDZD === 200, "Cash change should be 200");
  assert(payment.status === "RECORDED", "Cash payment should be recorded");
}

async function testFiscalCalculation(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  assert(receipt.vatAmountDZD === 0, "VAT should be 0 while VAT is disabled");
  assert(receipt.totalDZD === 1000, "Total should be 1000 without VAT");
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
        lines: [{ ...fiscalInput.lines[0]!, vatRate: 0.19 as 0 }],
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

async function testFinalizeCashSaleWritesLocalDataAndOutbox(): Promise<void> {
  const repositories = new InMemoryLocalSaleRepositories();
  const sale = await finalizeCashSale(
    {
      orderId,
      paymentId,
      receiptId,
      receiptNumber,
      localSequence: 1,
      items: fiscalInput.lines,
      receivedDZD: 1200,
      finalizedAt: now,
      printer: {
        printerJobId,
        targetPrinterId: printerId,
      },
    },
    repositories
  );

  const savedOrder = await repositories.orders.getById(orderId);
  const savedPayment = await repositories.payments.getByOrderId(orderId);
  const savedReceipt = await repositories.receipts.getByOrderId(orderId);
  const outboxEntries = await repositories.outbox.listEntries();

  assert(savedOrder?.id === orderId, "Finalized sale should save the order locally");
  assert(savedPayment?.amountDueDZD === sale.receipt.totalDZD, "Payment should use receipt total");
  assert(savedReceipt?.id === receiptId, "Finalized sale should save the receipt locally");
  assert(
    outboxEntries.length === 4,
    "Finalized sale should enqueue order, payment, receipt, and print events"
  );
  assert(
    outboxEntries.every((entry) => entry.status === "PENDING"),
    "All new outbox entries should start pending"
  );
  assert(sale.printerJob?.status === "QUEUED", "Receipt print job should be queued server-side");
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

async function testApiSyncIngestionPersistsSaleEvents(): Promise<void> {
  const localRepositories = new InMemoryLocalSaleRepositories();
  const apiRepository = new InMemorySyncIngestionRepository();
  const sale = await finalizeCashSale(
    {
      orderId,
      paymentId,
      receiptId,
      receiptNumber,
      localSequence: 2,
      items: fiscalInput.lines,
      receivedDZD: 1200,
      finalizedAt: now,
      printer: {
        printerJobId,
        targetPrinterId: printerId,
      },
    },
    localRepositories
  );

  const results = await ingestSyncEvents(sale.syncEvents, apiRepository);
  assert(
    results.every((result) => result.accepted),
    "All sale sync events should be accepted"
  );
  assert((await apiRepository.getOrder(orderId))?.id === orderId, "API sync should persist order");
  assert(
    (await apiRepository.getCashPayment(paymentId))?.id === paymentId,
    "API sync should persist cash payment"
  );
  assert(
    (await apiRepository.getReceipt(receiptId))?.id === receiptId,
    "API sync should persist receipt"
  );
  assert(
    (await apiRepository.getPrinterJob(printerJobId))?.id === printerJobId,
    "API sync should persist printer job request"
  );

  const duplicate = await ingestSyncEvent(sale.syncEvents[0]!, apiRepository);
  assert(duplicate.accepted === false, "Duplicate sync event should not be accepted twice");
  assert(
    duplicate.reason === "duplicate_idempotency_key",
    "Duplicate sync event should be rejected by idempotency key"
  );
}

async function testApiSyncRejectsInvalidAggregate(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const apiRepository = new InMemorySyncIngestionRepository();
  const invalidEvent: SyncEvent<"RECEIPT_ISSUED"> = {
    id: "event-invalid" as SyncEventId,
    type: "RECEIPT_ISSUED",
    schemaVersion: 1,
    aggregateId: receipt.id,
    aggregateType: "ORDER",
    payload: { receipt },
    createdAt: now,
    idempotencyKey: "invalid-aggregate" as IdempotencyKey,
    attemptCount: 0,
  };

  const result = await ingestSyncEvent(invalidEvent, apiRepository);
  assert(result.accepted === false, "Invalid aggregate type should be rejected");
  assert(
    result.reason === "invalid_aggregate_type",
    "Invalid aggregate rejection reason should be explicit"
  );
}

async function testWorkerProcessesPrintJobSuccessfully(): Promise<void> {
  const localRepositories = new InMemoryLocalSaleRepositories();
  const sale = await finalizeCashSale(
    {
      orderId,
      paymentId,
      receiptId,
      receiptNumber,
      localSequence: 5,
      items: fiscalInput.lines,
      receivedDZD: 1200,
      finalizedAt: now,
      printer: {
        printerJobId,
        targetPrinterId: printerId,
      },
    },
    localRepositories
  );

  if (!sale.printerJob) throw new Error("Sale should include a printer job");

  const repository = new InMemoryPrintJobRepository();
  const transport = new RecordingPrinterTransport();
  const result = await processPrintJob(sale.printerJob, repository, transport, { now });
  const savedJob = await repository.getById(sale.printerJob.id);

  assert(result.ok === true, "Print worker should mark successful print job as ok");
  assert(savedJob?.status === "SENT", "Successful print job should be marked sent");
  assert(savedJob?.attemptCount === 1, "Successful print job should increment attempt count");
  assert(transport.sentJobs.length === 1, "Printer transport should receive one job");
}

async function testWorkerMarksFailedAndDeadLetterPrintJobs(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const baseJob: PrinterJob = {
    id: printerJobId,
    orderId,
    receiptId,
    type: "RECEIPT",
    targetPrinterId: printerId,
    payload: receipt,
    status: "QUEUED",
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const failingTransport: PrinterTransport = {
    async send() {
      throw new Error("printer offline");
    },
  };

  const repository = new InMemoryPrintJobRepository();
  const firstResult = await processPrintJob(baseJob, repository, failingTransport, {
    now,
    maxAttempts: 2,
  });
  const firstSavedJob = await repository.getById(baseJob.id);

  assert(firstResult.ok === false, "Failed print job should return a failed result");
  assert(firstResult.status === "FAILED", "First failed attempt should remain retryable");
  assert(firstSavedJob?.status === "FAILED", "Repository should save retryable failed status");
  assert(firstSavedJob?.attemptCount === 1, "Failed print job should increment attempt count");
  assert(firstSavedJob?.lastError === "printer offline", "Failed print job should keep last error");

  const secondResult = await processPrintJob(firstSavedJob!, repository, failingTransport, {
    now,
    maxAttempts: 2,
  });
  const secondSavedJob = await repository.getById(baseJob.id);

  assert(secondResult.ok === false, "Second failed print job should return a failed result");
  assert(secondResult.status === "DEAD_LETTERED", "Max attempts should dead-letter print job");
  assert(secondSavedJob?.status === "DEAD_LETTERED", "Repository should save dead-letter status");
  assert(secondSavedJob?.attemptCount === 2, "Dead-lettered print job should record final attempt");
}

async function testFlushOutboxHandlesFailureAndRetry(): Promise<void> {
  const repositories = new InMemoryLocalSaleRepositories();
  const sale = await finalizeCashSale(
    {
      orderId,
      paymentId,
      receiptId,
      receiptNumber,
      localSequence: 3,
      items: fiscalInput.lines,
      receivedDZD: 1200,
      finalizedAt: now,
    },
    repositories
  );

  const failingEventId = sale.syncEvents[0]!.id;
  let shouldFailFirstEvent = true;
  const pushed = new Set<string>();

  const flakyApi: RemoteSyncApi = {
    async pushEvent(event: SyncEvent) {
      if (event.id === failingEventId && shouldFailFirstEvent) {
        shouldFailFirstEvent = false;
        throw new Error("temporary api outage");
      }

      pushed.add(event.id);
    },
  };

  const firstFlush = await flushOutboxDetailed(repositories.outbox, flakyApi, 50);
  assert(
    firstFlush.attemptedCount === sale.syncEvents.length,
    "First flush should attempt all events"
  );
  assert(firstFlush.failedCount === 1, "First flush should record one failed event");
  assert(
    firstFlush.syncedCount === sale.syncEvents.length - 1,
    "First flush should sync non-failing events"
  );

  const entriesAfterFailure = await repositories.outbox.listEntries();
  const failedEntry = entriesAfterFailure.find((entry) => entry.event.id === failingEventId);
  if (!failedEntry) throw new Error("Failed event should exist in local outbox");
  assert(failedEntry.status === "FAILED", "Failed event should be marked failed");
  assert(failedEntry.event.attemptCount === 1, "Failed event attempt count should increment");
  assert(failedEntry.lastError === "temporary api outage", "Failed event should keep last error");

  const secondFlush = await flushOutboxDetailed(repositories.outbox, flakyApi, 50);
  assert(secondFlush.attemptedCount === 1, "Second flush should retry only failed event");
  assert(secondFlush.syncedCount === 1, "Second flush should sync retried event");
  assert(secondFlush.failedCount === 0, "Second flush should not fail after API recovers");
  assert(pushed.has(failingEventId), "Recovered flush should push failed event");

  const entriesAfterRetry = await repositories.outbox.listEntries();
  assert(
    entriesAfterRetry.every((entry) => entry.status === "SYNCED"),
    "All entries should be synced after retry"
  );
}

async function testFlushOutboxCanPushToApiIngestion(): Promise<void> {
  const localRepositories = new InMemoryLocalSaleRepositories();
  const apiRepository = new InMemorySyncIngestionRepository();
  const sale = await finalizeCashSale(
    {
      orderId,
      paymentId,
      receiptId,
      receiptNumber,
      localSequence: 4,
      items: fiscalInput.lines,
      receivedDZD: 1200,
      finalizedAt: now,
    },
    localRepositories
  );

  const api: RemoteSyncApi = {
    async pushEvent(event: SyncEvent) {
      const result = await ingestSyncEvent(event, apiRepository);
      if (!result.accepted) throw new Error(result.reason);
    },
  };

  const syncedCount = await flushOutbox(localRepositories.outbox, api, 50);
  assert(
    syncedCount === sale.syncEvents.length,
    "Flush should sync every local sale event to API ingestion"
  );
  assert(
    (await apiRepository.getOrder(orderId))?.id === orderId,
    "Flush should persist order via API ingestion"
  );
  assert(
    (await apiRepository.getCashPayment(paymentId))?.id === paymentId,
    "Flush should persist payment via API ingestion"
  );
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
    async markFailed() {
      throw new Error("markFailed should not be called in successful flush test");
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
  await testFinalizeCashSaleWritesLocalDataAndOutbox();
  await testIdempotencyGuard();
  await testApiSyncIngestionPersistsSaleEvents();
  await testApiSyncRejectsInvalidAggregate();
  await testWorkerProcessesPrintJobSuccessfully();
  await testWorkerMarksFailedAndDeadLetterPrintJobs();
  await testFlushOutboxHandlesFailureAndRetry();
  await testFlushOutboxCanPushToApiIngestion();
  await testFlushOutbox();
  console.log("All tests passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
