# A950 step 7. Show the last offered upgrade in Box status

An administrator can see when the last offered upgrade finished, which two versions were involved,
and whether the box upgraded or reopened its previous release. The operator running the supervised
command already sees its result at the console. This slice makes it visible later in Box status
and puts the reader in the baseline release before the timer can install. On rollback, that
baseline app must be able to read the result. The later email slice can use the same result and
attempt id to identify the rollback. [Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Supervised install](2026-11-21-a950-quiet-upgrade-stop.md). Codex wrote this plan for Lane F.
Claude reviewed its first draft and the driver revised it. Watcher clearance is pending.

The timer keeps checking offers. Manual Restore/Keep, editable hours, pause, rollback email, and
activation are outside this slice's changes. Physical rehearsal and timing precede activation.
Pairs still wait for A947. This slice asks the watcher to clear shipping the read before the
settings and install requests, which the parent plan grouped together.

1. **Retain the latest offered result on the host.** In `scripts/box/upgrades/cli.mjs`, pass the
   installed and signed target versions to Apply and keep them in the first attempt marker in
   `transaction.mjs`. After `reopen()` confirms health, and before cleanup, use the existing
   durable writer to save `attemptId`, `finishedAt` (box time), `fromVersion`, `toVersion` and
   `status: "upgraded" | "rolled-back"` to `<box directory>.upgrade-result.json`
   (by default `/opt/waitron.upgrade-result.json`). Use the same path during recovery
   (`host.mjs`). Save only an offered attempt with versions that selected the candidate or had a
   stopped copy. Keep the same result when cleanup retries. Manual attempts, late busy starts with
   no copy, a failed reopen, and markers without versions leave the previous result as it stands.
   If writing fails, report it in host logs and let cleanup finish. Like the installed version,
   this is box history that survives venue reset. Keep only the latest result.
2. **Use the existing Box status read.** In `deploy/box/waitron-box{.sh,@.service}`, add one fixed
   `upgrade.status` request without arguments. Use the same systemd `EnvironmentFile` as upgrade
   recovery to find the box directory. The shell reads a bounded result file. Include the verb in
   `scripts/box/host-protocol.mjs`'s shell inventory. `apps/server/src/{box-host-client,box-health,boot}.ts`
   validate the reply and carry the optional value in the existing `system.manage`-protected
   `/api/box/health`, outside database locks. An absent result, older host, or failed read leaves
   other health fields available. `apps/dashboard/src/api/client.ts`, `screens/box-status-{rows,screen}.ts`
   and `i18n/strings.ts` show it as **Last offered upgrade**, with both versions and the box's
   recorded time. Use the existing row and date formatting. Update the English and Spanish
   Box status guides and both A950 backlog entries.

**Tests first.** `transaction.test.mjs` and `cli.test.mjs` should first fail because no result survives
cleanup. Test success, rollback, recovery of an interrupted attempt, and a busy or old marker
leaving the prior result. `scripts/waitron-box-sh.test.mjs` owns fixed reads, including missing files.
`scripts/box/host-protocol.test.mjs` grows the pinned shell verb list for `upgrade.status`.
`box-host-client.test.ts` owns malformed and absent replies, `box-health-api.test.ts` the protected
answer, and the dashboard status tests the two visible outcomes and absent result. Exercise success
and rollback in step 5c's installed Linux fixture. Run changed suites and check both themes and
languages at phone and desktop widths. Run the two Claude branch reviews and normal push/CI gates.

**Estimate** +225/−10 production and +235/−0 tests and support, plus docs. One PR.
