# A950 step 7. Set the overnight upgrade hours

An administrator can open **Automatic upgrades** in Box status, change the venue-local hours,
pause while keeping those hours, or clear both hours. A fresh box shows 03:00–05:00 with upgrades
allowed. A saved pause or cleared window blocks the supervised offered install. The timer continues
to check only. Turning on scheduled installs follows the signed release-to-release test-box rehearsal
and timing check. Checked manual repair and paired upgrades are outside this slice.
[Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Quiet stop](2026-11-21-a950-quiet-upgrade-stop.md). Lane F Codex drafted this for watcher clearance.

1. **Save the box's choice.** `scripts/box/upgrades/{contracts,settings,window,cli}.mjs` reuse the
   hours, saved revision and window resolver, dropping clock-digest inputs. Read the time zone from
   `installedVenueTimeZone` when evaluating the window. Save `{version:1, revision, automatic,
   start, end}` beside the box as `.upgrade-settings.json` using `writeFileDurable`. Only a missing
   file uses defaults. A malformed file defers and reports an error. Require a matching revision
   for each edit and accept two `HH:MM` values or two nulls. Both the offered preflight and the last
   check before stopping read these settings under the existing host upgrade lock. Use today's
   and, for overnight spans, yesterday's local occurrence. Keep the 30-minute reserve before the
   saved end. A pause permits offer checks. An unset window skips scheduled checks.
2. **Use the existing host socket.** Add fixed `upgrade.settings` and `upgrade.settings.set` verbs
   to `deploy/box/waitron-box.sh`, `scripts/box/host-protocol.mjs` and
   `apps/server/src/box-host-client.ts`. The shell delegates bounded input to the retained CLI and
   takes the same nonblocking upgrade lock for saves. `deploy/{waitron.sh,box/build.sh}` stage the
   settings modules with the driver; load those modules only for settings and window operations so
   an older driver file list can still install the first supporting app release by hand. In that
   intermediate state the editor is unavailable and offered installs defer. Refresh with the new
   retained installer to get the modules. In `apps/server/src/{upgrade-api,boot,errors}.ts`, expose
   GET and POST `/api/box/upgrade-settings` under the existing `system.manage` check. Return the
   saved revision, or a specific refusal for a stale edit, busy box or unavailable host.
3. **Edit in Box status.** `apps/dashboard/src/screens/{box-status-screen,upgrade-settings-dialog}.ts`,
   `api/client.ts` and `i18n/strings.ts` add the button and dialog. Reuse `wt-switch`, `wt-input`
   time fields, `draftScopeFor` and `saveActionState`. Read on open, keep the draft across status
   polling, and close on a successful save. One missing hour or equal hours get inline feedback.
   Update both Box status guides, `deploy/README.md` and both A950 backlog entries.

**Tests first.** `settings.test.mjs` owns persistence, missing versus malformed files, and stale
revisions. `window.test.mjs` keeps midnight and clock-change cases. `cli.test.mjs` proves edited
hours and that a saved pause stops offered Apply before shutdown. `waitron-box-sh.test.mjs` and
`waitron-sh.test.mjs` cover fixed dispatch, a busy lock and first supporting driver installation.
`upgrade-api.test.ts` covers permission and refused edits. Dashboard dialog and unsaved tests cover
open, edit, save, invalid and cleared hours, and leaving with changes. Inspect EN/ES in both themes
at phone and desktop widths. Run two Claude branch reviews because the slices share permission,
wire and locking rules. **Estimate** +420/−45 production, +360/−30 tests, plus docs, one PR.
