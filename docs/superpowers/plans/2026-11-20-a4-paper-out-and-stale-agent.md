# Office printer holds, Print Queue and retired agents

Staff see why an A4 invoice waits, in Customer document and after it closes. It prints when the
printer resumes. Managers see waiting and failed pages in Print Queue. A retired agent falls
quiet without raising a warning.

## 1. Detect and explain a stop

- The Lenovo saved the HP's `paper_out` hold and completed the invoice in one attempt. Its log has no first-hold
  timestamp or raw reply. Claude reproduced a near-deadline hold when a stopped printer's job still
  reports processing. The watcher cleared asking the printer on every unfinished job poll at 23:07
  on 20 November. Use the HP's recorded empty-tray reply in the test and assert one submission.
- In `apps/server/src/invoice-delivery-status.ts`, read the attempt's office printer by its saved
  id. Reuse the alert's per-printer hold lookup for jobs queued behind a hold, including a
  test page. Extend `page-print-agent-e2e.test.ts` to assert the hold and printer name.
- In the till's `api/client.ts`, `screens/till-ticket-view.ts` and `i18n/strings.ts`, give active
  holds named, actionable instructions in English and Spanish. Keep uncertain outcomes distinct.
  Test those words in `till-ticket-view.test.ts`.

## 2. Show A4 pages in Print Queue

- In `apps/server/src/print-api.ts`, include A4 jobs in the existing bounded queue. Use the linked
  delivery for uncertain outcomes and the same hold lookup for waiting pages. Omit receipt visibility
  rules and reprint targets for A4. Test queued behind a hold, held, failed, uncertain and finished
  history in `print-api.test.ts`.
- Extend dashboard `api/client.ts`, `api/live-queries.ts`, `screens/printers-screen.ts` and translated
  printer wording. Check live updates for holds and completions. Show “May have printed” where
  appropriate. Test reasons and receipt-only actions in `printers-screen.test.ts`.

## 3. Stop the warning for the retired agent

- Check the old agent's node id and A4 assignments. In `boot.ts` and `alert-sources.ts`, scope
  `agent.silent` to serving boxes, staff-enrolled agents and agents still assigned to active office
  printers. Use the existing list of boxes to keep a serving spare's warning. Keep agent identities
  for a future swap. Test a swap, a reassignment and a serving spare in `alert-sources.test.ts`.

## 4. Keep waiting visible after the dialog closes

- The Lenovo's till had a five-minute idle setting and its session ended at 22:06 local time. The
  retained log does not establish what ended that session. Exercise the existing idle lock and
  document close path in `till-app-settlement-documents.test.ts`.
- For an intended close, extend `apps/server/src/box-staff-notices.ts` and its tests to show a
  printer-scoped A4 notice through the existing equipment read. Use the same held, waiting, failed
  and uncertain outcomes as the dashboard bell and clear the notice when that alert ends.
  Keep the same notice visible during an idle lock with just the printer and reason. Reuse
  `apps/till/src/till-app.ts`, `screens/till-lock-screen.ts` and `i18n/staff-notices.ts` plus
  translated strings. Test the notice on the lock screen and its clearance after printing.

Run each regression red then green. Check both languages and themes at phone and desktop widths.
Update the English and Spanish `printers.md` and `table-service.md` guides and A552 in
`docs/backlog/printers.md`. Estimate 280 production lines and 240 test lines. One PR. Invoice
issuance, migrations, reprint actions and cross-box routing are outside scope. Arrange any
real-box reads through the watcher.
