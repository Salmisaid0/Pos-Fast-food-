import type { CashPayment, Order, PrinterJob, Receipt, SyncEvent } from "@packages/shared-types";

export type SyncEventRejectReason =
  | "duplicate_idempotency_key"
  | "invalid_aggregate_type"
  | "aggregate_id_mismatch"
  | "invalid_payload";

export interface SyncEventAcceptance {
  accepted: boolean;
  reason?: SyncEventRejectReason;
}

export interface SyncIngestionRepository {
  hasProcessedIdempotencyKey(idempotencyKey: string): Promise<boolean>;
  recordProcessedIdempotencyKey(idempotencyKey: string): Promise<void>;
  saveOrder(order: Order): Promise<void>;
  saveCashPayment(payment: CashPayment): Promise<void>;
  saveReceipt(receipt: Receipt): Promise<void>;
  savePrinterJob(printerJob: PrinterJob): Promise<void>;
}

export class InMemorySyncIngestionRepository implements SyncIngestionRepository {
  private readonly processedIdempotencyKeys = new Set<string>();
  private readonly orders = new Map<string, Order>();
  private readonly cashPayments = new Map<string, CashPayment>();
  private readonly receipts = new Map<string, Receipt>();
  private readonly printerJobs = new Map<string, PrinterJob>();

  async hasProcessedIdempotencyKey(idempotencyKey: string): Promise<boolean> {
    return this.processedIdempotencyKeys.has(idempotencyKey);
  }

  async recordProcessedIdempotencyKey(idempotencyKey: string): Promise<void> {
    this.processedIdempotencyKeys.add(idempotencyKey);
  }

  async saveOrder(order: Order): Promise<void> {
    this.orders.set(order.id, order);
  }

  async saveCashPayment(payment: CashPayment): Promise<void> {
    this.cashPayments.set(payment.id, payment);
  }

  async saveReceipt(receipt: Receipt): Promise<void> {
    this.receipts.set(receipt.id, receipt);
  }

  async savePrinterJob(printerJob: PrinterJob): Promise<void> {
    this.printerJobs.set(printerJob.id, printerJob);
  }

  async getOrder(orderId: string): Promise<Order | undefined> {
    return this.orders.get(orderId);
  }

  async getCashPayment(paymentId: string): Promise<CashPayment | undefined> {
    return this.cashPayments.get(paymentId);
  }

  async getReceipt(receiptId: string): Promise<Receipt | undefined> {
    return this.receipts.get(receiptId);
  }

  async getPrinterJob(printerJobId: string): Promise<PrinterJob | undefined> {
    return this.printerJobs.get(printerJobId);
  }
}

const processedIdempotencyKeys = new Set<string>();

export function acceptSyncEvent(event: SyncEvent): SyncEventAcceptance {
  const validationResult = validateEventShape(event);
  if (!validationResult.accepted) return validationResult;

  if (processedIdempotencyKeys.has(event.idempotencyKey)) {
    return { accepted: false, reason: "duplicate_idempotency_key" };
  }

  processedIdempotencyKeys.add(event.idempotencyKey);
  return { accepted: true };
}

export async function ingestSyncEvent(
  event: SyncEvent,
  repository: SyncIngestionRepository
): Promise<SyncEventAcceptance> {
  if (await repository.hasProcessedIdempotencyKey(event.idempotencyKey)) {
    return { accepted: false, reason: "duplicate_idempotency_key" };
  }

  const validationResult = validateEventShape(event);
  if (!validationResult.accepted) return validationResult;

  await persistEventEffect(event, repository);
  await repository.recordProcessedIdempotencyKey(event.idempotencyKey);
  return { accepted: true };
}

export async function ingestSyncEvents(
  events: SyncEvent[],
  repository: SyncIngestionRepository
): Promise<SyncEventAcceptance[]> {
  const results: SyncEventAcceptance[] = [];

  for (const event of events) {
    results.push(await ingestSyncEvent(event, repository));
  }

  return results;
}

async function persistEventEffect(
  event: SyncEvent,
  repository: SyncIngestionRepository
): Promise<void> {
  switch (event.type) {
    case "ORDER_FINALIZED":
      await repository.saveOrder(event.payload.order);
      return;
    case "CASH_PAYMENT_RECORDED":
      await repository.saveCashPayment(event.payload.payment);
      return;
    case "RECEIPT_ISSUED":
      await repository.saveReceipt(event.payload.receipt);
      return;
    case "PRINT_JOB_REQUESTED":
      await repository.savePrinterJob(event.payload.printerJob);
      return;
  }
}

function validateEventShape(event: SyncEvent): SyncEventAcceptance {
  switch (event.type) {
    case "ORDER_FINALIZED":
      return validateAggregate(event, "ORDER", event.payload.order.id);
    case "CASH_PAYMENT_RECORDED":
      return validateAggregate(event, "PAYMENT", event.payload.payment.id);
    case "RECEIPT_ISSUED":
      return validateAggregate(event, "RECEIPT", event.payload.receipt.id);
    case "PRINT_JOB_REQUESTED":
      return validateAggregate(event, "PRINTER_JOB", event.payload.printerJob.id);
  }
}

function validateAggregate(
  event: SyncEvent,
  expectedAggregateType: SyncEvent["aggregateType"],
  expectedAggregateId: string
): SyncEventAcceptance {
  if (event.aggregateType !== expectedAggregateType) {
    return { accepted: false, reason: "invalid_aggregate_type" };
  }

  if (event.aggregateId !== expectedAggregateId) {
    return { accepted: false, reason: "aggregate_id_mismatch" };
  }

  return { accepted: true };
}
