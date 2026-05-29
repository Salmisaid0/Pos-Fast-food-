# Enterprise Offline-First Fast-Food POS System

## Start Plan (Scope Reduced as Requested)

Per your instruction, we are **starting without**:

- Multi-branch support
- Card payment integration (SATIM/CIB/Edahabia)

This first execution plan focuses only on:

1. Single-branch operations
2. Cash-first checkout
3. Offline-first reliability
4. Fiscal receipt generation (9% VAT)
5. Reliable server-side printing

---

## 1) Phase 0 Scope (What We Build First)

### In Scope

- Single branch, single tenant behavior
- Product catalog and categories
- Cart and order workflow
- Cash payment with automatic change calculation (DA)
- Local offline persistence in POS desktop app
- Sync outbox from local app to server when online
- Receipt generation with 9% VAT logic
- Print job queue and thermal printer worker (ESC/POS)
- Basic manager view for same branch (sales list, totals)

### Out of Scope (Deferred)

- Multi-branch and branch isolation/RLS
- SATIM/CIB/Edahabia integration
- Advanced inventory purchasing flows
- Cross-branch analytics
- Mobile companion app

---

## 2) Execution Roadmap (First 8 Weeks)

## Week 1–2: Monorepo and Core Foundations

### Deliverables

- Bootstrap monorepo:
  - `apps/pos-desktop` (Tauri + React + TypeScript)
  - `apps/api` (NestJS)
  - `apps/workers` (Bull/Redis print worker)
  - `packages/shared-types`
- Tooling:
  - ESLint + Prettier + TypeScript strict mode
  - basic CI pipeline (`lint`, `typecheck`, `test`)
- Initial shared domain contracts:
  - `Product`, `Order`, `OrderItem`, `CashPayment`, `Receipt`, `PrintJob`, `SyncEvent`

### Exit Criteria

- Repo builds successfully
- Shared types imported by both client and server

---

## Week 3–4: Offline Cash Register Vertical Slice

### Deliverables

- POS UI for:
  - product list/search
  - cart management
  - cash amount entry
  - automatic change calculation
- Local database (SQLite in Tauri):
  - `orders_local`
  - `payments_local`
  - `sync_outbox`
- Local-first order completion flow:
  - sale completes instantly even when offline
  - event stored in outbox for later sync

### Exit Criteria

- Cashier can complete sale offline end-to-end
- Restart app and data is still present

---

## Week 5–6: Backend Order/Receipt Pipeline

### Deliverables

- NestJS modules:
  - `auth` (basic local users)
  - `catalog`
  - `orders`
  - `receipts`
  - `printers`
- Postgres schema (single branch assumptions)
- Idempotent order create endpoint
- Fiscal engine v1:
  - subtotal
  - 9% VAT computation
  - total + receipt payload
- Sync API endpoint to consume outbox events

### Exit Criteria

- Offline-created order syncs successfully when network returns
- Server returns stable receipt payload for print/render

---

## Week 7–8: Printing, Hardening, Pilot Readiness

### Deliverables

- Redis + Bull queue:
  - `print.jobs`
- Print worker:
  - consume job
  - send ESC/POS over TCP 9100
  - retry policy on failure
- Basic operational dashboard:
  - recent orders
  - print status (queued/sent/failed)
- Windows installer packaging with Tauri

### Exit Criteria

- Completed sale produces queued print job and printer output
- Retry path works when printer is temporarily offline

---

## 3) Minimal Technical Architecture (Now)

### POS Desktop

- Tauri + React front-end
- SQLite local store
- Outbox sync loop with retry/backoff
- UI state flow:
  - `CartOpen -> CashEntered -> PaidLocal -> QueuedForSync -> Synced`

### Backend

- NestJS REST API
- PostgreSQL 16
- Redis + Bull worker for printing
- No multi-tenant logic yet

### Data Principles

- Use idempotency keys for order creation
- Keep append-only sync events for audit and replay
- Keep fiscal calculations in dedicated module (`fiscal-engine`)

---

## 4) First Implementation Backlog (Start Immediately)

### Epic A — POS Shell & Navigation

- Create app layout (menu, product panel, cart panel)
- Add keyboard-friendly cashier shortcuts

### Epic B — Offline Storage Layer

- Add SQLite setup and migration scripts
- Implement repository functions:
  - `saveOrderLocal`
  - `savePaymentLocal`
  - `enqueueSyncEvent`

### Epic C — Cash Payment UX

- Add numeric keypad component
- Compute change in real-time
- Validate underpay/overpay scenarios

### Epic D — Sync Engine v1

- Poll connectivity status
- Flush outbox on reconnect
- Persist sync success/failure states

### Epic E — Receipt & Printing

- Implement fiscal receipt DTO (9% VAT)
- Build `POST /print-job` flow
- Implement print worker retry behavior

---

## 5) Non-Negotiable Rules for This Start

- Sale completion must never depend on internet.
- No direct printing from client; only server queue worker.
- Every synced order must be idempotent.
- Fiscal computation must be covered by unit tests.
- Keep code ready for future multi-branch extension (but do not implement now).

---

## 6) Testing Plan for This First Scope

### Automated

- Unit tests:
  - cash change calculator
  - 9% VAT calculator
  - sync retry/backoff logic
- Integration tests:
  - outbox sync endpoint idempotency
  - print queue to worker processing
- E2E scenario:
  - offline sale -> reconnect -> sync -> print success

### Manual Pilot Checks

- Simulate internet down during peak checkout
- Simulate printer unavailable for first attempt
- Validate receipt values and formatting consistency

---

## 7) What Comes After This (Deferred Later)

After this 8-week baseline is stable in production pilot:

1. Add SATIM payment integration
2. Add inventory purchasing module depth
3. Add multi-branch + RLS isolation
4. Add cross-branch reporting

This order reduces early complexity and gets you to a usable, revenue-generating POS faster.
