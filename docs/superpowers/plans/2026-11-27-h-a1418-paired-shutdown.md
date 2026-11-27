# A1418 6C — Checked shutdown with a spare

On a main box with a joined spare, **Check and shut down** drains work and checks the final backup.
The spare stays on and sales wait for the main box to restart. **Hand over to the spare** opens
**Servers** for the existing controlled handover and return of records. Both choices ship in one PR.
[Design §§3–4](../specs/2026-11-07-a1418-box-stop-intent-design.md#3-every-start) ·
[Slice map, item 6](2026-11-26-h-a1418-box-stop-intent.md)

**Qualification, 27 November.** The normal join test ran two box servers with Litestream 0.5.18
and versitygw 1.8.0. An older upload completed after the final write committed. Both reported
positions were 3 and lag was zero, but a fresh restore had the earlier write while upload 4 was held.
`litestream sync -wait -json` timed out while held. After release it returned local and remote
positions 5, the follower reached 5, and a fresh restore contained the final write. The join suite
passed. Lane H receipts are `6c-probe-old-signal.log` and `6c-probe-sync.log`.
[Pinned sync implementation](https://github.com/benbjohnson/litestream/blob/v0.5.18/store.go#L411-L459)

1. **Prove the upload.** In `packages/stream/src/{litestream,litestream-process,supervisor}.ts`,
   give the paired sender a private Unix socket and call the pinned binary with `sync -wait -json`
   after the shutdown drain. Accept a positive local position covered by the replica position.
   `apps/server/src/stream-host.ts` checks that the same sender, spare, and stream generation still
   apply when the call returns. A timed-out call leaves the check pending while the stream is
   healthy and the administrator can cancel. A definite stream failure pauses with the existing
   Retry and Shut down anyway choices. Measuring a no-progress interval stays with 1C. The stream
   package’s `supervisor.test.ts` owns malformed or behind responses, timeout and cancellation.
   `stream-host.test.ts` owns a changed sender or wrong destination.
2. **Check shutdown.** `admin-shutdown-duties.ts` uses the current joined pair and the existing
   drain and checked archive paths. Require sync and the saved backup check or confirmed download
   before writing the existing mark. A failed sync cannot leave a staged download behind.
   `spare-join.e2e.test.ts` and `testing/spare-join-scenario.ts` exercise a real join, a held final
   upload, no mark while held, and a restore of the final write after checked completion.
   `admin-shutdown.test.ts` owns Retry, Cancel and the unchecked choice.
3. **Confirm the role on restart.** `boot-peer-check.ts` and `start-peer-check.ts` return positive
   role evidence only from a fresh, signed reply from the joined spare that agrees with the current
   trusted membership. `boot.ts` clears the existing paired mark on that evidence or completed
   HTTPS peer carry-on. Silence, a stale chart and a timed-out wait keep the mark. Superseding chart
   or operation evidence takes the existing stop path. `boot-peer-check.test.ts` proves the answer
   cases, and `boot.stop-mark.test.ts` and `waiting-start.test.ts` prove whether start clears the mark.
4. **Show both choices.** Feed paired eligibility through `box-health.ts` and the dashboard
   `api/servers-api.ts`. Update `box-status-screen.ts`, English and Spanish strings and Box status
   guides, and `docs/backlog.md`. `box-status-screen.test.ts` proves that handover opens Servers
   and shutdown opens its confirmation. Run the unchanged controlled handover, fiscal and menu gates.

Estimate 250–350 added product lines and 330–430 test lines. Spare shutdown, Cloud, and appliance
power-off are later slices. Build test-first after the watcher clears the reviewed plan.
