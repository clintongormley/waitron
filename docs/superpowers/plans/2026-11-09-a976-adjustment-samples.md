# A976: AdjustmentVenue staff samples

**Goal:** Contributors use English staff dish samples throughout AdjustmentVenue and its dependent selectors/readbacks. No production behavior changes. BillVenue stays held.
**Authority:** Watcher, `~/waitron-campaign-j/questions.md`, heading “WATCHER 2026-11-09 14:23 — A976 next area: AdjustmentVenue APPROVED, BillVenue held”: “Take the smaller AdjustmentVenue area (three staff names across six files, about 120–160 test/helper lines, zero production) once its exact inventory and fiscal boundaries are qualified as in the earlier areas; fiscal suites run unedited.” This approves planning only. Build waits for one completed Claude read and watcher approval.

**Scope at `72960b2e207ef9f944d0dc7fc549feb13c2d4f5d`:** Replace staff samples `Croquetas` → `Croquettes`, `Pimientos` → `Peppers`, `Cana` → `Draught beer`, and corresponding lowercase title words `croquetas`/`croqueta`. Retain `Tortilla` as an English food name. The new staff names differ from their unchanged customer/kitchen names (`Ham croquettes`/`CROQ`, `Pepper tapa`/`PEPS`, `Small draught beer`/`BEER`).

| Editable path under `apps/server/src/` | Exact candidate spans at that base |
| --- | --- |
| `testing/adjustment-venue.ts` | Three MENU staff literals at 103, 159, 167. |
| `testing/adjustment-venue.test.ts` | 15 literal occurrences on 12 lines, 78–286. |
| `order-portions.adjustments.test.ts` | 84 staff literals plus 10 lowercase title words on 90 lines, 386–3538. |
| `adjustments-apply.test.ts` | 15 mapped occurrences on 15 lines, 603–806, including one title. |
| `receipt-adjustments.test.ts` | Six bill inputs at 841, 883, 900, 920, 956, 978; delete comment block 838–840. |
| `adjustments-api.test.ts` | Beer lookup/input at 188, 216; keep BEER/RIBEYE printing checks. |

**Other editable paths:** This plan; A976 in `docs/backlog.md` and `docs/backlog/architecture.md` (including related summaries). Remove completed adjustment staff-name/title work; retain A976's other samples and deliberate locale checks.
**Size:** 137 occurrences on 130 matching test/helper lines, including 11 title and two comment occurrences. Replace 128 lines and delete three comment lines before formatting: +128/−131 tests/helpers, production zero; budget docs +60/−20, total about 345 added-plus-removed lines. No new tests or infrastructure.
**Consumer trace:** Repository-wide name/import scans found 46 direct test consumers, 35 provisioners and 11 utility/reason-only users, no further source consumers. Static inspection found no mapped name-changing write that would become a no-op. Preserve customer/kitchen fields, locales, other fixture names, prices, VAT, quantities, permissions, all numeric expectations and all fiscal checks. H2 prohibits edits to hashes, chains, invoice allocation, fiscal records/builders, registerSif, restoreFiscal, golden tests and guards. Inspection is not runtime verification.

1. After approval, save the 35-file list from `rg -l --glob '*.test.ts' 'provisionAdjustmentVenue' apps/server/src`; inspect it and strip `apps/server/` for Vitest. Run that focused selection with `pnpm --filter @waitron/server exec vitest run <paths>` and run the unedited fiscal gates below. Record exit statuses and nonzero test counts; no whole-package run.
2. Update only the five consumer suites' mapped inputs/readbacks/titles first. Run those five complete suites against the old seed: require missing-new-name offer/readback failures, including the VAT case's Peppers and Draught beer inputs. An unrelated setup failure is not red. Then update the three seed literals, delete the specified comment, and run the five suites and the 35-file selection green.
3. In an installed disposable checkout, separately restore only the final VAT case's Peppers input to Pimientos and its Draught beer input to Cana; each must fail lookup, and restored inputs must pass. Compare base/final TypeScript syntax trees after normalizing only qualified mappings and ignoring comments/positions: all other syntax/assertions/values must match. Check the exact comment deletion and word diff separately; retain controls outside the repo.
4. Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` before and after. Verify these files and full-comp.fiscal-identity.test.ts are unedited; never refresh hashes or XML digests.
5. Update the two backlog entries, commit with sign-off, and run finish-branch's single Claude run-it review after initial rebase. Gather fixes into one ready push; normal hook and required current-head CI precede authorised landing. Finish line: this complete three-name area available on main, with all existing behavioral checks retained.

**Stops:** No unlisted paths, protected edits, new checks/cases or changed numeric assertions without watcher approval. Above 518 added-plus-removed lines (1.5× estimate), seek an outside opinion before growing. Open the PR within three active hours; log watcher/outage waits separately. At the limit, checkpoint and report the smallest remaining cut. No build is authorised by writing this plan.
