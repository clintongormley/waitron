# One query at a time: proposed guard

Sol-high proposal for Claude review and watcher clearance; no owner design approval. Verbatim `/Users/clintongormley/waitron-campaign-f/receipts/one-query-at-a-time-20261116/ask.txt`:

> ### ONE-QUERY-AT-A-TIME. A check that fails when two queries run at once on one transaction — `in-progress` — started 2026-11-16 01:23 — inspecting wrapper and violations; plan review next
> - **Ask:** `docs/backlog.md:2108` ("Nothing stops two queries being started at once on one transaction"; CLAUDE.md §3: "Await queries on one transaction in turn, never `Promise.all`"). Add the cheapest check that fails when a second query starts on a transaction while one is in flight (in the store's transaction wrapper, tests only if a production check costs), then fix the violations it finds. If it finds many, stop at the plan and list them. Plan first; one PR; delete the entry, and name the check in CLAUDE.md's line as its guard.

## Recommendation and finish line

Recommend a static guard using TypeScript's syntax tree (AST). CI rejects the shared-transaction patterns below with file:line. This detects syntax, not dynamic overlap; watcher clearance must accept that narrower finish line before building or deleting the backlog entry.

The real-adapter probe on Node 26.13.0 ran raw and builder query pairs through `Promise.all` in one transaction: native-statement peak was 1; both raw statements finished before the array returned. Receipt: `~/waitron-campaign-f/receipts/one-query-at-a-time-20261116/synchronous-probe.txt`. A native busy flag therefore misses these calls. Builder instrumentation or delaying the synchronous driver would add machinery this proposal avoids.

Reuse `scripts/no-history-length.test.ts`'s parser/fixture/tree pattern. Leave `connections.ts`, `write-queue.ts`, `tenancy.ts` and the adapter unchanged.

## Bounded source check

Create `scripts/one-query-at-a-time.test.ts`. Scan non-test source files under `apps/` and `packages/`, excluding dependency/build/test-support directories.

Recognise inline `withTransaction`, `withNodeTransaction` and `.transaction` callbacks, plus parameters explicitly typed `Transaction`/`NodeTransaction`. Respect shadowed bindings. Flag literal `Promise.all`/`allSettled` arrays with two unawaited branches using the same transaction as query receiver or helper argument; flag mapped inputs using that transaction too. Already awaited elements are sequential.

Limits: aliases, stored promise arrays, hidden captures, computed combinators, custom schedulers, inferred/destructured parameters and bare `withWriteLock` bodies escape detection. Helper arguments indicate possible database work, not proof. Independent reads outside transaction scopes remain allowed. Omit frameworks, global Drizzle patches, connection/session redesign and async emulation.

## Inspection and implementation responsibilities

No same-transaction violation was confirmed in inspected candidates. Preserve `apps/server/src/start-peer-check.ts:174` and `boot.ts:2342` (outside reads), `tender-refund-recovery.ts:71-75` (separate queued transactions), and `mirror-bundle.ts:198-227` (one venue transaction beside node/file reads). These are inspection findings, not overlap measurements. If many actual violations emerge, stop with their file:line list.

- [ ] TDD: watch negative scanner fixtures fail first. Assert exact lines for parallel builders, raw calls, helpers and mapped work. Positive cases: sequential awaits, awaited elements, shadowing, unrelated reads, independent transactions, comments/strings. The tree assertion owns file selection and production findings.
- [ ] Implement; delete detection and confirm the negative assertion fails. Inject forbidden syntax into tree-scan input, verify file:line, restore and rerun. Scan bad then good input to check reset. No runtime failure/reset tests: no runtime state changes.
- [ ] Update `docs/developers/conventions-data.md:2258-2261` with limits; delete the `docs/backlog.md` entry after watcher acceptance. Have Claude add the one-line “weaker than the rule” guard annotation to `CLAUDE.md`; do not edit it now.
- [ ] Run `pnpm exec vitest run scripts/one-query-at-a-time.test.ts`, checking the test count; normal pre-push once; package suites in CI. Keep scanner inline; any new non-test module requires root `vitest.config.ts` coverage inclusion.

Size: production 0 lines; test-side scanner 100–140; fixtures/tree checks 70–100; documentation about 15. One PR after clearance.

Claude review: does this deliver the ask by the simplest reasonable route, and what does it build that was not asked for? Then, is it correct and buildable? Does this change runtime semantics? Intended answer: no. Watcher: accept limited static checking instead of dynamic in-flight detection?
