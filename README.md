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
```

## Git hooks

- `pre-commit`: runs `lint-staged` for fast formatting/linting of staged files.
- `pre-push`: runs `npm run typecheck && npm run test`.

## Build artifact policy

Do not commit generated output. If `dist/` is created locally, it should remain untracked. The
`npm run verify:no-tracked-build-output` guard fails when build/cache artifacts are tracked by git.
