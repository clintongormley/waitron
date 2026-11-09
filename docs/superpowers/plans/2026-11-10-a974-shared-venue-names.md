# A974 — shared venue fixture identifiers

**Outcome and boundary.** Maintainers can use one English-named shared `Venue` contract throughout its consumers. Rename identifiers only; preserve every string, locale, fixture value, comment, assertion and matcher (including test names and expected text), allowing required Prettier wraps. No new helpers, guards, tests, aliases, dependencies or file moves. Display cleanup belongs to separate A976 work, whose whole-helper proposal and BillVenue remain held; its narrower eleven-file approval does not widen this plan.

**Exact edit inventory / focused test list.** Paths below are relative to the repository root. `C` means `cafeId → coffeeId`; `W` means `aguaId → waterId`. Counts are identifier occurrences, followed by changed lines. The thirteen `.test.ts` rows are the complete focused server file list.

| Path | Substitutions; lines |
| --- | --- |
| `apps/server/src/testing/venue-fixtures.ts` | C×4, W×4, `bebidas → drinks`×3, `cafe → coffee`×2, `agua → water`×2; 11 |
| `apps/server/src/boot.clock-wiring.test.ts` | C×3; 3 |
| `apps/server/src/device-api.delete.test.ts` | C×1; 1 |
| `apps/server/src/device-api.test.ts` | C×2, W×1; 3 |
| `apps/server/src/device-delete.db.test.ts` | C×1; 1 |
| `apps/server/src/device-delete.history.test.ts` | C×1; 1 |
| `apps/server/src/device-equipment.test.ts` | W×1; 1 |
| `apps/server/src/device-zones-api.test.ts` | C×2; 2 |
| `apps/server/src/made-here.test.ts` | C×17, W×10; 27 |
| `apps/server/src/station-outputs-down.test.ts` | C×1; 1 |
| `apps/server/src/till-api.split-bill.test.ts` | C×1; 1; retain local `provisionedCoffeeId` |
| `apps/server/src/venue-details-api.test.ts` | C×1; 1 |
| `apps/server/src/venue-details.test.ts` | C×3; 3 |
| `apps/server/src/venue-settings-api.test.ts` | C×1; 1 |

**Consumer trace and exclusions.** At `8d7ee8c42c025b867c333cab73b862f26a14ab89`, whole-tree `rg` searches for `venue-fixtures`, `cafeId` and `aguaId`, cross-checked against tracked source files, found 60 direct importers: 59 tests and `testing/place-copy-box.ts`. Thirteen read these fields; the other 47 need no edits. No helper re-exports, module mocks or structural local copies carrying these keys were found. `place-copy-box.ts:224` reads `cfg.nodeId` and does not return the Venue object (`:413`). Keep independent `apps/server/src/served-at-huella.test.ts` untouched: its `Shop` (`:150`) and `seedShop` (`:173`) own their identically spelled fields. Keep all private tax-id names (including this helper's `nifCounter`/`nextNif`), other suites' drink names and the imported test seed helper `nifWithControlLetter` unchanged.

**Build and evidence, after approval.**

1. Record the build base and refresh the consumer search before editing. Apply only the table's identifier substitutions, then Prettier on changed files. `boot.clock-wiring.test.ts:387` is predicted to expand beyond one line; the formatter has not been run during planning. Inspect `git diff --word-diff` for only the named token changes and formatter punctuation; add no verifier, reverse replay or manufactured failing test. Scope old-field searches to `apps packages scripts`, where the five independent `served-at-huella.test.ts` occurrences remain.
2. Run `pnpm --filter @waitron/server exec vitest run` with exactly the thirteen listed test paths, dropping each path's `apps/server/` prefix, and retain per-file/total executed/pass/fail/skip/todo counts outside the repository. Existing database/API suites own routing, equipment/deletion, settings, clock wiring and split-payment behavior. Run `pnpm --filter @waitron/server typecheck` for the shared contract and typed consumers. Source searches do not establish runtime behavior. CI owns broader package tests; no whole server/workspace run or repeated baseline solely for this rename.

**Fiscal responsibility.** This area is near fiscal code: `venue-fixtures.ts:67` calls `applyHistoricalTestVenue`; `packages/provisioning/test/allocated-venue.ts:25` calls `seedFixtureSif`, whose `packages/fiscal-verifactu/test/sif-fixture.ts:24` calls `registerSif`. Equipment's sale (`device-equipment.test.ts:209`) goes through `testing/whole-payment-fixture.ts:98`, `till-sale.ts:2378`, core `record-sale.ts:351`, then `fiscal-verifactu/src/backend.ts:339` appends to the chain. Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` once after the change, retaining actual counts and requiring both suites UNEDITED: they own golden write-path and immutable-record checks. H2 forbids protected fiscal/golden changes, not naming these consumer references; stop for approval if a fix would cross that boundary.

**Size and backlog.** Estimate production +0/−0; tests +53/−46 (including an unmeasured seven-line formatter expansion); test support +11/−11; 14 source files, 61 identifier substitutions. No added/removed cases or generated files. Edit only A974 entries in `docs/backlog.md` and `docs/backlog/architecture.md`: refine the root's generic shared-helper phrase to the still-open bill/party helper consumers; remove only the `cafeId` shared-property sentence and `made-here.test.ts` example from the detail. Keep split-suite wording, independent fiscal fixture names, other helpers and A976 work. Docs estimate: this page about +37/−0; backlog +3/−5. Seventeen total planned paths. Report actual added/removed lines by production, tests, support and docs from the final diff; formatter size remains an estimate.

**Approval and finish.** This remains an unapproved proposal. Claude's first read recommends the smaller property/binding rename, a simpler check and no standalone PR; those reductions are applied here. Ask the watcher whether to leave this parked or name the existing maintenance bundle in which it belongs; invent no bundle or extra task. No build or standalone plan PR before that decision. Authority for eventual finish/land is the current user instruction, 2026-11-10: “The owner authorises finish-branch and land-branch.” That does not approve this scope. For an approved bundle, use normal finish-branch review, hook and current-head CI before landing. The external review could not read campaign/user authority; the watcher receives that UNVERIFIED limitation with the proposal.

**Receipts and uncertainties.** Planning used source inspection only; no tests, typecheck, formatter or runtime rename verification ran. Runtime counts and final formatting/diff sizes remain unmeasured; consumer inventory must be refreshed if the base moves. Rules read: root `CLAUDE.md`; `docs/developers/conventions-data.md:5941`; `testing-guide.md:91,206,1939,2434,2674`; `writing-claims.md:7`; Lane J `RUNNER.md` §0/H2 and current queue/questions. The current prompt supplies the plan-only boundary and separate-writer authority.
