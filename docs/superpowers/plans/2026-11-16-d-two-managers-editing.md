# Two managers editing at once

Deliver TWO-MANAGERS-EDITING’s six entries in `docs/backlog/service-periods.md`: untouched fields/dates follow live updates, touched values remain yours, and saves omit unchanged optional settings and paint. Watcher acceptance is required for retaining whole required department name/trading-name/policy bodies and special-day name/repeat/date envelopes: this plan does not make those fields optional. Paint ownership is per department/zone and date/weekday, not individual strokes.

Separate Sol author; driver checked and corrected after Claude’s 298-second approach read. Await watcher clearance; no owner design approval claimed. Source diagnoses remain unverified until reproduced. Paths use `V = packages/venue-service/src/`, `D = V/dashboard/`.

1. **Department dialog.** `D/department-settings.ts` follows each untouched field against its saved comparison value, and reminders per `courseId`, using existing comparisons, `followSteps`, `followDescription` and `draftScopeFor`. Preserve touched values/leave protection. Through `D/client.ts`, omit unchanged optional settings; send the existing course list only when a row changed. In `D/department-settings.test.ts`, reproduce **“Name-only Save preserves another manager’s reminder Off/Needs clearing”** and **“Touched reminder survives while untouched name follows”**. Assert native controls and omitted fields. Reuse `V/testing/department-edit-fixture.ts`, preserving omitted values in its answer.

2. **Special days.** Keep existing merge/date/paint helpers in `D/special-day-painter.ts`.
   - `D/special-day-painter.paint.test.ts`: **“Failed replacement read explains missing hours; recovery clears its message”**, reusing `deleteLunch` and the failed re-read. Show EN/ES wording (`D/strings.ts`) only while `vacated` is set, saying Save retries. Preserve write-refusal/no-write assertions.
   - `D/special-day-painter.save.test.ts`: run existing paint/Closed/untouched removed-date cases, adding at most one assertion. A tick-only edit on a previously painted date returns ticked; its untouched paint follows removal. Retire that allegation with the passing receipts, without another test.
   - Same file: **“Dropping the last edit adopts live revision for a new holiday”**; move revision adoption after `dropUnpaintable`. Reuse existing still-dirty controls.
   - `D/special-day-painter.races.test.ts`: **“Update during refused Save is merged before retry”**. Hold write, deliver untouched-date updates, refuse, wait for re-read, assert display/retry body and retained personal paint. Reuse existing re-read without its `vacated` condition; add no retry-before-read defense.

3. **Season weeks.** `D/season-painter.ts` sends changed weekdays only, including empty days for erasure. In `V/season-weeks.ts`, validate submitted weekdays before merging, then append missing stored weekdays from its existing reads inside the transaction. Reuse seven-day stagers and revision/waiting-change checks. Submitted days stay first, preserving error positions; empty `days` is a no-op. Map `refuse` through each owner’s sent weekdays; appended-day errors use the existing week-level message.

   `V/season-weeks.test.ts` owns **“Two saves preserve unlisted department/zone weekdays and clear listed empty days”**, duplicate/invalid weekdays and atomic refusal. `V/menu-timetable-routes.test.ts` owns sparse-body/error mapping. `D/season-painter.{save,races}.test.ts` owns selective requests/refusal-day display; update existing seven-day bodies and simulated storage without dropping behavioral assertions.

Use TDD: Chromium proves view behavior/request shape; the real database case (`useVenueDb`) proves stored weekday preservation. Reuse painter fixtures, held gates, `LiveData` and real clients. Run changed files with `pnpm --filter @waitron/venue-service exec vitest run <files>`; record counts/red-green evidence. Retire non-reproductions only after running them.

Correct stale design-system claims; leave guides unchanged unless an instruction becomes false. Delete resolved backlog entries/details and the bundle/index when all six close. No till/staffing/fiscal/migration work, framework, ledger or extra race defenses.

Estimated additions/removals: production180/75, tests275/100, support15/10, docs10/0, backlog0/35: **700 lines**. One usable PR within three hours excluding recorded waits; seek watcher guidance beyond **1,050 lines**.
