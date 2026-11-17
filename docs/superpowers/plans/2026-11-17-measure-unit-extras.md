# Measure-unit extras — implementation plan

**Ask:** Lane H `queue.md`, MEASURE-UNIT-EXTRAS (17 November 2026).
**Status:** Separate Sol high-effort draft, shortened by the Codex driver; Claude review and
watcher clearance pending. Claude first read complete (266 s); its simpler inline route awaits
the watcher. No owner design approval is claimed. One correction read remains; build only after clearance.

## Finish line and reuse

A false-to-true switch warns only when the stored unit currently takes extras (`takesExtras`,
missing `hardwareUnit` normalized to null). Word it as: N dishes in this unit have extras lists;
once it is a measure the till will not offer them after you publish. Count dishes, not attachments.
Confirm saves; Cancel/Escape saves nothing and keeps the editor and every draft field. Zero means
no warning. Creation, already-on and true-to-false changes keep their ordinary save behavior.

Keep `widgets/unit-form.ts`'s FormFeedback, draft scope and submission; `screens/units-screen.ts`
owns saving. Reuse compact `wt-modal`, its native-dialog behavior and `wt-form-actions`; no new primitive.
Existing `getUnitExtraUsage` counts products used INSIDE extras lists for precision warnings;
keep its meaning and consumers. The new read counts dishes CARRYING attachments.

## Build test-first

- [ ] **Reproduce:** `apps/dashboard/src/screens/units-screen.test.ts`, real switch then Save,
  count 2: confirmation appears before any update. Observe the premature-save failure on this
  main-code base before changing production code; keep the ordinary zero-impact save assertion.
- [ ] **Menu count:** add `countProductsWithAttachedExtras(tx: Transaction, unitId: string):
  Promise<number>` in `packages/menu/src/units.ts` (already exported). Reuse `productsUsingUnit`
  and `readProductModifiers`; count each parent with an extras attachment once, including archived
  dishes/inactive attached lists, regardless of menu placement. Variants inherit their parent's
  unit/lists and do not multiply the count. Options-only and inverse extras-item usage do not count.
  `units.operations.test.ts`: one fixture expecting 2 combines two dishes/multiple lists,
  options-only, other-unit and inverse-usage controls, including archived/inactive attachments;
  an empty unit returns 0. Existing parent-unit behavior owns variant inheritance.
- [ ] **API:** add `GET /management-api/units/:id/attached-extras-count` → `{ dishCount: number }`
  in `apps/server/src/units-api.ts`, using existing `gated` menu.manage authorization, UUID parsing
  and `getUnit` refusal. `units-api.test.ts` owns 200/body and 404, not the shared access/UUID checks
  or the menu count matrix.
  Add `getUnitAttachedExtrasCount(id)` in `apps/dashboard/src/api/client.ts`, with the sibling GET/body
  case in `api/client-routes.test.ts`; leave the old precision read untouched.
- [ ] **Screen:** in `units-screen.ts`, read before false-to-true updates; keep pending submitted
  value/count for positive confirmation and suspend the original Save/Enter until it resolves.
  This separate-dialog route is UNSETTLED: Claude recommends inline beside the switch instead,
  reusing the editor Cancel. Ask the watcher before building either route.
  Reuse busy/refusal handling; a failed read keeps the draft, reports through form feedback and
  permits Save retry. Confirm uses existing write/close/refresh. Add EN/ES count wording to
  `i18n/strings.ts` using the existing `_one` convention. Screen tests own confirm/cancel,
  zero/other transitions, draft retention and failed-read retry; include a decimal/scale unit
  switched on with no count read or warning. No duplicate unsaved suite addition. Extend
  `units-screen.a11y.test.ts` only if a separate dialog remains after the watcher decision.
- [ ] **Conditional draft fix:** in `apps/server/src/order-drafts.db.test.ts`, reuse venue/save
  helpers: publish Burger in a precision-0 measure unit, pick its sauce, assert `unavailable: true`
  before pricing; include a decimal- or scale-unit pick in the same case, since `soldMeasured`
  excludes all three. Controls: ordinary allowed pick; measured dish without extras and valid options.
  Only if reproduced, fix `order-drafts.ts:unavailable` minimally with existing `takesExtras`/
  `soldMeasured`, retaining options checks; retire the stale exhaustive `unavailable` comment.
  If already passing, keep production unchanged and report
  the executable closure. Published documents retain modifier attachments; test actual offers.

## Checks, docs and size

Run each changed test file with `pnpm --filter <package> exec vitest run <files>`; observe red/green.
Menu: `src/units.operations.test.ts src/extra-usage.test.ts`; server: `src/units-api.test.ts
src/order-drafts.db.test.ts`; dashboard: named screen/client test files, plus a11y if extended.
If the inline route wins, form behavior belongs in `widgets/unit-form.test.ts` and existing screen
save integration; revise the route/files and size after the watcher answers, before the one correction read.
Look at confirmation EN/ES × light/dark × 390/1280, buttons, Escape and focus return; screenshots stay local.
Add at most one staff-action clause in `apps/server/src/guide/{en,es}/products.md#selling-unit`;
run server `src/guide-content.test.ts`
and root `scripts/guide-links.test.ts`. Delete finished points in `docs/backlog/menu.md`, correct its
bundle count and `docs/backlog.md` index; keep the decimal-quantity owner question.

Queue gates, unedited: fiscal `src/write-path.e2e.test.ts src/inmutabilidad.test.ts`, server
`src/till-api.sell-published.test.ts` (menus Task 7 Review Focus 1/2), till `src/till-app-menu-refresh.test.ts`.
Then finish-branch, normal pre-push hook and required current-head CI; no whole-package local run.
No publish change, decimal quantity choice, frozen-unit/A997, schema/migration, fiscal change,
persisted acknowledgement, concurrent-edit protocol, extra transaction check or unrelated cleanup.
Expected total 250–500 changed lines: production +80–140/−5–20, tests +150–240/−0–30,
support +0–10/−0, docs +15–30/−5–15. Report actual additions/removals separately;
stop for watcher deviation clearance beyond 1.5× the upper estimate.
