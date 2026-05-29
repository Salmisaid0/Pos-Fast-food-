# Fiscal Engine v1 Stabilization Plan

This plan starts after the Domain Completion planning step. Domain Completion itself is **not complete yet**:
`DOMAIN_COMPLETION_PLAN.md` currently defines the required workstreams and explicitly states that the
current DTOs are only enough for smoke tests, not durable offline sales, receipt audit, server sync, or
printer queue processing.

Fiscal Engine v1 stabilization should therefore run in parallel with the first Domain Completion contracts
that affect receipts, order totals, cash payments, and sync events.

## Current fiscal engine baseline

The current implementation in `packages/fiscal-engine` is intentionally minimal:

- `FISCAL_ENGINE_VERSION = "v1"`.
- `VAT_RATE_RESTAURATION = 0.09`.
- `calculateReceipt(orderId, subtotalDZD, generatedAt)` computes VAT from a subtotal and returns a
  minimal `Receipt`.
- Rounding is currently `Math.round(value * 100) / 100`.
- Receipt output does not yet include line-level totals, receipt number, receipt id, immutable product
  snapshots, or a formal rounding policy document.

## Stabilization objective

Make Fiscal Engine v1 deterministic, test-covered, auditable, and safe to use for the first production
single-branch, cash-only POS release.

The stable v1 contract must answer these questions every time:

1. What inputs are accepted?
2. What values are rejected?
3. How is each receipt line calculated?
4. How are VAT and totals rounded?
5. What immutable receipt snapshot is produced?
6. How do we prove future fiscal changes do not silently alter historical receipts?

## Scope constraints

### In scope

- Single branch only.
- Cash-only finalized sales.
- 9% restaurant VAT.
- Deterministic receipt totals.
- Receipt snapshots suitable for offline local persistence and later sync.
- Tests for rounding, validation, totals, fiscal versioning, and regression fixtures.

### Out of scope

- Multi-branch tax configuration.
- CIB, Edahabia, SATIM, or external payment flows.
- Multiple VAT rates in the same sale.
- Supplier purchase invoices.
- Fiscal authority integrations or certified e-report submission.
- Discount/promotion engines unless explicitly added to Domain Completion later.

## Workstream 1: Fiscal contract alignment

### Deliverables

- Add or consume shared DTOs from Domain Completion:
  - `FiscalVersion`
  - `ReceiptId`
  - `ReceiptNumber`
  - `ReceiptLine`
  - `FiscalReceiptInput`
  - expanded `Receipt`
- Keep `FISCAL_ENGINE_VERSION` exported as the implementation constant for v1.
- Move the public fiscal input away from raw `(orderId, subtotalDZD)` and toward a structured input object:
  - `orderId`
  - `receiptId`
  - `receiptNumber`
  - `issuedAt`
  - `items`

### Acceptance criteria

- Fiscal engine accepts one structured input type.
- Fiscal engine returns one immutable receipt output type.
- No fiscal function depends on live product records after receipt generation.

## Workstream 2: Deterministic rounding policy

### Deliverables

- Define a formal v1 rounding policy:
  - currency precision is two decimals for internal arithmetic until printing rules are finalized;
  - line subtotal = `unitPriceDZD * quantity`;
  - line VAT = rounded line subtotal multiplied by 9%;
  - receipt subtotal = sum of rounded line subtotals;
  - receipt VAT = sum of rounded line VAT amounts;
  - receipt total = subtotal + VAT.
- Add `roundCurrencyDZD(value)` as an exported or internal tested utility.
- Document why line-level VAT summing is chosen for v1 to make printed receipt lines reconcile with totals.

### Acceptance criteria

- Rounding policy is documented in code comments and tests.
- All total calculations use the same rounding helper.
- Tests cover values with decimal inputs and boundary values like `0.005`, `0.015`, and repeated small lines.

## Workstream 3: Input validation and invariant checks

### Deliverables

- Validate fiscal inputs before calculating:
  - non-empty order id;
  - non-empty receipt id;
  - non-empty receipt number;
  - valid ISO issued timestamp;
  - at least one line item;
  - quantity greater than zero;
  - unit price greater than or equal to zero;
  - VAT rate exactly 9% for v1;
  - finite numeric values only.
- Add explicit error messages or typed domain errors:
  - `InvalidFiscalInputError`
  - `UnsupportedVatRateError`
  - `InvalidReceiptLineError`

### Acceptance criteria

- Invalid fiscal input fails before generating a receipt.
- Error messages identify the invalid field.
- Fiscal engine never returns `NaN`, `Infinity`, negative totals, or partial receipts.

## Workstream 4: Receipt line calculation

### Deliverables

- Add deterministic line calculation:
  - product id snapshot;
  - product display name snapshot;
  - quantity;
  - unit price;
  - subtotal;
  - VAT rate;
  - VAT amount;
  - total.
- Include a line ordering rule based on input order.
- Preserve line snapshots even if product name or price changes later.

### Acceptance criteria

- Receipt lines reconcile exactly with receipt totals.
- Same input always produces byte-for-byte equivalent calculated receipt values except object key order.
- Tests cover one-line and multi-line receipts.

## Workstream 5: Versioning and backwards compatibility

### Deliverables

- Add a fiscal v1 changelog file or section:
  - what v1 means;
  - VAT rate;
  - rounding policy;
  - receipt line policy;
  - breaking-change rules.
- Add snapshot/regression fixtures:
  - simple one-line receipt;
  - multi-line receipt;
  - decimal price receipt;
  - zero-price allowed item if business permits free modifiers/items.
- Make tests assert `fiscalVersion === "v1"` for every generated receipt.

### Acceptance criteria

- Future fiscal changes require a new version or explicit fixture update.
- Tests fail if v1 output changes unexpectedly.
- v1 behavior is documented enough for audit and developer handoff.

## Workstream 6: Integration with order and cash payment flow

### Deliverables

- Update `apps/pos-desktop` cash finalization flow after Domain Completion implementation:
  - finalize local order;
  - calculate receipt using fiscal engine;
  - calculate cash payment;
  - write order/payment/receipt/outbox events locally.
- Ensure fiscal totals and cash amount due use the same `Receipt.totalDZD`.
- Add a single complete-sale smoke fixture that connects:
  - product snapshot;
  - order item;
  - fiscal receipt;
  - cash payment;
  - sync event;
  - print job request.

### Acceptance criteria

- Cash payment cannot be calculated from a different total than the receipt total.
- Offline sale record contains enough data to reprint receipt without recalculating against changed product data.
- Existing smoke tests prove the complete cash sale path stays valid.

## Workstream 7: Print formatting boundary

### Deliverables

- Keep fiscal engine responsible for fiscal values only.
- Do not put ESC/POS printer commands inside fiscal engine.
- Define a `PrintableReceiptView` or similar mapping later in worker/API layer if needed.
- Ensure receipt output has enough fields for printer workers to format fiscal receipts.

### Acceptance criteria

- Fiscal engine has no direct printer dependency.
- Worker receives receipt/print job DTOs and formats outside fiscal engine.
- No direct client printer call is introduced.

## Workstream 8: Test matrix

### Required passing tests

1. Generates v1 receipt for one item at 9% VAT.
2. Generates v1 receipt for multiple items at 9% VAT.
3. Rounds line totals deterministically.
4. Sums rounded line VAT into receipt VAT.
5. Rejects empty receipt lines.
6. Rejects zero or negative quantity.
7. Rejects negative unit price.
8. Rejects unsupported VAT rate.
9. Rejects invalid timestamp.
10. Preserves immutable product snapshots.
11. Produces stable regression fixture outputs.
12. Keeps cash payment due equal to receipt total.

## Suggested implementation order

1. Add fiscal shared DTOs during Domain Completion Workstreams 1 and 5.
2. Replace `calculateReceipt(orderId, subtotalDZD)` with structured `calculateReceipt(input)`.
3. Add deterministic rounding helper and tests.
4. Add validation and domain errors.
5. Add receipt line calculations and multi-line tests.
6. Add regression fixtures.
7. Integrate receipt total with cash payment smoke test.
8. Document v1 fiscal contract and changelog.

## Definition of done for Fiscal Engine v1 Stabilization

- Fiscal engine uses structured input and returns immutable receipt snapshots.
- Fiscal engine rejects invalid inputs with explicit errors.
- 9% VAT and rounding policy are documented and tested.
- Receipt line totals, VAT totals, and grand totals reconcile exactly.
- Regression fixtures protect v1 from accidental behavioral changes.
- `npm run check` passes from a clean build.
- No multi-branch, card payment, SATIM, or direct-printer behavior is introduced.
