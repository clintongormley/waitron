# A950 step 5a. Check the signed offer on a box

A release operator rehearsing a rollout can run `sudo /opt/waitron-host/waitron.sh check-upgrade-offer`
on a numbered box and see its offered version, no offer, or why the check deferred.
The night job and its check just before Apply can use the same lookup. The owner chose
a signed file for rollout groups (Lane F queue, A950-LATER).
[Upgrade plan](2026-11-09-a950-shorter-upgrades.md) · [Offer format](2026-11-19-a950-staged-offers.md)

1. In `deploy/waitron.sh`, add `check-upgrade-offer` to dispatch and help. Use the retained
   installer, take its existing upgrade lock without waiting, and defer if an upgrade is
   held. That attempt can make the candidate look installed. Reuse `installed_app_ref`,
   validate with `is_release_tag`, and strip the leading `v`. Main and branch builds defer.
   Numbered prereleases check for a newer stable offer.
2. Add a verb in the already-retained `scripts/box/upgrades/cli.mjs` that branches before
   the recovery path. In `host.mjs`, extract the mount lookup from Apply's volume loop
   with the same Apply behaviour. The check reuses Compose config and volume inspection
   to find the state mount without creating it. Share Apply's `trading.env` ID parser here
   in place of the shell read named in 1d. Missing ID defers. A fresh-identity restore
   or full reset can change group membership.
3. Resolve the retained trust directory once and use its `release-list.mjs` selector
   and two keys. Missing trust defers. Use the CLI's existing child runner for curl on
   the fixed `upgrade-offer/waitron-offer.json` asset. Use HTTPS-only redirects, 15-second
   connect and 60-second total limits, and cap the download and captured raw bytes at
   16 KiB. Ask the runner for a Buffer and select only after a successful fetch.
4. Keep the highest verified serial and digest beside the upgrade lock, outside the
   paths copied on rollback. Use `writeFileDurable` before returning a new result,
   including a pause. A missing file starts with the first verified offer. An unreadable
   or malformed file defers. The shell and CLI return one JSON line with `offered` and the
   version, `none`, or `deferred` and the reason. The entry prints its deferred line and exits
   nonzero. The shell forwards the CLI's line and exit status and prints its own deferred
   line when the CLI returns no stdout. Offered and none exit zero.
5. Start with failing cases in `scripts/box/upgrades/cli.test.mjs` for no recovery on a
   missing attempt marker, deferral when the box ID is missing, first use, pause and replay
   across calls, bad state and failed persistence. Curl cases check HTTPS-only, its time
   and 16 KiB limits, the capped buffer and deferral on failed or oversized downloads.
   Box ID read failures belong in `host.test.mjs`. Group, signature and 16 KiB boundary
   tests stay in `scripts/box/release-list.test.mjs`. `scripts/waitron-sh.test.mjs` pins
   version lookup, busy lock and held-attempt refusals and the empty-output fallback.
   Run those files with `pnpm exec vitest run`. Update `deploy/README.md` and
   `docs/backlog/box.md`, including that a lost state file loses replay history.

For the rehearsal, seed the driver and selector from the recipe or main, then take a checked
manual install of a numbered release carrying this command. The nightly window, quiet admission,
final recheck, signed candidate verification, rollback activation and Box status/email follow.
Pair upgrades stay on hold. Estimate +135/−15 production and +155/−0 test lines, plus docs.
