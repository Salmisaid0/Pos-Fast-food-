"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cash_1 = require("../apps/pos-desktop/src/cash");
const src_1 = require("../packages/fiscal-engine/src");
const src_2 = require("../packages/sync-engine/src");
const sync_1 = require("../apps/api/src/sync");
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
async function testCashCalculation() {
    const payment = (0, cash_1.calculateCashPayment)("order-1", 1000, 1200);
    assert(payment.changeDZD === 200, "Cash change should be 200");
}
async function testFiscalCalculation() {
    const receipt = (0, src_1.calculateReceipt)("order-1", 1000, "2026-01-01T00:00:00.000Z");
    assert(receipt.vatAmountDZD === 90, "VAT should be 90 for subtotal 1000");
    assert(receipt.totalDZD === 1090, "Total should be 1090");
    assert(receipt.fiscalVersion === src_1.FISCAL_ENGINE_VERSION, "Fiscal version should be v1");
}
async function testIdempotencyGuard() {
    const event = {
        id: "1",
        type: "ORDER_CREATED",
        payload: { orderId: "o-1" },
        createdAt: new Date().toISOString(),
        idempotencyKey: "idem-1",
    };
    const first = (0, sync_1.acceptSyncEvent)(event);
    const second = (0, sync_1.acceptSyncEvent)(event);
    assert(first.accepted === true, "First event must be accepted");
    assert(second.accepted === false, "Duplicate event must be rejected");
}
async function testFlushOutbox() {
    const pending = [
        { id: "1", type: "ORDER_CREATED", payload: {}, createdAt: "t", idempotencyKey: "k1" },
        { id: "2", type: "CASH_PAYMENT_RECORDED", payload: {}, createdAt: "t", idempotencyKey: "k2" },
    ];
    const synced = new Set();
    const outbox = {
        async enqueue() { },
        async listPending(limit) {
            return pending.slice(0, limit);
        },
        async markSynced(eventId) {
            synced.add(eventId);
        },
    };
    const api = {
        async pushEvent() {
            return;
        },
    };
    const count = await (0, src_2.flushOutbox)(outbox, api, 50);
    assert(count === 2, "flushOutbox should sync 2 events");
    assert(synced.has("1") && synced.has("2"), "Both events should be marked synced");
}
async function main() {
    await testCashCalculation();
    await testFiscalCalculation();
    await testIdempotencyGuard();
    await testFlushOutbox();
    console.log("All tests passed.");
}
main().catch((error) => {
    console.error(error);
    throw error;
});
