# A976 venue-service and staffing test fixtures

Lane J's J-ENGLISH-VENUE-SERVICE item in `~/waitron-campaign-j/queue.md` continues
[A976](../../backlog/architecture.md#a976-finish-the-servers-english-test-venue-defaults).
Contributors can read ordinary venue-service test names in English and reuse those samples.
Include staffing in the same pull request if the combined diff fits.

1. Start with the 56 venue-service test paths in `scripts/english-only-still-to-clean.ts`. Rename
   ordinary fixtures, keys and matching readbacks in place. Start with `menu-timetable.test.ts`
   and keep every menu distinct. Translate the invented calendar's samples in
   `special-days.holiday-name.test.ts` with its matching readbacks. Preserve the dates, IDs,
   matcher strength, ordering, control characters and locale keys. Read whole files because the
   scanner catches only selected words and accented letters.
2. Keep deliberate language input and expected text in each test. A screen test that checks which
   fixed label appears can read the corresponding key from `VENUE_SERVICE_STRINGS` or
   `STAFFING_STRINGS`. Keep independent expectations for exact wording, plurals, dates, list
   joining and filled placeholders. Preserve accented ordering, Unicode and hyphenation inputs,
   the language maps in `department-receipts.test.ts` and `configuration-transfer.test.ts`,
   and the real holiday and place names in `holidays.test.ts`, `holidays-routes.test.ts`,
   `opening-hours-calendar.test.ts` and `configuration-transfer.test.ts`.
3. Apply the same rules to the 12 listed staffing tests if both packages fit about 900 changed
   lines and the three-hour budget. Delete fully clean paths from the debt list. Move only paths
   with necessary language findings to the existing `KEEPS_NON_ENGLISH` list in
   `packages/db/src/english-only.ts`, with a reason and the exact count. Update the test's list of
   kept paths and reduce `STILL_TO_CLEAN_COUNT` by the number removed from the debt list. Get
   watcher clearance for those two guard expectations. Update A976 in `docs/backlog.md` and both
   menu-timetable references in `docs/backlog/architecture.md` under A913 and A976.

Run each changed file before and after with `pnpm --filter @waitron/venue-service exec vitest run
<files>` and the matching staffing command if included. In `menu-timetable.test.ts`, change one
side of a fixture rename first and observe the stale readback fail. Require the same cases and
skips after the edits. Run `pnpm exec vitest run scripts/english-only.test.ts`. Check that restoring
a removed finding in a clean file and adding a finding in a kept file both fail the guard. List
changed expected text and the reason in the pull request.

Estimated product code +0/−0, tests +320–400/−320–400, test support +0/−0, debt list +0/−56 to
−68. Allow about 5–6 added guard lines per kept file, with 15–25 possible from Claude's scan.
The keep count comes from the final diff. The rest of A976, production translations, application
behavior and fiscal fixtures stay outside this branch.
