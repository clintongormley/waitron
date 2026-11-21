# 2. Let staff record cash in and out

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 1. Estimate 350 production and 300 test
lines. A person who already holds the drawer permission can record a top-up or withdrawal and its
reason from the till. PR 5 brings the staff grant with Close drawer.

Add `POST /api/drawer/entries` in `apps/server/src/drawer-api.ts`, mounted by `till-api.ts`. Require
the active device, tab person, `cash.drawer`, profile permission and the device's actual assigned
drawer. Accept positive whole-cent amounts, a reason and the existing submission id convention.
Replay the same submission without recording twice. Use PR 1's writer and one transaction. Show no
expected balance in this form.

In `apps/server/src/device-api.ts`, expose the assigned drawer from PR 1's resolver alongside the
existing kick eligibility. Manual opening keeps its existing permissions.

Add the form in `apps/till/src/screens/till-drawer-cash.ts` and connect it through `till-app.ts`,
`widgets/till-shell.ts`, a drawer API client and EN/ES strings. Use the existing audited Open drawer
action and offer the key if it fails. Saving or replaying the entry leaves the drawer mechanism alone.
Update EN/ES till and printer guides.

Fail first in server `drawer-api.test.ts` for a permitted person versus an ungranted person or device,
guessed printer id, signed movement, validation, switched-off hardware and replay. Run the till profile and session-person route walks with their new inventory.
Till `till-drawer-cash.test.ts` and its accessibility suite own the More menu form, local decimals,
reason, manual-key route and successful save. Re-run `till-shell.test.ts` and the existing Open drawer
and calibration assertions. The database protection list should be equal.
