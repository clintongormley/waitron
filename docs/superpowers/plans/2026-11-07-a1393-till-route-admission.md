# A1393: till route inventory

Goal: list every till route's device proof and profile action, and require matching device proof
on the fourteen writes approved by the watcher. Codex drives this branch.
Ask: `docs/backlog/till.md`, “Bundle A1393” and both linked details. Printer identity is separate.
Authority: Lane F queue, watcher 2026-11-06 about 12:45, assigns A1393 after A1383. The owner
invoked RUNNER.md and authorised finish/land on 2026-11-07. Actual notes are in
`/Users/clintongormley/waitron-campaign-f/{RUNNER.md,queue.md,questions.md}`. Earlier branches
wait for A760's landing freeze; no database table changes or landing are allowed here.

## Work

1. Extend `apps/server/src/till-api.profile-actions.test.ts`, reusing its live `ROUTES` refusal
   cases. Replace its prose action map with data for action cases elsewhere in this file or other suites (naming the
   case) and actionless routes (giving the reason). Record device proof separately from actions:
   matching request proof, device-cookie authority, session device only, public/bootstrap, or
   undecided until the approved repair is qualified. “No action” exceptions do not decide request-device proof. Keep all existing
   behavioral assertions and the independent zone map. Each classified row carries its proof field;
   rows sharing a route key must agree on it.
2. Mount real till/device/staff schedule APIs in a separate inventory app, including workforce, attendance and live department events,
   simulator, development and box-clock routes (backend must offer `confirmClockStop`). Compare
   the set of registered `/api/` method/path keys with the classified set, normalising UUID and
   line-number samples and parameter names. Fail on missing/stale rows; exclude middleware and
   management routes. Start with the failing inventory comparison, then add classifications.
   This guards completeness, not execution of every stated check. Existing action cases test
   their action refusals; proof entries are source readings unless backed by a named test. Prove missing/new-route failures once in an installed disposable clone.
3. Watcher 2026-11-07 06:11 approved matching device proof for all fourteen questioned writes,
   retaining reads/bootstrap/logout and existing action/permission/zone exceptions. Add real
   route regressions in `till-api.request-device.test.ts`: absent, invalid and foreign cookie
   must refuse `device.unauthorized` before body/business checks; matching and development-header
   calls (no device cookie) must reach exact existing statuses; production ignores that header. Observe every new refusal case fail first.
   Add `assertRequestDevice` immediately after session resolution only on those handlers in
   `till-api.ts`, `device-api.ts`, `keep-open-api.ts`, `station-today-api.ts`,
   `till-box-clock-api.ts` and `schedule-api.ts`. Pass full deps to the device proof checks. Test schedule `devMode` through `boot.ts`; retain
   each surface's error status convention (schedule gains 401). Update session-only fixtures
   with matching cookies without dropping assertions. Do not change `requireSession` globally.
   Test first, then make `device.unauthorized` EN/ES wording in the till's `i18n/codes.ts` explain
   verification failed and say to reload or reopen Waitron on this device before retrying.
   In `till-app.ts`, preserve this code for receipt handover, table cleared, locale save and demo
   cancel; in `widgets/box-time-dialog.ts`, preserve it for challenge and confirm. Test all six
   rendered refusals in EN/ES with the same next step. Retire the undecided inventory group once
   the fourteen checks pass, naming the new route suite as their device-proof receipt.
   Run existing permission/zone/admission/schedule/clock suites as the successful-call controls.
4. Run focused inventory/action/zone, affected routes, till widget/app/codes suites, scoped types and one-time
   controls. Update `docs/developers/conventions-ui.md` with the guard's actual limits in both route-map passages; update the root `CLAUDE.md` pointer in this PR under watcher 06:11 authority. The guard sees only the APIs it mounts, not theme/node
   routes or a newly introduced API. Sign off commits. Remove completed A1393 entries in `docs/backlog.md` and both linked details in `till.md`;
   retain the printer-identity section, retitling its bundle; run finish-branch with one Claude run-it review, normal hook and current-head CI;
   retain the branch under A760's freeze.
