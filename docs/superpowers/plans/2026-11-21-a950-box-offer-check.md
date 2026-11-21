# A950 step 5a. Check the signed offer on a box

A release operator rehearsing a rollout can run `sudo /opt/waitron-host/waitron.sh check-upgrade-offer`
on a numbered box and see which stable version it is offered, whether it has no offer, or why
the check deferred. The nightly check and the final check before Apply will use this same
lookup. The owner chose a signed file for rollout groups (Lane F queue, A950-LATER).
[Upgrade plan](2026-11-09-a950-shorter-upgrades.md) · [Offer format](2026-11-19-a950-staged-offers.md)

1. In `deploy/waitron.sh`, use the retained installer and the existing box upgrade lock.
   Reuse `installed_app_ref` for the actual installed image's release label and the
   state-volume reader used by `is_production` to get `WAITRON_NODE_ID` from `trading.env`.
   Read only that field for the check. An unknown installed release or missing identity
   defers. A restore that changes the box ID changes which offer rules it matches.
2. Add `scripts/box/upgrades/offer-check.mjs` and include it in the retained driver download
   and `deploy/box/build.sh` recipe. Download the fixed `waitron-offer.json` asset on the
   `upgrade-offer` release over HTTPS, using the numbered-file fetch bounds and the same
   16 KiB limit when reading. Resolve the retained trust directory once and use its
   `release-list.mjs` selector and current and spare keys. A missing or refused download
   or signature produces no candidate, even if the last check found one. Return the selected
   version or no offer only after saving any newer verified serial and digest, including
   after a pause. Reuse the host's durable write from `transaction.mjs`.
3. Keep only the serial and digest in a host file next to the box's upgrade lock, outside
   the data copied and restored by an upgrade. An explicit first `--initialize` check
   records the current verified file when there is no prior state and returns no candidate
   on that invocation. The normal check defers on missing state. A malformed saved file
   defers even when initialization is requested. A normal check after a pause uses the
   saved serial and refuses an older offer. Document initialization and lost-state recovery
   with a fresh publisher-confirmed offer in `deploy/README.md` and update `docs/backlog/box.md`.
4. Start with failing cases in `scripts/box/upgrades/offer-check.test.mjs` for a signed
   offer, a newer pause followed by a replay after restarting the checker, missing or
   damaged state, failed persistence and an unavailable or oversized asset.
   `scripts/waitron-sh.test.mjs` proves the command reads the installed version and box ID
   and stays out of Apply, including when the host lock is held. Group rules and signature
   cases stay in `scripts/box/release-list.test.mjs`. Run those files with `pnpm exec vitest run`.

This slice prepares the release-to-release rehearsal and supplies the offer check for the
next slice. Scheduled starts, the quiet window, final recheck, signed candidate verification,
rollback activation and Box status/email follow. The existing manual install keeps its
separate entry point. Pair upgrades remain on hold. Budget about +140/−15 production lines and
+150/−0 test lines, plus the operator guide and backlog.
