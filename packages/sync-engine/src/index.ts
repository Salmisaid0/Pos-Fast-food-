import type { IsoDateTimeString, SyncEvent } from "@packages/shared-types";

export interface LocalOutboxRepository {
  enqueue(event: SyncEvent): Promise<void>;
  listPending(limit: number): Promise<SyncEvent[]>;
  markSynced(eventId: string, syncedAt?: IsoDateTimeString): Promise<void>;
  markFailed(eventId: string, error: Error, failedAt?: IsoDateTimeString): Promise<void>;
}

export interface RemoteSyncApi {
  pushEvent(event: SyncEvent): Promise<void>;
}

export interface FlushOutboxResult {
  attemptedCount: number;
  syncedCount: number;
  failedCount: number;
}

export async function flushOutbox(
  outbox: LocalOutboxRepository,
  api: RemoteSyncApi,
  batchSize = 50
): Promise<number> {
  const result = await flushOutboxDetailed(outbox, api, batchSize);
  return result.syncedCount;
}

export async function flushOutboxDetailed(
  outbox: LocalOutboxRepository,
  api: RemoteSyncApi,
  batchSize = 50
): Promise<FlushOutboxResult> {
  const pending = await outbox.listPending(batchSize);
  const result: FlushOutboxResult = {
    attemptedCount: pending.length,
    syncedCount: 0,
    failedCount: 0,
  };

  for (const event of pending) {
    try {
      await api.pushEvent(event);
      await outbox.markSynced(event.id);
      result.syncedCount += 1;
    } catch (error) {
      await outbox.markFailed(event.id, normalizeError(error));
      result.failedCount += 1;
    }
  }

  return result;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}
