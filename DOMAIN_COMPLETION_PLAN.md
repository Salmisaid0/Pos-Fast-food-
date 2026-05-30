# Domain Completion Plan

This plan starts after foundation hardening for the single-branch, cash-only, offline-first POS scope.
It focuses on making `packages/shared-types` the stable contract layer used by the POS desktop app,
API, workers, fiscal engine, and sync engine.

## Current domain baseline

The current shared contract package contains these first DTOs:

- `OrderItem`
- `Order`
- `CashPayment`
- `Receipt`
- `SyncEvent`
- `PrinterJob`

These are enough for smoke tests, but not yet complete enough for durable offline sales, receipt audit,
server sync, or printer queue processing.

## Goals

1. Make all sale-critical DTOs explicit, versioned, and stable.
2. Represent the complete single-branch cash sale lifecycle from local cart to synced order.
3. Keep payment scope cash-only.
4. Keep branch scope single-branch; do not add multi-branch fields yet.
5. Preserve offline-first behavior: every finalized sale must be representable as a local order plus outbox events.
6. Preserve print architecture: DTOs can describe print jobs, but clients still cannot call printers directly.
7. Add domain-level validation and tests before implementing persistence or UI workflows.

## Non-goals

- No CIB, Edahabia, SATIM, online card, or external payment DTOs.
- No multi-branch ownership model.
- No customer loyalty system.
- No supplier, purchase order, or advanced inventory module yet.
- No kitchen display workflow beyond printer job contracts.

## Workstream 1: Core primitives

### Deliverables

- Replace loose primitive aliases with branded/domain-oriented primitives where useful:
  - `EntityId`
  - `OrderId`
  - `ProductId`
  - `ReceiptId`
  - `PrinterJobId`
  - `SyncEventId`
  - `IdempotencyKey`
  - `IsoDateTimeString`
  - `CurrencyDZD`
- Define a single `FiscalVersion` union with current value `"v1"`.
- Define `VatRate` constants/types for the current VAT-disabled scope.

### Acceptance criteria

- No domain DTO uses unexplained `string` for important identifiers without a type alias.
- Fiscal version is imported from one shared contract type instead of repeated literal strings.
- TypeScript strict mode passes.

## Workstream 2: Product and menu contracts

### Deliverables

- Add `Product` DTO:
  - `id`
  - `sku`
  - `name`
  - `description`
  - `priceDZD`
  - `vatRate`
  - `categoryId`
  - `isActive`
  - `createdAt`
  - `updatedAt`
- Add `ProductCategory` DTO:
  - `id`
  - `name`
  - `sortOrder`
  - `isActive`
- Add minimal product snapshot fields into `OrderItem` so historical receipts do not change if a product is renamed.

### Acceptance criteria

- `OrderItem` contains immutable sale-time product data: product id, display name, unit price, VAT rate, quantity, and line totals.
- Products can be deactivated without breaking old orders.
- Smoke tests cover creating an order item from a product snapshot.

## Workstream 3: Order lifecycle contracts

### Deliverables

- Expand `OrderStatus`:
  - `DRAFT`
  - `FINALIZED_LOCAL`
  - `PENDING_SYNC`
  - `SYNCED`
  - `SYNC_FAILED`
  - `VOIDED`
- Expand `Order`:
  - `id`
  - `localSequence`
  - `status`
  - `items`
  - `subtotalDZD`
  - `vatAmountDZD`
  - `totalDZD`
  - `receiptId`
  - `paymentId`
  - `createdAt`
  - `finalizedAt`
  - `updatedAt`
- Add domain helper input types for creating/finalizing orders:
  - `CreateOrderDraftInput`
  - `FinalizeCashOrderInput`

### Acceptance criteria

- A finalized cash sale can be represented without API/server availability.
- `Order` references the payment and receipt snapshots required for audit.
- Order totals are explicit and can be compared with fiscal engine output.

## Workstream 4: Cash payment contracts

### Deliverables

- Add `PaymentId` primitive.
- Expand `CashPayment`:
  - `id`
  - `orderId`
  - `method: "CASH"`
  - `amountDueDZD`
  - `receivedDZD`
  - `changeDZD`
  - `paidAt`
  - `createdAt`
- Add `PaymentStatus` if needed:
  - `RECORDED`
  - `VOIDED`

### Acceptance criteria

- Underpayment remains invalid in domain logic.
- Payment DTO contains enough data to reprint/audit the receipt later.
- No non-cash payment method appears in the union yet.

## Workstream 5: Fiscal receipt contracts

### Deliverables

- Expand `Receipt`:
  - `id`
  - `orderId`
  - `fiscalVersion`
  - `receiptNumber`
  - `subtotalDZD`
  - `vatRate`
  - `vatAmountDZD`
  - `totalDZD`
  - `issuedAt`
  - `lines`
- Add `ReceiptLine` with product snapshot, quantity, unit price, net/gross totals, and VAT amount.
- Add `FiscalReceiptInput` used by `packages/fiscal-engine`.
- Keep fiscal engine version `v1` and VAT-disabled behavior deterministic.

### Acceptance criteria

- Receipts are immutable snapshots.
- Receipt output contains fiscal version and issued timestamp.
- Fiscal-engine tests cover receipt line totals and header totals.

## Workstream 6: Offline sync event contracts

### Deliverables

- Expand `SyncEventType`:
  - `ORDER_FINALIZED`
  - `CASH_PAYMENT_RECORDED`
  - `RECEIPT_ISSUED`
  - `PRINT_JOB_REQUESTED`
- Expand `SyncEvent`:
  - `id`
  - `type`
  - `schemaVersion`
  - `aggregateId`
  - `aggregateType`
  - `payload`
  - `idempotencyKey`
  - `createdAt`
  - `attemptCount`
  - `lastAttemptAt`
- Add typed payload interfaces for each event type.

### Acceptance criteria

- Every event has an idempotency key and schema version.
- Event payloads are discriminated by event type.
- Sync-engine tests prove pending events can be flushed in order.

## Workstream 7: Printer job contracts

### Deliverables

- Expand `PrinterJob`:
  - `id`
  - `orderId`
  - `receiptId`
  - `type: "RECEIPT" | "KITCHEN"`
  - `targetPrinterId`
  - `payload`
  - `status`
  - `attemptCount`
  - `createdAt`
  - `updatedAt`
- Add `Printer` DTO for server-side printer registry:
  - `id`
  - `name`
  - `ipAddress`
  - `port`
  - `role`
  - `isActive`
- Ensure POS desktop DTOs only request print jobs through sync/API contracts; no direct printer calls.

### Acceptance criteria

- Client-facing contracts do not require printer IPs for direct TCP calls.
- Worker-facing contracts contain enough information to process queued print jobs.
- Tests cover worker accepting a queued print job contract.

## Workstream 8: Runtime validation

### Deliverables

- Add a schema validation library after dependency approval, preferably Zod.
- Create schemas beside DTOs or in a dedicated package section:
  - `OrderSchema`
  - `CashPaymentSchema`
  - `ReceiptSchema`
  - `SyncEventSchema`
  - `PrinterJobSchema`
- Export inferred TypeScript types only if schemas become the source of truth.

### Acceptance criteria

- API sync ingestion can validate incoming events at runtime.
- POS local persistence can validate event payloads before writing to SQLite outbox.
- Invalid DTO fixtures fail tests.

## Workstream 9: Tests and fixtures

### Deliverables

- Add reusable fixtures for:
  - product
  - order item
  - finalized order
  - cash payment
  - receipt
  - sync event
  - printer job
- Expand `tests/run-tests.ts` or move to a proper test runner in a later phase.
- Test all critical invariants:
  - no negative quantity
  - no negative price
  - no underpayment
  - fiscal totals match order totals
  - event idempotency key exists
  - print jobs are server/worker scoped

### Acceptance criteria

- `npm run check` passes from a clean checkout after `npm install`.
- Tests prove one complete finalized cash sale can be represented from product to receipt to sync event to print job.

## Suggested implementation order

1. Core primitives and status unions.
2. Product and category DTOs.
3. Expanded order/order-item DTOs.
4. Expanded cash payment DTO.
5. Expanded receipt and receipt-line DTOs.
6. Typed sync events and payloads.
7. Printer/printer-job DTOs.
8. Domain fixtures and invariant tests.
9. Runtime schemas.

## Definition of done for Domain Completion

- `packages/shared-types` exports complete single-branch cash-sale contracts.
- `packages/fiscal-engine` consumes the new receipt input/output contracts.
- `apps/pos-desktop`, `apps/api`, and `apps/workers` compile against package entrypoints, not fragile source-relative imports.
- `npm run check` passes from a clean build.
- No multi-branch or non-cash payment DTOs are introduced.
