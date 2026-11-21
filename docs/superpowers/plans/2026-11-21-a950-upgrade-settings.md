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
Lane F Codex drafted this and revised it after Claude's read. The watcher cleared the split
and the changes below in Lane F's `questions.md` on 21 November at 17:33.

1. **Box-side pull request. Use the saved hours.** Keep the settings read, save and window check
   in the retained `scripts/box/upgrades/cli.mjs`. Use the current window resolver's approach to
   midnight and clock changes. Resolve both endpoints in the saved venue
   zone from `installedVenueTimeZone`. For overnight spans also consider the previous local date.
   Skip an occurrence with an ambiguous or missing endpoint. Check exact instants and allow a
   start until 30 elapsed minutes before the saved end. Pausing still permits offer checks.
   Clearing the hours stops installs and returns offer checks to 03:00–05:00. Both offered-install
   checks honour the current settings. The final check runs the candidate driver, so
   `deploy/waitron.sh` requires its staged CLI to
   answer the settings read before replacement on the offered path. Future candidates keep
   reading version 1 settings. Unknown versions and damaged files defer. Only a missing file uses
   defaults. Delete the unused settings/window files and their parsers from `contracts.mjs`.
   Exercise midnight and clock changes through the retained CLI.
2. **Use the existing host socket.** Add fixed `upgrade.settings` and `upgrade.settings.set` verbs
   to `deploy/box/waitron-box.sh`, `scripts/box/host-protocol.mjs` and
   `apps/server/src/box-host-client.ts`. Pass bounded input to the retained CLI. Under a separate
   settings lock, check the saved revision and write `{version:1, revision, automatic, start, end}`
   to `<box>.upgrade-settings.json` with `writeFileDurable`. Run the retained CLI with the box's
   pinned Node, using the host directory from `service.env`. Accept `HH:MM` hours spanning at
   least 60 minutes or two nulls. A save can complete during the online trial, and the final check
   reads the saved settings.
   In `apps/server/src/{box-health-api,boot,errors}.ts`, add GET and POST `/api/box/upgrade-settings`
   under `system.manage`. Keep the existing gate for writes on a mirror or fenced box. Distinguish
   stale edits, busy saves and an unavailable host.
3. **Dashboard pull request. Edit in Box status.** `apps/dashboard/src/screens/{box-status-screen,upgrade-settings-dialog}.ts`,
   `api/client.ts` and `i18n/strings.ts` add the button and dialog. Reuse `wt-switch`, `wt-input`
   time fields, `draftScopeFor` and `saveActionState`. Read on open, keep the draft across status
   polling, and close on a successful save. One missing hour or a window shorter than 60 minutes
   gets inline feedback. Update both Box status guides, `deploy/README.md` (including console
   recovery from an unreadable settings file with the timer stopped) and the A950 backlog.

**Tests first.** `cli.test.mjs` covers persistence, invalid files, stale revisions, edited hours
across midnight and the spring clock change, and a pause during preparation stopping Apply before
shutdown. Exercise the window check on the installed host Node 26.7.0. `waitron-box-sh.test.mjs`
covers fixed dispatch and the independent save lock. `waitron-sh.test.mjs` pins the staged driver
check for offered installs. `box-health-api.test.ts` covers permission, read-only posture,
host unavailable, stale and busy answers. Dashboard dialog and unsaved tests cover those messages,
edits, save, clearing and leaving with changes. Inspect EN/ES in
both themes at phone and desktop widths. Run two Claude branch reviews for permission, wire and
locking changes. **Estimate** about +350 production and +325 tests across both pull requests,
plus docs. The box-side deletions remove the unused policy files and their tests.
