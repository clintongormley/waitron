# A950 step 7. Show the last offered upgrade in Box status

An administrator can see when the last offered upgrade finished, which two versions were involved,
and whether the box upgraded or reopened its previous release. The operator running the supervised
command already sees its result at the console. This slice makes it visible later in Box status
and puts the reader in the baseline release before the timer can install. On rollback, that
baseline app must be able to read the result, so later hosts keep answering `upgrade.status`.
The later email slice can use the same result and attempt id to identify the rollback. [Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Supervised install](2026-11-21-a950-quiet-upgrade-stop.md). Codex wrote this plan for Lane F.
Claude reviewed it and reread the revisions. The watcher cleared this slice at 12:11 on
21 November 2026.

The timer keeps checking offers. Manual Restore/Keep, editable hours, pause, rollback email, and
activation are outside this slice's changes. Physical rehearsal and timing precede activation.
Pairs still wait for A947. The watcher cleared shipping the read before the settings and
install requests, which the parent plan grouped together.

1. **Retain the latest offered result on the host.** In `scripts/box/upgrades/cli.mjs`, pass the
   installed and signed target versions to Apply and keep them in the first attempt marker in
   `transaction.mjs`. After `reopen()` confirms health, and before cleanup, use the existing
   durable writer to save `attemptId`, `finishedAt` (box time), `fromVersion`, `toVersion` and
   `status: "upgraded" | "rolled-back"` to `<box directory>.upgrade-result.json`
   (by default `/opt/waitron.upgrade-result.json`). Use the same path during recovery
   (`host.mjs`). Take the attempt id from the existing attempt directory name. For an offered
   attempt with versions, report a healthy candidate as upgraded or a healthy reopening through
   `restore()` as rolled back, including after a partial copy. Carry that restore decision through
   the committed marker and use it for both the console and the stored result. Keep the first
   healthy reopen time when cleanup retries. Manual attempts, late busy stops, failed reopens and
   markers without versions leave the prior result.
   If writing fails, report it in host logs and let cleanup finish. Like the installed version,
   this is box history that survives venue reset. Keep only the latest result.
2. **Use the existing Box status read.** In `deploy/box/waitron-box{.sh,@.service}`, add one fixed
   `upgrade.status` request without arguments. Use the same systemd `EnvironmentFile` as upgrade
   recovery to find the box directory. The shell reads a bounded result file. Include the verb in
   `scripts/box/host-protocol.mjs`'s shell inventory. `apps/server/src/{box-host-client,box-health,boot}.ts`
   validate the reply and carry the optional value in the existing `system.manage`-protected
   `/api/box/health`, outside database locks and with a 60-second cache. An absent result, older
   host, or failed read leaves other health fields available. `apps/dashboard/src/api/client.ts`, `screens/box-status-rows.ts`
   and `i18n/strings.ts` show it as **Last offered upgrade**, with both versions and the box's
   recorded time. Use the existing row and date formatting. Update the English and Spanish
   Box status guides and both A950 backlog entries.

**Tests first.** `transaction.test.mjs` owns success, rollback, partial copy, interrupted recovery,
and a busy or old marker leaving the prior result. The CLI case in `host.test.mjs` checks that only
offered Apply passes both versions and that the console and retained partial-copy result agree.
`scripts/waitron-box-sh.test.mjs` owns the fixed read and `scripts/box/host-protocol.test.mjs` pins the verb.
`box-host-client.test.ts` owns missing and malformed replies. `box-health-api.test.ts` checks other
health fields stay available when the host read fails. Dashboard tests check both outcomes and an
absent result. Exercise success and rollback in step 5c's installed Linux fixture. Run changed suites and check both themes and
languages at phone and desktop widths. Run the two Claude branch reviews and normal push/CI gates.

**Estimate** +225/−10 production and +235/−0 tests and support, plus docs. One PR.
