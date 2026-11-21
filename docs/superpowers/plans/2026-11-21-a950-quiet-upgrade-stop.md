# A950 step 5c. Apply a signed offer in the quiet window

An operator can run `waitron.sh install-offered-upgrade` to qualify an automatic attempt on a
numbered standalone test box. It applies the stable release the signed offer names for that box.
If the stopped checks or test sale fail, the old copy reopens automatically. The timer continues
checking offers. Wiring it to install, default activation, editable hours, status/email, pairs
and the physical rehearsal remain open. [Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Staged offers](2026-11-19-a950-staged-offers.md). Codex wrote this plan and worked in both
Claude reads. The watcher cleared the trading-record checks and brief restart on 21 November
at 09:58 in Lane F’s questions.md and the final scope and size at 10:02.

1. In `host.mjs`, reuse the volume, venue-zone and standalone-box reads. Defer on a stopped app,
   missing or unknown state, open or placed `working_orders`, `payments` in `attempting` or
   `initiated`, or pending `bill_payments`, `bill_payment_refunds` or `tender_refunds`.
   Measure ten quiet minutes from `working_orders.opened_at/settled_at`, `sales.issued_at`,
   `payments.created_at/updated_at`, `bill_payments.created_at/received_at` and refund creation
   or completion times. Future timestamps defer. Check the stopped data under the existing
   state lock on the first stop only, before copying. A late order or payment can cause a
   brief restart of the old version. The existing shutdown closes admission and drains work.
   The new driver reads the old database at the stop. Later schema changes must keep that read
   working on the old layout or the box will defer.
   The watcher cleared absent payment tables only when saved settings explicitly switch Payments
   off (10:47). Check the payment table whenever it exists.
2. In `deploy/waitron.sh`, use the installed driver for the early window, quiet and signed
   offer checks under the nonblocking host upgrade lock before driver fetch or bootstrap. Skip
   a busy lock or pending attempt, then release the lock before downloading the driver.
   Reuse checked numbered release verification,
   digest pinning and host refresh. Refuse a staged source with no automatic entry before
   replacing any host file. If activity or a pause arrives after the early check and refresh,
   the app stays on the old release with the refreshed host files.
3. In `cli.mjs` and `host.mjs`, the new automatic entry reuses Apply in automatic mode.
   Extract signed selection from its public pending-attempt guard. Call it after online trial,
   in the same host lock, immediately before disabling restart policies. Re-fetch the offer,
   save any verified new serial including a pause, and require the same newer stable version.
   Apply the venue's 03:00–05:00 window with a provisional latest stop at 04:30 for rehearsal.
   Leave that reserve open for validation on real box data before unattended installation.
   A failed final pre-stop check takes the existing preparation abort path and reports deferred.
   An old target with `copied: false` reports deferred at the stop, with the failure from the busy
   or incomplete shutdown check. An old target with a copy reports rolled back. A candidate
   target reports upgraded. Manual installs retain Restore/Keep.

**21 November, step 7:** [Box status](2026-11-21-a950-upgrade-status.md) now shares the console's
outcome. A partial copy failure followed by a healthy reopening of the previous release is
`rolled-back`. A stop refused before copying still reports `deferred-at-stop`.

**Tests first.** `host.test.mjs` uses migrated fixtures via `useVenueDb` for quiet, busy and late
activity, and proves the rollback stop skips the quiet check. `cli.test.mjs` checks the final
recheck’s saved pause or newer serial, different version, time cutoff and current attempt folder.
Step 5a’s tests cover offer selection failures. `scripts/waitron-sh.test.mjs` owns driver staging
order, refusing an older target and existing manual calls. Exercise the installed automatic CLI
in `bench/box-installer/upgrade.mjs` with its prepared disposable Linux candidate. Check busy
deferral, late activity with no copy, success and failed-candidate rollback against the old
fingerprint. The physical rehearsal owns the complete installed command and real timings.
Update `deploy/README.md` and both A950 backlog entries. Describe the late-activity restart in
`apps/server/src/guide/{en,es}/box-status.md` and the PR in one sentence each. Run the changed
test files and normal hook. Estimate +240/−30 production and +220/−0 tests and support, plus docs.
The step 5 estimate including 5a and 5b is +521/−55 production and +644/−8 tests, approximately
1.7× and 1.6× the parent estimate. The watcher cleared that size at 10:02.
