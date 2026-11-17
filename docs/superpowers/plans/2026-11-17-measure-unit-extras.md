# Measure-unit extras — implementation plan

**Ask:** Lane H `queue.md`, MEASURE-UNIT-EXTRAS (17 November 2026).
**Status:** Separate Sol high-effort draft, shortened by the Codex driver; Claude review and
watcher build clearance pending. Claude first read complete (266 s); watcher cleared its simpler
inline route at 07:18 on 17 November (Lane H questions.md). No owner design approval is claimed.
One correction read remains; build only after settled plan clearance.

## Finish line and reuse

A false-to-true switch warns only when the stored unit currently takes extras (`takesExtras`,
missing `hardwareUnit` normalized to null). Word it as: N dishes in this unit have extras lists;
once it is a measure the till will not offer them after you publish. Count dishes, not attachments.
Show the warning inline beside the switch; the editor's existing Cancel leaves the saved unit
unchanged. Zero means no warning. Creation, already-on and true-to-false changes keep their
ordinary save behavior.

Keep `widgets/unit-form.ts`'s FormFeedback, draft scope and submission; `screens/units-screen.ts`
owns saving. Reuse the precision warning pattern and existing editor actions; no new dialog or primitive.
Existing `getUnitExtraUsage` counts products used INSIDE extras lists for precision warnings;
keep its meaning and consumers. The new read counts dishes CARRYING attachments.

## Build test-first

- [ ] **Reproduce:** `apps/dashboard/src/screens/units-screen.test.ts`, real switch then Save,
  count 2: inline warning appears before update, Cancel leaves the saved unit unchanged. Observe
  the missing-warning failure before changing production; keep the zero-impact save assertion.
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
- [ ] **Form/screen:** `widgets/unit-form.ts` reads on an eligible measure switch and shows the
  count beside it; extend its API Pick with the new method. Await that same pending read on Save/
  Enter before emitting submit. If it fails, show a generic no-count warning, emit no submit from
  that waiting Save, and allow the next Save. Reuse the precision read's stale-response pattern;
  no held submission or persistent acknowledgement. `units-screen.ts` keeps write/close/refresh.
  Add EN/ES count and failed-count wording to `i18n/strings.ts` using the `_one` convention.
  `widgets/unit-form.test.ts` owns positive/zero warnings, pending Save, failed-read next-Save and
  a decimal/scale stored unit switched on with no count read/warning. Existing screen integration
  owns write and Cancel; no duplicate unsaved or separate-dialog a11y tests.
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
src/order-drafts.db.test.ts`; dashboard: `src/widgets/unit-form.test.ts`,
`src/screens/units-screen.test.ts` and `src/api/client-routes.test.ts`.
Look at the changed editor EN/ES × light/dark × 390/1280, including warning and Cancel; screenshots stay local.
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
