# A1581 — Small display fixes around A4 printing

Staff can see when an office printer is holding a job, open its details from Print Queue,
and see how many jobs it owes and when it last printed. Drawer commands have no preview.
The till keeps Back to floor visible under the notice and shows the delivery result
without an unnecessary Check print status button.

- [ ] **Print Queue (a–c).** In `apps/dashboard/src/screens/printers-screen.test.ts`, test queued
  and printing A4 jobs with a paper hold against a Printing row and a transition to Done.
  Show Held with the warning dot and the existing reason below. Use that word for search and
  the status filter, adding EN/ES wording in `i18n/domain.ts`. Match listed office printers for
  the cell, search and filter in `printers-screen.ts`, using its existing details button and the
  recorded name when the printer is absent. Return `kind: "drawer"` on drawer rows only in
  `apps/server/src/print-jobs-routes.ts` and pin that in `print-api.test.ts`. Widen the type in
  `apps/dashboard/src/api/printing-api.ts` and test drawer and document rows side by side.
  Move the queue's status and reason helpers into a sibling if needed to stay under the cap.
- [ ] **Till (d–e).** Verify the actual Customer document window on the A4 completion path using
  `apps/till/src/till-app.invoice-printer-choice.test.ts`. A1582 (#4360) added automatic refresh
  and hid the button while F1 uses it. Check completed A4 there first. Change
  `screens/till-ticket-view.ts` only for a reproduced Customer document case, retaining any
  unresolved or failed-read action. For the overlap, use `apps/till/src/till-app.notices.test.ts`
  with the real office paper-out notice and open table and bill picker. Use the reported device
  if known, then check desktop and a wrapping phone width. Measure the painted strip and the
  Back to floor row, then fix the sizing where the failing test locates it.
- [ ] **Printers list (f).** Share the existing full-history summary in
  `apps/server/src/print-printers-routes.ts` with the existing page-printers GET. Add an opt-in
  `?jobSummary=1` read so only the Printers screen subscribes to the summary under `print_jobs`
  in `apps/dashboard/src/api/live-queries.ts`. Keep the printer-list read and its test-page
  error recovery independent of job events. In `page-printers-api.test.ts` prove one held A4
  job, two distinct completion times and an idle printer return the right counts and times.
  In the mixed printer table test prove both office values update after a job event.
- [ ] **Verify and show.** Run changed tests red before fixing, then run their files. Update
  `apps/server/src/guide/{en,es}/printers.md` for the new printer action and hold label.
  Keep the backlog's historical record of the real-box session. Check English and Spanish,
  light and dark, phone and desktop. Send a representative before and after for each
  changed surface to the watcher for the owner’s landing decision.

Use existing job states, delivery facts and printer details. Dispatch, retries, drawer execution,
test pages and A1588's preview navigation are outside this change. Expect about 100–150 lines of
product code and 100–170 test lines, plus the guide edits, in one pull request.
