# Rejoin side files implementation plan

**Status:** Plan only; watcher clearance pending. No owner design approval is claimed.
**Source:** `/Users/clintongormley/waitron-campaign-f/queue.md`, REJOIN-SIDE-FILES, watcher 2026-11-16 01:35.
**Verbatim ask:** “`docs/backlog.md:1881` (detail `docs/backlog/ci.md:6`): `apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe; add the rejoin-level case with the database's side files present on disk (the wipe itself is pinned by `db-wipe.test.ts`). Test only; small; one PR; delete the entry.”

**Outcome:** The existing rejoin case detects leftover SQLite side files; delete the completed backlog entry in the same PR.
**Reuse:** Real filesystem, `openVenueDatabase`, existing `run` fixture and real wipe closure; follow `apps/server/src/db-wipe.test.ts`'s open-handle setup.
**Files:** `apps/server/src/rejoin-command.test.ts`, plus this entry's deletion from `docs/backlog.md` and `docs/backlog/ci.md`.
**Forecast:** Production +0/-0; tests +15–30/-2–8; test support +0/-0; backlog docs +0/about -10 lines, plus this plan.
**Excluded:** New fixture, mock, production helper, dependency, schema, runtime behavior, fiscal change or provider request. Production and `db-wipe.test.ts` stay unchanged.

## One task: strengthen the existing real-wipe case

- [ ] Strengthen the case near line 154: “drives the real wipe closure: both database files go, then the directory is re-migrated and trading.env cleared”.
- [ ] Keep `openVenueDatabase(venueDir)` open until cleanup. Retain marker-table creation; insert one row per database through `live.venue.run` and `live.node.run`.
- [ ] Before `run`, assert these exist: `venue.db`, `venue.db-wal`, `venue.db-shm`, `node.db`, `node.db-wal`, `node.db-shm`. Both WALs (write-ahead logs) must have `stat(...).size > 0`. Reuse one local filename list before/after.
- [ ] Retain injected `openDb`, `rejoin`, `closePreWipe` and `migrate`. Keep the separate real handle open through the wipe and assertions, preventing close from removing side files first.
- [ ] Preserve `code === 0`, all six post-wipe `stat` rejections with `code: "ENOENT"`, `migrated === [venueDir]`, and the `trading.env` absence assertion.
- [ ] Keep the handle in a guarded local; close it in `finally`, then remove `stateDir` in a nested `finally`, even if close fails. The case owns the wipeable resource so it can assert removal before closing it.
- [ ] Omit duplicate absence assertions inside `migrate`: that callback only records the directory; post-call checks expose leftovers. Preserve its target assertion.
- [ ] Use a disposable checkout with its own locked dependency install for the controls; reuse the driver’s already-created detached shared clone.
- [ ] There only, change `apps/server/src/db-wipe.ts`'s suffix loop to `[""]`, omitting side-file removal. Run the original case: expect PASS without side files at wipe time.
- [ ] Apply the strengthened test there: expect FAIL on the remaining `venue.db-wal` absence assertion, not setup/cleanup. Record output.
- [ ] Restore `db-wipe.ts`; rerun for PASS. Remove only that disposable clone and its temporary parent after collecting receipts. Feature-branch production stays untouched.
- [ ] Delete only this backlog bullet/link and detail heading/body; preserve adjacent entries.

**Named verification commands (from the checkout root):**

- Each control: `pnpm --filter @waitron/server exec vitest run src/rejoin-command.test.ts -t 'drives the real wipe closure' --reporter=dot`; require one executed case and expected PASS/FAIL/PASS.
- Final: `pnpm --filter @waitron/server exec vitest run src/rejoin-command.test.ts src/db-wipe.test.ts --reporter=dot`; require both files and passing test counts.
- `git diff --check` and `git diff --numstat`: confirm named files and production +0/-0. Later use normal pre-push checks and current-head CI; no whole-package local run.
