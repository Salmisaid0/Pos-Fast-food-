import type {
  CashPayment,
  IsoDateTimeString,
  Order,
  Receipt,
  ReceiptNumber,
} from "@packages/shared-types";

import type { LocalSaleRepositories } from "../../local-sale";

export interface RecentLocalSale {
  order: Order;
  receipt?: Receipt | undefined;
  payment?: CashPayment | undefined;
  pendingSyncCount: number;
}

export interface LocalSalesSnapshot {
  recentSales: RecentLocalSale[];
  pendingSyncCount: number;
  failedSyncCount: number;
  nextLocalSequence: number;
}

export async function loadLocalSalesSnapshot(
  repositories: LocalSaleRepositories,
  limit = 10
): Promise<LocalSalesSnapshot> {
  const orders = await repositories.orders.listRecent(limit);
  const outboxEntries = await repositories.outbox.listEntries();
  const pendingSyncCount = outboxEntries.filter((entry) => entry.status === "PENDING").length;
  const failedSyncCount = outboxEntries.filter((entry) => entry.status === "FAILED").length;
  const recentSales = await Promise.all(
    orders.map(async (order) => ({
      order,
      receipt: await repositories.receipts.getByOrderId(order.id),
      payment: await repositories.payments.getByOrderId(order.id),
      pendingSyncCount: outboxEntries.filter(
        (entry) => entry.status !== "SYNCED" && entry.event.createdAt === order.createdAt
      ).length,
    }))
  );

  return {
    recentSales,
    pendingSyncCount,
    failedSyncCount,
    nextLocalSequence: calculateNextLocalSequence(orders),
  };
}

export function createReceiptNumberPreview(localSequence: number): ReceiptNumber {
  return `R-LOCAL-${String(localSequence).padStart(6, "0")}` as ReceiptNumber;
}

export function formatSaleTimestamp(value: IsoDateTimeString): string {
  return new Date(value).toLocaleString();
}

function calculateNextLocalSequence(orders: Order[]): number {
  const maxSequence = orders.reduce(
    (currentMax, order) => Math.max(currentMax, order.localSequence),
    0
  );
  return maxSequence + 1;
}
