# A976: local party-test samples

**9 November 2026: Claude read completed (477 seconds); watcher approved 11:55 with the three corrections below.** Finish the English sample labels and readbacks owned by the nine suites below. Contributors can then use English local party samples with the existing behaviour checks intact. No production change. Authority to propose: Lane J queue A976 and watcher 8 November 14:43, “Do not start the party-venue area; that needs its own plan later.” The 11:55 approval permits this local area and retains the shared-helper restriction.

**Scope:** leave `testing/party-venue.ts` and its shared dish selectors unchanged. Its consumers include fiscal recording and receipt comparisons; this slice changes only locally created table, party, course and printer labels and their readbacks. Proposed whole area under `apps/server/src/`:

| Test file | Existing lines proposed to change |
| --- | ---: |
| `parties.test.ts` | 60 |
| `party-arriving-dishes.test.ts` | 54 |
| `party-bill-actions.test.ts` | 1 |
| `party-main-bill.test.ts` | 25 |
| `party-move-bill.test.ts` | 107 |
| `party-name-paper.test.ts` | 17 |
| `party-table-actions.test.ts` | 85 |
| `receipt-guests.test.ts` | 28 |
| `testing/party-bill-of.test.ts` | 6 |

**Size:** driver read-only AST inventory measures 383 test literal lines / 390 spans, plus deletion of ten fixture narrative comments (16 lines): 399 source lines total; zero production lines. Source hashes, exact spans and zero distinct-literal collisions are retained in the qualified inventory; no test or source file was edited. Also edit `docs/backlog.md`, `docs/backlog/architecture.md` and this plan's dated status, estimated 15–25 documentation lines. Count formatting separately; seek deviation approval before extra paths/ideas or more than 598 source lines.

**12:05 watcher-approved correction:** include the four uppercase `POSTRES` → `DESSERTS` course-name readbacks in `party-arriving-dishes.test.ts`; retain Spanish ticket vocabulary and all assertion operators. This makes 403 source lines including the comment deletions.

**12:20 watcher-approved review fix:** include five table-prefix inputs in `party-table-actions.test.ts`: Separa → Split, Fuera → Elsewhere, Ajena → Foreign, Abandonada → Abandoned and Retenida → Held. They reach local table creation through `anaAtTwo` → `tables`; every assertion stays. Total source scope: 408 lines.

**Mapping and exclusions:** the exact proposed spans, comment deletions and hashes are in `/Users/clintongormley/waitron-campaign-j/receipts/a976-party-plan-20261109/qualified-inventory.json`; `proposed-mapping.json` holds the dictionary. Apply only those spans, never a broad substitution. Shared defaults and till-API samples stay for separate slices. Keep Bea (an English nickname), Extra 1/2 (English), and private ana/luis identifiers (A974). Vacia → Vacant and Cobrada → Settled preserve distinctions from Vacía → Emptied and Pagada → Paid; the four accented table prefixes are included. Translate local labels such as Mesa → Table, Terraza → Terrace, Ana → Ann, Luis → Louis and local course names. Apply whole words/phrases longest first, once against original string/template text, preserving whitespace, suffixes and expressions. Review the complete map against actual consumers; no broad substitution outside these files. Preserve Spanish receipt/ticket wording (`MOVIDO`, `Pedido`, `De:`, `A:` and `(mostrador)`; only the sample label in `A:  Mesa aviso 5` changes), locales/language maps, official terms, addresses, company/operation text, shared dishes/three-name distinctions, accent probes, all other comments, identifiers, non-sample values and all assertion operators. Translate the local printer `Cocina`, never the default station. No fiscal golden/protected data or fiscal implementation edits; no new guard/framework.

**Build only after Claude's read and watcher approval; inline, within three active hours to PR:**

1. Re-check the existing qualified-inventory.json source hashes at build start; reuse its approved spans. Baseline the nine named suites from `apps/server` with `pnpm exec vitest run` and explicit file paths; retain actual Tests counts. Budget 30 minutes for planning/inventory/baseline.
2. Observe RED: change `party-main-bill.test.ts:309`'s positive readback to `Ann`, retaining input `"  Ana "` at line 305. Run `pnpm exec vitest run src/party-main-bill.test.ts`; require expected Ann, received Ana. Translate only approved inputs/readbacks; run all nine suites again with matching Tests counts and no new failures/skips. Keep trimming, clearing and revision assertions. No invented RED for unasserted labels. Budget 45 minutes.
3. Prove final files equal Prettier of the approved edit replay. The final-file equality checks extra edits. Compare assertion syntax after normalizing only mapped text; preserve calls/operators/order, quantities, money, IDs and refusal codes. Check identity distinctions, residual samples, paths and `git diff --check`. H2 requires this unedited run because these suites use the fiscal backend; it is an invariant gate, not evidence of the rename: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`. Budget 30 minutes; no whole-package run.
4. Update the main backlog and both architecture paragraphs (currently lines 405 and 838), retaining shared-helper/dish work and the A974 identifier residual. One Claude run-it after initial rebase, in-scope fixes, signed-off commits, normal hook and current-head CI; preserve earlier approval across clean rebases. Budget 75 minutes including contingency. Report OVER BUDGET at three active hours, excluding watcher/outage waits. The current owner request says “The owner authorises finish-branch and land-branch”; Lane J run.sh:76 supplies that instruction and RUNNER.md:15 delegates queued items. Watcher questions.md, 9 November 11:55, approves this 399-line area with these corrections, after #2618 and before A1464.
