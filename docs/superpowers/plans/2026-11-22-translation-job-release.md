# Release translation jobs the box ends

Lane H's TRANSLATION-JOB-RELEASE assignment comes from the watcher's 2026-11-22 03:25 queue
note and [Translate all followups](../../backlog/menu.md#bundle-translate-all-followups).

## What this delivers

The box asks Cloud to release a known job after it ends locally because time ran out, the
installation's translation service went off, or a status or collect request or its final page
was rejected. Cloud can clear finished results then, including results whose good pages the box
already saved. Keep the local ending and its counts even when Cloud refuses or cannot answer.
A job Cloud already reports missing, expired or collected needs no release.

Cloud's existing release answers 409 for queued or running work. Its submit reuses an existing job
for the same operation id and body, but it can create a new job while the service is ready if the
first request never arrived. Cloud also answers 503 to every translation action when its operator
turns off the routes. These are source readings from Waitron Cloud at
`2af67c8495aa03c2c1f3134b6c102ddf49977fe4`, in
`packages/translation/src/{machine.ts:71–101,job-store.ts:29–30,64–71}` and
`packages/account-http/src/{app.ts:129,201,translation.ts:8–15}`.

A complete fix for active work and lost submit replies needs a Cloud action that can abandon an
existing job by operation id even when it is still active, without creating one. The watcher can
route that contract to Lane G. Keep those cases and an unavailable Cloud in the backlog. Leave the
service switched off and leave Cloud code, storage, routes and the ordinary completed-job retry
path alone.

## Build and check

- [ ] Start with the existing HTTP runner cases in
  `apps/server/src/content-suggestion-runner.test.ts`. Make the service-off mid-collection and
  cursor-refusal cases expect release of the actual job and Cloud state `collected`. Preserve
  the saved page, local refusal and notice checks. Cover a final page that fails the store's item
  accounting, and change the local expiry case to expect one release attempt and a local
  `expired` result when Cloud answers 409. Keep the lost-submit and revoked-connection controls.
  Run the changed cases before the fix. The release action or Cloud-state assertions must fail.
- [ ] In `apps/server/src/content-suggestion-runner.ts`, reuse `translation.release` once after
  the local transaction commits. Use it from `close` for a known job and after
  `storeSuggestionPage` returns `ended`. Skip calls for a missing id, a revoked or missing
  connection, or a terminal Cloud reply. Use the current abort signal and release timeout. A
  refusal or unavailable Cloud leaves the local end as recorded and permits a fresh run. Move
  the test fixture's per-installation readiness check to new submission only, matching Cloud's
  existing-job routes (`apps/server/test/translation-cloud-fixture.ts`).
- [ ] Run the server runner and API suites, the menu job and store suites, and Lane H's unchanged
  fiscal and menu Review Focus checks. Narrow the backlog entry and its bundle link. Sign off the
  commit and take the normal review and CI path.

Expected size is 35–55 added production lines and 35–65 added test lines, mostly changed runner
assertions and one fixture edit, plus the backlog wording.
