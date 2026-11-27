# A1418 6C — Start a paired-box handover from Box status

[Design §4](../specs/2026-11-07-a1418-box-stop-intent-design.md#4-shut-down-this-box) · [Slice map, item 6](2026-11-26-h-a1418-box-stop-intent.md)

On the main box, an administrator with **Manage boxes** can choose **Hand over to a spare box**
under **Shut down this box**. That choice opens **Servers**, where they select the spare and follow
**Hand over the venue**. The existing handover takes sales and filing off the old box and moves the
final copy. Keep both boxes connected for the transfer and the old box's return of records.

The watcher assigned the pair work in Lane H `questions.md` on 27 November 2026 at 04:47.
This first pair PR delivers the handover choice. Checked shutdown without handing over still
needs stream catch-up for paired boxes, plus the design §3 rule for a verified peer's answer on
restart. Spare shutdown and appliance power-off follow separately.

## Build

- In `apps/server/src/admin-shutdown-duties.ts`, expose an optional `handoverAvailable: true` in the
  existing shutdown health view for the serving main box when the existing handover route supports
  the venue and the held chart names an addressable serving spare that has finished joining. Reuse
  the source route's `holdsJoinedSpare` key comparison in `handover-signing.ts` and pass the same
  venue capability from `boot.ts`. Read the chart once per health view and keep `available` for
  checked backups. Leave the signed live probe and every start check in the existing handover route.
- In `apps/server/src/box-health.ts`, `apps/dashboard/src/api/servers-api.ts` and
  `apps/dashboard/src/screens/box-status-screen.ts`, carry the optional flag and use the existing
  `#goTo` navigation for the new choice. Show it in the idle shutdown section only with **Manage
  boxes** and access to Servers. Tell the administrator where to choose the spare and to keep both
  boxes connected. A click navigates without sending a write. The existing Servers confirmation
  owns the destination, confirmation and progress, including an unreachable spare's refusal.
- Add English and Spanish wording in `apps/dashboard/src/i18n/strings.ts` and both
  `apps/server/src/guide/{en,es}/box-status.md` guides. Point the guide to **Hand over to a spare
  box** in the Servers guide. Record the delivered choice and remaining pair work in `docs/backlog.md`.

## Focused checks

- Start in `apps/server/src/boot.stop-mark.test.ts` with **Offers handover to a joined spare without
  enabling checked shutdown**. A matching enrolled spare with an address gets the flag and the
  checked-shutdown POST is still refused. Chart-only and wrong-key spares lack the flag. Exercise
  the real health read with the normal server permission gate. Run the file and observe the flag
  missing before the change.
- In `apps/dashboard/src/screens/box-status-screen.test.ts`, start with **Opens Servers for handover
  without starting shutdown**. Check the navigation event, zero writes, and absence of the choice
  during a shutdown or without permission to use it. Run the file and observe the control missing
  before the change. Check the result in English and Spanish, both themes and at phone width.
- Rerun both changed test files. Run `apps/server/src/handover-controlled.e2e.test.ts` unchanged for
  the old box's stop, the final copy, the spare selling and the restart with the old box switched
  off. Run the guide checks, typechecks and Lane H's unchanged fiscal and menu gates.

Estimate 60–100 added production lines and 75–130 added test lines in one PR.
