# Office printer holds, Print Queue and retired agents

When an office printer holds an invoice, staff see the printer and what to fix on the till and in
Print Queue. The same job finishes when the printer resumes. A4 failures stay visible, and a
former primary's built-in agent stops raising a quiet-agent warning.

## 1. Detect and explain the hold

- In `apps/print-agent/src/ipp-print.test.ts`, first show a printer reporting `media-empty-error`
  while its accepted job still says `processing` without `printer-stopped`. Require a paper-out
  report before the late check near the deadline, then one completed Print-Job after paper returns.
  The existing fixture that makes the job itself say it has stopped already passes.
- In `ipp-print.ts`, check the printer on the first valid unfinished-job reply and periodically
  on the existing held-poll cadence while the job is otherwise unremarkable. Keep immediate
  checks for stopped or held jobs and the last check near the deadline. Keep the stopped-printer
  check, reason codes, claim renewal and same-job polling. The live HP's reply sequence from
  20 November is unverified. This test covers a gap in when Waitron asks for the printer's report.
- In `apps/server/src/invoice-delivery-status.ts`, use the linked A4 job's printer for an optional
  `printerName` on a held attempt. Extend the held case in `page-print-agent-e2e.test.ts` to
  assert that name and keep its existing one-submission and completion assertions.
- In `apps/till/src/api/client.ts`, `screens/till-ticket-view.ts` and `i18n/strings.ts`, show
  “{printer} is out of paper. Add paper and it will print.” for an active paper hold. Reuse the
  existing translated reasons for other stops and the office-printer fallback when no name is
  available. Keep the separate uncertain-outcome wording after a lost job. Test the displayed
  English and Spanish in `till-ticket-view.test.ts`. Keep the existing five-second reread.

## 2. Show office jobs in Print Queue

- Extend the existing `/management-api/print-jobs` read in `apps/server/src/print-api.ts` to include
  A4 jobs, using the existing status, printer name and hold from `print_jobs` and its printer join.
  Keep the completion and exhausted history limits. Add an A4 case to `print-api.test.ts` for
  queued, held and failed jobs. Update the existing history cases to admit A4 within those limits.
- In `apps/dashboard/src/api/client.ts`, `screens/printers-screen.ts` and `i18n/strings.ts`, use
  the queue's existing status cell and translated office-printer reasons. Make the reason
  searchable. A failed job shows its failure, even when a previous hold is stored. Keep A4 rows
  clear of the receipt preview and resend actions. Test a held and a failed row in
  `printers-screen.test.ts`, and update the English and Spanish `printers.md` guides.

## 3. Limit quiet-agent warnings to agents expected to print

- Pass the serving box's node id from `apps/server/src/boot.ts` into `printingAlertSource` in
  `alert-sources.ts`. That source should count its own self-enrolled agent and agents enrolled
  by staff (no node id). Keep the other box's enrollment and job history so it can serve again
  after a role swap. In `alert-sources.test.ts`, show the warning while that box serves, its
  disappearance after a swap and continued warnings for a quiet current or staff-enrolled agent.

Run each new case red then green and each changed test file before handoff. Check the till and
queue in both languages, both themes and at desktop and phone widths. Update A552 in
`docs/backlog/printers.md`, keeping the remaining paper and power-loss checks open.
Estimate 140 production lines and 160 test lines. One PR. Scope excludes migrations, new print
actions, fiscal changes and cross-box agent routing. Hardware qualification waits for the watcher
to clear work on the owner's boxes.
