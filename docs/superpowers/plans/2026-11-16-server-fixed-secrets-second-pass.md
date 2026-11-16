# Server fixed-secret setup, second pass

Separate Codex Sol/high draft, 2026-11-16; checked by the Lane I driver.
The driver checks and commits this draft, obtains Claude plan review, resolves findings,
and seeks watcher clearance before building. Neither review nor clearance is owner design approval.
Request: Lane I `~/waitron-campaign-i/queue.md`, SERVER-FIXED-SECRETS-2, queued 2026-11-16 15:03:

> Use `fixturePinHash`/`fixturePasswordHash` (`apps/server/src/testing/known-secret-hashes.ts`) for the remaining repeated stored-secret setup; keep hashing-subject tests and real sign-in checks unchanged. Another inspected subset is needed: the broad search also includes setup run once per file and tests about hashing.

The same queue says: “reuse the remembered hash instead, so each file pays that cost once.”
Finish line: the selected repeated fixtures reuse stored hashes for their existing secrets;
their unchanged behavioural tests pass, with a measured local before/after comparison.
Reuse `apps/server/src/testing/known-secret-hashes.ts` unchanged. Change imports and stored-hash calls only.
Preserve every assertion, supplied secret, hook, real sign-in and verification call.
No production edits, new cache/helper/scanner, coverage changes, fixture-value changes or assertion rewrites.
Exclude hashing-subject tests, handover, restore, Cloud and fiscal-filing subjects, staged-hour salt helpers and all held paths.
Leave once-per-file setup in menu-api, management-api.device-profiles, backup-api.route,
stream-api.route, print-api.printer-wiring, floor/table, department-transfer-api and unpaid-departure;
leave tender-refunds/authorization module constants, management-api sign-in seeds and the one in-test till-api.receipt seed.
Leave boot’s scattered one-off seeds for this pass; boot.setup-routes is held.
Review-suggested payments-api.stuck is held by A1389/A739/VB9 (#3517), till-sale by A275.
Exclude sale-till-source.receipt: its assertions pin fiscal chain continuity and invoice numbers.

Expected physical additions + deletions: production 0; test files 100–190; support/helpers 0;
docs 90–120, including this plan and backlog edits; total 190–310. These are estimates, not targets.
Beyond 1.5× the upper estimate (465), stop for an outside opinion through the watcher;
this is a growth review trigger, not a cap. Stop at a clean point near 1,000 changed lines.

Execute inline after review and clearance:

- [ ] Refresh holds from every worktree branch's merge-base diff and open PR files;
      consult `~/waitron-campaign-i/receipts/server-fixed-secrets-2-20261116/{holds-start.json,held-paths.txt}`.
      Recheck before every file edit and before push; skip newly held paths. Do not read other lanes' queues.
- [ ] Confirm the driver's three sequential fresh-process baseline runs per sample completed at
      `1a09d5ad118fa5c21faf94e934ce33361d8d08ae`; retain logs, test counts and start/end host load in that receipt directory's `baseline.json`.
      No timings are asserted by this draft. Use the same four samples below for the after runs.
- [ ] Convert `apps/server/src/receipt-language.test.ts` (`venueWith`, hashes at 144–145, 185)
      and `apps/server/src/receipt-guests.routes.test.ts` (`venue`, 113–114, 165): helpers called across cases.
- [ ] Convert `apps/server/src/till-api.sell-published.test.ts` (`setupLunch`, 179–180, 262)
      and `apps/server/src/attendance-till-api.test.ts` (`beforeEach`, 43; repeated `paidBill`, 342).
      `setupLunch` is called directly by cases; its hash work is not in the file's `beforeEach`.
- [ ] Convert `apps/server/src/box-health-api.test.ts` (`seedPerson`, 53; three calls per `beforeEach`)
      and `apps/server/src/disk-stop-api.test.ts` (`seedPerson`, 46; four calls per `beforeEach`).
- [ ] Convert `apps/server/src/alerts-api.test.ts` (`seedVenueWithStaff`, 89; called across cases)
      and `apps/server/src/till-api.unroutable-dish.test.ts` (`beforeEach`, 102).
- [ ] Convert `apps/server/src/course-retention.test.ts` (`setup`, 84–85; called across cases)
      and `apps/server/src/device-api.delete.test.ts` (`openTillSession`, 114; callers at 207, 257, 269, 294, 319).
- [ ] Convert `apps/server/src/live-api.test.ts` (`fixture`, 48; called across cases)
      and `apps/server/src/device-levers.test.ts` (`fixture`, 107; called across cases).
      These twelve files are a useful subset, not a promise to convert every search hit.
      Import `./testing/known-secret-hashes.js`; retain every other identity import, including the namespace in live-api.
- [ ] After each group, run each converted file with `pnpm --filter @waitron/server exec vitest run <src/file.test.ts>`.
      Run unchanged `apps/server/src/testing/known-secret-hashes.test.ts` by the same command with `src/testing/known-secret-hashes.test.ts`.
      Its `fixturePinHash` and `fixturePasswordHash` suites own correct/wrong-secret, identical-string reuse and cross-secret verification;
      converted files retain their existing route and domain assertions. Read actual Tests counts and failures.
      Add no source-spelling tests. If new behaviour becomes necessary, stop for scope review and require a failing behavioural test first.
- [ ] Repeat each of the four samples three times sequentially in fresh processes:
      `/usr/bin/time -p pnpm --filter @waitron/server exec vitest run <file>` for `src/receipt-language.test.ts`,
      `src/receipt-guests.routes.test.ts`, `src/till-api.sell-published.test.ts` and `src/attendance-till-api.test.ts`; skip a newly held sample, never substitute an unbaselined file.
      Record candidate SHA, logs, exit codes, test counts and start/end host load alongside `baseline.json`.
      Report per-file medians and unchanged counts; disclose load differences and timing spread.
      Different host loads limit attribution; local timings do not establish a CI speed-up.
- [ ] Update `docs/backlog/ci.md`'s fixed-secret entry and bundle bullet/count together with
      `docs/backlog.md`'s bundle index. Keep its existing search and explicitly preserve held, unconverted and
      uninspected remaining setup. Delete only after a complete inventory proves none remains;
      once-per-file or hashing subjects alone do not count as remaining work.
- [ ] Inspect the whole diff for preserved assertions, secrets and hooks, and zero production/support changes.
      Do not refresh `apps/server/test-durations.json` unless a shard is measured over four minutes (`apps/server/vitest.config.ts:40`).
- [ ] Driver completes `finish-branch`: initial rebase, required Claude run-it review, fixes and fresh read;
      make signed-off commits, run the normal push hook, open one PR and wait for selected current-head CI.
      Landing is authorised by the lane request; driver uses `land-branch` after the required checks and resolved reviews.

Claude reviewed the initial plan once (141 seconds); driver corrections address selection/holds, backlog completeness, named timing samples and imports. The watcher cleared the original twelve files at 15:20 on 16 November, behind the CI priority; the four added suggestions stay unconverted.
