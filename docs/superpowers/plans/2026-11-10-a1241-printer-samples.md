# A1241: English printer-screen test samples

**Outcome.** Clean the complete remaining sample-name area in the main printer-screen test file. Its accessibility and save-state siblings are outside this slice. Use the approved device-sample method; add no tests, helpers, scripts or production code.

**Authority.** The owner’s 2026-11-10 campaign prompt says “advance one eligible item” and “The owner authorises finish-branch and land-branch”; Lane J `RUNNER.md:15–16` records that standing authority, `:20` requires scope approval and `:46–49` requires separate planning. This printer scope is NOT yet approved. A1018 #2669 remains owner-only, A1342 held; neither creates a wait for this slice. This writer runs no tests, commits, reviews, push or PR.

**Exact repository paths, only:**

- `apps/dashboard/src/screens/printers-screen.test.ts`
- `docs/superpowers/plans/2026-11-10-a1241-printer-samples.md`
- `docs/backlog.md`
- `docs/backlog/architecture.md`

**Inventory.** Original source at `65d2465c8381b18627ec39abcd6be06ab98afa76`; all 13,362 lines were inspected through the complete string-literal/name-input inventory, including unaccented names. Detailed mapping, predicted failing checks and retained subjects belong at `/Users/clintongormley/waitron-campaign-j/receipts/a1241-printer-plan-20261110/inventory.md`. Predictions come from source, not execution. The whole area qualifies without changing assertion meaning or order.

**Names.** Map only the inventoried input values, then matching expectation/selector string values. Examples: `Cocina` → `Kitchen`, `Nube` → `Remote`, `Camareros` → `Waitstaff`, `Mostrador` → `Counter`, `Oficina` → `Office`, `Otra` → `Other`; variants and every occurrence are in the inventory. Keep distinct role fixtures, IDs, comments, identifiers, matchers, whitespace, permissions, numeric values and assertion structure.

**Protected subjects.** Keep Spanish UI/language checks, locale-subject text, invalid `ñ123`, fiscal/wire values and recorded receipt text. In the two Spanish drawer sentences, change only `Camareros`. Keep `$&` and all other replacement/placeholder tokens. The phone printer/agent names retain 42/41 characters and seven words; `Barra vieja` becomes the equally long `Old counter`, while its Spanish deletion reason stays. These are layout/identity samples, not Spanish-language subjects; keep all geometry checks. The reported hostname stays unchanged.

**Sorting.** Preserve every array position: job sorts at original :6422/:6424/:6426 become `[Remote, Bar USB, Kitchen]`, `[Kitchen, Bar USB, Remote]`, `[Kitchen, Remote, Bar USB]`. The shared names keep their lexical p3/p1/p2 relationship. Agent and printer name-sort fixtures at :6115/:6350 already use English and stay unchanged. Used-by profile/station order and department deduplication stay unchanged; no new ordering is needed. These explicit mappings need watcher approval.

**Driver sequence, after this writing handoff:**

1. Commit the plan signed off; obtain one completed Claude `claude-seat.sh review-branch` plan read, fix findings, then request and await watcher approval before any build. At most one reread for fixes; an unavailable seat means no build. Apply `~/workspace/tools/review-standing-questions.md`: should this exist, true size, who approved it. Carry approval evidence into the brief; unresolved necessity/simplification/UNVERIFIED findings go to WATCHER-NEEDED and block landing.
2. After approval, recheck the source against the inventory and browser headroom. Run the whole chosen file once for baseline: `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts`. Save actual case/pass/fail/skip counts and exit status; missing counts or baseline failures stop editing. No counts have been measured by this writer.
3. Change INPUTS ONLY, using the inventory's 74 literal occurrences; leave all 70 expectation occurrences and both row selectors untouched. Run the same whole-file command. Expect exactly the inventory's named failing cases/checks and parameter expansions, including :2979's row-identity failure and :3011's missing-row TypeError from stale selectors :2970/:3009. Later affected checks are listed separately. Stop on any different result rather than weakening a check.
4. Change only the 70 mapped expectation values and two row-selector string values; rerun the same file. Require final passing count equal to baseline, with unchanged total cases/skips. Some samples have no independent name-equality check; the inventory names them, and you add none. Run `pnpm exec vitest run scripts/english-only.test.ts`; the package vocabulary guard is no evidence for app samples at this base. Audit residual names and the complete diff separately. No whole-package local run.
5. Update only the named backlog entries. List each changed check's original line and before/after value in the PR's Changed test checks section and lane progress FYI, per RUNNER §0(6). Keep the existing method's evidence outside the repository.
6. Run normal `finish-branch`: one Claude run-it whole-branch review after initial rebase, in an installed disposable checkout, then the normal push hook and selected required CI jobs on the exact head. Sign off every commit. Re-read Lane J queue/questions before finish and land; use `land-branch` under RUNNER H11's shared lock, including install/cleanup, and record the merge's own CI. No review is invoked by this writer.

**Backlog wording, during build.** In `docs/backlog/architecture.md`, delete the two-line sentence beginning “The printers-screen accessibility and save-state suites use English samples, but” and ending “Spanish printer, agent and profile sample names.” only after the whole mapped area qualifies; if the scope shrinks, narrow that sentence to the remaining names instead. In `docs/backlog.md`, retain open A1241 and add: “Audit each remaining file's fixture names, typed drafts and matching selectors together.” Add no history or completion counts.

**Size estimates (added/removed separately).** Production +0/−0; tests +150/−150 (138 mapped source lines plus allowance for formatter wraps); test support +0/−0; docs +50/−2; generated +0/−0. Total 352 changed lines. Stop above 528 (1.5×), before an unlisted path or any assertion-meaning change, and request watcher deviation approval. Three active hours from build to open PR, excluding recorded external waits; at the limit checkpoint and request OVER BUDGET.

**Conditional future deviation.** `scripts/english-only-still-to-clean.ts` is outside these four paths. Reduce only its matching entry/count if A977 lands before build AND the watcher explicitly approves that reduction after confirming this whole file qualifies. Otherwise stop for deviation approval; never silently add the path or infer permission from the device slice.

**Finish line: names only, same product behavior.**
