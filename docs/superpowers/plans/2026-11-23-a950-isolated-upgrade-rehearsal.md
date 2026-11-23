# A950. Rehearse a checked upgrade on an isolated Prepare box

The watcher cleared planning this rehearsal on 22 November at 21:58 in Lane F `questions.md`.
At 21:56 the watcher relayed the owner's “let's not do a real release yet.” ENV7 and ENV8
are on main. The rehearsal should show that the installed command upgrades a running Prepare
box and that Restore returns its app and data after a failed check.

1. Add an `upgrade-install` case to `bench/box-installer/run.mjs` and `upgrade.mjs`. Use the
   [existing Debian guest](../../../bench/box-installer/README.md#check-a-manual-upgrade-and-interrupted-recovery)
   with its own disk and Docker on a Mac with Docker Desktop. Pull the older published app and
   print agent by digest. Build the synthetic Prepare archive on that app's migrations with one
   fiscal sale and one open order with a line. Use box-managed TLS and the images' producer
   settings, since the installer downloads new Compose and carries over `.env`. Check
   `/health`, clock sync, row fingerprints and enough space. Use a disposable guest under
   the campaign's host booking rules. Allow installer downloads and clock sync and keep
   venue integrations out of the guest. Allow 1,260,000 ms for each upgrade boot, including
   the download. Raise the limit for this case if emulation needs more time.
2. Reuse the bench's probes and comparisons with `bash /opt/waitron-host/waitron.sh install main`
   as root. Record the pulled candidate digests for each attempt. First, inject a trial refusal
   and verify the running container, start time and rows. Then use the guest port blocker to fail
   readiness after copying. Require exit 1 and “upgrade held”. Read the held phase and complete
   copy with the retained CLI's `status /opt/waitron`. Remove the blocker,
   run `waitron.sh restore` and verify baseline images, Compose, image selections, row
   fingerprints and healthy restart. Finally, require a successful trial, final checks,
   disposable cash sale and healthy restart with candidate images distinct from the baseline
   and unchanged rows. Check that each install leaves the timer disabled. Record stage
   timings for diagnosis in the emulated guest.
3. Keep fixture-key checks in `scripts/box/{verify-release,release-list,upgrades/cli}.test.mjs`.
   They already check signature refusal, offer selection and the start-window cutoff. The
   installed verifier fetches the numbered file from upstream (`deploy/waitron.sh`,
   `verify_numbered_release`). The watcher cleared using the existing fixture-key checks on
   23 November at 12:06. The live offer, signed download, automatic rollback and
   final window measurement go with the first real release-to-release check. Scheduling
   stays opt-in through that check.

**Starting version.** Use the published build from `ad31a5d3e2ee2037af99b1fde236b5f436939c7b`.
The watcher cleared waiting for a newer nightly publication with compatible migrations on
23 November at 12:13. The previous published build's database is refused as
`provisioning.database_ahead` because its starting migration differs.

- App `ghcr.io/clintongormley/waitron@sha256:e664f54ed19184e3a200c641422b82b804c3fe7b05ecca2420bde64f3649743f`
- Print agent `ghcr.io/clintongormley/waitron-print-agent@sha256:db05785904b68a3fe14dc3723f6c1a1baf0af58106391f74950b6aa5f808bb86`

**Size and checks.** This plan adds one page. The bench change is about 55 lines, including
one case and its README instructions. The focused test in `scripts/box/upgrade-rehearsal.test.mjs`
adds about 30 lines and checks that the new guest case enters through `install` and observes
the held result. Run that test first and verify the outcomes in the Linux guest. Product code,
release sources and deployed trust stay as shipped. After rehearsal, record the result and
remaining A950 work in the backlog.
