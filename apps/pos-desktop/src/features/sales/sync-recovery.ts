import type {
  IsoDateTimeString,
  SyncAggregateType,
  SyncEventId,
  SyncEventType,
} from "@packages/shared-types";

import type { LocalSaleRepositories } from "../../local-sale";

export type RecoverableSyncStatus = "PENDING" | "FAILED";

export interface RecoverableSyncEvent {
  eventId: SyncEventId;
  type: SyncEventType;
  aggregateType: SyncAggregateType;
  aggregateId: string;
  status: RecoverableSyncStatus;
  attemptCount: number;
  createdAt: IsoDateTimeString;
  lastAttemptAt?: IsoDateTimeString | undefined;
  lastError?: string | undefined;
}

export interface SyncRecoverySnapshot {
  pendingEvents: RecoverableSyncEvent[];
  failedEvents: RecoverableSyncEvent[];
  retryableEvents: RecoverableSyncEvent[];
  hasRecoveryWork: boolean;
  oldestPendingAt?: IsoDateTimeString | undefined;
  latestFailure?: RecoverableSyncEvent | undefined;
}

export async function loadSyncRecoverySnapshot(
  repositories: LocalSaleRepositories,
  limit = 10
): Promise<SyncRecoverySnapshot> {
  const entries = await repositories.outbox.listEntries();
  const recoverableEvents = entries
    .flatMap((entry): RecoverableSyncEvent[] => {
      if (entry.status !== "PENDING" && entry.status !== "FAILED") return [];

      return [
        {
          eventId: entry.event.id,
          type: entry.event.type,
          aggregateType: entry.event.aggregateType,
          aggregateId: entry.event.aggregateId,
          status: entry.status,
          attemptCount: entry.event.attemptCount,
          createdAt: entry.createdAt,
          lastAttemptAt: entry.event.lastAttemptAt,
          lastError: entry.lastError,
        },
      ];
    })
    .sort(compareRecoverableSyncEvents);

  const pendingEvents = recoverableEvents
    .filter((event) => event.status === "PENDING")
    .slice(0, limit);
  const failedEvents = recoverableEvents
    .filter((event) => event.status === "FAILED")
    .slice(0, limit);
  const retryableEvents = recoverableEvents.slice(0, limit);

  return {
    pendingEvents,
    failedEvents,
    retryableEvents,
    hasRecoveryWork: retryableEvents.length > 0,
    oldestPendingAt: pendingEvents.at(-1)?.createdAt,
    latestFailure: failedEvents[0],
  };
}

export function formatRecoverableSyncEvent(event: RecoverableSyncEvent): string {
  const retryText = event.attemptCount === 1 ? "1 attempt" : `${event.attemptCount} attempts`;
  return `${event.type} · ${event.aggregateType} · ${retryText}`;
}

function compareRecoverableSyncEvents(
  left: RecoverableSyncEvent,
  right: RecoverableSyncEvent
): number {
  if (left.status !== right.status) return left.status === "FAILED" ? -1 : 1;
  return right.createdAt.localeCompare(left.createdAt);
}
