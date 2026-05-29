import type {
  CashPayment,
  IsoDateTimeString,
  LocalOutboxEntry,
  Order,
  Receipt,
} from "@packages/shared-types";

import type { LocalSaleRepositories } from "../../local-sale";

export const LOCAL_SALES_BACKUP_SCHEMA_VERSION = 1;
export const LOCAL_SALES_BACKUP_APP_VERSION = "pos-fast-food-local-backup-v1";

export interface LocalSalesBackupCounts {
  orders: number;
  payments: number;
  receipts: number;
  outboxEntries: number;
  pendingOutboxEntries: number;
  failedOutboxEntries: number;
}

export interface LocalSalesBackup {
  schemaVersion: typeof LOCAL_SALES_BACKUP_SCHEMA_VERSION;
  appVersion: typeof LOCAL_SALES_BACKUP_APP_VERSION;
  exportedAt: IsoDateTimeString;
  counts: LocalSalesBackupCounts;
  orders: Order[];
  payments: CashPayment[];
  receipts: Receipt[];
  outboxEntries: LocalOutboxEntry[];
}

export interface CreateLocalSalesBackupOptions {
  exportedAt?: IsoDateTimeString;
  orderLimit?: number;
}

export interface BrowserBackupDownloadResult {
  filename: string;
  bytes: number;
}

export interface LocalSalesBackupValidationSuccess {
  ok: true;
  backup: LocalSalesBackup;
}

export interface LocalSalesBackupValidationFailure {
  ok: false;
  errors: string[];
}

export type LocalSalesBackupValidationResult =
  | LocalSalesBackupValidationSuccess
  | LocalSalesBackupValidationFailure;

export async function createLocalSalesBackup(
  repositories: LocalSaleRepositories,
  options: CreateLocalSalesBackupOptions = {}
): Promise<LocalSalesBackup> {
  const exportedAt = options.exportedAt ?? (new Date().toISOString() as IsoDateTimeString);
  const orders = await repositories.orders.listRecent(options.orderLimit ?? 10_000);
  const payments = await compactAsync(
    orders.map((order) => repositories.payments.getByOrderId(order.id))
  );
  const receipts = await compactAsync(
    orders.map((order) => repositories.receipts.getByOrderId(order.id))
  );
  const outboxEntries = await repositories.outbox.listEntries();

  return {
    schemaVersion: LOCAL_SALES_BACKUP_SCHEMA_VERSION,
    appVersion: LOCAL_SALES_BACKUP_APP_VERSION,
    exportedAt,
    counts: {
      orders: orders.length,
      payments: payments.length,
      receipts: receipts.length,
      outboxEntries: outboxEntries.length,
      pendingOutboxEntries: outboxEntries.filter((entry) => entry.status === "PENDING").length,
      failedOutboxEntries: outboxEntries.filter((entry) => entry.status === "FAILED").length,
    },
    orders,
    payments,
    receipts,
    outboxEntries,
  };
}

export function serializeLocalSalesBackup(backup: LocalSalesBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function createLocalSalesBackupFilename(exportedAt: IsoDateTimeString): string {
  return `pos-local-sales-backup-${exportedAt.replaceAll(":", "-")}.json`;
}

export function parseLocalSalesBackupPayload(payload: string): LocalSalesBackupValidationResult {
  try {
    return validateLocalSalesBackup(JSON.parse(payload) as unknown);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "Backup file is not valid JSON"],
    };
  }
}

export function validateLocalSalesBackup(candidate: unknown): LocalSalesBackupValidationResult {
  const errors: string[] = [];

  if (!isRecord(candidate)) {
    return { ok: false, errors: ["Backup root must be an object"] };
  }

  if (candidate.schemaVersion !== LOCAL_SALES_BACKUP_SCHEMA_VERSION) {
    errors.push(`Unsupported backup schema version: ${String(candidate.schemaVersion)}`);
  }

  if (candidate.appVersion !== LOCAL_SALES_BACKUP_APP_VERSION) {
    errors.push(`Unsupported backup app version: ${String(candidate.appVersion)}`);
  }

  if (typeof candidate.exportedAt !== "string" || Number.isNaN(Date.parse(candidate.exportedAt))) {
    errors.push("Backup exportedAt must be a valid ISO timestamp");
  }

  const orders = Array.isArray(candidate.orders) ? candidate.orders : undefined;
  const payments = Array.isArray(candidate.payments) ? candidate.payments : undefined;
  const receipts = Array.isArray(candidate.receipts) ? candidate.receipts : undefined;
  const outboxEntries = Array.isArray(candidate.outboxEntries)
    ? candidate.outboxEntries
    : undefined;
  const counts = isRecord(candidate.counts) ? candidate.counts : undefined;

  if (!orders) errors.push("Backup orders must be an array");
  if (!payments) errors.push("Backup payments must be an array");
  if (!receipts) errors.push("Backup receipts must be an array");
  if (!outboxEntries) errors.push("Backup outboxEntries must be an array");
  if (!counts) errors.push("Backup counts must be an object");

  if (orders && counts && counts.orders !== orders.length) {
    errors.push("Backup order count does not match orders array");
  }
  if (payments && counts && counts.payments !== payments.length) {
    errors.push("Backup payment count does not match payments array");
  }
  if (receipts && counts && counts.receipts !== receipts.length) {
    errors.push("Backup receipt count does not match receipts array");
  }
  if (outboxEntries && counts && counts.outboxEntries !== outboxEntries.length) {
    errors.push("Backup outbox count does not match outbox array");
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, backup: candidate as unknown as LocalSalesBackup };
}

export async function downloadBrowserLocalSalesBackup(
  repositories: LocalSaleRepositories,
  options: CreateLocalSalesBackupOptions = {}
): Promise<BrowserBackupDownloadResult> {
  const backup = await createLocalSalesBackup(repositories, options);
  const payload = serializeLocalSalesBackup(backup);
  const filename = createLocalSalesBackupFilename(backup.exportedAt);
  const blob = new globalThis.Blob([payload], { type: "application/json" });
  const url = globalThis.URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");

  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    return { filename, bytes: payload.length };
  } finally {
    globalThis.URL.revokeObjectURL(url);
  }
}

async function compactAsync<TValue>(
  promises: Array<Promise<TValue | undefined>>
): Promise<TValue[]> {
  const values = await Promise.all(promises);
  const compacted: TValue[] = [];

  for (const value of values) {
    if (value !== undefined) compacted.push(value);
  }

  return compacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
