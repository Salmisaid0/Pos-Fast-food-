import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CashPayment, Order, PrinterJob, Receipt } from "@packages/shared-types";

import type { SyncIngestionRepository } from "./sync";

export interface FileSyncIngestionStore {
  processedIdempotencyKeys: string[];
  orders: Order[];
  cashPayments: CashPayment[];
  receipts: Receipt[];
  printerJobs: PrinterJob[];
}

export class FileSyncIngestionRepository implements SyncIngestionRepository {
  constructor(private readonly filePath: string) {}

  async hasProcessedIdempotencyKey(idempotencyKey: string): Promise<boolean> {
    return (await this.readStore()).processedIdempotencyKeys.includes(idempotencyKey);
  }

  async recordProcessedIdempotencyKey(idempotencyKey: string): Promise<void> {
    const store = await this.readStore();
    if (!store.processedIdempotencyKeys.includes(idempotencyKey)) {
      store.processedIdempotencyKeys.push(idempotencyKey);
    }
    await this.writeStore(store);
  }

  async saveOrder(order: Order): Promise<void> {
    const store = await this.readStore();
    store.orders = upsertById(store.orders, order);
    await this.writeStore(store);
  }

  async saveCashPayment(payment: CashPayment): Promise<void> {
    const store = await this.readStore();
    store.cashPayments = upsertById(store.cashPayments, payment);
    await this.writeStore(store);
  }

  async saveReceipt(receipt: Receipt): Promise<void> {
    const store = await this.readStore();
    store.receipts = upsertById(store.receipts, receipt);
    await this.writeStore(store);
  }

  async savePrinterJob(printerJob: PrinterJob): Promise<void> {
    const store = await this.readStore();
    store.printerJobs = upsertById(store.printerJobs, printerJob);
    await this.writeStore(store);
  }

  async getOrder(orderId: string): Promise<Order | undefined> {
    return (await this.readStore()).orders.find((order) => order.id === orderId);
  }

  async getCashPayment(paymentId: string): Promise<CashPayment | undefined> {
    return (await this.readStore()).cashPayments.find((payment) => payment.id === paymentId);
  }

  async getReceipt(receiptId: string): Promise<Receipt | undefined> {
    return (await this.readStore()).receipts.find((receipt) => receipt.id === receiptId);
  }

  async getPrinterJob(printerJobId: string): Promise<PrinterJob | undefined> {
    return (await this.readStore()).printerJobs.find(
      (printerJob) => printerJob.id === printerJobId
    );
  }

  async readStore(): Promise<FileSyncIngestionStore> {
    try {
      const rawStore = await readFile(this.filePath, "utf8");
      return normalizeStore(JSON.parse(rawStore) as Partial<FileSyncIngestionStore>);
    } catch (error) {
      if (isMissingFileError(error)) return createEmptyStore();
      throw error;
    }
  }

  private async writeStore(store: FileSyncIngestionStore): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

export function createEmptyFileSyncIngestionStore(): FileSyncIngestionStore {
  return createEmptyStore();
}

function createEmptyStore(): FileSyncIngestionStore {
  return {
    processedIdempotencyKeys: [],
    orders: [],
    cashPayments: [],
    receipts: [],
    printerJobs: [],
  };
}

function normalizeStore(store: Partial<FileSyncIngestionStore>): FileSyncIngestionStore {
  return {
    processedIdempotencyKeys: store.processedIdempotencyKeys ?? [],
    orders: store.orders ?? [],
    cashPayments: store.cashPayments ?? [],
    receipts: store.receipts ?? [],
    printerJobs: store.printerJobs ?? [],
  };
}

function upsertById<TItem extends { id: string }>(items: TItem[], item: TItem): TItem[] {
  const existingIndex = items.findIndex((existingItem) => existingItem.id === item.id);
  if (existingIndex === -1) return [...items, item];

  return items.map((existingItem, index) => (index === existingIndex ? item : existingItem));
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
