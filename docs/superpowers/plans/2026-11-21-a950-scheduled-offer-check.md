# A950 step 5b. Schedule the signed offer check

On a numbered box, an operator can enable the offer-check timer and read the same signed
offer result in the system log that the manual command prints. The timer checks only during
03:00–05:00 in the venue’s saved time zone. Step 7 owns default activation, editable hours,
Box status and email. A later slice owns quiet-time admission, the final offer recheck,
installation and rollback. Publication and the physical release-to-release rehearsal remain
separate. See the [upgrade plan](2026-11-09-a950-shorter-upgrades.md),
[staged offers](2026-11-19-a950-staged-offers.md) and
[manual check](2026-11-21-a950-box-offer-check.md). The scope comes from Lane F’s A950-LATER queue.

1. In `scripts/box/upgrades/host.mjs`, reuse the Compose state-volume lookup used by
   `installedBoxId`. Read `settings.doc.timeZone` from the `business_day` version 1 row in
   `venue/venue.db` with `node:sqlite` in read-only mode and close the connection. Carry
   the stored spelling to the window policy. Missing or unreadable settings give no window.
2. In `contracts.mjs`, `settings.mjs` and `window.mjs` in the same folder, remove the dormant
   policy’s retired clock inputs and reuse `initialUpdateSettings(timeZone)` and
   `resolveUpdateWindow` for the default hours. In `cli.mjs`, the internal
   `check-upgrade-window` entry derives the local date from the current instant and saved zone.
   It opens the check at the inclusive start and closes it at the exclusive end. Invalid zones
   and skipped calendar endpoints defer. The entry returns exit 0 inside the window and exit 1
   on deferral, with the reason in the log. It runs before the upgrade recovery path.
3. Add `deploy/box/waitron-upgrade-offer.{service,timer}`. The timer wakes every 30 minutes
   without catching up missed ticks. The service runs after and requires an already active
   `waitron-app.service`. Its condition uses an internal `deploy/waitron.sh` entry which takes
   the existing nonwaiting upgrade lock, skips held attempts, reads the window, and releases
   the lock on exit. The service then runs `check-upgrade-offer`, which already keeps the
   download outside the lock. Bound the service to 90 seconds so a stuck host read cannot
   hold up the timer. Install the units and retained modules in `deploy/box/build.sh` and
   the checked installer’s driver refresh. Leave the timer disabled by default. In
   `deploy/README.md`, document `systemctl enable --now waitron-upgrade-offer.timer` and
   `journalctl -u waitron-upgrade-offer.service`. Update `docs/backlog.md` and `docs/backlog/box.md`.

Run the failing cases first. The sibling `host.test.mjs` checks the real SQLite zone read and
the missing row. `cli.test.mjs` pins both boundaries with a venue zone differing from the host
zone and skips an unavailable or invalid zone. Keep the switching-clock cases in `window.test.mjs`
and update `settings.test.mjs` for the retired fields. `scripts/waitron-sh.test.mjs` checks
the installed unit entry points and that the condition skips on a held upgrade. On Linux,
run `systemd-analyze verify` on the installed units and start the service with the condition
closed and open. Use a disposable Linux box fixture with a signed test offer. Run the changed
test files with `pnpm exec vitest run`, then sign off the commits. Estimate +130/−20 production
and +115/−25 test lines, plus docs, within one pull request.
