# A950 step 7. Set the overnight upgrade hours

An administrator can open **Automatic upgrades** in Box status, change the venue-local hours,
pause while keeping those hours, or clear both hours. A fresh box shows 03:00–05:00 with upgrades
allowed. A saved pause or cleared window blocks the supervised offered install. The timer continues
to check only. Turning on scheduled installs follows the signed release-to-release test-box rehearsal,
timing check and a check that the timer can use saved hours. Checked manual repair and paired
upgrades are outside this slice.
[Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Quiet stop](2026-11-21-a950-quiet-upgrade-stop.md) ·
[Owner's 29 October hours decision](../specs/2026-10-27-a950-automatic-upgrades-design.md).
Lane F Codex drafted this for watcher clearance and revised it after Claude's read.

1. **Use the saved hours.** Keep the settings read, save and window check in the retained
   `scripts/box/upgrades/cli.mjs`, which every existing installer fetches. Use the current window
   resolver's approach to midnight and clock changes. Resolve both endpoints in the saved venue
   zone from `installedVenueTimeZone`. For overnight spans also consider the previous local date.
   Skip an occurrence with an ambiguous or missing endpoint. Check exact instants and allow a
   start until 30 elapsed minutes before the saved end. A pause permits offer checks. A cleared
   window skips scheduled checks. Both offered-install checks honour the current settings. The
   final check runs the candidate driver, so `deploy/waitron.sh` requires its staged CLI to
   advertise the settings read verb before replacement on the offered path. Future candidates keep
   reading version 1 settings. Unknown versions and damaged files defer. Only a missing file uses
   defaults. Explain console recovery from an unreadable file with the timer stopped.
2. **Use the existing host socket.** Add fixed `upgrade.settings` and `upgrade.settings.set` verbs
   to `deploy/box/waitron-box.sh`, `scripts/box/host-protocol.mjs` and
   `apps/server/src/box-host-client.ts`. Pass bounded input to the retained CLI. Under a separate
   settings lock, check the saved revision and write `{version:1, revision, automatic, start, end}`
   to `<box>.upgrade-settings.json` with `writeFileDurable`. Accept distinct `HH:MM` hours or two
   nulls. A save can complete during the online trial and the final check reads it atomically.
   In `apps/server/src/{box-health-api,boot,errors}.ts`, add GET and POST `/api/box/upgrade-settings`
   under `system.manage`. Keep the existing gate for writes on a mirror or fenced box. Distinguish
   stale edits, busy saves and an unavailable host.
3. **Edit in Box status.** `apps/dashboard/src/screens/{box-status-screen,upgrade-settings-dialog}.ts`,
   `api/client.ts` and `i18n/strings.ts` add the button and dialog. Reuse `wt-switch`, `wt-input`
   time fields, `draftScopeFor` and `saveActionState`. Read on open, keep the draft across status
   polling, and close on a successful save. One missing hour or equal hours get inline feedback.
   Update both Box status guides, `deploy/README.md` and both A950 backlog entries.

**Tests first.** `cli.test.mjs` covers persistence, invalid files, stale revisions, edited hours
across midnight and the spring clock change, and a pause during preparation stopping Apply before
shutdown. Exercise the window check on the installed host Node 26.7.0. `waitron-box-sh.test.mjs`
covers fixed dispatch and the independent save lock. `waitron-sh.test.mjs` pins the staged driver
check for offered installs. `box-health-api.test.ts` covers permission and refused edits. Dashboard
dialog and unsaved tests cover edits, save, clearing and leaving with changes. Inspect EN/ES in
both themes at phone and desktop widths. Run two Claude branch reviews for permission, wire and
locking changes. **Estimate** +350/−35 production, +325/−10 tests, plus docs, one PR.
