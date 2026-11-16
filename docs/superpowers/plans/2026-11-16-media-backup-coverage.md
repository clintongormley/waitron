# Media backup accepting control — implementation plan

**Goal:** Restore the media coverage gate while checking that a valid department receipt logo survives backup verification.
**Request:** Watcher's Lane E `questions.md` note headed 2026-11-16 03:46 asks to diagnose nightly CI 43791398545, cover meaningful branches, run media coverage locally, then rerun CI on main.
**Authority:** This is a watcher-requested maintenance fix. No separate owner approval of this plan is claimed.
**Base:** `be2574ba585f91fe171d47f312653baf25d0176b`, after mn13. Its 664 media tests pass, but branches are 918/967 (94.93%), below 95%.
**Reuse:** `packages/media/src/backup-verification.test.ts` already has real source/restored databases, authentic photo/blob rows, `run()` and a missing-logo refusal case.
**Files:** Add one accepting case in that existing test file; keep this plan. Production code and configuration stay unchanged.
**Size:** About 15 added test lines, zero production/support lines. Stop for watcher input if a larger fix is needed.

## One task

- [ ] Insert a department in both existing databases with `receiptLogoImageId: id`, naming the seeded photo, and assert `expect(await run()).toEqual(passed)` in a case named "accepts a restored department logo with its photo and original bytes". A verifier that refuses every non-null department logo must fail this assertion; no new helper or fake.
- [ ] Run `pnpm --filter @waitron/media exec vitest run src/backup-verification.test.ts`, then `pnpm --filter @waitron/media exec vitest run --coverage --reporter=default --reporter=../../scripts/vitest-file-progress.mjs`. Keep the actual test counts and per-file coverage; all four package thresholds must pass. The prior full run is the observed failing gate; this maintenance adds a missing behavioral check, not production behavior.
- [ ] In an owned disposable copy, force the existing department-logo check to refuse a valid reference: the new accepting assertion must fail. Restore and rerun. Record this one-time control; commit no self-mutation test.
- [ ] Use finish-branch's review, normal hook and current-head PR CI; land on green under the existing campaign authority. Start `gh workflow run ci.yml --ref main` and read its media result before claiming the nightly failure resolved.

**Deliberately omitted:** New product behavior, new backup rules, thresholds/exclusions, unrelated browser cases and fixture rewrites. Existing corruption/refusal assertions remain intact. No backlog entry describes this missing test; retain the existing product backlog.
