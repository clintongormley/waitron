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
   Numbered prereleases check for a newer stable offer. Read just `WAITRON_NODE_ID` from
   `trading.env` in the running app's state volume with `docker compose exec -T`. Defer if
   the app is stopped or the ID is unavailable. A restore with a new ID changes group membership.
2. Put the lookup behind a verb in the already-retained `scripts/box/upgrades/cli.mjs` so an
   older installer already knows to fetch it. Resolve the retained trust directory once and
   use its `release-list.mjs` selector and two keys. Defer with a trust diagnostic when
   the installed selector or keys are missing. Seed the rehearsal box from the recipe or
   a main install carrying both the new driver and the selector. Use the CLI's existing
   child runner for curl on the fixed `upgrade-offer/waitron-offer.json` release asset.
   Use the numbered download's HTTPS-only redirects, 15-second connect and 60-second total
   limits, and cap both the curl download and captured bytes at 16 KiB. Select only after
   a successful fetch. An unsigned, malformed, unavailable or superseded file defers.
3. Keep the highest verified serial and digest beside the upgrade lock, outside the paths
   copied on rollback. Reuse `writeFileDurable` and finish saving a new serial, including a
   pause, before returning an answer. A missing file starts from the first verified offer.
   An unreadable or malformed file defers. Return one JSON line with `offered` and its
   version, `none`, or `deferred` and its reason. Offered and none exit zero. Deferred exits
   nonzero. Document the command, including that a lost file loses replay history, in
   `deploy/README.md` and update `docs/backlog/box.md`.
4. Start with failing cases in `scripts/box/upgrades/cli.test.mjs` for first use, a pause and
   replay across separate calls, corrupt state, failed persistence, and missing or oversized
   downloads. `scripts/waitron-sh.test.mjs` pins the installed label, box ID, held attempt
   and busy lock at the command. Group and signature tests stay in
   `scripts/box/release-list.test.mjs`. Run those files with `pnpm exec vitest run`.

The nightly window, quiet admission, final recheck, signed candidate verification, rollback
activation and Box status/email follow. Pair upgrades stay on hold. The rehearsal still
needs numbered releases. Estimate +120/−10 production and +145/−0 test lines, plus docs.
