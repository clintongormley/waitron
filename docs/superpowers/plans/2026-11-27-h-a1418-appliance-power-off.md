# A1418 appliance power-off

[Approved design §4 step 6](../specs/2026-11-07-a1418-box-stop-intent-design.md) · [Shutdown plan PR 2](2026-11-26-h-a1418-admin-shutdown.md)

An administrator can turn off the appliance from the existing Box status shutdown action. The box
saves the next-start hold before requesting power-off. This applies to eligible standalone and paired
main boxes, including the existing download and streaming flows. A box without the host service
still gives the manual instruction. Spare shutdown, Cloud backup and handover stay outside this slice.

1. **Authority and order.** In `apps/server/src/box-status.ts` pass the authorized person's id to
   the existing start and decision calls. Keep HTTPS, Manage boxes and the fresh password check on
   start. Use the person whose action leads to completion, including download confirmation, retry
   or **Shut down anyway**. **Keep waiting** resumes the original action. In `admin-shutdown.ts` add
   one call after the existing durable hold write, archive cleanup and transition to `ready`.
   This order lets a host stop signal see the completed shutdown. Start the bounded host call without
   adding it to the promise `close()` waits for. Keep the saved hold and trading pause through every
   host outcome. A failed check or hold write never requests power-off.
2. **Host request.** Pass the original `hostClient` from `boot.ts` through `admin-shutdown-duties.ts`.
   Keep the clock wrapper for clock work. Add optional `powerOff(actor: PersonActor)` in
   `box-host-client.ts`, using the bounded fixed-line exchange with a two-second reply limit and
   the existing person actor shape as printable JSON. In `deploy/box/waitron-box.sh` validate
   the requester as for `clock.set`, log the app's actor and run the fixed
   `systemctl poweroff --no-block` command. Reply success only if the command succeeds. The socket
   group gates access on the host. The app's existing shutdown route checks Manage boxes. This
   covers systemd installations that attach the host socket. An absent socket or an older handler's
   `unknown_request` keeps manual power-off. A refused, lost or malformed reply, or a timeout,
   leaves the hold in place and shows that power-off could not be confirmed. Send the request once.
3. **Box status.** In dashboard `servers-api.ts`, `box-status-screen.ts` and `i18n/strings.ts`, show
   that power-off was requested when observed in the ready status. That message can remain if the
   next read loses the connection. Explain before confirmation that the box can go offline during
   shutdown, while keeping the unchecked-backup warning before **Shut down anyway**. If power-off
   cannot be confirmed and the box stays on, give the manual instruction. Update both
   `apps/server/src/guide/{en,es}/box-status.md` and the A1418 backlog.
4. **Test first.** `box-status.route.test.ts` checks the authenticated actor and retains the
   permission refusals. `admin-shutdown.test.ts` holds the mark write to prove the host call waits,
   then checks the actor and one call on regular, download and unchecked completion. Exercise close
   with a host reply still pending. `boot.stop-mark.test.ts` checks the host sees the saved hold,
   a stop signal preserves it and a refused host leaves writes paused. `box-host-client.test.ts`
   covers the wire and reply outcomes. `scripts/waitron-box-sh.test.mjs` checks the fixed command,
   actor log and refusal through stubs. Dashboard's `box-status-screen.test.ts` checks manual,
   automatic, disconnected and unconfirmed wording. Run the changed files and Lane H's fiscal and
   menu checks. Inspect Box status in both languages, themes and widths.
5. **Appliance proof before landing.** Reserve `waitron-spare.local` with a person available to turn
   it back on. Use a separate synthetic standalone venue and local backup folder. Preserve the
   spare's normal configuration. Install the candidate app and host script together and confirm the
   app connects to that host socket. Observe physical power-off and record the message Box status
   showed. After power-on, collect the previous boot's app and host logs. Check the eight-second
   app stop deadline and a refused sale before **Carry on**, then complete a sale. Return the spare
   to its normal configuration. Land once this rehearsal is recorded.

Estimate 90–130 product and 100–160 test lines. One PR within three active hours.
