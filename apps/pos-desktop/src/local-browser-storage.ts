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
import type { LocalJsonSaleStore } from "./local-json-storage";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEFAULT_BROWSER_LOCAL_SALE_STORE_KEY = "pos-fast-food-local-sales-v1";

export class LocalBrowserSaleRepositories implements LocalSaleRepositories {
  readonly orders: LocalOrderRepository;
  readonly payments: LocalPaymentRepository;
  readonly receipts: LocalReceiptRepository;
  readonly outbox: LocalSaleOutboxRepository;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly key = DEFAULT_BROWSER_LOCAL_SALE_STORE_KEY
  ) {
    this.orders = new LocalBrowserOrderRepository(this);
    this.payments = new LocalBrowserPaymentRepository(this);
    this.receipts = new LocalBrowserReceiptRepository(this);
    this.outbox = new LocalBrowserOutboxRepository(this);
  }

  readStore(): LocalJsonSaleStore {
    const rawStore = this.storage.getItem(this.key);
    if (!rawStore) return createEmptyStore();
    return normalizeStore(JSON.parse(rawStore) as Partial<LocalJsonSaleStore>);
  }

  writeStore(store: LocalJsonSaleStore): void {
    this.storage.setItem(this.key, JSON.stringify(store));
  }

  clear(): void {
    this.storage.removeItem(this.key);
  }
}

export function createBrowserLocalSaleRepositories(
  storage: KeyValueStorage = globalThis.localStorage,
  key = DEFAULT_BROWSER_LOCAL_SALE_STORE_KEY
): LocalBrowserSaleRepositories {
  return new LocalBrowserSaleRepositories(storage, key);
}

export class InMemoryKeyValueStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class LocalBrowserOrderRepository implements LocalOrderRepository {
  constructor(private readonly storage: LocalBrowserSaleRepositories) {}

  async save(order: Order): Promise<void> {
    const store = this.storage.readStore();
    store.orders = upsertById(store.orders, order);
    this.storage.writeStore(store);
  }

  async getById(orderId: OrderId): Promise<Order | undefined> {
    return this.storage.readStore().orders.find((order) => order.id === orderId);
  }

  async listRecent(limit: number): Promise<Order[]> {
    return this.storage
      .readStore()
      .orders.slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }
}

class LocalBrowserPaymentRepository implements LocalPaymentRepository {
  constructor(private readonly storage: LocalBrowserSaleRepositories) {}

  async save(payment: CashPayment): Promise<void> {
    const store = this.storage.readStore();
    store.payments = upsertById(store.payments, payment);
    this.storage.writeStore(store);
  }

  async getByOrderId(orderId: OrderId): Promise<CashPayment | undefined> {
    return this.storage.readStore().payments.find((payment) => payment.orderId === orderId);
  }
}

class LocalBrowserReceiptRepository implements LocalReceiptRepository {
  constructor(private readonly storage: LocalBrowserSaleRepositories) {}

  async save(receipt: Receipt): Promise<void> {
    const store = this.storage.readStore();
    store.receipts = upsertById(store.receipts, receipt);
    this.storage.writeStore(store);
  }

  async getByOrderId(orderId: OrderId): Promise<Receipt | undefined> {
    return this.storage.readStore().receipts.find((receipt) => receipt.orderId === orderId);
  }
}

class LocalBrowserOutboxRepository implements LocalSaleOutboxRepository {
  constructor(private readonly storage: LocalBrowserSaleRepositories) {}

  async enqueue(event: SyncEvent): Promise<void> {
    const store = this.storage.readStore();
    store.outboxEntries = upsertByEventId(store.outboxEntries, {
      event,
      status: "PENDING",
      createdAt: event.createdAt,
    });
    this.storage.writeStore(store);
  }

  async listPending(limit: number): Promise<SyncEvent[]> {
    return this.storage
      .readStore()
      .outboxEntries.filter((entry) => entry.status === "PENDING" || entry.status === "FAILED")
      .slice(0, limit)
      .map((entry) => entry.event);
  }

  async markSynced(eventId: string, syncedAt?: IsoDateTimeString): Promise<void> {
    const store = this.storage.readStore();
    store.outboxEntries = store.outboxEntries.map((entry) =>
      entry.event.id === eventId
        ? {
            event: entry.event,
            status: "SYNCED",
            createdAt: entry.createdAt,
            syncedAt: syncedAt ?? (new Date().toISOString() as IsoDateTimeString),
          }
        : entry
    );
    this.storage.writeStore(store);
  }

  async markFailed(eventId: string, error: Error, failedAt?: IsoDateTimeString): Promise<void> {
    const store = this.storage.readStore();
    const lastAttemptAt = failedAt ?? (new Date().toISOString() as IsoDateTimeString);
    store.outboxEntries = store.outboxEntries.map((entry) =>
      entry.event.id === eventId
        ? {
            event: {
              ...entry.event,
              attemptCount: entry.event.attemptCount + 1,
              lastAttemptAt,
            },
            status: "FAILED",
            createdAt: entry.createdAt,
            lastError: error.message,
          }
        : entry
    );
    this.storage.writeStore(store);
  }

  async restoreEntry(entry: LocalOutboxEntry): Promise<void> {
    const store = this.storage.readStore();
    store.outboxEntries = upsertByEventId(store.outboxEntries, entry);
    this.storage.writeStore(store);
  }

  async listEntries(): Promise<LocalOutboxEntry[]> {
    return this.storage.readStore().outboxEntries;
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
