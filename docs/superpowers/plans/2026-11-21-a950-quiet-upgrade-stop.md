# A950 step 5c. Reserve a quiet stop for an automatic upgrade

A box can ask its running app to reserve a stop after ten quiet minutes with no open orders. A
busy app carries on trading. A quiet app holds new work while the host starts the existing
checked shutdown. This is the first of two installation slices under the
[parent plan](2026-11-09-a950-shorter-upgrades.md) and the
[staged-offer plan](2026-11-19-a950-staged-offers.md). The timer continues checking offers.
The following slice connects the stable signed offer and final pause/window check to this
stop and the existing automatic restore policy. Default activation, Box status, email,
pairs and the physical release-to-release rehearsal stay separate.

- In `apps/server/src/upgrade-quiet.ts` and `boot.ts`, track time from full start and from
  admitted change requests finishing, using the steady clock. Passive reads leave the time
  alone. Add a reversible hold to the request tracking in `handover-gate.ts`. An upgrade
  returns busy if the box is already stepping down, the ten minutes have not elapsed, or
  admitted changes fail to settle within the existing shutdown deadline. After the hold and
  drain, check again for quiet and for open or placed orders and unresolved connected payments
  or refunds, using the existing row state and write queue. Only a healthy standalone primary
  can reserve the stop. No new table, durable state or public endpoint.
- Start an app-owned Unix socket at a fixed path inside the installed app container only.
  Configure that path in `deploy/compose.yml`, and close the socket with the server. The host
  reaches it through `docker exec` on the app it inspected. One bounded exchange reserves a
  stop only for the life of that connection, releasing the temporary hold if the host leaves
  without stopping the app. A handover or shutdown that has already begun keeps its own gate.
- In `scripts/box/upgrades/host.mjs`, add `reserveQuietStop` for the inspected app container
  and let `stopUpgradeWriters` accept that reservation. Hold it across `docker stop` of the
  same container and keep the fresh `server.shutdown_complete` check and writer stop order.
  A missing socket (including an older app), refusal or timeout yields no reservation.
  Manual stops keep their current path. The next slice acquires the reservation after
  online trial and the final offer/window check, before disabling restart policies or
  stopping writers. It releases the reservation if preparation aborts.

Start with failing cases. `upgrade-quiet.test.ts` uses the real test database for placed
orders and pending provider work, and a controlled steady clock for the quiet boundary.
`handover-gate.test.ts` tests a write already inside, a later refused write and release of the
temporary hold, preserving its existing handover cases. `host.test.mjs` checks that a deferral
issues no stop and that a granted connection stays open across the existing shutdown check.
The Linux fixture must let a blocked venue keep answering, then observe real app shutdown
for a quiet one. Record the result and keep each changed test file focused. Update the A950
entry in `docs/backlog.md` and `docs/backlog/box.md` in the build. Estimate +210/−10 production
and +200/−0 test lines, plus docs. The following connection slice gets its own reviewed plan.
