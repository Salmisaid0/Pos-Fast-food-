import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NestSyncController,
  NestSyncModule,
  readApiRuntimeConfig,
  acceptSyncEvent,
  ingestSyncEvent,
  createSyncModule,
  ingestSyncEvents,
  InMemorySyncIngestionRepository,
} from "@apps/api";
import {
  addProductToCart,
  buildCashCheckoutState,
  calculateCartSummary,
  calculateCashPayment,
  createEmptyCart,
  decrementCartLine,
  finalizeCartCashSale,
  finalizeCashSale,
  InMemoryLocalSaleRepositories,
  LocalJsonSaleRepositories,
  seedProducts,
  toFiscalReceiptInputLines,
} from "@apps/pos-desktop";
import {
  FilePrintJobRepository,
  InMemoryPrintJobRepository,
  InMemoryPrintWorkerMetrics,
  InMemoryRedisPrintJobClient,
  IoredisPrintJobClient,
  PrintWorkerLoop,
  RecordingPrintWorkerLogger,
  RedisPrintJobRepository,
  TcpEscPosPrinterTransport,
  buildEscPosReceiptPayload,
  createArabicCodePageTextEncoder,
  createTcpEscPosPrinterTransportFromDomainPrinters,
  readRedisPrintQueueRuntimeConfig,
  drainPrintQueue,
  processNextPrintJob,
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
  Printer,
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

async function testPosCartStateBuildsFiscalLines(): Promise<void> {
  const classicBurger = seedProducts[0]!;
  const cola = seedProducts[4]!;
  const cart = addProductToCart(
    addProductToCart(addProductToCart(createEmptyCart(), classicBurger), classicBurger),
    cola
  );
  const summary = calculateCartSummary(cart);
  const fiscalLines = toFiscalReceiptInputLines(cart);
  const decrementedCart = decrementCartLine(cart, classicBurger.id);

  assert(summary.itemCount === 3, "Cart should count product quantities");
  assert(summary.totalDZD === 1150, "Cart should calculate DZD total from product snapshots");
  assert(fiscalLines.length === 2, "Cart should produce one fiscal line per product");
  assert(fiscalLines[0]?.quantity === 2, "Fiscal line should preserve product quantity");
  assert(fiscalLines[0]?.vatRate === 0, "Fiscal lines should keep VAT-disabled product rate");
  assert(
    calculateCartSummary(decrementedCart).itemCount === 2,
    "Cart decrement should reduce quantity without mutating original cart"
  );
}

async function testPosCheckoutStateAndFinalizeLocalSale(): Promise<void> {
  const repositories = new InMemoryLocalSaleRepositories();
  const cart = addProductToCart(
    addProductToCart(createEmptyCart(), seedProducts[0]!),
    seedProducts[4]!
  );
  const underpaid = buildCashCheckoutState(cart, 200);
  const ready = buildCashCheckoutState(cart, 700);

  assert(underpaid.status === "UNDERPAID", "Checkout should block underpaid cash sales");
  assert(!underpaid.canFinalize, "Underpaid checkout should not be finalizable");
  assert(ready.canFinalize, "Checkout should allow fully paid cash sales");
  assert(ready.changeDZD === 50, "Checkout should calculate change due");

  const sale = await finalizeCartCashSale({
    cart,
    receivedDZD: 700,
    localSequence: 42,
    finalizedAt: now,
    repositories,
  });

  assert(sale.order.status === "PENDING_SYNC", "Finalized POS sale should be pending sync");
  assert(sale.receipt.totalDZD === 650, "Finalized POS sale should use fiscal receipt total");
  assert(sale.payment.changeDZD === 50, "Finalized POS sale should keep cash change");
  assert(sale.syncEvents.length === 3, "Finalized POS sale should enqueue sale sync events");
  assert(
    (await repositories.orders.getById(sale.order.id))?.id === sale.order.id,
    "Finalized POS sale should be saved locally"
  );
}

async function testLocalJsonSaleRepositoriesSurviveRestart(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pos-local-sale-"));
  const storePath = join(directory, "local-sale-store.json");

  try {
    const repositories = new LocalJsonSaleRepositories(storePath);
    const sale = await finalizeCartCashSale({
      cart: addProductToCart(createEmptyCart(), seedProducts[0]!),
      receivedDZD: 500,
      localSequence: 77,
      finalizedAt: now,
      repositories,
    });

    const restartedRepositories = new LocalJsonSaleRepositories(storePath);
    const persistedOrder = await restartedRepositories.orders.getById(sale.order.id);
    const persistedPayment = await restartedRepositories.payments.getByOrderId(sale.order.id);
    const persistedReceipt = await restartedRepositories.receipts.getByOrderId(sale.order.id);
    const pendingEvents = await restartedRepositories.outbox.listPending(10);

    assert(persistedOrder?.id === sale.order.id, "Durable local store should reload orders");
    assert(
      persistedPayment?.id === sale.payment.id,
      "Durable local store should reload cash payments"
    );
    assert(persistedReceipt?.id === sale.receipt.id, "Durable local store should reload receipts");
    assert(
      pendingEvents.length === sale.syncEvents.length,
      "Durable local store should reload pending outbox events"
    );

    await restartedRepositories.outbox.markFailed(
      sale.syncEvents[0]!.id,
      new Error("network unavailable"),
      now
    );
    const afterFailureRestart = new LocalJsonSaleRepositories(storePath);
    const failedEntry = (await afterFailureRestart.outbox.listEntries()).find(
      (entry) => entry.event.id === sale.syncEvents[0]!.id
    );

    if (!failedEntry) throw new Error("Durable local store should reload failed outbox entry");
    assert(failedEntry.status === "FAILED", "Durable local store should persist outbox failure");
    assert(
      failedEntry.event.attemptCount === 1,
      "Durable local store should persist outbox attempt count"
    );

    await afterFailureRestart.outbox.markSynced(sale.syncEvents[0]!.id, now);
    const afterSyncRestart = new LocalJsonSaleRepositories(storePath);
    const syncedEntry = (await afterSyncRestart.outbox.listEntries()).find(
      (entry) => entry.event.id === sale.syncEvents[0]!.id
    );

    assert(syncedEntry?.status === "SYNCED", "Durable local store should persist sync state");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

async function testNestSyncControllerAndModuleIngestEvents(): Promise<void> {
  const localRepositories = new InMemoryLocalSaleRepositories();
  const apiRepository = new InMemorySyncIngestionRepository();
  const sale = await finalizeCashSale(
    {
      orderId,
      paymentId,
      receiptId,
      receiptNumber,
      localSequence: 8,
      items: fiscalInput.lines,
      receivedDZD: 1200,
      finalizedAt: now,
    },
    localRepositories
  );
  const controller = new NestSyncController(apiRepository);
  const module = NestSyncModule.register({ repository: apiRepository });

  const response = await controller.ingestBatch(sale.syncEvents);

  assert(
    response.acceptedCount === sale.syncEvents.length,
    "Nest sync controller should accept batch"
  );
  assert(
    (await apiRepository.getOrder(orderId))?.id === orderId,
    "Nest controller should persist order"
  );
  assert(
    module.controllers?.includes(NestSyncController) === true,
    "Nest sync module should expose controller"
  );
}

async function testApiRuntimeConfigReadsEnvironment(): Promise<void> {
  const config = readApiRuntimeConfig({
    API_PORT: "4101",
    API_HOST: "127.0.0.1",
  } as Record<string, string | undefined>);
  const fallbackConfig = readApiRuntimeConfig({ PORT: "4102" } as Record<
    string,
    string | undefined
  >);

  assert(config.port === 4101, "API runtime config should read API_PORT");
  assert(config.host === "127.0.0.1", "API runtime config should read API_HOST");
  assert(fallbackConfig.port === 4102, "API runtime config should fall back to PORT");
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

async function testWorkerClaimsNextQueuedPrintJob(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const queuedJob: PrinterJob = {
    id: "printer-job-claim" as PrinterJobId,
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

  const repository = new InMemoryPrintJobRepository([queuedJob]);
  const transport = new RecordingPrinterTransport();
  const result = await processNextPrintJob(repository, transport, { now });
  const savedJob = await repository.getById(queuedJob.id);
  const idleResult = await processNextPrintJob(repository, transport, { now });

  assert(result.ok === true, "processNextPrintJob should process the queued job");
  assert(result.status === "SENT", "Claimed queued job should be sent");
  assert(savedJob?.status === "SENT", "Claimed job should be persisted as sent");
  assert(transport.sentJobs.length === 1, "Claimed job should be delivered once");
  assert(idleResult.status === "IDLE", "Worker should become idle when no jobs remain");
}

async function testWorkerDrainsPrintQueue(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const firstJob: PrinterJob = {
    id: "printer-job-drain-1" as PrinterJobId,
    orderId,
    receiptId,
    type: "RECEIPT",
    targetPrinterId: printerId,
    payload: receipt,
    status: "QUEUED",
    attemptCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z" as IsoDateTimeString,
    updatedAt: now,
  };
  const secondJob: PrinterJob = {
    ...firstJob,
    id: "printer-job-drain-2" as PrinterJobId,
    createdAt: "2026-01-01T00:00:01.000Z" as IsoDateTimeString,
  };

  const repository = new InMemoryPrintJobRepository([firstJob, secondJob]);
  const transport = new RecordingPrinterTransport();
  const result = await drainPrintQueue(repository, transport, { now, limit: 10 });

  assert(result.attemptedCount === 2, "Drain should attempt every queued job");
  assert(result.sentCount === 2, "Drain should send all healthy queued jobs");
  assert(result.failedCount === 0, "Drain should not record failures for healthy transport");
  assert(result.deadLetteredCount === 0, "Drain should not dead-letter healthy jobs");
  assert(transport.sentJobs[0]?.id === firstJob.id, "Drain should process oldest print job first");
  assert(
    (await repository.getById(firstJob.id))?.status === "SENT",
    "First drained job should be sent"
  );
  assert(
    (await repository.getById(secondJob.id))?.status === "SENT",
    "Second drained job should be sent"
  );
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

async function testFilePrintJobRepositoryPersistsQueuedJobs(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const directory = await mkdtemp(join(tmpdir(), "pos-print-queue-"));
  const filePath = join(directory, "print-jobs.json");
  const queuedJob: PrinterJob = {
    id: "printer-job-file" as PrinterJobId,
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

  try {
    const writerRepository = new FilePrintJobRepository(filePath);
    await writerRepository.save(queuedJob);

    const readerRepository = new FilePrintJobRepository(filePath);
    const loadedJob = await readerRepository.getById(queuedJob.id);
    const transport = new RecordingPrinterTransport();
    const drainResult = await drainPrintQueue(readerRepository, transport, { now });
    const sentJob = await readerRepository.getById(queuedJob.id);

    assert(loadedJob?.status === "QUEUED", "File queue should reload queued print jobs");
    assert(drainResult.sentCount === 1, "File queue should drain persisted queued job");
    assert(sentJob?.status === "SENT", "File queue should persist sent job state");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function testRedisPrintJobRepositoryPersistsAndClaimsJobs(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const redis = new InMemoryRedisPrintJobClient();
  const repository = new RedisPrintJobRepository(redis);
  const firstJob: PrinterJob = {
    id: "printer-job-redis-1" as PrinterJobId,
    orderId,
    receiptId,
    type: "RECEIPT",
    targetPrinterId: printerId,
    payload: receipt,
    status: "QUEUED",
    attemptCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z" as IsoDateTimeString,
    updatedAt: now,
  };
  const secondJob: PrinterJob = {
    ...firstJob,
    id: "printer-job-redis-2" as PrinterJobId,
    createdAt: "2026-01-01T00:00:01.000Z" as IsoDateTimeString,
  };

  await repository.save(secondJob);
  await repository.save(firstJob);

  const runnableJobs = await repository.listRunnable(10);
  const claimedJob = await repository.claimNext(now);
  const claimedState = await repository.getById(firstJob.id);
  const remainingRunnableJobs = await repository.listRunnable(10);

  assert(runnableJobs[0]?.id === firstJob.id, "Redis queue should list oldest runnable job first");
  assert(claimedJob?.id === firstJob.id, "Redis queue should claim oldest runnable job");
  assert(claimedState?.status === "PROCESSING", "Redis queue should persist claimed job state");
  assert(
    remainingRunnableJobs.length === 1 && remainingRunnableJobs[0]?.id === secondJob.id,
    "Redis queue should remove claimed job from runnable index"
  );
}

async function testRedisPrintJobRepositoryDrainsQueue(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const redis = new InMemoryRedisPrintJobClient();
  const repository = new RedisPrintJobRepository(redis);
  const transport = new RecordingPrinterTransport();
  const queuedJob: PrinterJob = {
    id: "printer-job-redis-drain" as PrinterJobId,
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

  await repository.save(queuedJob);

  const drainResult = await drainPrintQueue(repository, transport, { now });
  const sentJob = await repository.getById(queuedJob.id);

  assert(drainResult.sentCount === 1, "Redis queue should drain queued job");
  assert(sentJob?.status === "SENT", "Redis queue should persist sent state after drain");
  assert(
    transport.sentJobs.length === 1,
    "Redis queue drain should deliver job to printer transport"
  );
}

async function testIoredisPrintJobClientAdapterDrainsQueue(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const redis = new InMemoryRedisPrintJobClient();
  const ioredisClient = new IoredisPrintJobClient(
    redis as unknown as ConstructorParameters<typeof IoredisPrintJobClient>[0]
  );
  const repository = new RedisPrintJobRepository(ioredisClient);
  const transport = new RecordingPrinterTransport();
  const queuedJob: PrinterJob = {
    id: "printer-job-ioredis" as PrinterJobId,
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

  await repository.save(queuedJob);

  const drainResult = await drainPrintQueue(repository, transport, { now });
  const sentJob = await repository.getById(queuedJob.id);

  assert(drainResult.sentCount === 1, "ioredis adapter should drain queued job");
  assert(sentJob?.status === "SENT", "ioredis adapter should persist sent job state");
}

async function testRedisPrintQueueRuntimeConfigReadsEnvironment(): Promise<void> {
  const config = readRedisPrintQueueRuntimeConfig({
    REDIS_URL: "redis://localhost:6379/2",
    REDIS_HOST: "redis.internal",
    REDIS_PORT: "6380",
    REDIS_DB: "3",
    REDIS_USERNAME: "pos",
    REDIS_PASSWORD: "secret",
    REDIS_KEY_PREFIX: "pos:",
    PRINT_JOBS_HASH_KEY: "print:jobs",
    PRINT_JOBS_RUNNABLE_SET_KEY: "print:runnable",
  } as Record<string, string | undefined>);

  assert(config.redis.url === "redis://localhost:6379/2", "Redis config should read URL");
  assert(config.redis.host === "redis.internal", "Redis config should read host");
  assert(config.redis.port === 6380, "Redis config should parse port");
  assert(config.redis.db === 3, "Redis config should parse db");
  assert(config.redis.username === "pos", "Redis config should read username");
  assert(config.redis.password === "secret", "Redis config should read password");
  assert(config.redis.keyPrefix === "pos:", "Redis config should read key prefix");
  assert(
    config.repository.jobsHashKey === "print:jobs",
    "Redis repository config should read hash key"
  );
  assert(
    config.repository.runnableSortedSetKey === "print:runnable",
    "Redis repository config should read runnable set key"
  );
}

async function testPrintWorkerLoopRunOnceDrainsQueue(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const repository = new InMemoryPrintJobRepository([
    {
      id: "printer-job-loop" as PrinterJobId,
      orderId,
      receiptId,
      type: "RECEIPT",
      targetPrinterId: printerId,
      payload: receipt,
      status: "QUEUED",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const transport = new RecordingPrinterTransport();
  const loop = new PrintWorkerLoop({
    repository,
    transport,
    batchSize: 5,
    now: () => now,
  });

  const result = await loop.runOnce();
  const savedJob = await repository.getById("printer-job-loop" as PrinterJobId);

  assert(result.sentCount === 1, "Worker loop runOnce should drain queued job");
  assert(savedJob?.status === "SENT", "Worker loop should persist sent job state");
  assert(transport.sentJobs.length === 1, "Worker loop should deliver queued job once");
}

async function testPrintWorkerLoopRecordsOperationalControls(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const repository = new InMemoryPrintJobRepository([
    {
      id: "printer-job-observability" as PrinterJobId,
      orderId,
      receiptId,
      type: "RECEIPT",
      targetPrinterId: printerId,
      payload: receipt,
      status: "QUEUED",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const transport = new RecordingPrinterTransport();
  const logger = new RecordingPrintWorkerLogger();
  const metrics = new InMemoryPrintWorkerMetrics();
  const loop = new PrintWorkerLoop({
    repository,
    transport,
    logger,
    metrics,
    batchSize: 5,
    now: () => now,
  });

  const result = await loop.runOnce();

  assert(result.sentCount === 1, "Observable worker run should send queued job");
  assert(metrics.get("print_worker_runs_total") === 1, "Worker metrics should count run cycles");
  assert(metrics.get("print_jobs_attempted_total") === 1, "Worker metrics should count attempts");
  assert(metrics.get("print_jobs_sent_total") === 1, "Worker metrics should count sent jobs");
  assert(
    logger.entries.some((entry) => entry.event === "print_worker.run_started"),
    "Worker logger should record run start"
  );
  assert(
    logger.entries.some((entry) => entry.event === "print_worker.run_completed"),
    "Worker logger should record run completion"
  );
}

async function testPrintWorkerLoopGracefulShutdown(): Promise<void> {
  const repository = new InMemoryPrintJobRepository();
  const transport = new RecordingPrinterTransport();
  const logger = new RecordingPrintWorkerLogger();
  const loop = new PrintWorkerLoop({
    repository,
    transport,
    logger,
    intervalMs: 60_000,
    shutdownSignals: ["SIGTERM"],
    now: () => now,
  });

  loop.start();
  assert(loop.running, "Worker loop should be running after start");

  loop.requestShutdown("test_shutdown");

  assert(!loop.running, "Worker loop should stop after shutdown request");
  assert(
    logger.entries.some((entry) => entry.event === "print_worker.shutdown_requested"),
    "Worker logger should record shutdown request"
  );
  assert(
    logger.entries.some((entry) => entry.event === "print_worker.stopped"),
    "Worker logger should record stop event"
  );
}

async function testEscPosPayloadContainsReceiptCommands(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const payload = buildEscPosReceiptPayload({
    id: "printer-job-escpos-payload" as PrinterJobId,
    orderId,
    receiptId,
    type: "RECEIPT",
    targetPrinterId: printerId,
    payload: receipt,
    status: "QUEUED",
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  const payloadText = payload.toString("utf8");

  assert(payload[0] === 0x1b && payload[1] === 0x40, "ESC/POS payload should initialize printer");
  assert(payloadText.includes("FAST FOOD POS"), "ESC/POS payload should include receipt header");
  assert(
    payloadText.includes("Classic Burger"),
    "ESC/POS payload should include receipt line item"
  );
  assert(
    payloadText.includes("TOTAL") && payloadText.includes("1000.00 DZD"),
    "ESC/POS payload should include total amount"
  );
  assert(
    payload[payload.length - 3] === 0x1d && payload[payload.length - 2] === 0x56,
    "ESC/POS payload should end with paper cut command"
  );
}

async function testEscPosPayloadSupportsCodePageAndArabicRtl(): Promise<void> {
  const arabicInput: FiscalReceiptInput = {
    ...fiscalInput,
    lines: [
      {
        ...fiscalInput.lines[0]!,
        productName: "برغر كلاسيك",
      },
    ],
  };
  const receipt = calculateReceipt(arabicInput);
  const payload = buildEscPosReceiptPayload(
    {
      id: "printer-job-arabic" as PrinterJobId,
      orderId,
      receiptId,
      type: "RECEIPT",
      targetPrinterId: printerId,
      payload: receipt,
      status: "QUEUED",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    { codePageCommand: 22, charactersPerLine: 42, rtl: true }
  );
  const payloadText = payload.toString("utf8");

  assert(
    payload[2] === 0x1b && payload[3] === 0x74 && payload[4] === 22,
    "ESC/POS payload should select configured code page"
  );
  assert(payloadText.includes("كيسالك رغرب"), "ESC/POS payload should apply RTL Arabic handling");
  assert(
    payloadText.includes("------------------------------------------"),
    "ESC/POS payload should honor line width"
  );
}

async function testEscPosPayloadSupportsCustomHardwareTextEncoder(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const payload = buildEscPosReceiptPayload(
    {
      id: "printer-job-custom-encoder" as PrinterJobId,
      orderId,
      receiptId,
      type: "RECEIPT",
      targetPrinterId: printerId,
      payload: receipt,
      status: "QUEUED",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      textEncoder(text: string) {
        return Buffer.from(`[${text}]`, "utf8");
      },
    }
  );
  const payloadText = payload.toString("utf8");

  assert(
    payloadText.includes("[FAST FOOD POS]"),
    "ESC/POS payload should use custom hardware text encoder"
  );
}

async function testArabicCodePageEncoderMapsArabicGlyphs(): Promise<void> {
  const encoder = createArabicCodePageTextEncoder();
  const encoded = encoder("برغر A\nﻻ");

  assert(encoded[0] === 0x87, "Arabic encoder should map beh");
  assert(encoded[1] === 0x90, "Arabic encoder should map reh");
  assert(encoded[2] === 0x99, "Arabic encoder should map ghain");
  assert(encoded[4] === 0x20 && encoded[5] === 0x41, "Arabic encoder should keep ASCII bytes");
  assert(encoded[6] === 0x0a, "Arabic encoder should preserve newline byte");
  assert(encoded[7] === 0xa4, "Arabic encoder should map lam-alef ligature");
}

async function testEscPosPayloadUsesArabicHardwareTextEncoder(): Promise<void> {
  const receipt = calculateReceipt({
    ...fiscalInput,
    lines: [
      {
        ...fiscalInput.lines[0]!,
        productName: "برغر",
      },
    ],
  });
  const payload = buildEscPosReceiptPayload(
    {
      id: "printer-job-arabic-codepage" as PrinterJobId,
      orderId,
      receiptId,
      type: "RECEIPT",
      targetPrinterId: printerId,
      payload: receipt,
      status: "QUEUED",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    { codePageCommand: 22, textEncoder: createArabicCodePageTextEncoder() }
  );

  assert(
    payload.includes(Buffer.from([0x1b, 0x74, 22])),
    "Arabic ESC/POS payload should select configured code page"
  );
  assert(
    payload.includes(Buffer.from([0x87])),
    "Arabic ESC/POS payload should include encoded beh"
  );
}

async function testTcpEscPosTransportCanBeCreatedFromRuntimePrinterConfig(): Promise<void> {
  const printer: Printer = {
    id: printerId,
    name: "Receipt Printer",
    ipAddress: "127.0.0.1",
    port: 9100,
    role: "RECEIPT",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const transport = createTcpEscPosPrinterTransportFromDomainPrinters([printer], {
    timeoutMs: 1000,
    codePageCommand: 22,
    charactersPerLine: 42,
    rtl: true,
  });

  assert(
    transport instanceof TcpEscPosPrinterTransport,
    "Runtime printer config should create TCP transport"
  );
}

async function testTcpEscPosPrinterTransportSendsReceiptToNetworkPrinter(): Promise<void> {
  const receipt = calculateReceipt(fiscalInput);
  const receivedChunks: Buffer[] = [];
  const server = createServer((socket) => {
    socket.on("data", (chunk: Buffer) => receivedChunks.push(chunk));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    const transport = new TcpEscPosPrinterTransport(
      new Map([[printerId, { host: "127.0.0.1", port: address.port, timeoutMs: 1000 }]])
    );

    await transport.send({
      id: "printer-job-escpos-tcp" as PrinterJobId,
      orderId,
      receiptId,
      type: "RECEIPT",
      targetPrinterId: printerId,
      payload: receipt,
      status: "QUEUED",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const receivedPayload = Buffer.concat(receivedChunks).toString("utf8");
  assert(
    receivedPayload.includes("Receipt: R-2026-000001"),
    "TCP transport should send receipt number"
  );
  assert(
    receivedPayload.includes("TOTAL") && receivedPayload.includes("1000.00 DZD"),
    "TCP transport should send receipt total"
  );
}

async function testSyncControllerModuleQueuesPrintJobs(): Promise<void> {
  const localRepositories = new InMemoryLocalSaleRepositories();
  const workerRepository = new InMemoryPrintJobRepository();
  const sale = await finalizeCashSale(
    {
      orderId,
      paymentId,
      receiptId,
      receiptNumber,
      localSequence: 7,
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

  if (!sale.printerJob) throw new Error("Sale should create a printer job for module test");

  const module = createSyncModule({
    sideEffects: {
      async enqueuePrinterJob(printerJob: PrinterJob) {
        await workerRepository.save(printerJob);
      },
    },
  });

  const response = await module.controller.ingestBatch(sale.syncEvents);
  const queuedJob = await workerRepository.getById(sale.printerJob.id);

  assert(
    response.acceptedCount === sale.syncEvents.length,
    "Sync controller should accept sale batch"
  );
  assert(response.rejectedCount === 0, "Sync controller should not reject valid sale batch");
  assert(queuedJob?.status === "QUEUED", "Sync module side effect should queue print job");
}

async function testFlushOutboxEnqueuesPrinterJobForWorkerQueue(): Promise<void> {
  const localRepositories = new InMemoryLocalSaleRepositories();
  const apiRepository = new InMemorySyncIngestionRepository();
  const workerRepository = new InMemoryPrintJobRepository();
  const transport = new RecordingPrinterTransport();
  const sale = await finalizeCashSale(
    {
      orderId,
      paymentId,
      receiptId,
      receiptNumber,
      localSequence: 6,
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

  if (!sale.printerJob) throw new Error("Sale should create a printer job for queue bridge test");

  const api: RemoteSyncApi = {
    async pushEvent(event: SyncEvent) {
      const result = await ingestSyncEvent(event, apiRepository, {
        async enqueuePrinterJob(printerJob: PrinterJob) {
          await workerRepository.save(printerJob);
        },
      });
      if (!result.accepted) throw new Error(result.reason);
    },
  };

  const syncedCount = await flushOutbox(localRepositories.outbox, api, 50);
  const queuedJob = await workerRepository.getById(sale.printerJob.id);
  const drainResult = await drainPrintQueue(workerRepository, transport, { now });
  const sentJob = await workerRepository.getById(sale.printerJob.id);

  assert(
    syncedCount === sale.syncEvents.length,
    "Flush should sync all local events before worker queue processing"
  );
  assert(
    (await apiRepository.getPrinterJob(sale.printerJob.id))?.id === sale.printerJob.id,
    "API ingestion should persist print job requests"
  );
  assert(queuedJob?.status === "QUEUED", "API side effect should enqueue print job for worker");
  assert(drainResult.sentCount === 1, "Worker drain should send the enqueued print job");
  assert(sentJob?.status === "SENT", "Worker repository should persist sent print job state");
  assert(transport.sentJobs.length === 1, "Printer transport should receive the queued job once");
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
  await testPosCartStateBuildsFiscalLines();
  await testPosCheckoutStateAndFinalizeLocalSale();
  await testLocalJsonSaleRepositoriesSurviveRestart();
  await testFiscalCalculation();
  await testFiscalValidation();
  await testCompleteSaleContracts();
  await testFinalizeCashSaleWritesLocalDataAndOutbox();
  await testIdempotencyGuard();
  await testApiSyncIngestionPersistsSaleEvents();
  await testApiSyncRejectsInvalidAggregate();
  await testNestSyncControllerAndModuleIngestEvents();
  await testApiRuntimeConfigReadsEnvironment();
  await testWorkerProcessesPrintJobSuccessfully();
  await testWorkerMarksFailedAndDeadLetterPrintJobs();
  await testWorkerClaimsNextQueuedPrintJob();
  await testWorkerDrainsPrintQueue();
  await testFilePrintJobRepositoryPersistsQueuedJobs();
  await testRedisPrintJobRepositoryPersistsAndClaimsJobs();
  await testRedisPrintJobRepositoryDrainsQueue();
  await testIoredisPrintJobClientAdapterDrainsQueue();
  await testRedisPrintQueueRuntimeConfigReadsEnvironment();
  await testPrintWorkerLoopRunOnceDrainsQueue();
  await testPrintWorkerLoopRecordsOperationalControls();
  await testPrintWorkerLoopGracefulShutdown();
  await testEscPosPayloadContainsReceiptCommands();
  await testEscPosPayloadSupportsCodePageAndArabicRtl();
  await testEscPosPayloadSupportsCustomHardwareTextEncoder();
  await testArabicCodePageEncoderMapsArabicGlyphs();
  await testEscPosPayloadUsesArabicHardwareTextEncoder();
  await testTcpEscPosTransportCanBeCreatedFromRuntimePrinterConfig();
  await testTcpEscPosPrinterTransportSendsReceiptToNetworkPrinter();
  await testSyncControllerModuleQueuesPrintJobs();
  await testFlushOutboxHandlesFailureAndRetry();
  await testFlushOutboxCanPushToApiIngestion();
  await testFlushOutboxEnqueuesPrinterJobForWorkerQueue();
  await testFlushOutbox();
  console.log("All tests passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
