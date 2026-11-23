# Let the box abandon unfinished Cloud translation jobs

When the box ends unfinished translation work, Cloud can still hold the job and refuse
the next Translate all. Use the operation ID already saved on the box, including when
the submit response was lost and the box never learned Cloud's job ID. Lane H's
TRANSLATION-ABANDON-BOX queue entry at 11:52 on 23 November defines the scope.
[Cloud contract for abandon](https://github.com/waitron-io/waitron-cloud/blob/a6490b62cf8e2870450f49e9660df5d398684c9e/docs/waitron-integration-contract.md#L1332-L1344).

- [ ] Extend `apps/server/test/translation-cloud-fixture.ts` to match the signed abandon
  action. Require the original submit operation ID in the envelope and exactly
  `{"version":1}` as the signed body. Look up the existing operation, expire any held
  job, and acknowledge a miss without inserting anything. Keep the venue service state
  separate from installation authorisation for abandon, as Cloud's machine handler does.
- [ ] In `apps/server/src/content-suggestion-runner.test.ts`, adapt the lost-submit and
  clock-expiry cases to assert the original ID, an expired Cloud job, and a new submit
  accepted by Cloud. Adapt the collect interruption case to assert the same action and
  preservation of the stored page. Add one case that loses the abandon reply and checks
  that a fresh runner reuses the saved ID before the next submit. Keep the existing
  completed-collection release and Cloud-expired assertions. Run these cases first and
  observe the missing abandon or the following Cloud refusal.
- [ ] In `apps/server/src/cloud-translation.ts` and `cloud-client.ts`, add
  `abandon(operationId, signal?)` through the existing signed exchange, lease and
  refusal handling. Use the release request budget. `serviceExchange` already checks
  the reply version. The box builds with the local `@waitron/contract` workspace
  package, which gained abandon in #4032. Cloud's existing `@waitron-io/contract`
  pin is 0.2.45, published from that commit. Record this pairing in
  `docs/developers/cloud-connection.md`.
- [ ] In `content-suggestion-runner.ts` and
  `packages/menu/src/content-suggestion-jobs.ts`, record a locally ended unfinished job
  with its existing `released` flag unset when Cloud might still hold it. Preserve its
  outcome and saved suggestions. The runner picks up that row before normal polling or
  submission, uses its local ID for abandon, and marks it released on acknowledgement.
  Use the runner's existing retry for a missing reply. Keep the ID until cleanup so a
  new run cannot replace the row first. Keep the terminal outcome visible while cleanup
  waits. An installation that is no longer connected can close locally. A connected
  installation may send abandon when venue translation is off. Keep normal release
  for jobs fully collected or reported failed by Cloud. Use no new table, timer or screen.
- [ ] Run the changed server test files and the menu job-store tests, including the existing
  release and run-state assertions. Remove the resolved entry in `docs/backlog/menu.md`.
  Use the normal branch reviews and CI. In `questions.md`, hand Lane G the pinned
  Waitron candidate for one disposable check using its existing translation proof:
  lose the reply after Cloud commits submit, end the job on the box, observe abandon
  and confirm the next submit reaches Cloud successfully. Record both source commits
  and the result before closing the item.

Expect 55–90 production lines, 55–95 test and fixture lines. Translation stays switched
off in production. The joint check covers a lost reply after Cloud committed the job.
Cloud's contract permits a submit still in progress to appear after an abandon miss.
