"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushOutbox = flushOutbox;
async function flushOutbox(outbox, api, batchSize = 50) {
    const pending = await outbox.listPending(batchSize);
    let syncedCount = 0;
    for (const event of pending) {
        await api.pushEvent(event);
        await outbox.markSynced(event.id);
        syncedCount += 1;
    }
    return syncedCount;
}
