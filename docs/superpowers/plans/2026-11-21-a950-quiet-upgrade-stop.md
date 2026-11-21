# A950 step 5c. Apply a signed offer in the quiet window

**Finish line.** An operator can run `waitron.sh install-offered-upgrade` on a numbered
standalone test box during 03:00–05:00 venue time. It installs the currently offered stable
release using the checked installer. If the candidate fails the stopped checks or test sale,
the old copy reopens automatically. The installed timer still checks offers. Switching the
timer to install, default activation, editable hours, status/email, pairs and the physical
release-to-release rehearsal remain open. See the [parent plan](2026-11-09-a950-shorter-upgrades.md)
and the [staged-offer plan](2026-11-19-a950-staged-offers.md).

**Decision for the watcher.** Claude proposed using the existing checked shutdown as the
point that closes admission and drains work. The host checks trading activity before stopping
and again after all writers stop. Work admitted just before shutdown can cause a brief restart
of the old version. The parent plan calls for closing admission and rechecking. Confirm that
the brief interruption is acceptable and that business-row activity is the intended measure
of quiet. Open or placed orders still defer, including tabs left open overnight.

1. In `scripts/box/upgrades/host.mjs`, reuse the installed state-volume and standalone-box
   reads. Check that the app is running, the venue clock/window can be read, there are no
   open or placed orders or pending connected payments/refunds, and no sale, order or
   payment/refund activity is recorded in the last ten minutes. Use the timestamps the rows
   actually store. A missing venue, unknown role, unreadable data or unknown state defers.
   Read before shutdown and again after the checked shutdown and state lock, before copying.
   A failed stopped check takes the transaction's existing reopen-old path. Manual installs
   keep their current admission and Restore/Keep choices.
2. In `deploy/waitron.sh` and `scripts/box/upgrades/cli.mjs`, reuse signed-offer selection,
   accepted pause/serial state, numbered release verification, source and digest staging,
   and checked Apply. Only the new entry selects automatic mode in `applyUpgrade`. Re-fetch
   and verify the offer after the online trial, under the existing host lock. Before
   disabling restart policies or stopping writers, require that it still offers that exact
   newer stable release and that time remains for the measured copy/check/restore work.
   Record the timing of that work on the disposable Linux fixture before assigning a
   budget. Use the existing release trust and checked host refresh. Defer before replacing
   the driver if the signed target lacks the automatic entry. A pause accepted at the
   final check prevents any stop. Update `deploy/README.md` and both A950 backlog entries.

**Tests first.** `host.test.mjs` owns busy vs quiet and activity that lands between the checks.
It must show no candidate copy in the latter case. `cli.test.mjs` owns the mode selected for
the transaction. `scripts/waitron-sh.test.mjs` owns the final signed offer and window reaching
Apply or deferring, and keeps the manual install cases. Existing transaction tests own the
restore transitions. Use `bench/box-installer/upgrade.mjs`'s disposable Linux fixture to run
the installed entry with a test key and stable release fixtures. Observe deferral while busy,
candidate success and reopening the old version after a failed candidate sale. Run the
changed test files and the normal push hook. Estimate +240/−30 production and +220/−0 tests
and test support, plus docs.
