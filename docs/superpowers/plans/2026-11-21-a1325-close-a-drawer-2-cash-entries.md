# 2. Let staff record cash in and out

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 1. Estimate 350 production and 300 test
lines. Staff can record a top-up or withdrawal and its reason from the till.

Add `POST /api/drawer/entries` in `apps/server/src/drawer-api.ts`, mounted by `till-api.ts`. Require
the active device, tab person, `cash.drawer`, profile permission and the device's actual assigned
drawer. Accept positive whole-cent amounts, a reason and the existing submission id convention.
Replay the same submission without recording twice. Use PR 1's writer and one transaction. Show no
expected balance in this form.

Add staff to `packages/identity/src/permissions.ts` holders of `cash.drawer`. Trace the till's
authorizers and override, hardware calibration's separate management authorization, permission
seeding and both apps' wording. Preserve override for an explicitly ungranted role and keep device
checks. In `apps/server/src/device-api.ts`, expose the assigned drawer including switched-off hardware
alongside the existing kick eligibility.

Add the form in `apps/till/src/screens/till-drawer-cash.ts` and connect it through `till-app.ts`,
`widgets/till-shell.ts`, a drawer API client and EN/ES strings. Use the existing audited Open drawer
action and offer the key if it fails. Saving or replaying the entry leaves the drawer mechanism alone.
Update EN/ES till and printer guides.

Fail first in server `drawer-api.test.ts` for staff access versus an ungranted person or device,
guessed printer id, signed movement, validation, switched-off hardware and replay. Run the identity
permission suite and the till profile and session-person route walks with their new inventory.
Till `till-drawer-cash.test.ts` and its accessibility suite own the More menu form, local decimals,
reason, manual-key route and successful save. Re-run `till-shell.test.ts` and the existing Open drawer
and calibration assertions. The database protection list should be equal.
