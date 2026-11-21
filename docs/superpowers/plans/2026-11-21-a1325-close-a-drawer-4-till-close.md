# 4. Close a drawer from the till

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 3. Estimate 480 production and 390 test
lines. Staff can close a drawer and get a slip, including when they have to open it with a key.

Add `apps/till/src/screens/till-drawer-close.ts` and wire it through `till-app.ts`, `widgets/till-shell.ts`,
the drawer client and EN/ES text. Reuse the till form and price input primitives. The More menu uses
the assigned drawer even when it cannot kick. For a new count, use the existing audited Open drawer
request and offer the key if it fails. Reopen a pending count directly. Save the first count before
showing expected cash. Allow the one recount, then propose the last amount left and show what goes
to the bank. Back closes the screen, with a saved count still available to resume.

Add `apps/server/src/drawer-close-ticket.ts` using the configured receipt layout and document print
queue. Include the date interval, drawer, actor, expected, counted, difference, withdrawals, cash
left and card total. Save the close and enqueue the document together when its printer can be used.
When the printer is unavailable, finish the close and explain the print status. Replaying Finish
leaves the print queue as it was. Documents contain no drawer commands.

Fail first in till `till-drawer-close.test.ts` and its accessibility suite for hidden expected cash,
count/recount, resume, local decimals, manual-key continuation and the confirm figures. Include a
till-app case for the More menu connection. Server `drawer-close-ticket.test.ts` owns slip contents
and existing layout. Extend `drawer-close-api.test.ts` for one queued document on replay and a saved
finish with unavailable printing. Update both till guides and inspect the flow. No schema change.
