# A1581 — Small display fixes around A4 printing

Staff can see when a job is waiting for paper, open an office printer from Print Queue,
and see its pending jobs and latest completed print. Drawer commands have no preview.
The till leaves its order controls visible under a notice and removes the status check
once the Customer document window has a confirmed delivery.

- [ ] **Print Queue (a–c).** In `apps/dashboard/src/screens/printers-screen.test.ts`, extend the
  office hold case to distinguish Waiting for paper from active Printing and prove the hold clears
  on Done. Test clicking a listed office printer opens its existing details and that a drawer
  command lacks View printout beside a normal document that still offers it. Use the existing
  status dot and warning token, with the same displayed status for search and filtering. Match
  office jobs against `pagePrinters` in `printers-screen.ts` and use the existing opener and
  retained-name fallback. Carry the drawer kind in `apps/server/src/print-jobs-routes.ts` and
  `apps/dashboard/src/api/printing-api.ts`, then omit its actions; verify a real queue response
  identifies drawer jobs in the server print API tests. Use English and Spanish status words.
- [ ] **Till (d–e).** In `apps/till/src/screens/till-ticket-view.test.ts`, show a settled A4
  original and assert the status check disappears; keep the unresolved and failed-read checks.
  In `till-ticket-view.ts` use the existing delivery and receipt completion facts. In the
  existing till app notices or settlement browser fixture, show the office notice above an open
  table order at phone width and measure its painted bottom against the first Back to floor row.
  Reproduce the overlap before choosing the CSS in `widgets/till-shell.ts` or its notice strip.
  Keep the strip in layout flow so it reserves its wrapped height.
- [ ] **Printers list (f).** Extend `apps/server/src/page-printers-api.test.ts` with one held
  A4 job, two completed at different times and another printer as a control. Count queued and
  printing A4 jobs and take the latest recorded delivery from the full stored job history in the
  page-printers list read. Return zero and an empty time before any job completes. In
  `apps/dashboard/src/api/printing-api.ts`, `live-queries.ts` and `printers-screen.ts`, show and
  sort those fields using the receipt columns’ existing formatter. Extend the mixed-printer table
  test to prove both values refresh after a `print_jobs` notification.
- [ ] **Verify.** Run each new or changed assertion red before its fix and then rerun its file.
  Update the EN/ES Printers and Table service guides where staff actions change and remove A1581
  from `docs/backlog/printers.md`. Capture before/after views on desktop and phone, both themes
  and languages, and send them through the watcher for the owner’s landing decision.

Use the existing print job and delivery states. Leave dispatch, retries, drawer execution, stored
test-page behavior and preview navigation out of this change. Expect 120–180 product lines and
130–220 test lines, plus the guide edits, in one pull request.
