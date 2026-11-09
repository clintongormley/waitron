# A976: local party-test samples

**9 November 2026: proposal; Claude read and watcher build approval pending.** Finish the English sample labels and readbacks owned by the eight suites below. Contributors can then use English local party samples with the existing behaviour checks intact. No production change. Authority to propose: Lane J queue A976 and watcher 8 November 14:43, “Do not start the party-venue area; that needs its own plan later.” That earlier restriction remains for implementation until this plan is approved.

**Scope:** leave `testing/party-venue.ts` and its shared dish selectors unchanged. Its consumers include fiscal recording and receipt comparisons; this slice changes only locally created table, party, course and printer labels and their readbacks. Proposed whole area under `apps/server/src/`:

| Test file | Existing lines proposed to change |
| --- | ---: |
| `parties.test.ts` | 60 |
| `party-arriving-dishes.test.ts` | 54 |
| `party-bill-actions.test.ts` | 1 |
| `party-main-bill.test.ts` | 25 |
| `party-move-bill.test.ts` | 107 |
| `party-name-paper.test.ts` | 17 |
| `party-table-actions.test.ts` | 83 |
| `receipt-guests.test.ts` | 28 |

**Size:** writer measured 375 test lines / 382 literal spans; zero production lines. Driver/reviewer must qualify the mapping before approval. Also edit `docs/backlog.md`, `docs/backlog/architecture.md` and this plan's dated status, estimated 15–25 documentation lines. Count formatting separately; seek deviation approval before extra paths/ideas or more than 562 source lines.

**Mapping and exclusions:** proposed complete mapping and read-only tracing are retained in `/Users/clintongormley/waitron-campaign-j/receipts/a976-party-plan-20261109/{proposed-mapping,writer-plan-original}.md`. Translate local labels such as Mesa → Table, Terraza → Terrace, Ana → Ann, Luis → Louis and local course names. Apply whole words/phrases longest first, once against original string/template text, preserving whitespace, suffixes and expressions. Review the complete map against actual consumers; no broad substitution outside these files. Preserve Spanish receipt/ticket wording (including `De: (mostrador)`), locales/language maps, official terms, addresses, company/operation text, shared dishes/three-name distinctions, accent probes, comments, identifiers, non-sample values and all assertion operators. Translate the local printer `Cocina`, never the default station. No fiscal golden/protected data or fiscal implementation edits; no new guard/framework.

**Build only after Claude's read and watcher approval; inline, within three active hours to PR:**

1. Freeze baseline hashes and exact approved spans in the receipts folder. Baseline the eight named suites from `apps/server` with `pnpm exec vitest run` and explicit file paths; retain actual Tests counts. Budget 30 minutes for planning/inventory/baseline.
2. Observe RED: change `party-main-bill.test.ts:309`'s positive readback to `Ann`, retaining input `"  Ana "` at line 305. Run `pnpm exec vitest run src/party-main-bill.test.ts`; require expected Ann, received Ana. Translate only approved inputs/readbacks; run all eight suites again with matching Tests counts and no new failures/skips. Keep trimming, clearing and revision assertions. No invented RED for unasserted labels. Budget 45 minutes.
3. Prove final files equal Prettier of the approved edit replay, then invert spans to baseline bytes. Compare assertion syntax after normalizing only mapped text; preserve calls/operators/order, quantities, money, IDs and refusal codes. Check identity distinctions, residual samples, paths and `git diff --check`. Run H2 unedited: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`. Budget 30 minutes; no whole-package run.
4. Update both backlog entries, retaining shared-helper/dish work. One Claude run-it after initial rebase, in-scope fixes, signed-off commits, normal hook and current-head CI; preserve earlier approval across clean rebases. Budget 75 minutes including contingency. Report OVER BUDGET at three active hours, excluding watcher/outage waits. Existing campaign authority covers finishing/landing after the separate build approval; this proposal grants none.
