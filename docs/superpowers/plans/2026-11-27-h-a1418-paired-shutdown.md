# A1418 6C — Checked shutdown with a spare

[Design §§3–4](../specs/2026-11-07-a1418-box-stop-intent-design.md#3-every-start) · [Slice map, item 6](2026-11-26-h-a1418-box-stop-intent.md)

**Checkpoint for the watcher.** The watcher's 04:47 assignment in Lane H `questions.md` calls for
the main box to offer controlled handover as its second choice. The first review found that a
shortcut to Servers alone would leave checked shutdown unavailable on a pair. The second review
found that the standard join creates a `streams` link and marks it `streaming` when it records the
spare. The earlier handover test seeds membership without that link. See `issueMirrorBundle` in
`apps/server/src/mirror-bundle-api.ts` and `recordSpare` in `apps/server/src/spare-join.ts`.

## Smallest result to plan

On a main box streaming to its joined spare, an administrator can check a final backup and
switch off the main box. The spare stays on. Sales stop until the main box restarts. **Servers**
remains the way to hand over so the spare can sell. Both boxes stay connected for the transfer and
the old box's return of records. Spare shutdown, reseeding, Cloud and appliance power-off are later
work.

First qualify how to prove the spare's store contains the final admitted writes. Use the normal
join in `apps/server/src/testing/spare-join-scenario.ts` with the pinned Litestream and versitygw.
Hold the spare's store behind a write that precedes shutdown. Compare the source and the data
restored from the store before and after the transfer catches up, including one upload that starts
before the final write. `packages/stream/src/freshness.ts` describes how upload timestamps can
understate lag. `apps/server/src/spare-follow.ts` compares the latest applied and uploaded positions,
which can agree while the source still has unsent writes. Use the experiment to choose the smallest
signal that distinguishes those cases. Bring the signal and its evidence back before building.

## Where the build would fit

- `apps/server/src/admin-shutdown-duties.ts` would accept a streaming pair link to the joined spare
  and reuse the shutdown gate and saved-copy or download check. Keep the hold behind the qualified
  stream check. Keep Retry, Cancel and the explicit unchecked choice when progress stalls.
- `apps/server/src/boot-peer-check.ts`, `start-peer-check.ts` and `boot.ts` would carry a positive
  role confirmation from the existing signed peer check. Start under the existing stop rules if a
  newer chart or operation shows a takeover. For a shutdown mark, only a verified matching current
  role or a completed HTTPS peer carry-on clears it. A timeout alone leaves the hold in place.
- `apps/dashboard/src/screens/box-status-screen.ts`, its English and Spanish wording and the two
  Box status guides would show the shutdown and handover choices. Keep the existing Servers flow
  and avoid a new handover eligibility check. Update `docs/backlog.md` with the delivery.

Use the real join to test that the ordinary pair is eligible and that a delayed transfer holds the
shutdown mark. The peer suites own matching, stale, silent and superseded replies. Dashboard tests
own both choices. Keep the controlled handover E2E and Lane H fiscal and menu gates unchanged.
The slice map allows 200–350 added production lines and 260–430 test lines. Re-estimate after the
stream qualification, when the signal and the files that need it are known.
