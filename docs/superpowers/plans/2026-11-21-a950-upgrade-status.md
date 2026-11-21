# A950 step 7. Show the last offered upgrade in Box status

An administrator can tell from Box status whether the latest completed offered install put the
box on the new release or reopened the previous one, and see both version numbers and when it
finished. This applies to the supervised command already on main and will also serve the timer
when it installs. [Parent plan](2026-11-09-a950-shorter-upgrades.md) ·
[Supervised install](2026-11-21-a950-quiet-upgrade-stop.md). Codex wrote this plan for Lane F.

This is the first reporting slice of step 7. It leaves the timer checking offers, preserves
manual Restore/Keep, and leaves the editable window, pause, rollback email and default switch-on
for subsequent slices. The physical rehearsal and cutoff measurement still precede activation;
pairs still wait for A947. This proposes shipping the read by itself before declaring the
settings and install requests as the parent plan originally grouped them.

1. **Retain the latest result on the host.** Reuse the existing attempt marker in
   `scripts/box/upgrades/{cli,transaction,host}.mjs` to carry the two numbered versions for offered
   installs. In the common reopen path, once the selected release is healthy and before removing
   the attempt, record just `attemptId`, `finishedAt`, `fromVersion`, `toVersion`, and
   `status: "upgraded" | "rolled-back"` using the existing durable writer. Keep the one result
   beside the installed box's upgrade-offer file, outside its rollback copy. Recovery uses the
   same path and keeps the result for the same attempt if cleanup is retried. A failed resume,
   busy stop with no copy, or manual attempt leaves the previous result. If recording fails, log
   it and complete the existing cleanup so an optional report cannot hold the venue. Clear the
   result with the box reset. No raw check output, new database table, or history list.
2. **Show the result through the current Box status read.** Add a fixed read-only host request
   in `deploy/box/waitron-box{.sh,@.service}` and the retained upgrade CLI. Use the installed
   host service configuration to find the box directory. The request takes no paths or
   arguments. `apps/server/src/{box-host-client,box-health,boot}.ts` validate the bounded reply
   and carry the optional result in the existing `system.manage`-protected `/api/box/health`.
   The host being absent, old, or unable to read a result leaves other health fields available.
   `apps/dashboard/src/api/client.ts`, `screens/box-status-{rows,screen}.ts` and
   `i18n/strings.ts` use the existing status rows and date formatter. Show installed or
   rolled-back wording in English and Spanish, with no row until there is a result. Update both
   Box status guide versions and both A950 backlog entries.

**Tests first.** In `transaction.test.mjs` and `cli.test.mjs`, first show that a successful install
and a restored old release lose their result at cleanup. Cover interrupted recovery, repeated
cleanup, and a late busy restart leaving the prior result. The installed shell test checks
the fixed read and reset. `box-host-client.test.ts` owns malformed and absent host replies,
`box-health-api.test.ts` the protected answer, and the dashboard status tests the two visible
outcomes and missing result. Exercise a successful upgrade and a rollback through the installed
Linux fixture used for step 5c. Run changed suites, look at Box status in both themes and languages
at phone and desktop widths, then use the two Claude branch reviews and normal push/CI gates.

**Estimate** +240/−10 production and +235/−0 tests and support, plus guides and backlog. One PR.
