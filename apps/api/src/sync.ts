import type { SyncEvent } from "@packages/shared-types";

const processedIdempotencyKeys = new Set<string>();

export function acceptSyncEvent(event: SyncEvent): { accepted: boolean; reason?: string } {
  if (processedIdempotencyKeys.has(event.idempotencyKey)) {
    return { accepted: false, reason: "duplicate_idempotency_key" };
  }

  processedIdempotencyKeys.add(event.idempotencyKey);
  return { accepted: true };
}
