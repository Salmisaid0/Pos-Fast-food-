import { SyncEvent } from "../../shared-types/src";

export interface LocalOutboxRepository {
  enqueue(event: SyncEvent): Promise<void>;
  listPending(limit: number): Promise<SyncEvent[]>;
  markSynced(eventId: string): Promise<void>;
}

export interface RemoteSyncApi {
  pushEvent(event: SyncEvent): Promise<void>;
}

export async function flushOutbox(
  outbox: LocalOutboxRepository,
  api: RemoteSyncApi,
  batchSize = 50,
): Promise<number> {
  const pending = await outbox.listPending(batchSize);
  let syncedCount = 0;

  for (const event of pending) {
    await api.pushEvent(event);
    await outbox.markSynced(event.id);
    syncedCount += 1;
  }

  return syncedCount;
}
