# POS Fast Food

Offline-first, single-branch, cash-only fast-food POS implementation baseline.

## Foundation rules

- Source code is committed; generated build output is not.
- `dist/`, `.turbo/`, `coverage/`, local SQLite databases, logs, and local `.env` files are ignored.
- Workspaces build through TypeScript project references and Turbo task ordering.
- The POS desktop client must not import API or worker implementation code.
- Shared packages must not import from `apps/*`.

## Local workflow

```bash
npm install
npm run build
npm run typecheck
npm run test
npm run check
npm run dev -w @apps/pos-desktop
```

## Git hooks

- `pre-commit`: runs `lint-staged` for fast formatting/linting of staged files.
- `pre-push`: runs `npm run typecheck && npm run test`.

## Build artifact policy

Do not commit generated output. If `dist/` is created locally, it should remain untracked. The
`npm run verify:no-tracked-build-output` guard fails when build/cache artifacts are tracked by git.

## Runtime configuration

The API runtime now boots through `apps/api/src/main.ts` and reads these environment variables:

- `API_PORT` or `PORT`: HTTP port. Defaults to `3000`.
- `API_HOST`: optional bind host, for example `127.0.0.1` in local development.

The worker Redis print queue adapter reads these environment variables when constructing the Redis-backed
repository:

- `REDIS_URL`: full Redis connection URL. If set, it is used as the primary connection target.
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`: host/port/database values when no full URL is preferred.
- `REDIS_USERNAME`, `REDIS_PASSWORD`: optional Redis authentication.
- `REDIS_KEY_PREFIX`: optional Redis key prefix for this POS deployment.
- `PRINT_JOBS_HASH_KEY`: optional override for the print-job hash key.
- `PRINT_JOBS_RUNNABLE_SET_KEY`: optional override for the runnable print-job sorted-set key.

Arabic thermal-printer output is exposed through an `EscPosTextEncoder` implementation. Use
`createArabicCodePageTextEncoder()` with the target printer's ESC/POS code-page command when hardware
requires Arabic byte output instead of UTF-8.

## POS local durability

`apps/pos-desktop` now includes `LocalJsonSaleRepositories`, a durable local adapter for the current
Node/test runtime. It persists finalized local orders, cash payments, receipts, and sync outbox entries to a
single JSON file using atomic write-and-rename semantics. This gives the offline-first sale flow a durable
contract that can later be backed by Tauri SQLite without changing the sale finalization service.
