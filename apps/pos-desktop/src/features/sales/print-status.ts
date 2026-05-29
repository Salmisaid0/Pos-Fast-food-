import type {
  IsoDateTimeString,
  OrderId,
  PrinterId,
  PrinterJobId,
  ReceiptId,
} from "@packages/shared-types";

import type { LocalSaleRepositories } from "../../local-sale";

export type LocalPrintJobStatus = "QUEUED" | "SENT_TO_SERVER" | "FAILED";

export interface LocalPrintJobStatusItem {
  printerJobId: PrinterJobId;
  orderId: OrderId;
  receiptId: ReceiptId;
  targetPrinterId: PrinterId;
  status: LocalPrintJobStatus;
  createdAt: IsoDateTimeString;
  syncedAt?: IsoDateTimeString | undefined;
  lastError?: string | undefined;
  attemptCount: number;
}

export interface LocalPrintStatusSnapshot {
  jobs: LocalPrintJobStatusItem[];
  queuedCount: number;
  sentCount: number;
  failedCount: number;
}

export async function loadLocalPrintStatusSnapshot(
  repositories: LocalSaleRepositories,
  limit = 10
): Promise<LocalPrintStatusSnapshot> {
  const entries = await repositories.outbox.listEntries();
  const jobs = entries
    .flatMap((entry): LocalPrintJobStatusItem[] => {
      if (entry.event.type !== "PRINT_JOB_REQUESTED") return [];

      const { printerJob } = entry.event.payload;
      return [
        {
          printerJobId: printerJob.id,
          orderId: printerJob.orderId,
          receiptId: printerJob.receiptId,
          targetPrinterId: printerJob.targetPrinterId,
          status: toLocalPrintJobStatus(entry.status),
          createdAt: entry.createdAt,
          syncedAt: entry.syncedAt,
          lastError: entry.lastError,
          attemptCount: entry.event.attemptCount,
        },
      ];
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);

  return {
    jobs,
    queuedCount: jobs.filter((job) => job.status === "QUEUED").length,
    sentCount: jobs.filter((job) => job.status === "SENT_TO_SERVER").length,
    failedCount: jobs.filter((job) => job.status === "FAILED").length,
  };
}

export function formatLocalPrintJobStatus(status: LocalPrintJobStatus): string {
  switch (status) {
    case "QUEUED":
      return "Queued for server print";
    case "SENT_TO_SERVER":
      return "Sent to print worker";
    case "FAILED":
      return "Print request failed";
  }
}

function toLocalPrintJobStatus(status: "PENDING" | "SYNCED" | "FAILED"): LocalPrintJobStatus {
  switch (status) {
    case "PENDING":
      return "QUEUED";
    case "SYNCED":
      return "SENT_TO_SERVER";
    case "FAILED":
      return "FAILED";
  }
}
