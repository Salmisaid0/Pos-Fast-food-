"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acceptSyncEvent = acceptSyncEvent;
const processedIdempotencyKeys = new Set();
function acceptSyncEvent(event) {
    if (processedIdempotencyKeys.has(event.idempotencyKey)) {
        return { accepted: false, reason: "duplicate_idempotency_key" };
    }
    processedIdempotencyKeys.add(event.idempotencyKey);
    return { accepted: true };
}
