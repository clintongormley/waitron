# Translate all: submission evidence and clarified placeholders

**Outcome:** Suggestions notice staff-name edits and included-menu moves during Cloud work; a later run retries a clarified placeholder without requiring Discard.
**Request:** `TRANSLATE-ALL-STALE-AND-PLACEHOLDER` in `/Users/clintongormley/waitron-campaign-f/queue.md`; backlog points (1) and (2).
**Status:** Source-grounded plan only; no reproduction or tests run. Driver commits, obtains Claude review and watcher clearance before implementation.

**Smallest route**

- Reuse `readSuggestionGaps`, `resolveTranslationRow`, existing name evidence, `suggestionStale` and `sameTranslationBaseline`; keep reads and writes in their existing transactions.
- Change only the TypeScript JSON type of `contentSuggestionJobs.sent` to `Record<string, { missing: string[]; staffName: string; baselines: Record<string, string> }>`; each baseline is an existing name-cell token.
- In `buildSuggestionJob`, capture enabled name-cell baselines from each sent item's existing gap row/settings, with its submitted staff name. Context-only heads remain outside `sent`; Cloud body, byte limits and counts stay unchanged.
- Store generated-name evidence from that saved baseline, adding `staffName` to its JSON. Matching language corrections reuse the submission baseline; retain current wrong-text checks, note-only mismatches and internal corrections.
- Compare stored/current staff names; strip that metadata before the strict baseline parser and reuse `suggestionStale`. Preserve its tolerance of unrelated configuration/default text. Returned `view.expected` remains the ordinary current name-cell token for saving.
- A placeholder's own row stores `{ staffName }` in `expected`, using the submitted name even if it changed before collection. Collection suppresses an item only while that name equals its current staff name; ignoring a clarified placeholder leaves co-located correction notes intact.
- Evidence survives `startSuggestionRun` deleting old jobs (`jobId` becomes null). No extra snapshot/check mechanism, SQL column, migration or compatibility path.

**Files and ownership** (paths below are relative to the worktree)

- Production: `packages/db/src/schema/menu/suggestions.ts` (JSON typing only); `packages/menu/src/content-suggestion-collect.ts` (capture/suppression/shared name-evidence helper); `packages/menu/src/content-suggestion-store.ts` (saved evidence/comparison/projection).
- Reuse inferred `SuggestionJobRow["sent"]` in menu code/helpers. Keep `packages/menu/src/content-translation-baseline.ts` and `content-suggestion-types.ts` unchanged.
- Trace `packages/menu/src/content-suggestion-jobs.ts`: key-based run totals, failed accounting and `sentInRun` remain key-based. `apps/server/src/content-suggestion-runner.ts` sends the saved body; `recordSuggestionJobSubmitted` in jobs clears it. Neither needs a new snapshot or behavior.
- Behavioral tests: `packages/menu/src/content-suggestion-evidence.test.ts`, `packages/menu/src/content-suggestion-jobs.test.ts`; keep storage/correction assertions in `packages/menu/src/content-suggestion-store.test.ts`.
- Shape/support updates only as required: `packages/menu/test/suggestion-fixture.ts`; `packages/menu/src/content-suggestion-{collect,collect.job,store.list}.test.ts`; `apps/server/src/{alert-sources,boot}.test.ts` job fixtures. Preserve existing behavioral assertions.
- Backlog: `docs/backlog/menu.md`, remove each reproduced-and-fixed point (1)/(2); retain (3)/(4), heading and bundle link. Update the matching `docs/backlog.md` bundle summary to name the remaining work.

**Execution checklist — inline, after clearance**

- [ ] Reproduce on current main (including #3568), before implementation. In evidence tests, start/submit a stored job, then rename a product or move an included menu between sections before storing results. Assert stale suggestions and zero offered/stopped-run waiting counts; an unchanged control stays usable and counted. Watch expected failures; fix only reproduced defects.
- [ ] In jobs tests, store/release a placeholder, rename its staff name, start another run and assert its missing languages are sent again. An unchanged placeholder still suppresses. Assert a co-located internal correction survives job deletion. Also rename during the first job before storing its placeholder, proving submitted-name evidence. Watch the retry assertion fail before fixing.
- [ ] Implement the JSON/capture/store/compare changes above. Adapt fixture shapes, retaining correction wrong-text, inheritance, unrelated-language/default-text, pagination, accounting and Cloud-body assertions. Use `suggestionSuite`/`useVenueDb`; no live Cloud or UI work.
- [ ] Run each new regression red then green with `pnpm --filter @waitron/menu exec vitest run src/content-suggestion-evidence.test.ts src/content-suggestion-jobs.test.ts -t '<new case name>'`; require actual test counts and expected assertion failures.
- [ ] Run `pnpm --filter @waitron/menu exec vitest run src/content-suggestion-{collect,collect.job,jobs,store,store.list,evidence}.test.ts` (shell brace expansion). Run `pnpm --filter @waitron/server exec vitest run src/content-suggestion-runner.test.ts src/content-suggestions-api.test.ts src/alert-sources.test.ts src/boot.test.ts` for the runner/API and affected server fixtures.
- [ ] Delete the fixed backlog points; driver uses normal finish-branch checks and current-head CI. No whole-workspace local test run solely for finishing.

**Exclusions:** Backlog points (3)/(4), open-dialog notices, job release policy, UI edits, Cloud request/reply changes and live Cloud calls.
**Estimate:** Production 80–120 changed lines; behavioral tests 150–210; fixture/shape support 40–70; backlog 5–10 (275–410 total, excluding this plan). Ask the watcher before adding storage or exceeding 1.5 times the reviewed estimate, as RUNNER requires.
