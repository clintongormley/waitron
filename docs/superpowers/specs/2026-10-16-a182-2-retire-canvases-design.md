# A182-2: retire canvases before redesigning the screens

Status: retirement scope decided by the owner; design and plan reviewed on 2026-10-16.
Implementation remains open. This planning change contains documentation only.

You should be able to change a till screen without maintaining a second, configurable way of
assembling that screen. Retire the general screen designer now. Keep today's default workflows
as fixed screens written in code, then let A182 part 1 redesign them separately.

The owner decided this on 2026-10-08 in [A182](../../backlog/till.md#build-good-screens-for-each-kind-of-device-and-retire-canvases-a182-owner-2026-10-01):
“delete the canvases functionality. we provide prebuilt screens with configuration settings.”
[Service design §11](2026-09-20-service-ordering-and-billing-design.md#11-screen-reuse-and-deferred-work)
keeps menu shortcuts, receipts and floor-plan editing separate and defers a screen-plugin contract.
The [implementation plan](../plans/2026-10-16-a182-2-retire-canvases.md) implements this retirement,
not A738/A739/A740, new wording or gestures, A668-5, or a plugin system.

## Evidence boundary

Source references below are readings at `fbc8cc7ff1cddb682ba0d02f72be1ca501b443d7`, on
2026-10-16. They establish where the implementation must change; they are not runtime receipts.
No tests, migration experiments, builds or servers ran in this documentation phase. Re-map on the
implementation base and after an overlapping rebase. Proposed new code paths below are explicitly
labelled; Markdown links point to existing documentation or the companion plan.

## Global constraints

- Ship ONE complete implementation PR after separate planning publication. No intermediate PR may break the boot/profile/schema contract.
- Delete canvas persistence, authoring, selection and rendering. Do not rename the generic canvas renderer or retain a cards/config/spans registry behind fixed defaults.
- Preserve business assertions, exact money and VAT results, permissions, login refusals, drawer rules and fiscal invariants. Do not edit golden fixtures, golden huella, `inmutabilidad` or other fiscal filing/hash checks.
- No data migration, backfill or compatibility reader before a real venue is live. Do not claim a reset is necessary without measuring the final candidate against a populated predecessor.
- Keep device types, capabilities, navigation screens, profile actions, receipt settings, tenant themes, menu Device Home Page Handheld/Till displays and the floor-plan editor.
- Preserve counter, table-order, station, pass and pass-monitor modes; starting screens, URLs/history, drafts, polling and resource cleanup. Preserve A743 kitchen notes and landed/in-progress A737 behavior.
- Use existing EN/ES wording, `wt-*` primitives and declared `--wt-*` tokens. LOOK in EN/ES, light/dark, at measured widths 390/1280.
- Root guards under `scripts/` are controversial test changes. Obtain the specific owner answer before changing their pins; scope approval alone does not grant that answer.
- Every implementation task has observed RED then GREEN and signed-off commits (`git commit -s`). Keep coverage `98/98/98/95` and mutation floors unchanged.
- Preserve foreign work and root instructions. Keep campaign state outside the repository and recheck live collisions before implementation and landing.

## Fixed screens and their interfaces

These are fixed navigation choices, not authored canvas tabs. Keep the existing visible labels,
translated through the existing `tab.counter`, `tab.floor` and `tab.order` keys
(`apps/till/src/i18n/strings.ts:219`). Kitchen has no primary header in kiosk mode; do not add a
new label there. No new copy is part of the retirement.

| Form factor | Fixed primary destinations, in order | Home | Mounting |
| --- | --- | --- | --- |
| `till` | `counter`, `floor` | `counter` | Counter owns menu/basket/total/payment/held/waiting markup; Floor embeds the existing floor screen. A table opens a non-embedded Order overlay over Floor. |
| `phone-portrait` | `floor`, `order` | `floor` | Floor embeds the floor screen; Order embeds the table-order screen, including its existing no-table/partyless state and settlement capability. |
| `tablet-landscape` | `floor`, `order` | `floor` | Same workflows as phone, with the existing responsive table-order layout and Handheld menu display. |
| `kds` | `kitchen` | `kitchen` | No operator header/login. Only with `act-as-kds`, mount the device-selected station, pass, pass monitor, or existing unavailable/unselected notice. Without that capability, mount none of those board/notice children, as the current renderer does. |

Evidence: `packages/layouts/src/default-canvases.ts:8`, `:37`, `:54`, `:72` define those orders;
`apps/till/src/till-app.ts:7636` distinguishes embedded handheld Order from the till overlay;
`apps/till/src/widgets/card-grid.ts:338` selects the KDS mode. KDS selection also depends on
`#readKitchenScreen`, `apps/till/src/till-app.ts:2904`; it is not simply “always mount station”.
The separate `act-as-kds` rendering gate is at `card-grid.ts:287`, `:311`; profiles may omit
that capability (`packages/layouts/src/device-profile.ts:42`). Preserve both the absent and
present cases from `till-app.test.ts:12448` and `card-grid.test.ts:849` in the fixed KDS mount.

**Author's interface decisions:**

1. Replace the boot response's `canvas` with required `formFactor: FormFactor` in
   `GET /api/till` and `TillInfo`. Resolve it from the same device read, falling back to `till`
   for the existing cookieless setup response. Keep all other boot fields and their omission rules.
   Evidence: canvas/profile resolution is at `apps/server/src/till-api.ts:1408`, its response at
   `:1503`; `apps/till/src/api/client.ts:171` mirrors it. This change grants no session or action.
   Identity validation, enrolment and transient-failure handling remain separate (`till-app.ts:2827`).
2. Proposed `packages/layouts/src/device-types.ts` owns the surviving types/constants/helpers now
   in `canvas.ts`: form factors/kinds, capabilities, actions, screens, navigation and
   `kindOfFormFactor`. Move `ThemeOverride` to existing `theme.ts`. Re-export surviving names from
   `index.ts`; keep theme/receipt stores. Browser apps retain browser-safe local shapes, not an
   import from layouts' database-bearing barrel. Proposed dashboard `src/device-profile-types.ts`
   replaces the surviving subset of `screens/canvas-editor/card-contracts.ts`, with parity tests.
3. Proposed till `src/built-in-screens.ts` defines the closed union
   `BuiltInScreen = "counter" | "floor" | "order" | "kitchen"` and
   `builtInScreensFor(formFactor: FormFactor): readonly BuiltInScreen[]`,
   `homeScreenFor(formFactor: FormFactor): BuiltInScreen`,
   `resolveBuiltInScreen(formFactor: FormFactor, requested: string | null): BuiltInScreen`.
   The resolver accepts only that form factor's fixed destinations and otherwise returns home.
   It carries no labels, widgets, settings, spans, visibility predicates or rendering callbacks.
4. Replace `widgets/tab-shell.ts` with proposed `widgets/till-shell.ts` / `till-shell`, retaining
   its header fitting, language/More/profile/transfer/clock controls, inert underlying body and
   `drill` slot. Inputs become `formFactor: FormFactor`, `activeScreen: BuiltInScreen`; emit
   `screen-select` with `detail: { screen: BuiltInScreen }`. Keep the remaining shell properties
   and events. Remove `tabs`, `TabDef` and custom-title translation exceptions.
5. `TillApp` directly renders Counter/Floor/Order/Kitchen in a closed switch. Factor its existing
   Order binding into `#tableOrderBody(embedded: boolean): TemplateResult`, shared by primary Order
   and the till overlay. Factor KDS into `#kitchenBody(): TemplateResult`; preserve each prefetched
   screen, read-only monitor, notice and switched-message binding. Preserve the existing
   `act-as-kds` visibility gate at the direct Kitchen mount; it grants no server action. These are
   app methods, not new registries. Counter's `counterTab` property disappears; its other business inputs stay.

You keep the counter's present wide arrangement: menu and held/waiting content in the left
two-thirds, scrollable basket on the right, total and payment below it at their natural height.
At phone width, stack menu, basket, total, payment, then held/waiting in normal page scrolling.
Preserve the menu/service/diet controls, pay-rest action, stored-line context, invoice/language
choices and event details. Show the held/waiting section when EITHER list has rows. Do not add the
non-default prep-queue rail. Source: `card-grid.ts:80`, `:284`, `:377`, `:490`, `:608` and
`screens/till-counter-screen.ts:332`; layout assertions at `till-counter-screen.layout.test.ts:198`.
These source locations guide extraction; the resulting geometry still needs Chromium measurements.

## Navigation and lifecycle contract

- Keep `/tabs/counter`, `/tabs/floor`, `/tabs/order`, `/tabs/kitchen` and existing
  `/zone/<id>`, `/view/<destination>`, `/station/<id>` address words. Only valid fixed primary
  destinations survive restoration; an unavailable/custom tab returns home with replacement,
  without adding a history stop. Keep `tillPath` (`apps/till/src/navigation.ts:3`).
- Keep operator Station/Expo/Schedule reachable through `show-station` / `show-expo` /
  `show-schedule`. Expo is not a default primary tab: the current app offers it from profile flags
  (`till-app.ts:11294`) and mounts it as an overlay (`:11586`). Preserve `run-the-pass` for controls.
  `startingScreen: null` now means fixed home; the same three explicit starting values remain,
  gated by capabilities. A permitted restored destination wins before the starting preference,
  as the login path currently orders it (`:3795`). KDS rejects operator destinations as today.
- Keep explicit primary selection, Back/Forward and automatic home replacement distinct.
  On handhelds, opening a table selects Order; on tills it opens the Order overlay over Floor.
  Return/New sale uses fixed home; Back from Find bill uses Counter where present, otherwise home.
  Keep table context and draft-flush behavior across Floor/Order visits (`:7332`, `:11183`).
- Keep the single app-owned basket and draft owners, leave coordinator, session/visit generations,
  menu/equipment polling, floor polling and teardown. Direct mounting must preserve all child
  inputs/events formerly forwarded by `card-grid`, including A743 note and note revision.
  Relevant owners: `till-app.ts:1687`, `:2559`, `:4088`, `:11453`; Floor owns its visible-map
  polling (`screens/till-floor-screen.ts`, locate `#watchFloor` on the implementation base).
- Find bill keeps its Bills/Transactions state, query/page and historical-receipt Back context;
  opening it does not replace the basket. Preserve A737 Part 2's pending-refund identity, dirty
  form and late-answer behavior when integrated. Do not implement its refund flow here.

## Retirement inventory

Trace identifiers AND prose across the entire tree before deleting. This table is the starting
inventory; the implementation PR must reconcile the final search, including non-TypeScript files.

| Area | Delete or change | Keep / replacement |
| --- | --- | --- |
| Layouts | `src/canvas.ts`, `default-canvases.ts`, `canvas-store.ts`, `validate-canvas.ts`, `card-contract.ts`, `widget-config.ts`, canvas exports and canvas error declarations | Device subset moves as above. Theme validators/store/imports, receipts, profile/equipment/printer functions stay. `widget-config` consumers found only in card-contract and index by source search. |
| Profile store | `device-profile-store.ts:35` row/columns/input/write/retirement `canvasId`; `:132` `bad_canvas_ref` translation | Existing authorization, name/form-factor lock, starting-screen and printer errors remain. Re-evaluate generic FK translation once its sole outgoing canvas key is gone; do not relabel unrelated failures. |
| Schema | `db/src/schema/canvases.ts`, profile field/FK/import; schema/index and package/index exports | New forward migration only. Remove `classify("canvases", ...)` at `db/src/classification.ts:134`; retain every other classification/append-only declaration. |
| Transfer/live | `db/src/configuration-transfer.ts:45` canvas declaration; dashboard live `listCanvases`, `getCanvas`, and canvas dependencies on profile reads (`api/live-queries.ts:297`, `:398`, `:407`) | Profile, device, kitchen-scope, printer and menu subscriptions stay. `CORE_CHANGE_SOURCES` derives from classification (`classification.ts:247`), consumed by composition `modules.ts:114` and boot `boot.ts:1424`; inspect sync/export/resource consumers rather than inventing a second list. |
| Server | `till-api.ts:1408` canvas reads/response; `management-api.ts:365`, `:1291` canvas id/parser/CRUD/status mapping; profile parser/payloads at `:578`, `:1473`, `:1530` | Profile CRUD/copy, theme routes, hardware/session/zone/action checks and other boot settings stay. Remove obsolete canvas selection from seed/fixture code, including `provisioning/src/venue-apply.ts:561`, `server/src/testing/clear-provision-fixture.ts:41`. |
| Till | `CanvasDef`, `TabDef`, card types/required-capability map in `layout.ts`; canvas-dependent predicates in `till-app.ts`; `widgets/card-grid.ts`; old shell canvas interface | Direct fixed screen mounts and fixed navigation; counter widget/business state stays. Menu browser column selection follows the menu's own Device Home Page. |
| Dashboard | `screens/canvas-editor-screen.ts`, entire `screens/canvas-editor/`; app import/destination/nav/render at `dashboard-app.ts:82`, `:131`, `:276`, `:2501`; `navigation.ts:36`; Canvas client CRUD/types; profile picker/draft/error/search/read fields | Profile form keeps all other fields and save/unsaved behavior. Remove only canvas URL keys. Old editor URLs follow existing unknown-destination fallback; no redirect/compatibility alias. Verify default destination for each permitted role stays reachable. |
| Errors/text | `canvas.*`, `canvas_editor.*`, `nav.canvases`, profile canvas labels and `bad_canvas_ref` copies, including stale non-throwing messages | Keep `layout.configure`, device-profile, receipt and theme codes. Inspect registries, status maps, prefix matchers, alert declarations and both locales, not just throwers (`layouts/src/errors.ts:33`, dashboard `i18n/codes.ts:486`). |
| Guards/prose | Exact guard questions below; source scanners' path lists and retained test mirrors | Keep unrelated guard coverage. Implementation audit includes `apps/till/README.md:18`, `:126`; `docs/developers/design-system.md:2234`, `:2332`, `:3997`, `:4247`, `:4328`; `docs/developers/products.md:643`; `docs/ui-review.md:114`; live docs and all backlog paraphrases found by search. |

Historical migrations/snapshots keep canvas names because they describe earlier schemas. Historical
specs/plans get a dated pointer when their old behavior needs qualification; do not rewrite history.
Leave the frozen privileges matrix (`packages/fiscal-verifactu/src/privileges.expected.ts:25`)
unedited: its consumer documents it as an old grants record (`scripts/write-path-tables.test.ts:20`).
Also inventory `server/src/testing/fixtures/configuration-v1-before-printing-retirement.json`;
its name alone does not authorise editing it. If a protected fixture prevents delivery, surface it.
HTML drawing canvases, the off-canvas sidebar, floor-plan geometry and `wt-floor-plan-canvas` stay.

## Migration evidence you must obtain

The source-snapshot inventory found the following incoming keys. It is not a live database inventory.
Repeat with `sqlite_master` joined to `pragma_foreign_key_list` on the full migrated predecessor,
including disabled-module tables and triggers ON or reading either target.

| Target | Referencing table / column | Delete action in head snapshots |
| --- | --- | --- |
| `canvases` | `device_profiles.canvas_id` | RESTRICT |
| `device_profiles` | `devices.device_profile_id` | RESTRICT |
| `device_profiles` | `device_approved_profiles.device_profile_id`, `device_profile_printers.device_profile_id` | CASCADE |
| `device_profiles` | identity `device_profile_admission_persons.device_profile_id`, `device_profile_admission_roles.device_profile_id` | CASCADE |
| `device_profiles` | payments `device_profile_card_readers.device_profile_id` | CASCADE |
| `device_profiles` | venue-service `device_profile_service_access.device_profile_id`, `department_transfer_desks.receiving_profile_id`, `device_profile_kitchen_screens.device_profile_id` | CASCADE |

Source: `packages/db/drizzle/meta/0159_snapshot.json`, identity `0007_snapshot.json`, payments
`0007_snapshot.json`, venue-service `0054_snapshot.json` (`tables.*.foreignKeys`). Follow the
service-access and kitchen-screen children too. The form-factor-lock trigger must survive
(`packages/db/src/schema/devices.trigger.test.ts:9`; recreation in core `0124`).

Generate the final schema change and inspect its SQL before selecting the migration form.
Prefer removing the outgoing key/column before dropping `canvases`; test the generated candidate,
including any profile rebuild. Do not preselect a reset or invent backfill to avoid one.
`applyMigrations` removes change-feed triggers (`packages/migrations/src/apply.ts:65`), but a
profile rebuild can interact with inbound keys and other triggers. The repository's measured
rebuild hazards are in [conventions-data](../../developers/conventions-data.md)
and its migration sections; those receipts do not measure this candidate.

Use the product migrator for (a) a fresh full schema and (b) a disposable populated predecessor
with assigned/unassigned canvases, active/disabled devices, every inbound relationship, profile
retirement, working drafts/orders, kitchen notes, and unchanged fiscal records/chain heads.
Install the predecessor change feed before upgrade. Compare complete retained rows by value,
not counts alone; verify integrity, foreign keys, journal completion and form-factor refusal.
If upgrading refuses or loses retained rows, retain the exact command/output and decide the
pre-live reset delivery with the parent. Add no bespoke content migration or compatibility repair;
generated schema rebuilds may copy unchanged retained columns. State the measured
reset need in the eventual PR's FIRST line. Fresh success alone does not answer that question.

## Tests, review and guard decisions

Replace canvas-construction checks with fixed-screen assertions while preserving the business
assertions they hosted. For example, integrated-reader and cash rules currently tested in custom
sale tabs move onto fixed Counter and embedded Order, rather than disappearing with those tabs
(`apps/till/src/till-app.test.ts:2081`, `:2242`, `:2443`, `:8659`). Retain the counter geometry,
repeated-login, starting-screen, KDS, draft, money, note and Find bill assertions. The plan owns
the exact deletion/rehome inventory and five review-focus tests.

The following guard decisions govern implementation:

1. **Approved by the owner through the watcher, 2026-10-16 ~11:35:** remove only the retired
   canvas FK pin at `scripts/schema-constraints.test.ts:120` and canvas unique-index pin at
   `:362`. The exact entries are `["device_profiles", ["canvas_id"], "canvases"]` and
   `"canvases_tenant_name_key"`. Keep every other expected key, index and assertion unchanged;
   name both deletions under the PR's Changed test checks. Fresh-schema and populated-upgrade
   checks in this plan remain required. The answer is recorded in lane G's local questions ledger.
2. If the final populated upgrade experiment measures a refusal or lost retained rows, may the
   implementation add that EXACT migration tag and measured outcome to `RESETS` in
   `scripts/migration-upgrade.test.ts:351`? Recommended only if measured, matching its existing
   refusal/loss contract; a clean populated upgrade needs no new entry. This is a conditional
   owner question, not a prediction or blanket permission to weaken the upgrade walk.

Q1 is answered; do not ask it again. Q2 needs a specific answer only if its measured condition
arises. Do not silently edit other guards or call the implementation ready without its checks.
Any additional controversial check found on the new base is another question. The owner has already authorised autonomous implementation, finish and
land; generic skill approval pauses do not reopen the product scope.

Acceptance requires the normal push hook, scoped required CI on the exact PR head, and one
completed Claude run-it after initial rebase in an installed throwaway copy of the complete
candidate. Run protected huella/immutability checks UNEDITED. During later landing hold H11's
atomic `main.lock` for the entire land/main-update/install/cleanup, then verify H12's CI run names
the exact merge SHA. These are future implementation gates, not evidence from this authoring pass.
