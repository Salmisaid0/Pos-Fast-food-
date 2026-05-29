import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  CashPayment,
  IsoDateTimeString,
  LocalOutboxEntry,
  Order,
  OrderId,
  Receipt,
  SyncEvent,
} from "@packages/shared-types";

import type {
  LocalOrderRepository,
  LocalPaymentRepository,
  LocalReceiptRepository,
  LocalSaleOutboxRepository,
  LocalSaleRepositories,
} from "./local-sale";

export interface LocalJsonSaleStore {
  orders: Order[];
  payments: CashPayment[];
  receipts: Receipt[];
  outboxEntries: LocalOutboxEntry[];
}

export class LocalJsonSaleRepositories implements LocalSaleRepositories {
  readonly orders: LocalOrderRepository;
  readonly payments: LocalPaymentRepository;
  readonly receipts: LocalReceiptRepository;
  readonly outbox: LocalSaleOutboxRepository;

  constructor(private readonly filePath: string) {
    this.orders = new LocalJsonOrderRepository(this);
    this.payments = new LocalJsonPaymentRepository(this);
    this.receipts = new LocalJsonReceiptRepository(this);
    this.outbox = new LocalJsonOutboxRepository(this);
  }

  async readStore(): Promise<LocalJsonSaleStore> {
    try {
      const rawStore = await readFile(this.filePath, "utf8");
      return normalizeStore(JSON.parse(rawStore) as Partial<LocalJsonSaleStore>);
    } catch (error) {
      if (isMissingFileError(error)) return createEmptyStore();
      throw error;
    }
  }

  async writeStore(store: LocalJsonSaleStore): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}

class LocalJsonOrderRepository implements LocalOrderRepository {
  constructor(private readonly storage: LocalJsonSaleRepositories) {}

  async save(order: Order): Promise<void> {
    const store = await this.storage.readStore();
    store.orders = upsertById(store.orders, order);
    await this.storage.writeStore(store);
  }

  async getById(orderId: OrderId): Promise<Order | undefined> {
    const store = await this.storage.readStore();
    return store.orders.find((order) => order.id === orderId);
  }
}

class LocalJsonPaymentRepository implements LocalPaymentRepository {
  constructor(private readonly storage: LocalJsonSaleRepositories) {}

  async save(payment: CashPayment): Promise<void> {
    const store = await this.storage.readStore();
    store.payments = upsertById(store.payments, payment);
    await this.storage.writeStore(store);
  }

  async getByOrderId(orderId: OrderId): Promise<CashPayment | undefined> {
    const store = await this.storage.readStore();
    return store.payments.find((payment) => payment.orderId === orderId);
  }
}

class LocalJsonReceiptRepository implements LocalReceiptRepository {
  constructor(private readonly storage: LocalJsonSaleRepositories) {}

  async save(receipt: Receipt): Promise<void> {
    const store = await this.storage.readStore();
    store.receipts = upsertById(store.receipts, receipt);
    await this.storage.writeStore(store);
  }

  async getByOrderId(orderId: OrderId): Promise<Receipt | undefined> {
    const store = await this.storage.readStore();
    return store.receipts.find((receipt) => receipt.orderId === orderId);
  }
}

class LocalJsonOutboxRepository implements LocalSaleOutboxRepository {
  constructor(private readonly storage: LocalJsonSaleRepositories) {}

  async enqueue(event: SyncEvent): Promise<void> {
    const store = await this.storage.readStore();
    store.outboxEntries = upsertByEventId(store.outboxEntries, {
      event,
      status: "PENDING",
      createdAt: event.createdAt,
    });
    await this.storage.writeStore(store);
  }

  async listPending(limit: number): Promise<SyncEvent[]> {
    const store = await this.storage.readStore();
    return store.outboxEntries
      .filter((entry) => entry.status === "PENDING" || entry.status === "FAILED")
      .slice(0, limit)
      .map((entry) => entry.event);
  }

  async markSynced(eventId: string, syncedAt?: IsoDateTimeString): Promise<void> {
    const store = await this.storage.readStore();
    store.outboxEntries = store.outboxEntries.map((entry) => {
      if (entry.event.id !== eventId) return entry;
      return {
        event: entry.event,
        status: "SYNCED",
        createdAt: entry.createdAt,
        syncedAt: syncedAt ?? (new Date().toISOString() as IsoDateTimeString),
      };
    });
    await this.storage.writeStore(store);
  }

  async markFailed(eventId: string, error: Error, failedAt?: IsoDateTimeString): Promise<void> {
    const store = await this.storage.readStore();
    const lastAttemptAt = failedAt ?? (new Date().toISOString() as IsoDateTimeString);
    store.outboxEntries = store.outboxEntries.map((entry) => {
      if (entry.event.id !== eventId) return entry;
      return {
        event: {
          ...entry.event,
          attemptCount: entry.event.attemptCount + 1,
          lastAttemptAt,
        },
        status: "FAILED",
        createdAt: entry.createdAt,
        lastError: error.message,
      };
    });
    await this.storage.writeStore(store);
  }

  async listEntries(): Promise<LocalOutboxEntry[]> {
    const store = await this.storage.readStore();
    return store.outboxEntries;
  }
}

function createEmptyStore(): LocalJsonSaleStore {
  return {
    orders: [],
    payments: [],
    receipts: [],
    outboxEntries: [],
  };
}

function normalizeStore(store: Partial<LocalJsonSaleStore>): LocalJsonSaleStore {
  return {
    orders: Array.isArray(store.orders) ? store.orders : [],
    payments: Array.isArray(store.payments) ? store.payments : [],
    receipts: Array.isArray(store.receipts) ? store.receipts : [],
    outboxEntries: Array.isArray(store.outboxEntries) ? store.outboxEntries : [],
  };
}

function upsertById<TItem extends { id: string }>(items: TItem[], item: TItem): TItem[] {
  const existingIndex = items.findIndex((existingItem) => existingItem.id === item.id);
  if (existingIndex === -1) return [...items, item];

  return items.map((existingItem, index) => (index === existingIndex ? item : existingItem));
}

function upsertByEventId(entries: LocalOutboxEntry[], entry: LocalOutboxEntry): LocalOutboxEntry[] {
  const existingIndex = entries.findIndex(
    (existingEntry) => existingEntry.event.id === entry.event.id
  );
  if (existingIndex === -1) return [...entries, entry];

  return entries.map((existingEntry, index) => (index === existingIndex ? entry : existingEntry));
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
