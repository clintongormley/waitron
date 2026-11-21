# 5. Let staff record cash in and out

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 4. Estimate 300 production and 275 test
lines. Staff can record a top-up or withdrawal and its reason from the till.

Add `POST /api/drawer/entries` to `apps/server/src/drawer-api.ts`. Reuse the close route's device,
person and drawer checks. Accept positive whole-cent amounts, a reason and the existing submission id convention.
Replay the same submission without recording twice. Use PR 1's writer and one transaction. Show no
expected balance in this form.

Add the form in `apps/till/src/screens/till-drawer-cash.ts` and connect it through `till-app.ts`,
`widgets/till-shell.ts`, a drawer API client and EN/ES strings. Use the existing audited Open drawer
action and offer the key if it fails. Saving or replaying the entry leaves the drawer mechanism alone.
Update EN/ES till and printer guides.

Fail first in server `drawer-api.test.ts` for a permitted person versus an ungranted person or device,
guessed printer id, signed movement, validation and replay. Run the till profile and session-person route walks with their new inventory.
Till `till-drawer-cash.test.ts` and its accessibility suite own the More menu form, local decimals,
reason, manual-key route and successful save. Re-run `till-shell.test.ts` and the existing Open drawer
and calibration assertions. The database protection list should be equal.
