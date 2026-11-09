# A974 — shared venue fixture identifiers

**Outcome and boundary.** Maintainers can use one English-named shared `Venue` contract throughout its consumers. Rename identifiers only; preserve every string, locale, fixture value, comment, assertion and matcher (including test names and expected text). No new helpers, guards, tests, aliases, dependencies or file moves. Display cleanup belongs to separate A976 work, whose whole-helper proposal and BillVenue remain held; its narrower eleven-file approval does not widen this plan.

**Exact edit inventory / focused test list.** Paths below are relative to the repository root. `C` means `cafeId → coffeeId`; `W` means `aguaId → waterId`. Counts are identifier occurrences, followed by changed lines. The thirteen `.test.ts` rows are the complete focused server file list.

| Path | Substitutions; lines |
| --- | --- |
| `apps/server/src/testing/venue-fixtures.ts` | C×4, W×4, `bebidas → drinks`×3, `cafe → coffee`×2, `agua → water`×2, `nifCounter → taxIdCounter`×3, `nextNif → nextTaxId`×2; 16 |
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

**Consumer trace and exclusions.** At `8d7ee8c42c025b867c333cab73b862f26a14ab89`, whole-tree `rg` searches for `venue-fixtures`, `cafeId` and `aguaId`, cross-checked against tracked source files, found 60 direct importers: 59 tests and `testing/place-copy-box.ts`. Thirteen read these fields; the other 47 need no edits. No helper re-exports, module mocks or structural local copies carrying these keys were found. `place-copy-box.ts:224` reads `cfg.nodeId` and does not return the Venue object (`:413`). Keep independent `apps/server/src/served-at-huella.test.ts` untouched: its `Shop` (`:150`) and `seedShop` (`:173`) own their identically spelled fields. Keep all other suites' private tax-id/drink names and the imported provider API `nifWithControlLetter` unchanged.

**Build and evidence, after approval.**

1. Record the build base; repeat the consumer search before editing. Run `pnpm --filter @waitron/server exec vitest run` with exactly the thirteen listed test paths, dropping each path's `apps/server/` prefix. Retain per-file and total executed/pass/fail/skip/todo counts outside the repository; baseline runtime counts are currently unknown. Existing database/API suites own routing, equipment/deletion, settings, clock wiring and split-payment behavior; no fixture-only duplicate tests or manufactured failing assertion.
2. Apply only the table's substitutions. In a small temporary script outside the repository, replay identifier-token renames on the original base files and compare complete text with the candidate; reverse those edits in memory and require byte-for-byte original text. This checks literals, comments, assertions and matchers too. Repeat the whole-tree old-field search: only the five independent `served-at-huella.test.ts` occurrences should remain. Do not commit a verifier or swap baseline files into the working tree.
3. Repeat exactly the focused list and require identical per-file/total counts, no failures and no new skips; run `pnpm --filter @waitron/server typecheck` for the shared contract and all typed consumers. Source searches and reversible text comparison are not runtime verification. CI owns broader package tests; do not run the whole server/workspace locally.

**Fiscal responsibility.** This area is near fiscal code: `venue-fixtures.ts:67` calls `applyHistoricalTestVenue`; `packages/provisioning/test/allocated-venue.ts:25` calls `seedFixtureSif`, whose `packages/fiscal-verifactu/test/sif-fixture.ts:24` calls `registerSif`. Equipment's sale (`device-equipment.test.ts:209`) goes through `testing/whole-payment-fixture.ts:98`, `till-sale.ts:2378`, core `record-sale.ts:351`, then `fiscal-verifactu/src/backend.ts:339` appends to the chain. Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` before/after, compare counts, and require both suites UNEDITED: they own golden write-path and immutable-record checks. H2 forbids protected fiscal/golden changes, not naming these consumer references; stop for approval if a fix would cross that boundary.

**Size and backlog.** Source estimate: production +0/−0; tests +46/−46; test support +16/−16; 14 files, 66 identifier substitutions. No added/removed cases. Also change only A974 entries in `docs/backlog.md:2356` and `docs/backlog/architecture.md:386,763` after implementation: remove this shared-fixture boundary from remaining work, retaining all unfinished areas and A976 text. Docs: this plan +38/−0; backlog estimate +10/−10. Report actual added/removed totals by category from the final diff. Total planned paths: 17.

**Approval and finish.** Recommend holding this complete but small area for a watcher-approved A974 maintenance bundle rather than its own PR; do not enlarge it into held A976 work. The driver obtains one completed Claude `review-branch` read (brief/report outside the checkout), applies findings with at most one re-read, then submits `PLAN FOR APPROVAL` and waits for watcher approval before building. No PR for this plan alone. The current user prompt authorizes later `finish-branch`/`land-branch`; that authority does not waive plan approval. After an approved build/bundle, use the normal review, hook and current-head CI gates.

**Receipts and uncertainties.** Planning used source inspection only; no tests, typecheck or runtime rename verification ran. Runtime counts and final formatting/diff sizes remain unmeasured; consumer inventory must be refreshed if the base moves. Rules read: root `CLAUDE.md`; `docs/developers/conventions-data.md:5941`; `testing-guide.md:91,206,1939,2434,2674`; `writing-claims.md:7`; Lane J `RUNNER.md` §0/H2 and current queue/questions. The current prompt supplies the plan-only boundary and separate-writer authority.
