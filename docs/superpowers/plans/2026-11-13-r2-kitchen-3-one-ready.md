# R2-KITCHEN-3 — One Ready per pass card

**Finish line:** every In progress pass card has one Ready, including multi-course and no-course counter orders. Only that card’s fired dishes become ready. Both device surfaces enforce Runs the pass. One PR, under three active hours.

**Ask, verbatim:** “the pass shows one Ready button per pass card, counter and no-course orders included, and the server refuses Ready from a device or person without "Runs the pass".” Source: Lane I `~/waitron-campaign-i/queue.md`, R2-KITCHEN-3. The queue records the owner’s yes to Proposal 3 on 11 November; this is not approval of this plan. `~/waitron-campaign-m/reports/r2.md` §§2–3 supplies the proposal: “every card In progress has one Ready”. The linked desk record says the answer was recorded in the lanes and does not quote the answer itself.

## Smallest build

Leave `order-groups.ts:bumpGroupReady`, its revision/replay/attendance handling, group routes’ bodies/answers and group screen handler unchanged. Replace only `working-order.ts:bumpCourseReady` with `bumpBillReady(tx, orderId, firer?, attendance?): Promise<void>`. Reuse its update, `advanceSet("ready")` and attendance capture; remove the course filter and select only lines with no group on that bill. Keep fired-only/not-ready conditions. Do not select writes through the board’s `readPassCardRows` read model or add a shared group/bill writer.

Replace course routes with `POST /api/orders/:id/ready` and `/api/device/orders/:id/ready` (`{}` body, empty 200). On these and both existing group Ready routes, import existing `passReleaseRefusal` and reject a missing flag with 403 `device.forbidden_action { action: "run-the-pass" }`. Keep existing session/admission, device proof, preparation and zone checks. Add no Fire screen-availability gate or person permission: both prepare-orders and run-the-pass are device-profile checks (`till-session.ts:204-208`, `device-session.ts:272-279`). “Person” means the signed-in till path; KDS keeps device-only admission. The watcher confirms this reading before build.

In till `state/pass-view.ts`, keep groupReady and replace courseReady/readyCourses with a billReady boolean under the existing In progress/non-monitor/runsPass gate. In `widgets/pass-board.ts`, retain the group event and add `pass-bill-ready { key }`; `screens/till-pass-screen.ts` replaces its course handler, and `api/client.ts` supplies `bumpBillReady`/`bumpDeviceBillReady`. Keep hidden/dimmed whole-card behavior, group revision recovery and distinct bill refusal recovery.

Server production files: `apps/server/src/{working-order,till-api,device-levers}.ts`, plus obsolete course-lever comments in `pass-card.ts`. Reuse `pass-release.ts` without editing it; fiscal `pass.ts` is excluded.

## TDD and test ownership

1. **Domain:** first fail `apps/server/src/working-order.test.ts` cases “pass card Ready crosses courses including no course” and “pass card Ready leaves grouped siblings unchanged”. Keep fired-only, held/requested, timestamp, repeat and attendance assertions. Implement the bill writer. Existing group domain tests stay unchanged.
2. **Refusals:** only `till-api.profile-actions.test.ts` tests both till routes without the flag; only `device-levers.test.ts` tests both KDS routes. Assert 403/domain code, unchanged rows and allowed success. Keep existing preparation/person/proof/zone cases. Update inventories and their basis text.
3. **Route consumers:** `{till-api.courses,till-api.groups,till-api.profile-zones,till-api.session-person,till-device-proof}.test.ts` get URL/fixture changes and route-specific mapping assertions, not duplicate refusal matrices. Preserve group revision/replay answers; test retired-course 404 and the new bill body/answer. Adapt direct course-writer consumers `{attendance-kitchen-service,kitchen-delete.integration,split-off-extras.release}.test.ts`, preserving credited-person checks.
4. **Till:** first fail one-button group, multi-course and no-course cases in `{state/pass-view,widgets/pass-board,screens/till-pass-screen.levers}.test.ts`. Retain monitor/no-flag/outside-In-progress suppression, hidden-card behavior, key events, refresh and refusal recovery. Update `api/{client,party-allergy-client}.test.ts`, `screens/till-pass-screen{,.help,.a11y,.dispatch-retirement}.test.ts`, widget accessibility and till-app fixtures only as their changed contracts require. Replace course-label/order/no-course-no-button and unknown-course-no-op assertions with equally strict card assertions; list changed checks in the PR.

## Wording, checks and limits

Use Ready / Listo for both existing translation keys in till `i18n/strings.ts`; keep expo.group_ready and the group event. Update `i18n/help-strings.ts`, server `guide/{en,es}/kitchen-service.md` (shared anchors retained), current course-lever wording in `docs/developers/design-system.md` and `docs/backlog/till.md`, and the root backlog. Do not close unrelated work or rewrite historical plans.

For each step, run the named cases red then green; run every changed test file before finishing. Commands use `pnpm --filter @waitron/server exec vitest run <named files>` and the till equivalent; run server `guide-content.test.ts` and root `scripts/guide-links.test.ts`. Require Tests counts; retain the normal hook and current-head CI. Check browser headroom, then inspect available pass layouts in EN/ES × light/dark × phone/desktop via `wa-wt demo waitron-feat-i-r2-kitchen-ready`; keep screenshots uncommitted.

Exclude other R2 proposals, Fire changes, Undo, new tables/records/protocols and unrelated cleanup. Expected additions/removals: production +90–150/−140–220; tests +180–260/−220–330; support +0–20/−0–20; guides/strings +20–40/−25–45. These are estimates; report actual counts separately.

Claude reviewed the first draft in Lane I receipts/r2-kitchen-3-20261113/plan-review.md. The driver accepted its smaller route and corrections; the watcher cleared the corrected plan at 23:31 on 13 November 2026 (Lane I questions.md), including the device-profile reading of Runs the pass and two run-it reviews.


**Review correction, watcher cleared 2026-11-14 00:06 (Lane I questions.md):** constrain the bill selector with existing `liveKitchenDish()` and its existing order/line joins. A real `serveLine` before Ready removes the served no-course water from the card; its ticket must remain unchanged. Add that one regression case. Keep one Ready on every In progress card, prune the stale hidden-dish claims and duplicate view case, fix the two test names, then take the one fresh fixes read. No group-writer change.
