# A1418 box stop intent

A manager can take a box out of service with a checked backup. If that box starts again, it waits
for an administrator. After a power cut a one-box venue waits up to a minute for configured
sources, while a restart can sell at once. A box that verifies it has been replaced stops selling
and filing. Each PR works on its own. Test first, run Lane H’s fiscal and menu gates unedited, and
open each PR within three active hours.
[Design](../specs/2026-11-07-a1418-box-stop-intent-design.md)
[November 7 plan](2026-11-07-a1418-part-1-stop-marks.md)

1. **Record stops and alert managers (140–200 code / 170–250 test lines).** Write a durable local
   `restart` mark on the first stop signal to an admitted primary via `run-server.ts` and its two
   entry points. Keep the deadline and log write failure. Consume the mark once under the venue
   lock, including on starts that wait or enter repair. Read the old heartbeat with
   `readVenueHolder` in `node-entry.ts` before startup cleanup can take `lockVenueDatabase` and
   overwrite it. The dev entry captures it before first-setup admission. Declare the file next to
   `spare-space.released` in `STATE_LAYOUT` so it stays out of backups and reset deletes it.
   Clear it when placing a restore. On the primary, record an incident only when there is no
   valid mark and the previous server holder is still there. Use its last heartbeat in the email.
   First setup, restore, a clean stop whose mark write failed and was logged, and a spare crash
   raise no alert. If an intervening failed start removes the previous holder before recording
   the stop, the later start has no heartbeat to report. A later unexpected stop replaces an open warning so it gets its own email
   (watcher, 13:26 on 26 November). Add the incident to `INCIDENT_EMAIL_CODES` and word it in English and Spanish.
   Test signal versus force kill and direct close in the shutdown suites, wording in
   `box-alert-email.test.ts`, and incident recording with the heartbeat time in
   `boot.stop-mark.test.ts`. The remaining slices each require their own plan and Claude read.
2. **Start a restored box above its bucket.** The [26 November slice 2 plan](2026-11-26-h-a1418-restore-bucket-term.md)
   proposes a term above the pointer and generation names that the configured bucket reveals.
   The watcher asked at 13:03 for owner words before adding a hold on sales or filing. The
   slice 2 proposal retains the existing first-start failure path and is awaiting clearance.

3. **Stop a replaced box (250–350 / 280–400).** Preserve A1342’s endorsed-peer rule in
   `stream-host.ts`. Prove a real archive and bucket restore can supply newer signed evidence
   using the old box’s local public key while they share an identity. Exclude the restore’s own
   first start. Use the waiting surface and stop admitting work as soon as replacement is verified. Save the
   venue and newer term in a box-local `replaced.json` before restart, then check it before acting on
   `restart`. Keep it out of archives. Restore and reset clear it. After HTTPS confirmation that the replacement is off,
   `carry-on.ts` raises the term before clearing the record. Test forged evidence and a late
   answer followed by an offline reboot in `stream-host.test.ts` and `boot.stop-mark.test.ts`.
   Email managers on replacement. Early signed claims and equal-term evidence need a separate
   decision. A1425’s fresh identities will also change the trust case.

4. **Bound the power-cut wait (190–280 / 230–350).** Reuse that reader and `waiting-start.ts`.
   Check alongside selling on restart and continue checking after the minute. With no configured
   source a solo box starts immediately. A successful clear reply releases the wait. Keep the
   peer decision on paired starts. Show the reason on the box and till, and alert managers when
   silence expires. Test hanging reads and reason display in `waiting-start.test.ts` and
   `server-router.test.ts`. Update both languages’ guides and the design’s §9 repository rules.

5. **Shut down a primary (300–420 / 340–500).** Start with a saved archive destination and no
   stream. Qualify `verifyBackupArtifact` on the exact A1557 `BackupSupervisor` output. Prove its
   existing limits on a real copy before changing them. Box status asks for fresh HTTPS
   `node.promote` sign-in, offers the recovery pack and shows staff still clocked in. Drain work
   and pause sales, filing and clocking. Offer wait, explicit shutdown anyway or cancel on failure,
   with a recorded incident and email. Preserve `shutdown` before power-off and across starts
   until authorized carry-on. Offer **Keep it stopped**. Cover success, cancel and refusal in
   `backup-supervisor.test.ts`, `box-status-screen.test.ts` and `waitron-box-sh.test.mjs`.

6. **Cover other backup destinations and pairs (200–350 / 260–430 per PR).** Add checked download
   and stream catch-up to the primary action. Reuse controlled handover as the paired primary’s
   second choice and accept a trusted peer’s role on start. Spare shutdown waits for qualified
   stream switching and automatic reseed while the primary sells. Exercise both directions in
   `handover-controlled.e2e.test.ts` and `stream-host.test.ts`. Update English and Spanish guides.

7. **Ask Cloud (80–140 / 110–180).** Wait for A1188’s authenticated declaration answer. Reuse the
   wait and stop paths. Test a late answer and silence in `cloud-client.emergency.test.ts`.
