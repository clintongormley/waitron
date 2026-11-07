# A1393: till route inventory and request-device proof

Codex drives. Goal: classify till routes and require matching device proof on the fourteen writes
approved by the watcher. Ask: A1393's two backlog details; printer identity stays separate.
Authority: Lane F queue, watcher 2026-11-06 about 12:45; owner invoked RUNNER.md and authorised
finish/land on 2026-11-07. Notes: `/Users/clintongormley/waitron-campaign-f/questions.md`.
Watcher 2026-11-07 06:11: “Yes to the simpler inventory. Yes to device proof on all the writes you list”.
A760 forbids database table changes and landing until its freeze ends.

1. Extend `apps/server/src/till-api.profile-actions.test.ts`. Reuse live `ROUTES`; replace its
   comment map with classified rows for remaining routes, naming an action receipt or an actionless
   reason. Record device proof separately, distinguishing source readings from named behavioral
   tests. Rows sharing a route key agree on proof. Keep the independent zone map and assertions.
2. In a separate inventory app, mount till/device/schedule APIs with workforce, attendance,
   live department events, simulator, development and box-clock routes. Compare registered
   `/api/` method/path sets with classifications, normalising parameters and sample UUID/line ids.
   Observe missing classifications fail, then fill them. Prove missing/new/stale rows once in an
   installed disposable clone. The guard excludes middleware/management routes and sees only its
   mounted APIs, not theme/node or newly introduced APIs; it does not prove every gate executes.
3. In `till-api.request-device.test.ts`, reproduce missing/invalid/foreign proof and production
   ignoring development headers on all fourteen writes. Keep matching-cookie and header-only
   controls with exact outcomes and no selling action. Then add `assertRequestDevice` after session
   resolution in `till-api.ts`, `device-api.ts`, `keep-open-api.ts`, `station-today-api.ts`,
   `till-box-clock-api.ts` and `schedule-api.ts`. Pass full deps; wire schedule `devMode` through
   `boot.ts`, qualified by a failing real-boot write. Preserve reads/bootstrap/logout, action
   exceptions, permissions and zones; retain statuses (schedule gains 401). Grow fixtures with
   matching cookies; preserve assertions. Leave `requireSession` unchanged.
4. Test first, then preserve `device.unauthorized` at receipt-handover, cleared, locale-save and
   demo-cancel handlers in `till-app.ts`, plus challenge/confirm in `widgets/box-time-dialog.ts`.
   EN/ES wording in `i18n/codes.ts` explains verification failed and says to reload or reopen Waitron
   on this device. Test all six rendered refusals. Retire undecided inventory rows after qualification.
5. Run focused affected server/till/widget/codes suites, types, guides and one-time controls.
   Update both conventions-ui route-map passages and, under watcher 06:11 authority, root
   `CLAUDE.md`. Remove completed A1393 backlog work; retain printer identity. Sign off commits.
   Finish with one Claude run-it review, normal hook and current-head CI; wait under A760's freeze.
