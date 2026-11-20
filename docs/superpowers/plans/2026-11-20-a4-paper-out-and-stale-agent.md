# Office printer holds, Print Queue and retired agents

Staff see what to fix when an office printer holds an invoice. That job finishes when the printer
resumes. Managers can find waiting and failed A4 jobs. A former primary's unneeded agent falls
quiet without a warning, and a printer that still needs that agent keeps its warning. A closed
dialog leaves staff a way to see that the printout is still due.

## 1. Find and explain the printer stop

- Obtain a read-only receipt from the 20 November HP attempt through the watcher. Check its
  delivery status and failure code, the linked job's hold, and any recorded printer and job
  replies. On main the held-and-resumed test in `apps/server/src/page-print-agent-e2e.test.ts`
  passes. The IPP suite also confirms that a `processing` job can defer the first printer check
  until near the deadline. The HP's reply sequence is unverified.
- Make only the agent change supported by that receipt. Reproduce the reply sequence in
  `apps/print-agent/src/ipp-print.test.ts` before changing `ipp-print.ts`. State both the job and
  printer states in the fixture. If only the job still says `processing`, test an earlier,
  bounded printer-state check. If the printer itself reports a different state with a stop
  reason, verify the distinction between an error and a warning before changing detection.
  Keep the claim, track the same printer job and assert one submission through recovery.
- In `apps/server/src/invoice-delivery-status.ts`, join the linked A4 job's office printer and
  return an optional `printerName` on a held attempt. Assert the assigned name in the existing
  `page-print-agent-e2e.test.ts` case. In the till's `api/client.ts`, `screens/till-ticket-view.ts`
  and `i18n/strings.ts`, name the printer for known holds, with the existing fallback. For an
  active paper hold, say “{printer} is out of paper. Add paper and it will print.” Keep the
  distinct wording when the box has lost track of the job. Test both languages in
  `till-ticket-view.test.ts` and keep the existing status reread.

## 2. Show A4 jobs in Print Queue

- Use the existing read in `apps/server/src/print-api.ts` for receipt and office printers. Keep
  its history limits. Read the linked invoice delivery for uncertain outcomes and the job for
  active holds. A waiting A4 behind a held job on that same printer shows the hold, too.
  Strip receipt preview, reprint targets and receipt visibility rules from the A4 row path.
  Test queued, held, failed and uncertain A4 jobs in `print-api.test.ts`, including a queued
  job behind a hold and A4 within the existing finished history limits.
- In the dashboard's `api/client.ts`, `api/live-queries.ts` if the read needs a new dependency,
  `screens/printers-screen.ts` and `i18n/strings.ts`, use the existing status cell and translated
  office-printer reasons. Say “May have printed” for an uncertain outcome. Test hold, failure,
  uncertainty and available actions in `printers-screen.test.ts`.

## 3. Stop the old agent warning after it is no longer needed

- Pass the serving box's node id from `apps/server/src/boot.ts` to `printingAlertSource` in
  `alert-sources.ts`. Preserve the warning for a quiet active agent if it is enrolled locally,
  enrolled without a box id, or still assigned to an active printer. Keep the other box's row
  for history and future swaps. Test the warning clearing after a swap and after reassignment,
  and the cases where it remains, in `alert-sources.test.ts`.

## 4. Keep delivery visible when the Customer document dialog closes

- Compare the owner's till screen after closure, elapsed time and profile timeout with
  `apps/till/src/till-app.ts` and its existing idle sign-out test in
  `till-app-settlement-documents.test.ts`. Auto sign-out closes the dialog by design. Confirm
  whether it happened here before selecting the fix.
- For an intended close, retain a plain waiting notice in the till and reuse the signed-in
  delivery read to clear it when the invoice prints or report a failure or uncertain result.
  Keep the sign-out boundary and customer details private. If it was an idle lock, resume
  the notice on the operator's next sign-in and get a watcher decision about what should show
  while locked. First reproduce the confirmed close and assert the notice and its clearance in
  `till-app-settlement-documents.test.ts`. Use till `i18n/strings.ts` for EN and ES.

Run tests red then green, including focused till and dashboard views in both languages, both
themes and at phone and desktop widths. Update both guides (`printers.md` and `table-service.md`)
in English and Spanish, and narrow A552 in `docs/backlog/printers.md` to remaining real-paper
checks. Estimate 250 production lines and 220 test lines. One PR. Keep issuance, migrations,
print actions and cross-box agent routing outside this change. Work on the real boxes follows
the watcher's go-ahead.
