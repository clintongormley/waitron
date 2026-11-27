# A1418 6C — Checked shutdown with a spare

On a main box with one joined spare, **Check and shut down** drains work and checks the final
backup. The spare stays on. After restarting the main box, sign in over HTTPS to resume sales.
**Hand over to the spare** opens **Servers** for the existing controlled handover and return of
records. Both choices ship in one PR. Automatic clearance of the restart hold requires a separate
watcher decision about a replacement the spare has never heard of. [Design §§3–5](../specs/2026-11-07-a1418-box-stop-intent-design.md#3-every-start) ·
[Slice map, item 6](2026-11-26-h-a1418-box-stop-intent.md)

**Qualification, 27 November.** Before testing, Lane H recorded that a check fails if it accepts
an older restored write or fails to accept the final one after transfer resumes. Two completed
controls joined two box servers with Litestream 0.5.18 and versitygw 1.8.0. An older upload
finished after the final write committed. Both reported positions were 3 and lag was zero, but a
fresh restore had the earlier write while upload 4 was held. `litestream sync -wait -json` timed
out after three seconds while held. After release it returned local and replica positions 5, the
follower applied 5, and a fresh restore had the final write. The join test passed in the second
control. Lane H receipts are `6c-probe-old-signal.log` and `6c-probe-sync.log`.
[Pinned sync implementation](https://github.com/benbjohnson/litestream/blob/v0.5.18/store.go#L411-L459)

1. **Prove the upload.** In `packages/stream/src/{litestream,litestream-process,supervisor}.ts`,
   give each paired Litestream process its own short, private Unix socket. Use the pinned binary
   to capture and replicate the database's current position with `sync -wait -json`. Require a
   positive local position and a replica position at least as high. `apps/server/src/stream-host.ts`
   verifies the same child, joined spare, and active generation at completion. Use the command's
   30-second default for one attempt. A timeout is a completed check failure and uses the existing
   pause, alert and Retry controls. Measuring a no-progress interval stays with 1C. `supervisor.test.ts`
   owns invalid responses, timeout and cancellation. `stream-host.test.ts` owns the wrong destination
   and a replaced child or generation.
2. **Check shutdown.** `admin-shutdown-duties.ts` admits the main in a two-box venue with a fully
   joined spare and its streaming link. `admin-shutdown.ts` runs sync just before saving the mark,
   after a checked saved backup or download confirmation. This covers venue writes up to the sync;
   mail bookkeeping can continue afterwards. A sync failure pauses with no mark. Retry reuses the
   checked backup, Cancel cleans any staged file, and the explicit unchecked choice remains.
   `spare-join.e2e.test.ts` and `testing/spare-join-scenario.ts` exercise normal join, the final
   upload held and the mark absent, release, and a restore of the final write. `admin-shutdown.test.ts`
   owns confirmation order, Retry, Cancel and the unchecked choice. `boot.stop-mark.test.ts` pins
   the existing HTTPS restart hold on a paired main, and existing peer checks still apply.
3. **Show both choices.** Feed eligibility through `box-health.ts` and the dashboard
   `api/servers-api.ts`. Update `box-status-screen.ts`, English and Spanish strings, both Box status
   guides, and `docs/backlog.md`. The screen shows checking until the sync succeeds. Tell staff the
   spare can report the main box unreachable while it is off. `box-status-screen.test.ts` proves
   where both choices lead. Run the unchanged controlled handover, fiscal and menu gates.

Estimate 200–310 added product lines and 280–410 test lines. Spare shutdown, Cloud and appliance
power-off are later slices. Build test-first after the watcher clears the reviewed plan.
