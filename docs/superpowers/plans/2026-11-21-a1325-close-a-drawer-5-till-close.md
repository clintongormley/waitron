# 5. Close a drawer from the till

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 4. Estimate 520 production and 430 test
lines. Staff can count a drawer, finish the withdrawal and get a slip. A manager deleting the
printer can choose to empty it first. Confirm the staff grant and same-address replacement rule
with the watcher before publishing this slice.

In `packages/identity/src/permissions.ts`, add Staff to `cash.drawer`. Trace permission seeding,
the till authorizers and override, and dashboard calibration's separate hardware permission.
Keep the profile check and the override for an explicitly ungranted role.

Add `apps/till/src/screens/till-drawer-close.ts` and wire it through `till-app.ts`, `widgets/till-shell.ts`,
the drawer client and EN/ES text. Use the assigned drawer even when it cannot kick. On a new count,
call audited Open drawer and offer the key on failure. A saved count resumes directly. Use till
form primitives to collect it, allow one recount and propose the previous amount left. Show the
withdrawal for the bank. Back leaves any saved count available to resume. The optional tips split
can follow as the design allows.

Finish appends the close and queues PR 4's document in one transaction when printing is available.
When printing is unavailable, finish and point to the Sales reprint. Replaying Finish queues no
duplicate. Documents contain no drawer commands.

In `apps/server/src/{printer-delete,print-api}.ts` and dashboard `widgets/printer-delete-copy.ts`,
offer Close first, Delete anyway and Stop for a balance or open count. Close first points to the
assigned till flow or the existing assignment action. Keep the recorded balance under the same
id on Delete and Add, and explain that re-adding at the same address can keep the id. A printer
with a different id starts at zero.

Fail first in the till flow and accessibility tests, including the More menu, manual key and
resume. Run identity and till permissions tests, extend `drawer-close-api.test.ts` for offline and
replayed printing, and run printer delete/history, return and delete-copy tests. Update EN/ES
till and printer guides. The database protection list should be equal.
