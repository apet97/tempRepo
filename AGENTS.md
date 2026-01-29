# Repository Agent Instructions (OTPLUS)

## Scope & Safety
- Do not add new dependencies or tools without explicit user request.
- Do not change CI/CD, auth, or security settings unless asked.
- Never log or persist auth tokens or PII.

## Project Orientation
- Read `README.md` and `docs/` before making behavioral changes.
- Key modules:
  - `js/main.ts` (controller/orchestration)
  - `js/api.ts` (Clockify API + rate limiting)
  - `js/calc.ts` (overtime engine)
  - `js/state.ts` (store + persistence)
  - `js/ui/*` (rendering + events)
  - `js/export.ts` (CSV export safety)

## Development Workflow
- Prefer small, focused diffs.
- Use patch-style edits where practical.
- Keep TypeScript type changes in `js/types.ts` in sync with implementations.
- Keep tests deterministic (avoid `Date.now()`/`Math.random()` in tests and helpers).
- Use `docs/test-strategy.md` as the source of truth for testing tier choices.

## Tests & Validation
- When behavior changes, run existing tests:
  - `npm test`
  - If relevant, `npm run lint` and `npm run typecheck`
- Run `npm run test:e2e` for UI-facing or orchestration changes.
- If a full run is too heavy, note which subsets were executed and why.

## Build
- Development build: `npm run build:dev`
- Production build: `npm run build:prod`

## Documentation
- Update `docs/guide.md`, `docs/spec.md`, and `docs/USER-GUIDE.md` when features or behavior change.
- Update `docs/test-strategy.md` when test strategy or quality gates change.
- ADRs live in `docs/adr/`; add new ADRs only when decisions change.
