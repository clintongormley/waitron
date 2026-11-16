# Rejoin side files implementation plan

**Status:** Implemented and cleared by the watcher on 2026-11-16 in this PR. No owner design approval is claimed.
**Source:** `/Users/clintongormley/waitron-campaign-f/queue.md`, REJOIN-SIDE-FILES, watcher 2026-11-16 01:35.
**Verbatim ask:** “`docs/backlog.md:1881` (detail `docs/backlog/ci.md:6`): `apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe; add the rejoin-level case with the database's side files present on disk (the wipe itself is pinned by `db-wipe.test.ts`). Test only; small; one PR; delete the entry.”

**Outcome:** The existing rejoin case detects leftover SQLite side files; delete the completed backlog entry in the same PR.
**Reuse:** Real filesystem, `openVenueDatabase`, existing `run` fixture and real wipe closure; follow `apps/server/src/db-wipe.test.ts`'s open-handle setup.
**Files:** `apps/server/src/rejoin-command.test.ts`, plus this entry's deletion from `docs/backlog.md` and `docs/backlog/ci.md`.
**Forecast:** Production +0/-0; tests +15–30/-2–8; test support +0/-0; backlog docs +0/about -10 lines, plus this plan.
**Excluded:** New fixture, mock, production helper, dependency, schema, runtime behavior, fiscal change or provider request. Production and `db-wipe.test.ts` stay unchanged.

## One task: strengthen the existing real-wipe case

- [x] Strengthen the case near line 154: “drives the real wipe closure: both database files go, then the directory is re-migrated and trading.env cleared”.
- [x] Keep `openVenueDatabase(venueDir)` open until cleanup. Retain marker-table creation; insert one row per database through `live.venue.run` and `live.node.run`.
- [x] Before `run`, assert these exist: `venue.db`, `venue.db-wal`, `venue.db-shm`, `node.db`, `node.db-wal`, `node.db-shm`. Both WALs (write-ahead logs) must have `stat(...).size > 0`. Reuse one local filename list before/after.
- [x] Retain injected `openDb`, `rejoin`, `closePreWipe` and `migrate`. Keep the separate real handle open through the wipe and assertions, preventing close from removing side files first.
- [x] Preserve `code === 0`, all six post-wipe `stat` rejections with `code: "ENOENT"`, `migrated === [venueDir]`, and the `trading.env` absence assertion.
- [x] Use `let live: VenueDatabase | undefined`; in `finally`, use `await live?.close().catch(() => {})`, then remove `stateDir`, matching `db-wipe.test.ts` and preserving assertion failures. The case owns the wipeable resource so it can assert removal before closing it.
- [x] Leave `migrate` unchanged; it records the directory without recreating files. Preserve its target assertion.
- [x] Reuse the driver’s already-created detached shared clone, which already has its own `pnpm install --frozen-lockfile` install.
- [x] There only, change `apps/server/src/db-wipe.ts`'s suffix loop to `[""]`, omitting side-file removal. Run the original case: expect PASS without side files at wipe time.
- [x] Apply the strengthened test there: expect FAIL on the remaining `venue.db-wal` absence assertion, not setup/cleanup. Record output.
- [x] Restore `db-wipe.ts`; rerun for PASS. Remove only that disposable clone and its temporary parent after collecting receipts. Feature-branch production stays untouched.
- [x] Delete the backlog entry by its exact heading, “`apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe”, in `docs/backlog.md` and `docs/backlog/ci.md`; the quoted ask’s line number has drifted. Preserve adjacent entries.

**Named verification commands (from the checkout root):**

- Each control: `pnpm --filter @waitron/server exec vitest run src/rejoin-command.test.ts -t 'drives the real wipe closure' --reporter=dot`; require one executed case and expected PASS/FAIL/PASS.
- Final: `pnpm --filter @waitron/server exec vitest run src/rejoin-command.test.ts src/db-wipe.test.ts --reporter=dot`; require both files and passing test counts.
- `git diff --check` and `git diff --numstat`: confirm named files and production +0/-0. Later use normal pre-push checks and current-head CI; no whole-package local run.
