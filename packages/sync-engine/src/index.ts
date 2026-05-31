 codex/develop-offline-first-fast-food-pos-system-rdcuxz
import type { IsoDateTimeString, SyncEvent } from "@packages/shared-types";

export interface LocalOutboxRepository {
  enqueue(event: SyncEvent): Promise<void>;
  listPending(limit: number): Promise<SyncEvent[]>;
  markSynced(eventId: string, syncedAt?: IsoDateTimeString): Promise<void>;
  markFailed(eventId: string, error: Error, failedAt?: IsoDateTimeString): Promise<void>;

 codex/develop-offline-first-fast-food-pos-system-q845bw
import type { IsoDateTimeString, SyncEvent } from "@packages/shared-types";

import { SyncEvent } from "../../shared-types/src";
 main

export interface LocalOutboxRepository {
  enqueue(event: SyncEvent): Promise<void>;
  listPending(limit: number): Promise<SyncEvent[]>;
 codex/develop-offline-first-fast-food-pos-system-q845bw
  markSynced(eventId: string, syncedAt?: IsoDateTimeString): Promise<void>;
  markFailed(eventId: string, error: Error, failedAt?: IsoDateTimeString): Promise<void>;

  markSynced(eventId: string): Promise<void>;
 main
 main
}

export interface RemoteSyncApi {
  pushEvent(event: SyncEvent): Promise<void>;
}

 codex/develop-offline-first-fast-food-pos-system-rdcuxz

 codex/develop-offline-first-fast-food-pos-system-q845bw
 main
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
 codex/develop-offline-first-fast-food-pos-system-rdcuxz


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
 main
 main
}
