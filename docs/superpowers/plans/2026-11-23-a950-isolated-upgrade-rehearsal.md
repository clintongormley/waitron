# A950. Rehearse a checked upgrade on an isolated Prepare box

The watcher cleared planning this rehearsal on 22 November at 21:58 in Lane F `questions.md`.
At 21:56 the watcher relayed the owner's “let's not do a real release yet.” ENV7 and ENV8
are on main. The rehearsal should show that the installed command upgrades a running Prepare
box and that Restore returns its app and data after a failed check.

1. Add an `upgrade-install` case to `bench/box-installer/run.mjs` and `upgrade.mjs`. Use the
   [existing Debian guest](../../../bench/box-installer/README.md#check-a-manual-upgrade-and-interrupted-recovery)
   with its own disk and Docker. Stage a synthetic Prepare archive with one fiscal sale and
   one open order with a line. Use box-managed TLS and the images' producer settings, since
   the installer downloads new Compose and carries over `.env`. Before running, confirm
   `/health`, clock sync, row fingerprints and enough space. Use a disposable guest under
   the campaign's host booking rules. Allow installer downloads and clock sync and keep
   venue integrations out of the guest.
2. Reuse the bench's probes and comparisons with `bash /opt/waitron-host/waitron.sh install main`
   as root. Check that published app and agent images match the same revision and differ
   from the prepared baseline. Record image digests before each attempt and discard the
   combined result if the publication changes. First, inject a trial refusal and verify
   the running container, start time and rows. Then use the guest port blocker to fail
   readiness after copying. Require exit 1 and “upgrade held”. Run `waitron.sh status` and
   check the retained CLI's JSON for the held phase and a complete copy. Remove the blocker,
   run `waitron.sh restore` and verify baseline images, Compose, image selections, row
   fingerprints and healthy restart. Finally, require a successful trial, final checks,
   disposable cash sale and healthy restart with the candidate images and unchanged rows.
   Check that each install leaves the timer disabled. Record stage timings and image
   digests for diagnosis. Measure the actual window on the test box.
3. Keep fixture-key checks in `scripts/box/{verify-release,release-list,upgrades/cli}.test.mjs`.
   They already check signature refusal, offer selection and the start-window cutoff. The
   installed verifier fetches the numbered file from upstream (`deploy/waitron.sh`,
   `verify_numbered_release`). Ask the watcher to confirm the existing fixture-key checks
   cover that part of this slice. The live offer, signed download, automatic rollback and
   final window measurement go with the first real release-to-release check. Scheduling
   stays opt-in through that check.

**Size and checks.** This plan adds one page. The bench change is about 55 lines, including
one case and its README instructions. The focused test in `scripts/box/upgrade-rehearsal.test.mjs`
adds about 30 lines and checks that the new guest case enters through `install` and observes
the held result. Run that test first and verify the outcomes in the Linux guest. Product code,
release sources and deployed trust stay as shipped. After rehearsal, record the result and
remaining A950 work in the backlog.
