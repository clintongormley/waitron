# A976 venue-service and staffing test fixtures

Lane J's J-ENGLISH-VENUE-SERVICE item, recorded in `~/waitron-campaign-j/queue.md`, continues
[A976](../../backlog/architecture.md#a976-finish-the-servers-english-test-venue-defaults).
Contributors can read ordinary venue-service test names in English and add tests without inheriting
Spanish placeholders. The same pull request cleans staffing if it fits the queue's size.

1. Take the venue-service test paths from `scripts/english-only-still-to-clean.ts` (56 at
   `9f581f90d7`). In the database suites, translate ordinary fixture labels and their readbacks
   together. In `menu-timetable.test.ts`, rename the menu fixture keys and their references, keeping
   each menu distinct and in its original sort position where order matters. Apply the same rule
   to calendar, service, station and routing labels in the dashboard tests. Keep control characters,
   dates, locale keys, IDs, expected order and matcher strength. Read whole files for ordinary
   Spanish text that the guard's word and accent checks miss.
2. Keep the input and expected output of deliberate language, accent and locale cases. In dashboard
   tests that check which message appears, read it from the existing `VENUE_SERVICE_STRINGS` or
   `STAFFING_STRINGS` key. Keep independent expected text when a case pins wording, formatting or
   interpolation. Put only deliberate language data that needs a literal in
   `packages/venue-service/src/testing/i18n/fixtures.ts` or
   `packages/staffing/src/testing/i18n/fixtures.ts`. Examples include the calendar's Spanish
   hyphenation case, an accented station name used in ordering, and staffing's composed and
   decomposed initials. Preserve the exact language-map values and official holiday input.
3. Apply the same approach to the 12 listed staffing tests, after reviewing the venue-service
   diff. Keep staffing in this pull request if both packages fit about 900 changed lines and
   the three-hour budget. Remove only paths cleaned in this branch from the debt list and reduce
   `STILL_TO_CLEAN_COUNT` by exactly that number in `scripts/english-only.test.ts`. This count
   change requires watcher clearance. Keep the scanner and its checks. Narrow the remaining A976
   work in `docs/backlog.md` and `docs/backlog/architecture.md`.

Record the baseline for each changed test file. For a rename that crosses fixture setup and
readback, change one side first and observe the old label fail in `menu-timetable.test.ts`.
Run each changed file with `pnpm --filter @waitron/venue-service exec vitest run <files>` and
the same command for `@waitron/staffing` if included. Require the same cases and skips. Run
`pnpm exec vitest run scripts/english-only.test.ts` after staging so the guard sees all tracked
fixtures. Include changed expected text and its reason in the pull request.

Estimated product code +0/−0, tests +320–400/−320–400, test data +20–40/−0, and debt list
+0/−56 to −68, plus the count and backlog lines. The rest of A976, production translations,
application behavior and fiscal fixtures stay outside this branch.
