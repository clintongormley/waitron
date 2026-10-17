# A740: zones on a device implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement the tasks inline, as the owner selected. Read the approved brief and this plan together.

**Goal:** Give a till its own displayed zones and starting zone, with Counter/Floor navigation and menu memory matching the approved A740 brief.
**Architecture:** Store the device's zone selection in venue-service, bounded by its current profile. Derive navigation from the effective selection;
derive menu defaults and service-period identity on the server, retaining browsing choices per device and zone in the browser.
**Tech Stack:** TypeScript, Lit, shared `wt-*` controls and draft coordinator, Hono, Drizzle/SQLite, Vitest with real Chromium.
**Spec:** [A737–A740 introduction and A740](../../backlog/till.md#a737a740-the-counter-till-redesigned-owner-2026-10-15),
[backlog A740](../../backlog.md), [board 5](../../backlog/mockups/a737-a740-till-counter-redesign/5-zones-on-a-device.png). Read the 2026-10-16
addition: table-only Floor pills; List and ⋮ on the pills' row. Text wins over the board.
**Related contracts:** [W97](../specs/2026-10-04-devices-menus-and-service-zones-design.md),
[Fixed device screens](../../developers/design-system.md#fixed-device-screens). A740 supersedes W97's reset-on-zone-change menu rule and its
profile-only starting choice where specified below.
**Execution:** Inline driver execution using `superpowers:executing-plans`, selected by the owner's standing preference. Read the TDD skill before
writing implementation or tests. No agents are needed for these sequential tasks.
**Status:** Planning only. Source observations below are from `eb8726bcedb930577458200849ade0d383bc05d7`, read on 2026-10-16. The board was viewed.
No tests, migration generation, reset, or implementation were run for this plan.

2026-10-17 execution note: each selection zone also carries `departmentId` and `departmentName`. The till keeps
that complete permitted-zone metadata for transfer destinations, independently of the Counter/Floor display subset.
The database-backed `device-zone-selection.test.ts` case “retains every permitted zone's department metadata when
the display subset hides one” and the existing shell transfer-acceptance case exercise those two consumers.
Floor input is filtered in `TillApp` before the shared screen builds its tabs; the screen's existing non-seating
refusals and occupied-table recovery remain available to the other form factors.

## Implementation start gate

- [ ] Reorient from every lane's current queue, blockers, handoff and actual worktree, including committed **and dirty/untracked** changes. Use
      `git worktree list --porcelain`, then `git -C <actual-worktree> status --short`, `git -C <actual-worktree> log --oneline origin/main..HEAD`,
      `git -C <actual-worktree> diff origin/main...HEAD --name-only`, `git -C <actual-worktree> diff --name-only` and
      `git -C <actual-worktree> diff --cached --name-only`. Read untracked material before judging overlap. Resolve queue locations from the runner's
      current instructions; this plan is not campaign state.
- [ ] Verify B/A770 and F/A737's actual landing SHAs in refreshed `origin/main`, their current-head checks and remaining migration work. F/A737 is
      parked with a migration; **no second migrating implementation starts before it lands**. A764 retains priority after A737 and must finish or be
      explicitly parked before A740 takes the migration slot. Reconcile every migration queue; an idle runner is not permission to overlap migrations.
- [ ] Work around G/A668-5's reserved till code: independent Tasks 1–3 may proceed once the migration slot and A764 priority permit them. Before
      overlapping Tasks 4–6, wait for G's landing, then rebase the implementation worktree on its landed code and install dependencies. Re-read `till-app.ts`
      render/`#drillBody`, `widgets/till-shell.ts` `#items`, and counter render; G currently owns those overlapping edits. Do not start partial
      implementation there while waiting. Confirm fixed mounts remain, and account for any landed A738/A739 changes without implementing their other
      features.
- [ ] Re-trace this plan's interfaces after reorientation. Use the registered feature-worktree workflow for the eventual single product PR. Do not
      reserve a migration number: generate from the rebased schema only after the slot is clear. This planning item starts no reset or migration baseline.

## Global Constraints

- Deliver the whole implementation in **one product PR**. Keep A740 open during planning; remove its backlog entry only with completed implementation,
  retaining decisions in the area's decisions section.
- Implement only A740: Counter tab/list, table-only Floor/pills with same-row List/⋮, Settings → Zones on this device, starting zone, and
  period-scoped menu memory. No manual default-menu setting. No fiscal writer, numbering, hash, refund or payment-window redesign.
- Keep person permissions, profile admission, profile actions and profile zone checks. A display subset never grants a permission. Preserve existing
  order, held/waiting, transfer, floor, receipt and payment behavior outside the approved changes.
- Use shared fields, semantic names, localized EN/ES copy, declared `--wt-*` tokens, `draftScopeFor`/`saveActionState`, and the existing leave
  coordinator. Do not introduce a primitive unless an existing one cannot meet the contract.
- Before implementation read root `CLAUDE.md` and the relevant forms, device authorization, draft, migration, test and claims sections of
  `docs/developers/{conventions-ui,conventions-data,testing-guide,design-system,writing-claims,workflow-guide}.md`.
- Each task uses observed RED → minimal implementation → observed GREEN → `git commit -s`; tests below describe future experiments, not evidence
  already obtained. Read test counts and failure reasons. Keep existing behavioral assertions, changing expectations only where A740 supersedes them.
- Run focused tests locally. Use the normal push hook once and current-head package coverage/merge jobs in CI; do not add a whole-workspace local run
  just to finish. One Claude run-it whole-branch review during `finish-branch`, in its disposable checkout after initial rebase. Owner authorization
  for later finish/land is already supplied; this invocation only writes this document.

## Review Focus

1. **Forged or superseded scope:** a foreign device/profile/zone or an old settings snapshot cannot change this device's selection; legitimate
   restricted staff can still save a display preference. Tasks 1–2, 5.
2. **Narrowing and restoration:** hidden, inactive, removed or newly forbidden choices never escape current permission bounds; restoring permission
   restores retained choices without moving a live order/payment. Tasks 1–2, 4–6.
3. **Empty and mixed selections:** zero/one/many counters and table zones produce usable navigation, including closed zones and table zones without a
   saved plan. Tasks 1, 4–5.
4. **Period identity:** the same period/menu names or period id on different days, repeated runs, gaps, removed menus and stale responses cannot
   resurrect an expired manual choice. Tasks 3, 6.
5. **Real interaction and lifecycle:** dirty settings, lines in an order, sign-in/out, reload, payment in flight and real pointer clicks preserve
   context and recover from read/write failures. Tasks 2, 4–6.

## Traced source map and implementation choices

These are reading observations, not runtime verification. Recheck line positions after rebasing.

| Current path and receipt                                                                                                                       | Responsibility and planned seam                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/device-session.ts:109`, `:333`; `apps/server/src/till-session.ts:92`, `:146`                                                  | Device binding, in-transaction device recheck, signed-in session/person/action checks. Reuse them for settings.                                                                                                                                     |
| `apps/server/src/device-api.ts:290`, `:333`, `:343`                                                                                            | Device identity and device-read/session-write equipment pattern. Add zone-selection GET/PUT here.                                                                                                                                                   |
| `packages/venue-service/src/profile-access.ts:71`, `:237`                                                                                      | Effective active profile scope versus retained stored scope. New device selection intersects the effective scope without modifying it.                                                                                                              |
| `packages/venue-service/src/schema/service.ts:161`; `packages/db/src/schema/devices.ts:18`                                                     | Zone defaults are on profiles; the device declaration holds equipment but no zone subset/start. New domain tables belong to venue-service, avoiding a rebuild of `devices`.                                                                         |
| `apps/server/src/till-api.ts:1529`, `:1556`, `:1576`, `:2687`; `apps/server/src/zone-access.ts:47`, `:66`                                      | Default offers, explicit offers, menu poll and Floor metadata. Explicit reads use profile zone checks; Floor includes `hasPlan` and `serviceMode`.                                                                                                  |
| `apps/server/src/till-api.ts:287`, `:300`, `:1625`; `apps/server/src/working-order.ts:1230`, `:1406`                                           | New-order zone resolution and existing-order/table context. `apps/till/src/api/client.ts:2573`, `:2599`, `:2629`, `:2803` feed the current zone to writes. Preserve recorded order context rather than replacing it with a new starting preference. |
| `apps/till/src/till-app.ts:3717`, `:3757`, `:4180`, `:4361`                                                                                    | Login, in-memory `#browsing`, guarded Counter zone switch and menu updates. Replace the one-zone browsing model; keep stale-request/session checks.                                                                                                 |
| `apps/till/src/till-app.ts:6951`, `:7338`, `:11370`, `:12205`; `apps/server/src/device.ts:295`                                                 | Profile switch, Floor reads, fixed mounts and shell events. Existing profile switching blocks drafts in the UI and pending payments on the server.                                                                                                  |
| `apps/till/src/built-in-screens.ts:5`; `apps/till/src/widgets/till-shell.ts` (`#items`, `render`)                                              | Form-factor screen ceiling and header. Add scoped till navigation without changing handheld/KDS screen capabilities.                                                                                                                                |
| `apps/till/src/screens/till-counter-screen.ts:350`; `apps/till/src/screens/till-floor-screen.ts:1704`, `:1766`; `packages/ui/src/floor.ts:56`  | Remove Counter's dropdown/refresh control. Filter Floor's input before generic `buildZoneTabs`; move view/menu controls into its pills row.                                                                                                         |
| `packages/venue-service/src/operations.ts:843`, `:915`, `:977`, `:1485`; `packages/venue-service/src/menu-timetable.ts:373`, `:479`            | Department menu membership and live period/default resolution. Expose an occurrence key from this resolver, not a browser guess based on names.                                                                                                     |
| `packages/module/src/module.ts:323`; `packages/catalogue/src/menu-document-types.ts:386`; `apps/till/src/api/client.ts:418`                    | Three service wire descriptions to update together. Trace all `ZoneOffers`/`MenuState` literals before adding a required occurrence field.                                                                                                          |
| `packages/venue-service/src/classification.ts:7`; `packages/composition/src/modules.ts:136`; `packages/migrations/migrations.manifest.json:32` | State classification, core/catalogue dependencies and migration registration. New tables need classification, but introduce no new migration-set dependency or append-only entry.                                                                   |
| `packages/venue-service/src/service-delete-settings.ts:28`, `:375`; `:658` in `configuration-transfer.ts`                                      | Zone deletion's impact/cleanup and explicitly enumerated configuration exports. Include new zone references in deletion handling; omit device-specific choices from configuration transfer.                                                         |
| `apps/server/src/device-delete.ts:134`, `:201`; `packages/layouts/src/device-profile-store.ts:287`                                             | Device deletion removes settings but retains the device row. Profile deletion retires a held profile or hard-deletes an unheld one. Cover both lifecycles without adding a layouts-to-venue-service dependency.                                     |

**Storage choice (implementation choice).** Browser-only storage would avoid a schema change and retain choices on that origin, but it gives no
server-held device selection and can disappear when browser data is cleared. A durable selection fits “set once and rarely changed,” follows the
enrolled device across operators/restarts, and can be checked atomically against the current profile. Recommend durable selection. Under this choice a
migration **is required** to create the proposed tables; the declarations above provide no existing device-zone store. This is a schema observation,
not a migration experiment.

**Assumptions made executable:** any signed-in, admitted staff member may narrow this device's display, following the equipment-choice precedent
(`device-api.ts:342`); no new manager permission is invented. Starting zone means the fresh-order destination after sign-in, including the same
person's next sign-in; restoring an existing order/draft keeps its recorded zone first. Within-period menu memory belongs to device/zone, not person,
so it survives operator changes. These are implementation choices applying A740 and the board's “after sign-in” label, not additional owner decisions.

**Effective selection (implementation choice).** Store a selection per `(deviceId, profileId)`; no saved row means all currently allowed active
service zones and the profile's allowed start. With a saved row, intersect its selected ids with the current profile and active venue zones. Retain
temporarily forbidden/inactive ids in storage so restoration can restore the choice. If the saved start is ineffective, use the profile start if
selected, else the first effective zone in existing display order. If the intersection is empty but the profile still allows zones, temporarily show
its allowed starting zone (else its first allowed zone) with a settings notice; do not overwrite the saved choice. With no permitted zones show a
recoverable empty state and Settings, never the venue's unrestricted counter fallback. Explicit Save requires a nonempty selection and a starting zone
in it.

**Kinds and closure (implementation choice).** Counter zones are `prepay`/`ticket_then_pay`; Floor zones are `table_tab`. Keep closed allowed zones
visible, labelled closed; existing service checks decide ordering. A table zone without a saved plan stays usable in list view. One effective table
zone needs no pills; several get table-zone pills. There is one saved plan per zone (`packages/db/src/schema/floor-plans.ts:87`), so no additional
plan selector is needed. No counters means hide Counter and start on Floor; no zones means neither selling screen, with Settings/retry still
reachable. Handheld/KDS mounts retain their existing contracts.

**Persistence boundary (implementation choice).** Zone selection is venue `state`, meaningful on another node for the same enrolled device, like
`device_kitchen_screens` (`packages/venue-service/src/classification.ts:25`) and `devices` (`packages/db/src/classification.ts:85`), not node-owned
`local`. Browser menu memory is a best-effort cache keyed by API origin, device id, profile id and zone id. Assume the same browser origin for
restart retention; another origin or blocked/cleared storage starts at the server default. Store no credentials or order data there, and never use
cache contents as authorization.

## Task 1: durable bounded device selection

**Files:** create `packages/venue-service/src/schema/device-zone-selection.ts`, `packages/venue-service/src/device-zone-selection.ts`,
`packages/venue-service/src/device-zone-selection.test.ts`; modify `schema/index.ts`, `index.ts`, `service.ts`, `service.test.ts`,
`classification.ts`, `errors.ts` in that package. Extend its `service-delete-settings.ts` and `.test.ts`, `configuration-transfer.test.ts`, and
`scripts/schema-constraints.test.ts`. Also extend `apps/server/src/device-delete.ts`, `device-delete.db.test.ts`, `device-api.test.ts`,
`apps/dashboard/src/widgets/device-delete-copy.ts` and its tests, dashboard strings, and `screens/devices-screen.test.ts` for the removal impact.
Generate only new `packages/venue-service/drizzle/` artifacts after the start gate.

**Proposed interfaces:** export `DeviceZoneSelection` and `DeviceZoneSelectionInput` through `@waitron/module` (`packages/module/src/module.ts`,
`index.ts`). Response: `profileId: string`, `snapshot: string`,
`zones: readonly { id: string; name: string; serviceMode: "table_tab" | "prepay" | "ticket_then_pay" }[]` (all currently permitted choices),
`selectedZoneIds: readonly string[]`, `startingZoneId: string | null`, `adjusted: boolean`. Input: `profileId: string`, `snapshot: string`,
`selectedZoneIds: readonly string[]`, `startingZoneId: string`.
Expose `readDeviceZoneSelection(tx: Transaction, cfg: VenueScope, deviceId: string): Promise<DeviceZoneSelection>` and
`setDeviceZoneSelection(tx: Transaction, cfg: VenueScope, deviceId: string, input: DeviceZoneSelectionInput): Promise<DeviceZoneSelection>` through
the existing `VenueServiceContribution` interface (`packages/module/src/module.ts:579`) and `VENUE_SERVICE` object. Helpers read the device's actual
profile; they never accept a target device id from the body. In the module interface, spell `cfg` as `{ locationId: LocationId }`; do not import venue-service into module.
Also expose `countDeviceZoneSelections(tx: Transaction, deviceId: string): Promise<number>` and
`removeDeviceZoneSelections(tx: Transaction, deviceId: string): Promise<void>` through that contribution. Count saved profile selections for the
device, including a switched-away profile; removal deletes every parent and its children in the caller's transaction.

- [ ] **RED:** write “isolates device/profile selections and intersects current access,” “restores retained choices after profile narrowing,” and
      “refuses forged ids, empty subset and start outside subset.” Use `useVenueDb`, two devices, two profiles/departments, active/inactive zones and a
      no-department profile. Assert exact selected ids/start, unchanged profile rows, error codes/fields and no partial write. Add deletion cases and an
      export case proving device choices are absent. Run
      `pnpm --filter @waitron/venue-service exec vitest run src/device-zone-selection.test.ts src/service-delete-settings.test.ts src/configuration-transfer.test.ts`; observe missing behavior, not a broken fixture.
- [ ] **Lifecycle RED:** in `apps/server/src/device-api.test.ts`, save choices on P1, switch the device to P2, then call the real profile-delete
      route for unheld P1: assert success, P1's choices removed and P2's unchanged. A disabled device holding P1 causes retirement instead; retain its
      choices and the existing retirement assertions. In `device-delete.db.test.ts`, assert deletion impact names all saved selections, deletion
      removes them atomically, disable preserves them, and another device's selections stay unchanged. Run
      `pnpm --filter @waitron/server exec vitest run src/device-api.test.ts src/device-delete.db.test.ts` and observe the new failures before code.
- [ ] **Minimal code:** create `device_zone_selections` with composite primary key `(device_id, device_profile_id)` and nullable `starting_zone_id`,
      and `device_zone_selection_zones` with primary key `(device_id, device_profile_id, zone_id)`. Declare parent FKs to core devices/profiles and Floor
      zones, child composite FK to parent with cascade, and child zone FK. Use no-action FKs for the device and zone targets, but cascade the parent
      profile FK, matching `schema/kitchen-screens.ts:42`: an unheld profile's hard delete removes its saved choices; retirement retains them.
      This cascade adds an incoming reference that any future core profile-table rebuild must inventory before proceeding. Nullable stored start
      permits hard-deletion cleanup; the save operation requires a valid start. Replace a child set in one
      caller-owned transaction; no external table references child keys. After the queue gate, generate with
      `pnpm --filter @waitron/venue-service db:generate --name device_zone_selection`; accept the generated number, never reserve one.
- [ ] Classify both tables `state`; export schema and service methods. A stable canonical `snapshot` includes actual profile/department ids, resolved
      permitted zone summaries, profile start/capabilities and stored selection. Compare it in the write transaction so old profiles, scope changes and
      competing saves refuse `device_zones.changed` (409); malformed/invalid choices refuse `device_zones.invalid` with
      `field: "selectedZoneIds" | "startingZoneId" | "profileId" | "snapshot"` (400). Reject null/coerced inputs. Import the registry at throwing sites.
      Reads do not prune retained choices or mutate settings.
- [ ] Add new zone references to deletion impact and cleanup: delete selected-zone children and clear a deleted stored start before the zone goes,
      preserving other choices. Follow existing delete-impact wording and restore semantics; disable is not delete. Keep both tables outside
      `VENUE_SERVICE_CONFIGURATION_TRANSFER`; configuration imports do not transplant device identities. Core/catalogue dependencies already cover every
      new FK. Do not add an append-only declaration.
- [ ] Include `countDeviceZoneSelections` in device deletion impact as `zone_selections`, with singular/plural EN/ES dashboard copy. Call
      `removeDeviceZoneSelections` alongside `removeDeviceKitchenScreens` in the existing delete transaction, before tombstoning the device.
      Disable and profile switching retain choices. Test profile hard-delete cascades through the real route; do not make layouts import venue-service.
- [ ] **GREEN:** rerun the RED command, then
      `pnpm --filter @waitron/venue-service exec vitest run src/schema/schema-conformance.test.ts src/migrations.test.ts src/service.test.ts`. Pin new FK
      entries in the root schema guard and run
      `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/module-graph-honesty.test.ts scripts/two-file-foreign-keys.test.ts scripts/id-columns-are-references.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts`. Add real offending-FK and duplicate-composite-key insert cases; schema checks alone do not establish enforcement.
- [ ] **Lifecycle GREEN:** rerun the lifecycle RED command, then
      `pnpm --filter @waitron/dashboard exec vitest run src/widgets/device-delete-copy.test.ts src/screens/devices-screen.test.ts`.
- [ ] **Signed-off commit:** stage only Task 1 files and generated migration artifacts;
      `git commit -s -m "feat(venue-service): retain device zone selections within profile scope"`.

**Migration/reset expectations:** the selected additive two-table schema requires one new venue-service migration, no backfill or compatibility
reader, no root/core migration and no operator reset. Verify fresh migration and upgrade from current main with populated device/profile/zone fixtures
retaining their rows. Existing installations with no selection row use the runtime default; that is not a data migration. Do not edit shipped SQL,
snapshots or journals by hand. If reorientation reveals a table rebuild or altered shipped migration is necessary, stop that approach and
redesign/regenerate; a reset-dependent alternative would need an explicit updated plan/PR first line and queue coordination. Do not initiate one here.

## Task 2: session-bound settings API and safe startup reads

**Files:** modify `apps/server/src/device-api.ts`, `till-api.ts`; create `apps/server/src/device-zones-api.test.ts`; extend
`till-api.profile-actions.test.ts`, `till-api.profile-zones.test.ts`. Modify `apps/till/src/api/client.ts`, `client.test.ts` and `i18n/codes.ts`.
Use Task 1's module types and functions, not direct cross-package schema access.

**Proposed routes/client:** `GET /api/device/zones` and `PUT /api/device/zones` return `DeviceZoneSelection`; both require the existing signed-in
device session (GET uses `requireSession`'s `passive: true`). Add `TillApi.getDeviceZones(options: ReadOptions = {}): Promise<DeviceZoneSelection>`
and `setDeviceZones(input: DeviceZoneSelectionInput, options: ReadOptions = {}): Promise<DeviceZoneSelection>` to the class at
`apps/till/src/api/client.ts:2279`. These are display settings, so no selling action is required; existing selling routes still enforce their
original person/action/zone requirements.

- [ ] **RED:** write “refuses foreign/superseded selection without writing,” “rechecks session, device and profile after waiting for the transaction,”
      “refuses a selection write during payment,” and “serves a legitimate admitted viewer's settings without granting ordering.” Pause a request before
      its write; end the session, disable the device, switch/narrow its profile, or save another snapshot. Assert 401/403/409 as appropriate, exact domain
      code, no new settings/payment/order rows, and an allowed control. Run
      `pnpm --filter @waitron/server exec vitest run src/device-zones-api.test.ts src/till-api.profile-zones.test.ts src/till-api.profile-actions.test.ts`
      and observe RED.
- [ ] **Minimal code:** parse UUID arrays/strings without coercion; identity comes from `requireSession`. Inside one write transaction call
      `assertStillSignedIn`, re-read the binding with `assertDeviceStillProven`, check actual current profile/snapshot through Task 1 and
      `assertNoPaymentInProgress`, then write. Never trust a body device id, busy flag or cached scope. GET also checks current identity/scope inside its
      read transaction. Map `device_zones.changed`/`invalid` and existing payment/session errors, add EN/ES messages in `apps/till/src/i18n/codes.ts` and
      module/server registry reachability as applicable.
- [ ] Keep explicit zone offers, Floor reads and existing-order routes checked against the **profile**, not the presentation subset; a hidden zone
      does not rewrite permission or a recorded order. Make `/api/default-service-zone/offers` choose the first effective **counter** from Task 1,
      preferring the selected start only if it is a counter. With no counter return the existing no-service-zone refusal; the app must obtain settings
      first and skip that read for Floor-only operation. Never load a table zone into a fresh Counter order. Keep `newOrderZoneIn`/existing-order pricing
      contracts; new Counter writes carry the explicitly selected counter id.
- [ ] Update both route maps with GET/PUT authentication, no-selling-action rationale and snapshot/current-profile subset checks, naming the refusing
      and allowed cases. Extend client tests for method/body/passive reads and refusal propagation. Add a test that forged explicit offers/new-order
      writes outside the profile remain refused while a permitted hidden zone's existing order remains governed by the original profile checks.
- [ ] **GREEN:** rerun the RED command and `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/i18n/codes.test.ts`; run
      `pnpm exec vitest run scripts/errors-reachable.test.ts`. For each new gate, build an installed disposable candidate containing the complete
      implementation, delete the check there and observe the named refusal test fail. Restore it there and rerun GREEN; preserve the legitimate
      controls. Remove only that owned candidate afterwards. Never mutate the feature worktree for these experiments.
- [ ] **Signed-off commit:** `git commit -s -m "feat(server): validate device zone preferences against live session scope"` after staging Task 2 paths
      only.

## Task 3: authoritative service-period occurrence

**Files:** modify `packages/venue-service/src/menu-timetable.ts`, `menu-timetable-types.ts`, `operations.ts`, `menu-timetable.test.ts`,
`operations.test.ts`; `packages/module/src/module.ts`; `packages/catalogue/src/menu-document-types.ts`; `apps/till/src/api/client.ts`. Extend
service fixtures/literals found by tracing `DepartmentService`, `ZoneMenuState`, `MenuState`, `ZoneOffers` and `ZoneOfferCatalogue` across all
packages/apps, including `apps/till/src/till-app-menu-timetable.test.ts`.

**Proposed interface:** add required `periodOccurrenceKey: string | null` to `DepartmentService` and the common `service` wire body in offers/menu
state. It is a canonical tuple encoding of department id, venue business day, period id and running range start, computed beside `rangeInForce` in
`resolveDepartmentService`. Repeated periods on different days/ranges differ; changing a keep-open end does not change the key.
Closed/gap/unreadable-clock/no-period answers carry null. It is not a new user setting or a database column.

- [ ] **RED:** write “distinguishes repeated service-period occurrences while sharing a key between offers and polls.” Use a fixed venue clock/time
      zone, two zones in a department, the same period id on consecutive business days and in separate runs, overnight service, a special-day plan, no
      active period and a keep-open extension. Assert key equality/difference, authoritative default id, null cases, and unchanged existing menu
      eligibility assertions. Run `pnpm --filter @waitron/venue-service exec vitest run src/menu-timetable.test.ts src/operations.test.ts` and observe the
      missing-key failure.
- [ ] **Minimal code:** compute the key from the same resolved running range/clock that determines `customerMenuId`; project it through
      `zoneServiceState`, both operations answers and all three wire descriptions. Respect `withDefault: false` pricing reads with a null key, without
      adding clock work there. Do not infer a period from its translated name, selected menu id, client wall clock or `keepOpen.endsAt`. Keep
      `resolveDefaultMenu`/`servedDefault` as the default authority.
- [ ] **GREEN:** rerun the RED command and
      `pnpm --filter @waitron/till exec vitest run src/till-app-menu-timetable.test.ts src/state/menu-state-poll.test.ts`; run package type checks for
      the three changed contracts:
      `pnpm --filter @waitron/module --filter @waitron/catalogue --filter @waitron/venue-service --filter @waitron/till --filter @waitron/server typecheck`. Repair every affected literal/consumer rather than making the field optional to conceal gaps.
- [ ] **Signed-off commit:** `git commit -s -m "feat(venue-service): identify each running menu period occurrence"` with only Task 3 paths staged.

## Task 4: Counter and Floor navigation from effective zones

**Files:** modify `apps/till/src/till-app.ts`, `widgets/till-shell.ts`, `screens/till-counter-screen.ts`, `screens/till-floor-screen.ts`,
`i18n/strings.ts`; extend `widgets/till-shell.test.ts`, `screens/till-counter-screen.fixed.test.ts`, `screens/till-floor-screen.zone-menu.test.ts`. Create `apps/till/src/till-app-device-zones.test.ts`. Preserve `built-in-screens.ts` as the form-factor ceiling; add scoped resolution in a new
`apps/till/src/state/device-zones.ts` with `device-zones.test.ts`.

**Proposed interfaces:**
`deviceZoneNavigation(formFactor: FormFactor, selection: DeviceZoneSelection): { counterZoneIds: readonly string[]; floorZoneIds: readonly string[]; startingZoneId: string | null; home: "counter" | "floor" | null }`
in the new state module. Add shell properties `counterZones: readonly { id: string; name: string }[]`, `selectedCounterZoneId: string`,
`showCounter: boolean`, `showFloor: boolean`; emit `counter-zone-selected` with `{ zoneId: string }`. Defaults preserve non-till callers. Add Floor
`selectedZoneId: string | undefined` for the starting-zone mount, while retaining its current internal zone navigation and URL guard.

- [ ] **RED:** in the new app suite write “renders zero/one/many counter zones and only selected table zones,” “starts a table-only device on Floor,”
      “hides single-plan pills but keeps List and menu,” and “refuses Counter switching with lines or a pending action.” Include stale URL/removed active
      zone, a closed selected zone, one table zone with no plan, two plans plus a counter, no permitted zones and unrelated handheld/KDS controls. Assert
      mounted screen, offers-call zone, no unrestricted fallback and no wrong-zone order writes. Run
      `pnpm --filter @waitron/till exec vitest run src/till-app-device-zones.test.ts src/state/device-zones.test.ts src/widgets/till-shell.test.ts src/screens/till-floor-screen.zone-menu.test.ts src/screens/till-counter-screen.fixed.test.ts`; observe RED.
- [ ] **Minimal code:** load Task 2 selection before choosing offers/home. Keep the profile's full metadata separately from selected Counter/Floor
      inputs, so transfer/order pickers retain their existing scope. With one counter draw plain Counter; with several show “Counter: {zone} ▾” and a
      checked list using shared popover/button behavior. Route selection through the existing line guard and request/session generation checks, rechecking
      lines after awaits. Remove the in-screen zone dropdown/refresh and its unused handlers/imports; polling remains.
- [ ] Filter Floor tabs and visible tables by selected `table_tab` ids **before** `buildZoneTabs`, retaining closed labels, no-plan list fallback,
      floor revisions, map/reset/drag actions and refusals. Hide pills with one table zone; keep view toggle and ⋮ together at the trailing edge of that
      same toolbar (also when pills are absent). Give the pill strip horizontal overflow at 390px, without pushing List/⋮ outside the viewport. Do not
      change generic `packages/ui/src/floor.ts` semantics.
- [ ] Resolve every direct URL/history/screen-select/mount against effective till navigation as well as the form-factor ceiling. No permitted zones
      gives an announced explanation, Settings and retry. Do not remap a live basket/table draft merely because home changes. Current Counter-zone change
      with lines remains a refusal, not a discard-and-switch shortcut; other navigation keeps its existing leave guard.
- [ ] **GREEN:** rerun the RED command, then
      `pnpm --filter @waitron/till exec vitest run src/till-app-boot-and-counter.test.ts src/screens/device-screens.phone-margin.test.ts`. Use
      `userEvent.click` on the visible Counter trigger, row, Floor pill, List and ⋮; assert one selection, menu close and the resulting content. Await
      native close events instead of sleeping.
- [ ] **Signed-off commit:** `git commit -s -m "feat(till): navigate selected counter and table zones"` after staging Task 4 paths only.

## Task 5: Settings → Zones on this device

**Files:** create `apps/till/src/widgets/device-zones-dialog.ts`, `device-zones-dialog.test.ts`, `device-zones-dialog.unsaved.test.ts`,
`device-zones-dialog.a11y.test.ts`; modify `till-app.ts`, `widgets/till-shell.ts`, `i18n/strings.ts`, `i18n/codes.ts`, and the Task 4 app suite.
Reuse patterns from `widgets/invoice-email-dialog.ts:68`, `attendance-correction-dialog.ts:143` and the shell's existing Equipment/Profile events.

**Proposed component:** `till-device-zones-dialog` accepts `open: boolean`, `selection: DeviceZoneSelection | null`, `busy: boolean` and a
field-aware refusal; emits `save-device-zones` with `DeviceZoneSelectionInput` and `close-device-zones`. The app owns reads/writes and opening
generations. The dialog owns a detached draft, canonical set comparison and one stable close guard. No menu/default-menu field exists.

- [ ] **RED:** write “saves a subset and a selected starting zone,” “cannot open first in a hidden zone,” “unchanged Save sends nothing,” “keeps edits
      through read/write refusal,” and “saved selection closes before a failed refresh.” Cover Cancel/Escape/back/locale navigation Keep/Discard, security
      teardown, disconnect/reopen and late responses from the prior opening. Assert exact body and no write after cancellation. Run
      `pnpm --filter @waitron/till exec vitest run src/widgets/device-zones-dialog.test.ts src/widgets/device-zones-dialog.unsaved.test.ts src/till-app-device-zones.test.ts`
      and observe RED.
- [ ] **Minimal code:** add Settings under ☰ with Equipment and Zones on this device, preserving other landed shell actions. Render profile-permitted
      rows with Show, Zone, Kind and Opens first; use labelled native checkbox/radio controls with semantic names and accessible group labels, following
      `packages/venue-service/src/dashboard/paint-grid-parts.ts:449` and `opening-hours-screen.ts:468`. The shared text-field rule does not prohibit
      these controls. A hidden row's start control is disabled. Unchecking the starting row clears the draft start and requires an explicit replacement.
      Start is required and subset cannot be empty. Explain adjusted/no-permitted states; allow retry/cancel when no selection can be saved.
- [ ] Register `draftScopeFor` with set-value equality; `saveActionState` keeps unchanged Save quiet/disabled and the handler returns early. Validate
      on attempted save then on edits, mark each bad field/group and put one localized correction sentence above the buttons. A server/network refusal
      alone never disables retry. Commit the submitted snapshot immediately after successful PUT, close, then refresh independently. Read recovery clears
      only its own error and never overwrites a dirty draft or action refusal.
- [ ] Guard Save before requesting and before applying its response: removing a zone holding current lines is refused until that order is
      held/sent/cancelled through existing paths; changing only the future start does not move it. Pending payment blocks settings writes on the server
      too. If a draft appears while a save is out, keep the current order context and defer navigation reconciliation; never clear/reprice lines. A live
      scope change invalidates the submit snapshot and marks newly invalid fields without silently replacing the typed choices.
- [ ] **GREEN:** rerun the RED command and
      `pnpm --filter @waitron/till exec vitest run src/widgets/device-zones-dialog.a11y.test.ts src/i18n/strings.test.ts src/i18n/codes.test.ts`; run
      `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/errors-reachable.test.ts`. Check axe in both
      themes for loaded, dirty, invalid, loading/refusal and no-zone states. Use actual pointer/keyboard dismissal and inspect native control state.
- [ ] **Signed-off commit:** `git commit -s -m "feat(till): configure zones and starting zone on this device"` with only Task 5 paths staged.

## Task 6: period-scoped menu memory, live reconciliation and acceptance

**Files:** create `apps/till/src/state/zone-menu-memory.ts`, `zone-menu-memory.test.ts`; extend `till-app.ts`, `state/menu-state-poll.ts` and
`.test.ts`, `till-app-menu-timetable.test.ts`, `till-app-menu-refresh.test.ts`, `till-app-device-zones.test.ts`, `till-app.test.ts`. Update
`docs/developers/design-system.md` Fixed device screens and affected prose/backlog decisions in `docs/backlog/till.md`/`docs/backlog.md` only when
implementation is accepted, preserving other lanes' material.

**Proposed memory interface:** define `ZoneMenuIdentity = { origin: string; deviceId: string; profileId: string; zoneId: string }`. `ZoneMenuMemory`
accepts a storage adapter (`Pick<Storage, "getItem" | "setItem" | "removeItem"> | null`);
`remember(identity: ZoneMenuIdentity, occurrenceKey: string, menuId: string): void`;
`resolve(identity: ZoneMenuIdentity, occurrenceKey: string | null, menus: readonly TillZoneMenu[], defaultMenuId: string | null): string`. Resolve
returns a still-orderable remembered menu only for the exact occurrence; otherwise the server default if orderable, otherwise `""` (no implicit
first-menu default). Null/changed occurrence removes old memory. Catch storage/parse failures and retain an in-memory fallback. Bound storage to one
entry per zone identity.

- [ ] **RED:** write “remembers Drinks independently in each zone until the next occurrence,” “new day with the same Lunch id resets to Lunch,” and
      “removed menu/null default cannot restore a forbidden choice.” Include equal period names/default ids across boundaries, two runs in a day,
      overnight day cutover, special-date timetable, closed gap, reopened service, inactive/unpublished menus and blocked/malformed storage. Assert actual
      selected products/menu, not only a cache value. Run
      `pnpm --filter @waitron/till exec vitest run src/state/zone-menu-memory.test.ts src/till-app-menu-timetable.test.ts src/till-app-device-zones.test.ts`
      and observe RED.
- [ ] **Minimal code:** replace the single `#browsing` and write-only `waitron.lastMenu` use after tracing all consumers. Apply one memory resolver to
      login, Counter zone return, table-zone offers, menu selection and both poll/reload paths. Every fresh-order sign-in uses the device's starting zone;
      restoring a live order/draft keeps that order's zone. Valid menu memory is independent of who signs in. Switching screens keeps its menu; switching
      zones restores the destination's choice only within its occurrence. A service boundary invalidates manual memory even when the default id/name did
      not change.
- [ ] Defer a boundary's grid/default change while the affected basket/draft has lines or a request/payment is in flight; use the fresh default at the
      next safe new-order point. Keep existing live availability/sendability marking and explicit refresh-review rules: neither remembered menu nor a
      boundary reprices recorded lines. If a chosen menu disappears, show the existing unavailable/review state and prevent new invalid picks; do not
      fabricate an alternate default when the server returns null.
- [ ] Reuse `MenuStatePoll.onTick` for an abortable, single-in-flight passive `getDeviceZones` refresh while signed in (including Floor-only/no-zone
      state); stop/invalidate it on logout, device/server change and disconnect. Refresh settings on open too. Compare snapshots and re-read profile setup
      when profile/capabilities change. Guard application by device/profile/session/opening generation and own-save generation; old reads never undo a
      save. Retain drafts and payment identity on narrowing, block new forbidden work, expose the existing refusal/recovery path, and reconcile navigation
      only when safe. Profile restoration re-enables retained valid choices. Do not restart/cancel/retarget a provider attempt as a polling side effect.
- [ ] Add integration cases “sign-out/sign-in and browser restart keep device settings and period menu memory,” “another operator shares this device's
      memory but another device/profile cannot inherit it,” and “live narrowing while paying/with a draft preserves identity.” Verify same/different
      operator, profile switch away/back, refresh, denied history URL, delayed old offers/settings responses, full versus empty profile scope, failed
      refresh recovery, successful write then read failure, payment retry/outcome tied to its original order, and existing draft hold/send/cancel
      recovery. Server refusal cases must assert unchanged rows and exact codes; browser assertions must inspect lines, zone ids and no unintended
      payment/write calls.
- [ ] **GREEN:** rerun the RED command, then
      `pnpm --filter @waitron/till exec vitest run src/till-app-menu-refresh.test.ts src/state/menu-state-poll.test.ts src/till-app.test.ts` and
      `pnpm --filter @waitron/server exec vitest run src/device-zones-api.test.ts src/till-api.profile-zones.test.ts src/till-api.profile-actions.test.ts src/till-api.drafts.test.ts`. Keep A767 and landed A737/A739 assertions intact. Before trusting a new refusal assertion, create an installed disposable candidate containing the complete implementation. Delete its gate
      there, observe the intended failure, restore it there and rerun its focused case. Keep the
      feature worktree unchanged and remove the owned candidate afterwards.
- [ ] **Visual acceptance:** open the running registered stack with `wa-wt demo <implementation-worktree-name>`. Look at EN/ES × light/dark ×
      390/1280 for one/many counters, one/many table zones, Floor list/map, no zones, settings dirty/errors and menus at a simulated period boundary.
      Record screenshots and observations. Use real pointer clicks on Counter's popover and Floor controls; check first paint, selected mark, close,
      focus, same-row geometry and no clipped actions. Do not count a string assertion or API response as a rendered-screen check.
- [ ] **Signed-off commit:** `git commit -s -m "feat(till): retain zone menus within each service period"` after staging only Task 6 changes and
      accepted documentation updates. Run remaining acceptance checks before claiming readiness, then use `finish-branch` for the single product PR.

## Acceptance checklist and queue dependencies

- [ ] All six task RED/GREEN receipts name commands, observed test counts and discriminating assertions; the full affected package coverage jobs pass
      on the PR's current head. Root schema guards supplement real writes, not replace them. No ignored-path Prettier result is presented as docs
      verification.
- [ ] Check the generated migration is additive and contains only the new tables/indexes/constraints. Run
      `pnpm exec vitest run scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts`; confirm no existing table rebuild or changed shipped SQL. Since Task 2 touches sale-route-adjacent `apps/server/src/till-api.ts`, run
      **unedited**
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
      The supplementary amount cases are
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/sale-amount.huella.test.ts src/correction-amount.huella.test.ts src/money-conversion.huella.test.ts`.
      Any later core/order-pricing/fiscal-adjacent change or migration regeneration repeats the relevant integrity cases; never weaken their fixtures or
      golden values to make A740 pass.
- [ ] Counter/Floor controls match the text and viewed board, including no in-screen zone dropdown, no manual default menu, no Counter in Floor pills,
      and List/⋮ sharing the toolbar. All five Review Focus cases have the mapped tests and allowed controls.
- [ ] Device/profile permissions and existing-order zones remain authoritative; no draft/payment is silently moved or cleared. Closed/empty scope and
      restored access recover without an unrestricted fallback. Settings and menu memory meet the stated sign-in/restart boundaries.
- [ ] Audit prose across the entire base-to-tip range and grep siblings for old zone/menu claims. Add a dated A740 supersession pointer to historical
      W97 prose rather than rewriting the historical decision. Update current Fixed device screens and only remove A740 backlog work when actually
      complete; leave A738/A739 and other lanes' residuals alone.
- [ ] Announce readiness to run `finish-branch`, or continue it if already authorized/underway. Run the normal hook, one completed Claude run-it
      review, resolve findings/conversations and wait for current-head CI coverage. Land under the existing autonomous authorization only after those
      gates; preserve migration queue ownership until landing and then report the slot's actual state to the runner.

**Remaining dependencies:** B/A770 landing and actual schema outcome; F/A737 landing before any second migrating implementation; coordination with
queued A764, which retains priority after A737, and every other migration producer; G/A668-5 landing/rebase before overlapping till edits, with
independent work allowed after the migration slot clears. Queue facts must be refreshed at execution
time. No migration number or reset baseline is reserved by this plan. No unresolved material product decision remains; the storage, fallback,
authorization and lifecycle assumptions above are labelled implementation choices.
