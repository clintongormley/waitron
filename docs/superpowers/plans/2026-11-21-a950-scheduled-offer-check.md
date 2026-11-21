# A950 step 5b. Schedule the signed offer check

An operator can enable the timer on a numbered test box and read the signed offer result in
the system log. The check starts only during 03:00–05:00 in the venue’s saved time zone.
Step 7 owns default activation, editable hours, Box status and email. A later slice owns
quiet-time admission, the final offer recheck, installation and rollback. Publication and the
physical release-to-release rehearsal remain separate. A timer enabled by hand stays enabled
across driver refreshes. The install slice or step 7 decides what happens to these enabled
checks when the service starts installing. See the [upgrade plan](2026-11-09-a950-shorter-upgrades.md),
[staged offers](2026-11-19-a950-staged-offers.md) and
[manual check](2026-11-21-a950-box-offer-check.md). Lane F’s A950-LATER queue sets the scope. Claude reviewed the plan and the watcher cleared it on 21 November at 08:04.

1. In `scripts/box/upgrades/host.mjs`, reuse the Compose state-volume lookup used by
   `installedBoxId`. Read `settings.doc.timeZone` from the `business_day` version 1 row in
   `venue/venue.db` with `node:sqlite` in read-only mode and close the connection. Carry
   the stored spelling through to the check.
2. Add the internal `check-upgrade-window` verb in `cli.mjs` before the recovery path, and
   pass it through `deploy/waitron.sh`. Use `Intl.DateTimeFormat` with `hourCycle: "h23"` and
   the saved named zone to read the current local hour. Return exit 0 for hours 3 and 4 and
   exit 1 elsewhere. An absent, invalid or unreadable zone exits 1 with a reason. Reject
   numeric offsets and pass the stored name to Intl without trimming it. The condition takes
   the existing nonblocking upgrade lock for the SQLite read. Even a read-only SQLite connection
   can create side files. The signed-offer command still checks for held upgrades and takes the
   lock after downloading. Use only modules already fetched by the retained driver. Editable
   hours and the existing calendar-window policy belong to the installation work.
3. Add `deploy/box/waitron-upgrade.{service,timer}`. Use a 30-minute calendar timer with no
   catch-up. The 90-second oneshot uses `Requisite=` and `After=waitron-app.service`, reads
   the same optional `service.env`, and calls the new entry through `ExecCondition=` before
   running `check-upgrade-offer`. An ordinary condition exit 1 skips the run. Offer-check
   failures leave the existing reason in the journal. Copy both units through
   `deploy/box/build.sh` and the checked installer’s fetch and install lists. Ship them
   disabled. Document `systemctl enable --now waitron-upgrade.timer` for test-box rehearsal and
   `journalctl -u waitron-upgrade.service` in `deploy/README.md`. A recipe carrying the units
   has them immediately. An existing box’s first checked refresh installs the new driver;
   that driver fetches both units together on a checked refresh to a source whose installer
   contains the window check. A pre-timer source can still be installed. Update
   `docs/backlog.md` and `docs/backlog/box.md`.

Run the failing cases first. `host.test.mjs` checks the real SQLite zone read and missing row.
`cli.test.mjs` pins both boundaries with a different host zone, invalid-zone refusal and
the condition exit status. Step 5a keeps the offer and deferral tests.
`scripts/waitron-sh.test.mjs` checks the new driver’s file lists and that it installs both units
without enabling them. It also covers an older signed source and a window read while the lock is
held.
In a disposable smoke run, pair the driver from #3935 with the new files and check Apply can
load before the new units arrive. In a throwaway container booted with
systemd, use a test trust key, a stubbed download and a fake installed release tag. Verify the
installed units with `systemd-analyze verify` and start the service inside and outside the window.
Repeat with the app stopped and confirm it stays stopped. List any unrun checks in the PR.
Run the changed files with `pnpm exec vitest run` and sign off the commits. Estimate +100/−5
production and +95/−0 test lines, plus docs.
