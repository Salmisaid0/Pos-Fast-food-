import { calculateCashPayment } from "../apps/pos-desktop/src/cash";
import { calculateReceiptTotals } from "../packages/fiscal-engine/src";
import { flushOutbox, LocalOutboxRepository, RemoteSyncApi } from "../packages/sync-engine/src";
import { acceptSyncEvent } from "../apps/api/src/sync";
import { SyncEvent } from "../packages/shared-types/src";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function testCashCalculation(): Promise<void> {
  const payment = calculateCashPayment(1000, 1200);
  assert(payment.changeDZD === 200, "Cash change should be 200");
}

async function testFiscalCalculation(): Promise<void> {
  const totals = calculateReceiptTotals(1000);
  assert(totals.vatAmountDZD === 90, "VAT should be 90 for subtotal 1000");
  assert(totals.totalDZD === 1090, "Total should be 1090");
}

async function testIdempotencyGuard(): Promise<void> {
  const event: SyncEvent = {
    id: "1",
    type: "ORDER_CREATED",
    payload: { orderId: "o-1" },
    createdAt: new Date().toISOString(),
    idempotencyKey: "idem-1",
  };

  const first = acceptSyncEvent(event);
  const second = acceptSyncEvent(event);
  assert(first.accepted === true, "First event must be accepted");
  assert(second.accepted === false, "Duplicate event must be rejected");
}

async function testFlushOutbox(): Promise<void> {
  const pending: SyncEvent[] = [
    { id: "1", type: "ORDER_CREATED", payload: {}, createdAt: "t", idempotencyKey: "k1" },
    { id: "2", type: "ORDER_CREATED", payload: {}, createdAt: "t", idempotencyKey: "k2" },
  ];
  const synced = new Set<string>();

  const outbox: LocalOutboxRepository = {
    async enqueue() {},
    async listPending(limit: number) {
      return pending.slice(0, limit);
    },
    async markSynced(eventId: string) {
      synced.add(eventId);
    },
  };

  const api: RemoteSyncApi = {
    async pushEvent() {
      return;
    },
  };

  const count = await flushOutbox(outbox, api, 50);
  assert(count === 2, "flushOutbox should sync 2 events");
  assert(synced.has("1") && synced.has("2"), "Both events should be marked synced");
}

async function main(): Promise<void> {
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
