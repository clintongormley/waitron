# Close Add a printer after a successful address check (A1579)

Staff can close **Add a printer** once **Connect** finds a printer at the typed address. This includes an office printer found at port 9100 and added through IPP at port 631. Closing still asks about an address that was never found or was edited since the successful check.

## Dashboard

- [ ] In `apps/dashboard/src/screens/printers-screen.test.ts`, use the existing `mountSharedPrinter` fixture and real Close action. Check a fresh 9100 discovery report for a printable office queue at 631, add it, verify the IPP registration, then expect `wt-close` and no discard prompt. Add a receipt case that closes after Connect with no Add, and a control that edits the checked address and still gets a discard prompt. Use a stale or mismatched report to verify that an unanswered Connect still leaves a draft. Run the new cases first and confirm the successful-check cases fail on the prompt.
- [ ] In `apps/dashboard/src/screens/printers-screen.ts`, carry the normalized form snapshot sent by Connect alongside its existing probe target. Keep the submitted host spelling because the server can canonicalize IPv6. When `#setDiscovered` first gets a successful `#probeOutcome`, commit that snapshot in the existing address scope. Reuse the target's host, port and report-time checks to tell whether a report answered Connect. Leave the receipt registration's existing same-address fallback and the dialog's close guard in place.
- [ ] Run the focused cases again, then both the printer screen and its accessibility test files. In the English and Spanish `apps/server/src/guide/{en,es}/printers.md`, make the next action after Connect explicit. Run the printer guide checks. In `docs/backlog/printers.md`, retain the still-open row decision if needed and remove the closed address issue.

## Agent display

#4336 groups reports for one queue. Current Chromium tests still show **Use this agent** when a different agent can print to an added queue. Present a picture proposal through the watcher. Keep the address fix independent of the decision about that row. The address branch changes no discovery grouping, printer routes, printer settings or profile assignment.

Expect about 18 production lines and 90 test lines. The checks belong to the Dashboard because the API already returns the probe target and the screen decides whether the input needs protection.
