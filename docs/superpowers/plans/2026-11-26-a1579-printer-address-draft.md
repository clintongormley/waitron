# Close Add a printer after a successful address check (A1579)

Staff can close **Add a printer** once **Connect** finds a printer at the typed address. This includes an office printer found at port 9100 and added through IPP at port 631. Closing still asks about an address that was never found or was edited since the successful check.

## Dashboard

- [ ] In `apps/dashboard/src/screens/printers-screen.test.ts`, use the existing `mountSharedPrinter` fixture and real Close action. Check a fresh 9100 discovery report for a printable office queue at 631, add it, verify the IPP registration, then expect Close to produce `wt-close` without opening the discard prompt. Add a receipt case that closes after Connect before Add, and controls for an edit after Connect and a stale report that each still prompt. When a successful Connect is followed by adding a different receipt printer, expect Add a printer to close and calibration to open, as for any clean address. Run the new cases first and check that the unexpected discard prompt accounts for the Close failures.
- [ ] In `apps/dashboard/src/screens/printers-screen.ts`, resolve the pending check in `#setDiscovered` with the existing `#probeOutcome`. When it returns `found`, `page_printer` or `registered`, commit `#addressValues()` to the address scope. The form disables both address inputs during the pending check. Keep the same-address receipt registration fallback for a matching printer added without a successful Connect.
- [ ] Run the focused cases again, then the printer screen and accessibility test files. In `apps/server/src/guide/en/printers.md` and `apps/server/src/guide/es/printers.md`, say where to Add or Close after Connect finds the printer. Run the printer guide checks. Update the session list in `docs/backlog/printers.md` for the completed fix and retain any open agent-row decision in the same bundle.

## Agent display

#4336 groups reports for one queue. Chromium tests still show **Use this agent** when a different agent can print to an added queue. The picture proposal in the lane's `receipts/a1579/agent-row-picture.md` shows the just-added printer without the move action until the dialog is opened again. The watcher will take it to the owner. The address fix can ship independently.

Expect about seven production lines and 115 test lines. The checks belong to the Dashboard, where the address draft and Close action are owned.
