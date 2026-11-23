# Let the box abandon unfinished Cloud translation jobs

When the box ends unfinished translation work, Cloud can still hold the job and refuse
the next Translate all. Use the operation ID already saved on the box, including when
the submit response was lost and the box never learned Cloud's job ID. Lane H's
TRANSLATION-ABANDON-BOX queue entry at 11:52 on 23 November defines the scope.
[Cloud contract for abandon](https://github.com/waitron-io/waitron-cloud/blob/a6490b62cf8e2870450f49e9660df5d398684c9e/docs/waitron-integration-contract.md#L1332-L1344).

- [ ] In `apps/server/src/content-suggestion-runner.test.ts`, adapt the lost-submit,
  local expiry and interrupted-collection cases to assert abandon uses the original ID.
  For the lost submit, check the Cloud job expires and the next submit reaches Cloud.
  Keep the stored-page and normal release assertions. The service-off, 24-hour running
  and backward-clock cases now expect abandon before closing. A job Cloud never took
  still expires locally after 24 hours. Cover failure to reach Cloud
  before and at the existing local expiry, using a new runner to check the same ID
  survives a retry. Run these cases red before adding the box call.
- [ ] Extend `apps/server/test/translation-cloud-fixture.ts` to accept the signed action
  independently of venue translation readiness. Require exactly `{"version":1}`
  as signed body and find the existing job by submit operation ID. In
  `apps/server/src/translation-cloud-fixture.test.ts`, check that a miss acknowledges
  without creating work and that a different operation cannot clear a held job.
- [ ] In `apps/server/src/cloud-translation.ts` and `cloud-client.ts`, add
  `abandon(operationId, signal?)` via the existing signed exchange and lease, with
  release's request budget and the built-in reply-version check. The box already uses
  `@waitron/contract` from the workspace. Record the Cloud pin 0.2.45 and its source
  commit ff647911ac in the PR and joint-test handoff.
- [ ] In `apps/server/src/content-suggestion-runner.ts`, send abandon before closing a
  still-connected unfinished job, including when venue translation is off. Close
  normally if Cloud already said the job is gone or the installation is disconnected.
  While the job is within the existing lifetime, let temporary Cloud failures use the
  current runner retry. Close locally on `cloud.request_invalid`; recorded revocation
  closes as not connected on the next step. Check age first: at expiry, give both
  unfinished and half-collected jobs one attempt before closing. Reuse the same ID
  throughout and keep network calls outside the database transaction. Leave fully
  collected and Cloud-failed jobs on the release path.
- [ ] For a last page that fails the accounting check, update
  `packages/menu/src/content-suggestion-store.ts` and
  `content-suggestion-jobs.ts` to leave the release flag unset via an option used only
  in the `!complete` branch. The existing cleanup read returns that row as failed with
  a Cloud ID and no release recorded. The runner uses its `rejected` failure to select
  abandon by original operation ID and then marks the row released. Keep both
  `content-suggestion-store.test.ts` assertions for the failed outcome and page contents.
- [ ] Run the changed server and menu test files. Update the two outdated paragraphs
  in `docs/developers/cloud-connection.md` and remove the entry and bundle line in
  `docs/backlog/menu.md`. After branch review, hand Lane G the pinned Waitron candidate
  in `questions.md`. Use its disposable translation proof to lose the submit reply
  after Cloud commits, end the job on the box, observe abandon and confirm the next
  submit. Record both commits and the result before closing the item.

Expect 40–65 production lines and 75–125 test and fixture lines. This uses the existing
job states and lifetime and adds no table, retry timer or screen. Translation stays
off in production. Cloud may still hold a job if unreachable at local expiry, or if
the original submit was still in progress when Cloud acknowledged an abandon miss.
