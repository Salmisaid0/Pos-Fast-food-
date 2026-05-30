import type { SyncEvent } from "@packages/shared-types";
import { flushOutboxDetailed, type RemoteSyncApi } from "@packages/sync-engine";

import type { LocalSaleRepositories } from "./local-sale";

export type PosOutboxSyncStatus = "IDLE" | "SYNCING" | "SYNCED" | "FAILED" | "OFFLINE";

export interface PosOutboxSyncSnapshot {
  status: PosOutboxSyncStatus;
  pendingCount: number;
  failedEventCount: number;
  attemptedCount: number;
  syncedCount: number;
  failedAttemptCount: number;
  lastAttemptAt?: string | undefined;
  lastSyncedAt?: string | undefined;
  lastError?: string | undefined;
}

export interface FlushOutboxOnceOptions {
  repositories: LocalSaleRepositories;
  api: RemoteSyncApi;
  batchSize?: number | undefined;
  now?: () => Date;
}

export interface OutboxSyncLoopOptions extends FlushOutboxOnceOptions {
  intervalMs?: number | undefined;
  runImmediately?: boolean | undefined;
  onStateChange?: (snapshot: PosOutboxSyncSnapshot) => void | Promise<void>;
}

export interface OutboxSyncLoopController {
  flushNow(): Promise<PosOutboxSyncSnapshot>;
  stop(): void;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<FetchResponseLike>;

export interface HttpRemoteSyncApiOptions {
  endpoint?: string | undefined;
  fetchImpl?: FetchLike | undefined;
}

export class HttpRemoteSyncApi implements RemoteSyncApi {
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: HttpRemoteSyncApiOptions = {}) {
    this.endpoint = options.endpoint ?? "/sync/events";
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
  }

  async pushEvent(event: SyncEvent): Promise<void> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Sync API rejected event ${event.id}: ${response.status} ${response.statusText}${
          body ? ` - ${body}` : ""
        }`
      );
    }
  }
}

export async function flushOutboxOnce(
  options: FlushOutboxOnceOptions
): Promise<PosOutboxSyncSnapshot> {
  const now = options.now ?? (() => new Date());
  const beforeCounts = await readOutboxCounts(options.repositories);
  const lastAttemptAt = now().toISOString();

  if (beforeCounts.pendingCount + beforeCounts.failedEventCount === 0) {
    return {
      status: "SYNCED",
      pendingCount: beforeCounts.pendingCount,
      failedEventCount: beforeCounts.failedEventCount,
      attemptedCount: 0,
      syncedCount: 0,
      failedAttemptCount: 0,
      lastAttemptAt,
      lastSyncedAt: lastAttemptAt,
    };
  }

  const result = await flushOutboxDetailed(
    options.repositories.outbox,
    options.api,
    options.batchSize ?? 25
  );
  const afterCounts = await readOutboxCounts(options.repositories);
  const status: PosOutboxSyncStatus = result.failedCount > 0 ? "FAILED" : "SYNCED";

  return {
    status,
    pendingCount: afterCounts.pendingCount,
    failedEventCount: afterCounts.failedEventCount,
    attemptedCount: result.attemptedCount,
    syncedCount: result.syncedCount,
    failedAttemptCount: result.failedCount,
    lastAttemptAt,
    ...(status === "SYNCED" ? { lastSyncedAt: lastAttemptAt } : {}),
  };
}

export function startOutboxSyncLoop(options: OutboxSyncLoopOptions): OutboxSyncLoopController {
  const intervalMs = options.intervalMs ?? 10_000;
  let stopped = false;
  let inFlight = false;

  const flushNow = async (): Promise<PosOutboxSyncSnapshot> => {
    if (inFlight) return buildIdleSnapshot(options.repositories);

    inFlight = true;
    await emitState(options, await buildSyncingSnapshot(options.repositories));

    try {
      const snapshot = await flushOutboxOnce(options);
      await emitState(options, snapshot);
      return snapshot;
    } catch (error) {
      const snapshot = await buildUnexpectedFailureSnapshot(options.repositories, error);
      await emitState(options, snapshot);
      return snapshot;
    } finally {
      inFlight = false;
    }
  };

  const timer = globalThis.setInterval(() => {
    if (!stopped) void flushNow();
  }, intervalMs);

  if (options.runImmediately ?? true) void flushNow();

  return {
    flushNow,
    stop() {
      stopped = true;
      globalThis.clearInterval(timer);
    },
  };
}

async function buildIdleSnapshot(
  repositories: LocalSaleRepositories
): Promise<PosOutboxSyncSnapshot> {
  const counts = await readOutboxCounts(repositories);
  return {
    status: "IDLE",
    pendingCount: counts.pendingCount,
    failedEventCount: counts.failedEventCount,
    attemptedCount: 0,
    syncedCount: 0,
    failedAttemptCount: 0,
  };
}

async function buildSyncingSnapshot(
  repositories: LocalSaleRepositories
): Promise<PosOutboxSyncSnapshot> {
  const counts = await readOutboxCounts(repositories);
  return {
    status: "SYNCING",
    pendingCount: counts.pendingCount,
    failedEventCount: counts.failedEventCount,
    attemptedCount: 0,
    syncedCount: 0,
    failedAttemptCount: 0,
  };
}

async function buildUnexpectedFailureSnapshot(
  repositories: LocalSaleRepositories,
  error: unknown
): Promise<PosOutboxSyncSnapshot> {
  const counts = await readOutboxCounts(repositories);
  return {
    status: "OFFLINE",
    pendingCount: counts.pendingCount,
    failedEventCount: counts.failedEventCount,
    attemptedCount: 0,
    syncedCount: 0,
    failedAttemptCount: 0,
    lastAttemptAt: new Date().toISOString(),
    lastError: error instanceof Error ? error.message : String(error),
  };
}

async function emitState(
  options: OutboxSyncLoopOptions,
  snapshot: PosOutboxSyncSnapshot
): Promise<void> {
  await options.onStateChange?.(snapshot);
}

async function readOutboxCounts(
  repositories: LocalSaleRepositories
): Promise<{ pendingCount: number; failedEventCount: number }> {
  const entries = await repositories.outbox.listEntries();
  return {
    pendingCount: entries.filter((entry) => entry.status === "PENDING").length,
    failedEventCount: entries.filter((entry) => entry.status === "FAILED").length,
  };
}

const defaultFetch: FetchLike = async (input, init) => {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("No fetch implementation is available for POS sync");
  }

  return globalThis.fetch(input, init);
};
