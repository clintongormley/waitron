# A1418 appliance power-off

[Approved design §4 step 6](../specs/2026-11-07-a1418-box-stop-intent-design.md) · [Shutdown plan PR 2](2026-11-26-h-a1418-admin-shutdown.md)

An administrator can turn off the appliance from the existing Box status shutdown action. The box
records the same next-start hold before asking the host to turn off. A box without the host service
still gives the manual instruction. Spare shutdown, Cloud backup and handover stay outside this slice.

1. **Authority and order.** In `apps/server/src/box-status.ts` pass the authorized person's id to the
   existing start and decision calls. Keep HTTPS, Manage boxes and the existing fresh password check
   on start. Use the person whose action completes shutdown, including download confirmation,
   retry or **Shut down anyway**. **Keep waiting** retains the current requester's id. In
   `admin-shutdown.ts`, `admin-shutdown-duties.ts` and `boot.ts`, use one completion path. Wait for
   the existing durable mark and archive cleanup and set `ready` before invoking the host so a
   signal during the request follows the completed shutdown path. Keep work paused and the mark
   saved through every host outcome. Cancel stays available before saving the hold. A failed check
   or failed hold write never reaches the host.
2. **Host request.** Reuse the bounded fixed-line socket client in `box-host-client.ts`. Add
   `powerOff({ personId })` with the same printable JSON format as `clock.set`. In
   `deploy/box/waitron-box.sh`, validate the requester as for `clock.set`, log the requester's id
   and invoke the fixed `systemctl poweroff --no-block` command. Reply success only if the command
   succeeds. No HTTP endpoint or host unit change. Treat an absent socket or a host that does not
   implement the request as manual power-off. A refusal or ambiguous reply leaves the hold in place
   and is shown to the administrator. Never resend automatically.
3. **Box status.** Add a power-off outcome to the existing ready status. In dashboard
   `servers-api.ts`, `box-status-screen.ts` and `i18n/strings.ts`, show that power-off is underway
   from when the server asks. If it cannot be confirmed, tell the administrator to switch off
   manually if the box stays on. Keep the unchecked-backup warning in either case. Update both
   `apps/server/src/guide/{en,es}/box-status.md` and the A1418 backlog.
4. **Test first.** `box-status.route.test.ts` checks the actor on start and decisions and retains
   the existing refusals. `admin-shutdown.test.ts` holds the mark write to prove the host call
   waits and checks one call with the right actor on the regular, download and unchecked paths.
   `boot.stop-mark.test.ts` uses a host fake that reads the saved mark and exercises the signal
   path before replying. A refused host must leave writes paused and the next-start hold intact.
   `box-host-client.test.ts` covers the wire and reply outcomes. `scripts/waitron-box-sh.test.mjs`
   uses a stub to assert the fixed command, actor log and refusals. Dashboard's
   `box-status-screen.test.ts` checks manual, automatic and unconfirmed wording. Run the changed
   files and Lane H's fiscal and menu checks. Inspect Box status in both languages, themes and widths.
5. **Appliance proof before landing.** Reserve `waitron-spare.local` for this rehearsal and confirm
   who can turn it back on. The earlier reservation covered upload timing. Use a separate synthetic
   standalone venue and a local backup folder. Preserve and restore the spare's normal configuration.
   Install the candidate app and host script together in the reserved slot. Start from Box status,
   observe physical power-off and collect the previous boot's app and host logs after power-on.
   Check the durable hold, the app's existing eight-second stop deadline and a refused sale before
   **Carry on**, then check a sale succeeds after it. Keep the PR unlanded until this check is recorded.

Estimate 75–110 product and 90–140 test lines. One PR within three active hours.
