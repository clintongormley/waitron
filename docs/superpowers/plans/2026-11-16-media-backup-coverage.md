# Media backup coverage — implementation plan

**Goal and request:** Fix nightly media coverage (CI 43791398545) with meaningful backup checks, identify the crossing commit, then run full CI on main. Requested in Lane E `questions.md`, watcher note headed 2026-11-16 03:46.
**Base:** `be2574ba585f91fe171d47f312653baf25d0176b`: 664 tests pass, but branches are 918/967 (94.93%).
**Files and reuse:** Extend `packages/media/src/backup-verification.test.ts`, using its real databases, authentic images and existing helpers; retain this plan. About 45 changed test lines, zero production/support lines.
**Authority:** Claude reviewed the initial plan (90 seconds), the branch (314 seconds) and the fixes (94 seconds). The watcher cleared real backup outcomes at 04:08, then the smaller scope at 04:30: “My ‘about 95.5%’ was a hope, not a bar: real behaviour only.” No owner approval of the design is claimed. The owner separately authorised finish-branch and land-branch in the campaign launch.

## One task

- [x] Compare complete historical media runs before and after the suspected change. Record the crossing commit, counts and coverage in the PR.
- [x] Add valid department-logo acceptance; strengthen the four release-state cases with an intact-backup assertion before the existing missing-photo checks. Keep every original refusal and the original empty-table fixture.
- [x] Cover the fresh reader's real type-refusal findings: numeric blob data answers `invalid` rather than rejecting during hashing; a binary department-logo id is refused even when it matches a photo id. Keep assertions in the cases.
- [x] Prove the added checks with one-time mutations in an owned disposable checkout. Restore and run the changed file; commit no mutation test.
- [ ] Run `pnpm --filter @waitron/media test:coverage` on the final head: expect 667 passing tests and every package threshold met. Record exact figures; ordinary PR CI disables package coverage.
- [ ] Complete finish-branch, the normal push hook and current-head PR CI; land on green. Dispatch `gh workflow run ci.yml --ref main` and read its media result before calling the nightly failure resolved.

**Review corrections, 16 November:** Remove the new missing-blob-table case: Codex reproduced the review's surviving guard mutation because table comparison already refused. Restore the original empty-table fixture; production skips this callback for schema zero (one-time server experiment passed with the bypass, failed without it). The watcher cleared these removals at 04:30. Report defensive missing-table, numeric-conversion and parser-exception branches in the PR.
**Leave out:** Production changes, new backup rules/helpers, exclusions, unrelated browser cases and backlog entries. Stop if production changes become necessary. Keep the honest coverage figure rather than manufacture cases for a percentage.
