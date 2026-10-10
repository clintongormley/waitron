# Departments and zones: implementation plan (A261 step 2)

> **2026-10-10, A366 slice 7 Part A:** Receipt previews now send authored department and
> venue drafts through POST. The GET preview, its query parameters and the client
> `previewReceipt` method below describe the earlier implementation. Follow
> [the slice 7 plan](2026-10-08-a366-slice-7-receipts-per-department.md) for the current
> preview and independent editing scopes.

> **2026-10-06, A261-2c:** The owner retired the invoice-first service style and the
> venue-wide `locations.order_flow` setting. Quick sales use the zone's `prepay` or
> `ticket_then_pay` policy; placement files no invoice. References below to
> invoice-first placement or preserving that legacy style describe the earlier design.


> **2026-10-04 approved amendment:** The owner approved this plan with the decisions below. The
> [devices, menus and service zones design](../specs/2026-10-04-devices-menus-and-service-zones-design.md)
> puts starting zones on profiles and menu membership on departments. Step 2 keeps today's
> zone-menu and device-default-zone controls working in a small section of the new screen;
> the later design replaces them. Task 8 and the Devices-editor move in Task 7 are outside this build.

> **2026-10-05 owner amendment:** The Departments and zones page always labels a department row
> with its own name, including when it is the only active department. The **Every zone** wording
> below records the earlier plan and is superseded for this page. Other screens retain their
> one-department behavior until their own work is approved.

> **Review:** On 2026-10-04 a fresh-context Claude read-only seat compared A261 §§4, 5, 11–12 and A254 §§2–3, 6 with the plan. Its six findings led to corrected receipt choices, an explicit `order_flow` retirement boundary, moved-bill coverage, removed-tab checks, stated defaults, and a proposed Devices home for the starting zone. A narrow read-only correction check followed; it identified an unscoped-sale snapshot, a missing switch-toggle test, the unassigned column cleanup, and the Floor-side setting handover. The later owner decision above defers the Devices move.

**Goal:** Replace the three-part Departments and zones screen with one editable tree table; give quick sales and receipts department defaults with optional zone overrides; print an enabled department trading name above the legal name and preview it from the table.

**Spec:** `docs/superpowers/specs/2026-10-03-venue-operations-design.md` §§4–5, 11 step 2, 12, with `docs/superpowers/specs/2026-10-03-departments-service-styles-hours-design.md` §§2–3, 6 where A261 has not revised it. Read both before implementation. A261 replaces A254's day types and places the receipt switch, trading name, and preview as in A261 §5.

**Architecture:** Add sale-policy tables to the venue-service migration set and replace live `order_flow` reads with one resolver for effective department and zone values. The existing four-value `service_mode` remains for tab paths while their billing choice is open. Snapshot the receipt trading name at issuance for stable reprints. The screen uses one `wt-data-table`, with inline controls and the existing core Receipts tab for preview.

**Tech:** TypeScript, Drizzle/SQLite, Hono, Lit, Vitest browser mode. Every task starts with a failing behavioral test, observes the expected failure, implements the smallest change, and reruns that focused test. Preserve existing behavioral assertions except for the single owner-approved change in decision 7; add new ones rather than rewriting other old expectations to follow implementation.

## Decisions for owner review

1. **Pending bill choice:** omit the **Tabs · Bill** control and any new tab billing path. Existing table tabs continue to invoice at payment. A254 §3.1 and Q14/Q21/Q27 must be answered before another bill mode is offered.
2. **Pending receipt advice:** offer A261's **Always**, **On request**, and **Never** choices per department and zone; provision `auto` (**Always**) as the default, with a blank zone override inheriting it. Q22 has no answer, so no screen or document may claim the latter two comply with delivery law; keep **Always** selected unless a manager deliberately changes it. If existing non-auto location settings must survive a particular pre-production venue, reset that venue as the repo permits; do not silently copy them into new defaults.
3. **Quick sales:** **Paid** offers **Before preparation** (`prepay`) and **On collection** (`ticket_then_pay`); `invoice_first` is not a new choice. Default to `prepay`, today's provisioned value. **Order number** controls a separate, non-fiscal customer collection ticket, not the stored `working_orders.order_number` used by staff. Default to **None**, because the current receipt code uses the internal number on fiscal paper but no separate collection-ticket path was found; **Numbered** requires an explicit choice. Internal numbers continue to be allocated.
4. **Trading name:** default *Print it* on. Print the department's trading name above the legal name only when one exists and differs from the legal name; otherwise print the legal name once. The one-department venue shows that department's settings in the **Every zone** row. Receipt preview uses its current values; an issued sale snapshots the name and enabled flag so a later rename cannot rewrite a reprint. For a mixed-line bill moved across departments, the receipt uses the bill's current department at issuance, which A254 says moves with its zone; the original lines keep their recorded departments for reporting.
5. **Scope of “move”:** remove the venue-wide receipt-mode control and retire its write route in this step. Retain the `locations.receipt_print_mode` column until step 8 audits/removes its remaining consumers; an unscoped sale uses literal `auto`. Retire every live `locations.order_flow` read in this step in favour of a resolved quick-sale policy or an explicit `prepay` fallback. Retain that inert schema column for the separately queued A261-2c migration, which audits a `locations` rebuild. The owner approved this boundary. The column has many runtime readers and `rg 'REFERENCES.*locations' packages/*/drizzle/*.sql` finds many incoming foreign keys, so a drop in this step carries table-rebuild risk. Do not remove or reinterpret stored order `service_mode` while tab billing remains open.
6. **Hours between steps:** the department row's Hours action opens today's department-hours editor. Step 5 replaces that action with a link to the new Hours page; this step must not create a dead destination.
7. **Existing refusal test:** The owner approved changing only the obsolete `department.has_active_zones` refusal assertion in `packages/venue-service/src/operations.test.ts` to the confirmed cascade; retain its checks that unrelated rows survive. Other existing behavioral assertions remain intact.
8. **Zone removal:** In one transaction, switch off its tables, remove zone-specific routing exceptions, drop it from watcher selections and clear device starting-zone defaults. Keep past orders and sales, `zone_menus`, and the zone's service policy. A removed zone's menus and policy become usable again when it is re-added. Refuse the entire change while a tab is open at one of its tables. Apply the same consequences to every zone removed with a department. Trace every other zone or department reference before implementation; if one is outside this decision, stop and ask the owner.
9. **Temporary controls:** Keep today's zone-menu assignment and device-default-zone controls working in a small section of the new Departments and zones screen. Do not implement Task 8 or move the starting-zone control to Devices in Task 7; the later devices and menus design owns both replacements.

## Open-question dependency check

| Open item | Does step 2 depend on it? | Boundary in this plan |
| --- | --- | --- |
| A254 §6.1: device department | No | Keep the device's default zone as its home; add no device department field. |
| A254 §6.2: counter-tab rounds, positions, party features | No for quick sales; yes for new counter tabs | Build no new counter-tab model or flow. |
| A254 §6.3 Q21, Q14, Q27: tab billing | Yes for the Bill cell | Omit that cell and billing policy; retain today's payment-time invoice. |
| A254 §6.3 Q22: on-request/never receipt delivery | No for storing A261's three choices; yes for a compliance claim | Offer all three; default to `auto` and make no legal claim about the others. |
| A254 §6.4: hide department on other screens | No for this table | Apply A261's one-department **Every zone** row here; do not change other screens before their survey. |
| A254 §6.5: conversion of existing service styles | No, under the pre-live reset rule | Generate new migration and reset development/demo venue data; retain legacy fields for current paths, with no inferred conversion. |
| A261 §12.1: A254's remaining open items | As above | A261's revised receipt placement and special dates win; no extra decision inferred. |
| A261 §12.2: uncategorised routing products | No | Step 4 routing grid owns it. |
| A261 §12.3: changing venue details after sales | No | Step 7 owns it. |

## Migration and shared-file map

- Add `department_sale_policies` (department FK, required `paid_when`, `collection_number`, `receipt_print_mode`, `print_trading_name`) and `zone_sale_policies` (zone FK, nullable override fields except no trading-name field) in `packages/venue-service/src/schema/service.ts`. Generate the next files under `packages/venue-service/drizzle/`; classify both as `state` in `src/classification.ts`, include them in `src/configuration-transfer.ts`, and seed the default policy in `src/provisioning.ts`. Add an append-only `sale_receipt_headers` snapshot table there, keyed by sale id, classified `ledger`, with `appendOnly()` and a `sales` FK. Its row stores a nullable department id for explicitly unscoped sales, the trading-name text, and the enabled flag, even when the text is empty. Do not put those values in the fiscal hash.
- **No existing table should rebuild.** These are new tables and an existing seed change. A generated `CREATE __new_*`, `DROP TABLE`, or `ALTER` of `departments`, `zone_service_policies`, `locations`, `sales`, or `working_orders` is a stop-and-redesign trigger. The inert `locations.order_flow` column is an owner-review cleanup decision, not a live policy source: `rg 'REFERENCES.*locations' packages/*/drizzle/*.sql` finds incoming keys across modules, so a core `locations` rebuild requires a separate plan. Current references into `departments` are `zone_service_policies`, `department_hours`, `order_service_contexts` and `working_line_contexts`; `zone_menus` points into `zone_service_policies` (`packages/venue-service/src/schema/service.ts:60-205`). `dining_tables` points into `floor_zones` (`packages/db/src/schema/dining-tables.ts:62`); the current change feed and append-only triggers also need reinstall checks on any rebuild. Never edit a shipped migration. Test a migrated existing database with populated department, zone, menu, table and sale rows, not just a fresh database; check foreign keys, row values and triggers afterward.
- The schema and APIs share `packages/venue-service/src/operations.ts`, `routes.ts`, `dashboard/client.ts`, `service.ts`, and `packages/module/src/module.ts`. The table owns `packages/venue-service/src/dashboard/venue-operations-screen.ts` and `strings.ts`; receipts own `apps/server/src/receipt-ticket.ts`, `receipt-print.ts`, `receipt-preview-api.ts`, `till-sale.ts`, `bill-payments.ts`, `apps/dashboard/src/screens/receipts-screen.ts`, and `apps/dashboard/src/api/client.ts`. The first-department name overlaps `packages/venue-service/src/provisioning.ts` and setup's location name.
- **Lane E A231/A231p:** A231 currently changes `packages/db/src/schema/tenants.ts`, `apps/server/src/setup-api.ts`, setup screens, and later its plan names `apps/server/src/receipt-ticket.ts`, `receipt-print.ts`, `till-sale.ts`, `bill-payments.ts`, and receipt readers. Re-read its landed head before editing; coordinate those exact files sequentially. Do not overwrite F1 layout, taxpayer domicile, or invoice-choice work. **Later lane D A261 steps:** step 3 touches this dashboard module's navigation and station settings; step 4 its zone/routing model and tree; step 5 `department_hours` and this page's Hours link; step 6 the calendar; step 7 location name/setup and Venue details; step 8 Printing rules, `locations.receipt_print_mode`, and receipt-print consumers. Keep each later step's work out of this PR. The later devices and menus design replaces the interim controls left on this screen.

## Tasks

### 1. Policy storage, reset seed, and migration

**Files:** `packages/venue-service/src/schema/service.ts`, `schema/schema-conformance.test.ts`, `src/operations.test.ts`, `src/provisioning.ts`, `src/provisioning.test.ts`, `src/classification.ts`, `src/configuration-transfer.ts`, generated `drizzle/0019_*.sql` and snapshot/journal, `scripts/migration-upgrade.test.ts` if its fixtures need the new table.

- [ ] Red: with a real `useVenueDb`, assert a newly provisioned department copies `locations.name` into both `name` and `trading_name`, has `paid_when=prepay`, no customer collection ticket, `receipt_print_mode=auto`, `print_trading_name=true`; the zone has null overrides. Assert a second department gets the same policy defaults and a saved override survives a zone move.
- [ ] Generate the new tables and seed, then run `pnpm --filter @waitron/venue-service test -- src/provisioning.test.ts src/operations.test.ts src/schema/schema-conformance.test.ts`. Inspect emitted SQL and migration upgrade on populated rows. Classify every new table; add the snapshot table's append-only trigger test.

### 2. Effective policy and precise writes

**Files:** `packages/venue-service/src/operations.ts`, `routes.ts`, `service.ts`, `dashboard/client.ts`, `errors.ts`, and `operations.test.ts`, `routes.test.ts`, `dashboard/client.test.ts`; `packages/module/src/module.ts` and `venue-service-slot.test.ts` for generic consumers.

- [ ] Red: department values are required and valid; a zone's omitted field retains its previous override while explicit `null` clears it; effective read inherits each field independently. A cross-venue or inactive parent fails with the domain code. A move to another department immediately changes only inherited values. Test HTTP read, write, permission refusal, invalid enum/type, and one transaction per write.
- [ ] Add separate field-specific write methods and routes; keep the existing `configureZone` and service-mode consumers until their call chain has been traced. Extend `GET /management-api/venue-service` with raw overrides and effective values and the module seat with a typed `resolveSalePolicy(tx, cfg, zoneId)` for sale paths. Run the three focused suites and `pnpm --filter @waitron/venue-service typecheck`.

### 3. Removal and zone moves

**Files:** `packages/venue-service/src/operations.ts`, `routes.ts`, `operations.test.ts`, `routes.test.ts`; `apps/server/src/tables.ts`, `management-api.ts`, `tables.test.ts`, `management-api.test.ts`.

- [ ] Red: removing the last active department refuses; removing another deactivates it and all its active zones in one transaction, retaining historical ids. The read for its confirmation lists zone names and active table counts. A zone or department removal refuses with the table's name while `party_tables.left_at IS NULL` belongs to an open party at that table, including a zone with several tables. A party at another zone and a closed party are negative controls. A failed cascade leaves every row active. For each removed zone, assert its tables become inactive, route exceptions are removed, watcher selections drop it and device starting-zone defaults clear; past orders and sales keep their values, while zone menus and service policy remain for reactivation. Moving a zone changes its department but leaves its tables and menus intact.
- [ ] Make the module operation own the whole cascade and use it from both delete routes, so floor-plan deletion cannot bypass the tab guard. Change only the owner-approved obsolete `department.has_active_zones` refusal assertion to expect the cascade; preserve unrelated behavioral assertions. Trace other zone and department references before implementation, and retire every registry, translation, and prefix consumer of the old error code. Run focused venue-service and server suites.

### 4. Quick-sale behavior and collection number

**Files:** `packages/venue-service/src/operations.ts`, `service.ts`, `operations.test.ts`; `apps/server/src/working-order.ts`, `till-api.ts`, `till-sale.ts`, `till-config.ts`, `boot.ts`, `move-bill.ts`, `configuration-transfer.ts`, and their focused tests, plus `kitchen-print.ts` if that is the existing ticket path; `apps/till/src/api/client.ts`, `till-app.ts`, `screens/till-counter-screen.ts`, `widgets/card-grid.ts` and focused till browser tests. Audit every `orderFlow`, `order_flow`, and `cfg.orderFlow` read before changing its meaning.

- [ ] Red in `apps/till/src/till-app-boot-and-counter.test.ts` and `till-app-table-service.test.ts`, alongside the named server suites: two zones under one department can pay at different times; a blank override follows a changed department default. `prepay` still files on payment; `ticket_then_pay` sends work at placement and files at collection; neither selects `invoice_first`. A receipt and the staff queue retain their internal order number even when customer collection ticket mode is **None**. **Numbered** emits one separate customer ticket at the correct moment, never a second fiscal record or drawer job; retry/replay emits no second ticket.
- [ ] Resolve pay timing from the selected zone at order creation and retain it in the existing order context. Replace live venue-wide `order_flow` fallbacks in server, till, boot, and configuration transfer with the resolved policy or an explicit `prepay` fallback for a truly unscoped path; keep historical placed-order `service_mode`. Add a non-fiscal collection-ticket job using the device's receipt printer and existing print-job conventions; never change the allocation of `working_orders.order_number`. Update till display of original-receipt availability from the effective receipt policy, not its boot-time location field. Run the focused server/till suites and a source search proving no live `locations.orderFlow` consumer remains. This is a risk trigger: no separate physical collection ticket was found in today's receipt path, so inspect a real printer preview before shipping.

### 5. Receipt selection and immutable trading-name snapshot

**Files:** `packages/venue-service/src/schema/service.ts`, `src/operations.ts`, `src/service.ts`; `apps/server/src/till-sale.ts`, `bill-payments.ts`, `move-bill.ts`, `receipt-print.ts`, `receipt-ticket.ts`, `receipt-order.ts`, plus their focused receipt, move-bill and sale tests; `apps/till/src/screens/till-ticket-view.ts` and its test for the matching on-screen issuer block.

- [ ] Red in `apps/server/src/receipt-ticket.test.ts`, `receipt-print.test.ts`, `move-bill.test.ts`, `till-api.receipt.test.ts`, `bill-payments-api.test.ts` and `apps/till/src/screens/till-ticket-view.test.ts`: a sale under a department with *Print it* on prints its distinct trading name first, then the legal name, owner header and NIF. An empty or equal trading name prints the legal name once; *Print it* off does likewise. A bill moved to another department **before** payment issues with the destination department's trading name and effective receipt mode, and the snapshot names that department. Include a bill whose lines retain two original departments: the current bill department at issuance supplies the receipt header, while each line retains its own department. A zone moved, department renamed, or *Print it* switch toggled **after** issuance cannot change a reprint; another department's receipt remains distinct. Auto printing follows the effective department/zone mode; explicit reprint remains available in every mode, files nothing, and opens no drawer. A replay returns original facts and queues no duplicate jobs. Include walk-up, collected, table/bill and card completion paths; an unknown zone refuses, while a sale explicitly made without a zone snapshots a null department id and uses the internal `auto` fallback.
- [ ] Write `sale_receipt_headers` in the same sale transaction after the sale id exists, through the venue-service seat, and read it on every original/reprint/copy path. Pass the snapshot into the pure formatter; keep fiscal inputs and hash unchanged. Preserve A231's F1/F2 document-specific layout if it has landed. Run `pnpm --filter @waitron/server test -- src/receipt-ticket.test.ts src/receipt-print.test.ts src/till-api.receipt.test.ts src/bill-payments-api.test.ts` and the relevant venue-service suite. Inspect sample paper at 58 and 80 mm.

### 6. Receipt preview and its destination

**Files:** `apps/server/src/receipt-preview-api.ts`, `receipt-preview-api.test.ts`; `apps/dashboard/src/api/client.ts`, `screens/receipts-screen.ts`, `screens/receipts-screen.test.ts`, `screens/receipts-screen.a11y.test.ts`, `screens/venue-settings-screen.ts`, `screens/venue-settings-screen.test.ts`; `packages/venue-service/src/dashboard/venue-operations-screen.ts` and its test.

- [ ] Red: `GET /management-api/receipt-preview?departmentId=<id>` draws that department's current trading name and switch without saving or filing; another venue's id and a malformed id are refused. **Preview for** appears only with two or more active departments, and changing it preserves the unsaved header/footer draft. A department Preview link opens `/manage/venue-settings/view/receipts` with that department selected; Back/Forward and an invalid or removed id recover to a valid selection. Keep the selected department in a URL parameter, not receipt trim.
- [ ] Extend preview and the core Receipts panel, add the table link, and revise the header-line hint to say it follows the legal name and the trading-name explanation to point back to Departments and zones. Test receipt-language and paper-width controls still work. Run focused server/dashboard/browser suites.

### 7. One editable tree table

**Files:** `packages/venue-service/src/dashboard/venue-operations-screen.ts`, `strings.ts`, `client.ts`, `live-queries.ts`, `venue-operations-screen.test.ts`, `venue-operations-screen.a11y.test.ts`; `packages/ui/src/components/wt-data-table.ts`, `wt-data-table.test.ts`, `wt-data-table.a11y.test.ts` only if row drag/drop needs a shared primitive extension; `apps/dashboard/src/screens/floor-screen.ts`, `floor-screen.test.ts` to remove zone creation/settings from the floor plan. Keep the existing zone-menu and device-default-zone controls available from the new screen.

- [ ] Red: one active department draws an **Every zone** settings row, two draw named department parents with nested zones. Group headers read **On the receipt**, **Quick sales**, **Every sale**; zone trading-name cells are empty. Clicking a name or settings cell edits that value in place; each zone dropdown has a blank first choice and an inherited grey value; department controls have no blank. New department and New zone sit at the top right. A zone dragged onto another department persists, with keyboard-accessible move control or equivalent. Each row menu is pinned `actions` at the end, with Rename/Remove and department Hours action opening today's editor. A zone readiness problem appears under its name. Keep today's zone-menu and device-default-zone controls working in a small section below the table; test their write, clear and fallback behavior. Before removing the old tab, identify and test both destinations A261 §2 names: Kitchen settings on Venue settings and the Floor-owned setting on Floor plan; if step 1 did not already move one, move that setting in this task. Inactive rows are retained but cannot be chosen for new orders. Removal shows names/counts before confirmation and a named table refusal beside the action. Test failed writes preserve the edit and successful writes refresh without resetting another draft.
- [ ] Reuse the existing form primitives and `wt-data-table` cell `part` styling. Remove only obsolete views and controls after all their consumers are traced; preserve today's menu and device-default-zone APIs. Add English and Spanish copy. Test light/dark themes, 40rem and phone width, keyboard drag alternative, focus, and axe. A table-control or drag change is a shared-UI risk trigger; run its browser tests and inspect sibling screens.

### 8. Deferred: move zone menu assignment to Menus

The later devices, menus and service zones design replaces today's zone-menu controls. This task is not part of A261-2. Keep the existing controls available from the new screen until that build lands.


### 9. Retire stale claims and validate the branch

**Files:** `apps/dashboard/src/screens/printing-rules-screen.ts` and its test, `docs/backlog.md`, `docs/developers/conventions-ui.md`, `docs/developers/conventions-data.md`, `docs/developers/design-system.md`, and every README/runbook found by a base-to-tip prose sweep.

- [ ] Red in `apps/dashboard/src/screens/printing-rules-screen.test.ts` and `apps/server/src/print-api.test.ts`: Printing rules has no editable venue receipt mode once the department setting is active; the retired write route refuses a call instead of silently overriding a department or zone. Test that receipts without a zone still print under the named literal `auto` fallback. Remove stale screen text and update A261 step 2 in backlog, including an owner-queued follow-up to drop the inert `locations.order_flow` column after a foreign-key and table-rebuild audit; leave historical specs with a dated pointer where needed. Audit prose over `git diff --name-only origin/main..HEAD` **and** repository-wide searches for old service-style/receipt/departments claims.
- [ ] Run focused package suites from tasks 1–7, migration/schema/append-only/upgrade guards (`scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`, `scripts/migrations-match-schema.test.ts`, `scripts/migration-upgrade.test.ts`), package typechecks, and the normal push hook during `finish-branch`. Check CI's selected packages and current-head coverage results before declaring ready. Open the dashboard page and receipt preview in both themes at desktop and phone width; inspect a real rendered 58/80 mm receipt and the one-department/two-department, inherited, error, and removal states. Do one whole-branch run-it review after the initial rebase because this branch changes sale and receipt production paths. Commit only with `git commit -s`.

## Review focus

- A zone move changes defaults but must not rewrite a sale's receipt or an open tab's recorded service context (Tasks 2, 3, 5).
- A department cascade must refuse an open party at any of its zones and roll back every proposed deactivation (Task 3).
- A missing or disabled module/zone at sale time must not choose a random department or stop a sale (Tasks 4, 5).
- The `auto` default must stay explicit across provisioning, receipt enqueue, reprint, and the till's original-receipt button while Q22 is open (Tasks 1, 4, 5, 9).
- A narrow receipt must retain legal issuer, NIF, QR, fiscal number and content after adding a trading name (Task 5).
