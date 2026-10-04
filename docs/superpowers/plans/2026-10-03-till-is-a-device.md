# A till is a device (A238) — Implementation Plan

> **2026-10-04 follow-up:** the [devices, menus and service zones design](../specs/2026-10-04-devices-menus-and-service-zones-design.md)
> records independent drawer selection and expanded profile/device choices as subsequent work.
> Its written spec awaits review; do not read this historical plan as that follow-up implementation.

> 2026-10-04: W57 added `operator_script` to the shared and sale source lists. The lists below record
> the earlier A238 plan.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the "till record" (`tills` table, the setup till, `WAITRON_TILL_TILL_ID`) so that a till is just a paired device: every record names a **source** and, for `device`, the **device**; the device's profile decides whether it takes cash and opens the drawer and lists the printers it may use; the device holds its current receipt and payment slip printers and can switch them mid-service.

**Architecture:** The work runs in an order where every task leaves the branch green. First the new pieces that do not touch the till: the source vocabulary and a shared test helper (Task 1), Takes cash (Task 2), profile printer lists (Tasks 3–4). Then the request learns its device from the sign-in session (Task 5). Then, one group of tables at a time, the till column is replaced: money records first gain `source` and `device_id` beside `till_id` (Task 6), printing follows the device (Tasks 7–8), alerts switch (Task 9), money records lose `till_id` (Task 10), orders (Task 11), then order history, working time, drawer openings and the trusted clock (Task 12). Last, the setup till and the default till go (Task 13), pairing stops creating tills and the `tills` table is dropped (Task 14), and the docs follow (Task 15).

**Tech Stack:** TypeScript 7 (packages), Hono (server), drizzle-orm 0.45 + `node:sqlite` with drizzle-kit migrations, Lit 3 web components, Vitest 4 (real headless Chromium for the front ends), axe-core.

**Spec:** `docs/superpowers/specs/2026-10-03-till-is-a-device-design.md` — read it in full before Task 1. Every task argues from it; section numbers below (§N) are the spec's.

**How the tests in this plan are written.** New units (the source vocabulary, the test helper, the printer-list store, the hashes) carry their test code in full. Route and screen tests are specified as cases: the suite file, the setup in that suite's own fixture style, the action, and the exact assertion. A case is not done until it was run, seen failing for the reason stated, and then seen passing.

## Global Constraints

- **The PR's first line reads:** `Needs a venue reset: every venue, the owner's box included, is wiped and set up again (A238).` (spec §2.9, §9; CLAUDE.md §3 "Editing a shipped migration…" does not apply because no shipped file is edited, but the hashes and columns change).
- **No shipped migration file is edited.** Every schema change is a NEW migration in its set (spec §9). Follow "How to change a table's columns" below for every rebuild.
- **No data carried across.** No backfill, no compatibility code (CLAUDE.md §3 "No backwards-compatibility…").
- **The sources are exactly** `device`, `dashboard`, `fiscal_filing`, `payment_check`, `kitchen_timer`, `demo_seed`, `readiness_test` (spec §3). A new background writer found during the work gets its own named source added to the list, never a generic `system`; say so in the task's commit.
- **Sale tables** (`sales`, `registros_facturacion`, `bill_payments`, `bill_payment_refunds`, `payments`) accept only `device`, `demo_seed`, `readiness_test` (spec §3).
- **`sessions`** carries `device_id` NOT NULL with a foreign key to `devices`, and no `source` (spec §3).
- **The database pairs them:** every table with a `source` has a CHECK that `source` is in its list and a CHECK that `device_id` is not null exactly when `source = 'device'` (spec §3).
- **Capability flag:** `take-cash`, added to `CAPABILITY_FLAGS` (`packages/layouts/src/canvas.ts`) and to the Till profile's defaults only (spec §4).
- **Error codes:** add `device.cash_not_allowed` and rename `device.register_name_taken` to `device.name_taken`; delete `device.register_required`, `device.till_required` and `drawer.till_switched_off`; `device.binding_invalid`'s `field` becomes `"receiptPrinterId" | "paymentSlipPrinterId" | "deviceProfileId"` (spec §3, §4, §7). Every copy in the tree moves in the same change (CLAUDE.md §3, error codes). Every new code a screen can show has English and Spanish wording.
- **The Veri\*Factu huella is untouched.** `packages/fiscal-verifactu/src/write-path.e2e.test.ts`'s golden huella block (inside lines ~596–720 today) and `packages/fiscal-verifactu/src/inmutabilidad.test.ts` keep every golden literal and every assertion byte for byte, and must pass. The ONLY edits allowed in them are setup: `inmutabilidad.test.ts`'s raw insert (line ~46) names `source`/`device_id` instead of `till_id`, and the golden block's input passes an origin instead of `tillId: seeded.tillId` (line ~661) — Task 10 makes both. Any other change to either file is NEEDS THE OWNER.
- **Hashes that change:** order history (`CapturedByTillId` → `CapturedBySource`, `CapturedByDeviceId`, empty when none) and working time (same). Daily close covers `byDevice` through its snapshot (spec §3).
- **Coverage stays 98/98/98/95** in every touched package and the root project, never by an exclude, an ignore comment or moving code under `src/testing/` (CLAUDE.md §2).
- **Screens:** forms follow `docs/developers/design-system.md` → Forms; a field comes from a field primitive (`wt-combobox`, `wt-switch`, …), never a native `<select>`; every colour, spacing, radius and font reads a declared `--wt-*` token; `wt-data-table` cell markup is styled with `part=`; every new or changed screen is opened and looked at in both themes and at phone width (CLAUDE.md §3, §4).
- **TDD:** each test is written first and seen failing for the stated reason. Comments only for an invariant or a non-obvious why, never history; cut stale comments in every file you touch (global and project CLAUDE.md).
- **Commits:** `git commit -s`, plain-English message (owner rule). Branch `a238-till-is-a-device`, worktree `/Users/clintongormley/workspace/worktrees/waitron-a238-till-is-a-device` (already created with `worktree.py … --headless`).
- **Review path: FULL.** This diff touches migrations, fiscal tables, auth (sessions) and cross-package contracts, all risk triggers: per-task reviews run, `/finish-branch` runs its full wave with two Codex run-it reviews. **The owner reviews before landing** (fiscal-core tables change; campaign rule H2).

## Review Focus

Five inputs the spec implies but no spec test names, most likely to bite first. Each has its test in the owning task.

1. **A handheld without Takes cash paying one bill partly in cash and partly by card.** The cash part is refused with `device.cash_not_allowed`, the card part goes through, and the till app's bill-pay dialog never offers cash on that device. Tests: Task 2, step 2 case (f) and step 4's Review Focus 1 case.
2. **A cash sale on a device whose profile opens the drawer but whose current receipt printer has no drawer.** The sale completes, no `drawer_opens` row is written, no drawer job is queued, nothing is refused. Test: Task 7, step 1, case (e).
3. **A device's current printer is deactivated.** Printing to it queues nothing, as for any inactive printer; the till's printer switcher does not offer it, and shows the current choice as "No printer". Tests: Task 3 step 1 case (g) and Task 8 step 1 case (d).
4. **A sale made by a device that has since been revoked.** The Sales screen, the payments screen and the alerts list still show that device's name. Test: Task 10, step 1, its Review Focus 4 bullet.
5. **Re-pairing a device under the name of a revoked one at the same location.** It is accepted; pairing a second ACTIVE device under a name already used at that location is refused with `device.name_taken`. Test: Task 14, step 1, case (c).

---

## Decisions this plan takes where the spec is silent

Each is a reading of the spec. The owner approved all of them on 2026-10-03, answering decision 4 "active only" and confirming 3, 13 and 15 by name.

1. **Names in code.** The pair (`source`, `device_id`) is an **origin**: `Origin` in `@waitron/shared` (`{ source: "device"; deviceId: DeviceId } | { source: <any other source>; deviceId: null }`). A request or background job's configuration carries `origin`. Columns are named as the spec says (`source`, `device_id`, `captured_by_source`, `captured_by_device_id`).
2. **The source column is an `enumType` text column**, not a bare `label`: it is still a text column (spec §3 says `label`), but `enumType` (`packages/db/src/schema/columns.ts`) types it as the source union and `enumCheck` builds its CHECK from the same list, so the CHECK and the TypeScript type cannot drift.
3. **A request's device comes from its sign-in session, and so do its device checks.** Every till-app write route already calls `requireSession`; a session is opened on a device (`POST /api/session` requires one), and `sessions.device_id` records it. `requireSession` returns that device's binding (profile, capabilities, printers), the route's configuration is built from it, and the capability checks (`assertDeviceCapability`, `assertTakesCash`) read it rather than the device cookie — otherwise a request carrying the session cookie and no device cookie would pass "no device passes" while being recorded as that device. Consequence, new behaviour: an open session on a device that has since been revoked is refused (`device.unauthorized`) on its next write. The kitchen-screen routes that run on the device cookie alone (`device-api.ts`: watcher done, kitchen-notice acknowledge, ticket-item advance) take their origin from the cookie's device.
4. **Device names are unique among a location's ACTIVE devices** (owner, 2026-10-03: "active only"), by a partial unique index `where active = 1`, so a counter re-paired after its device was revoked can reuse its name. The cost, accepted: the Sales screen can show a revoked device and its replacement under one name.
5. **Profile printer lists are ordered** by a `position` column. "The first printer in the list" (spec §4) is the lowest position whose printer is active and at the device's own location. A printer at another location may be listed on a profile but is never chosen for a device elsewhere.
6. **Deactivating a printer moves no device** (spec §4 lists only "leaves a profile's list" and "moves to another profile"). Printing to an inactive printer queues nothing, as today.
7. **The till's printer route is `PUT /api/device/printers`**, body `{ receiptPrinterId?: string | null; paymentSlipPrinterId?: string | null }`, open to any signed-in session on the requesting device (spec §4: no permission, no audit row). A field left out is unchanged.
8. **The dashboard's device hardware PATCH (`/management-api/devices/:id/hardware`) and its client call are deleted**: the receipt printer was its only field (spec §8 removes the picker).
9. **The till's printer switcher** is a **Printers** button in the header's session area, beside **Allergens**, in both headers that exist today (`apps/till/src/widgets/tab-shell.ts` and `apps/till/src/screens/till-counter-screen.ts`). It opens a dialog showing the current receipt and payment slip printers; a list with more than one printer is a `wt-combobox`, a list of one or none is read-only text (spec §4, §8).
10. **Background printing uses the stored device.** A card bill payment completed by the payment checking loop prints on the device that started it (`bill_payments.device_id`). A path with no device prints nothing.
11. **`kitchen_timer`.** If, when Task 9 runs, no kitchen alert is raised by time, the source stays in the vocabulary unused (the spec lists it) and Task 9's commit says so.
12. **A kitchen display may not sign in**, as today: `POST /api/session` refuses a `kds` device with `device.forbidden_action` `{ action: "sign_in" }`, replacing the `device.till_required` refusal it raises now (Task 14).
13. **Payment-check alerts with no sale collapse to one open alert per code**, venue-wide, until acknowledged (the open-alert index keys on source, device, code and sale, and a payment check has no device). Today they collapse per till per code; with one till that is the same.
14. **A Veri\*Factu cancellation record (anulación) copies its original sale's source and device**, as it copies the till today (`packages/fiscal-verifactu/src/backend.ts:334`). Nothing in the product files one today (only `apps/server/src/testing/order-venue.ts` calls `recordVoid`); the till's Cancel files a correction, which takes the requesting device (spec §5). Copying keeps an anulación inside the sale tables' allowed sources whoever files it.
15. **The cash-up groups by origin.** Rows are keyed by (`source`, `device_id`): one row per device, plus one row per job source that took cash (in practice `demo_seed` in a Demo venue), named by the source. Totals stay the sum of all rows, as today. The daily close reconciles counted cash for device rows only; a job-source row has no drawer to count.

## Existing test assertions this plan changes

The spec approves changing any assertion that pins:

- (a) a till id, a till name, the `tills` table, `cfg.tillId`, `WAITRON_TILL_TILL_ID`, `tillName`, `create-till`, the per-till Printing rules section and its routes, the handheld till picker, or the codes `device.register_required`, `device.till_required`, `device.register_name_taken`, `drawer.till_switched_off` (spec §3, §6, §7, §8);
- (b) the handheld drawer refusal: a handheld whose profile allows the drawer now opens it (spec §4);
- (c) the order history golden digests in `packages/db/src/order-amendment-hash.test.ts` (spec §3, Hashes);
- (d) `byTill` / `tillId` in the cash-up and daily close (now `byDevice` / `deviceId`, spec §4, §3);
- (e) a till profile's default capability list gaining `take-cash` (spec §4).

**Setup-only** changes (a fixture gains a device, a session, `take-cash` or a printer list, with the assertion unchanged) need no approval; list them in the task's commit.

**Anything else that changes an assertion is NEEDS THE OWNER:** stop that task, write the question with the file and line, and do not edit the assertion. In particular, the golden huella and `inmutabilidad` never change.

## File Structure

New files:

| File | Responsibility |
| --- | --- |
| `packages/shared/src/origin.ts` (+ `.test.ts`) | The source vocabulary, `Origin`, `DeviceId` constructors and `readOrigin` |
| `packages/db/src/schema/origin.ts` (+ `.test.ts`) | `sourceColumn`, `saleSourceColumn`, `originChecks` for every table that carries an origin |
| `packages/db/src/schema/device-profile-printers.ts` | The profile's printer lists |
| `packages/layouts/src/device-printers.ts` (+ `.db.test.ts`) | Profile list read/write and the device printer-choice rules |
| `apps/server/src/request-config.ts` (+ `.test.ts`) | `requestCfg`: a till-app request's configuration from its session's device |
| `apps/till/src/widgets/printers-dialog.ts` (+ `.test.ts`, `.a11y.test.ts`) | The till's printer switcher |
| Hand-written migrations in `packages/db/drizzle/`, `packages/identity/drizzle/`, `packages/payments/drizzle/`, `packages/fiscal-verifactu/drizzle/`, `packages/workforce/drizzle/` | Generated per task; names given in each task |

Everything else is a modification; each task lists its files.

## How to run things

- One server file: `pnpm --filter @waitron/server exec vitest run src/<file>.test.ts` (add `-t "<part of name>"` for one case).
- One package file: `pnpm --filter @waitron/<pkg> exec vitest run src/<file>.test.ts`.
- One front-end file: `pnpm --filter @waitron/<till|dashboard|setup> exec vitest run src/<path>.test.ts` (real headless Chromium).
- A root guard: `pnpm exec vitest run scripts/<guard>.test.ts`.
- Types: `pnpm --filter @waitron/<pkg> typecheck`. Lint and format of touched files: `pnpm exec eslint <files> && pnpm exec prettier --check <files>`; a `docs/` path is ignored by prettier whole (check one with `pnpm exec prettier --file-info <file>`).
- A package's coverage while chasing a failure: `pnpm --filter @waitron/<pkg> test:coverage`.
- Read the counts: a passing run ends `Test Files  N passed (N)`. An unknown reporter or a `*/` inside a doc comment prints `no tests ran` and exits 0.
- Under an AI agent Vitest hides a passing test's console output; prefix `CLAUDECODE= AI_AGENT=` to see it.
- Before a heavy or browser run: `memory_pressure | grep free` and `ps -axo rss,command | sort -nr | head`; scale concurrency to what is free.
- Chain dependent validation steps with `&&`; a newline-separated sequence reports only its last command's status.

## How to change a table's columns (every migration task follows this)

Read `docs/developers/conventions-data.md` sections "A drizzle table rebuild…", "A drizzle migration-number collision…", and "A migration set depends on another…" before the first migration task.

1. **Change the TypeScript schema first** (the table file, its `*_CLASSIFICATION` entry if the table is new, and the barrel).
2. **List what the rebuild will meet.** A rebuild is `CREATE TABLE __new_x … ; INSERT INTO __new_x SELECT … ; DROP TABLE x ; ALTER TABLE __new_x RENAME TO x`, run with foreign keys ON. Measured for this plan on 2026-10-03 at `810ad27b0` by migrating a scratch database and reading `sqlite_master` and `pragma foreign_key_list`:

   | Table | Triggers ON it (dropped silently by the rebuild — recreate after) | Triggers on OTHER tables whose body reads it (drop before, recreate after, or the rename fails) | Foreign keys pointing at it |
   | --- | --- | --- | --- |
   | `devices` | `device_binding_rule_insert`, `device_binding_rule_update` | `device_profile_form_factor_locked` (on `device_profiles`) | `device_made_here_stations`, `watcher_item_marks`, `device_zone_defaults` (no action), `device_card_readers` (restrict) |
   | `working_orders` | `working_orders_release_main_bill`, `working_orders_release_main_bill_on_move`, `working_orders_enforce_transition` | on `working_order_lines`: `…_require_open_parent_insert`, `…_require_open_parent_update`, `…_require_open_parent_delete`, `…_check_locales_insert`, `…_check_locales_update`, `…_check_variant_locales_insert`, `…_check_variant_locales_update` | 13 tables, four of them CASCADE (`working_order_lines`, `kitchen_print_jobs`, `order_service_contexts`, `kitchen_notices`) |
   | `sales` | append-only pair (reinstalled by `applyMigrations`) | `sale_settlements_check_coverage` (on `sale_settlements`) | 14 tables, restrict / no action |
   | `bill_payments` | `bill_payments_guard_update`, `bill_payments_no_delete` | — | `tenders`, `bill_payment_lines`, `bill_payment_refunds`, `drawer_opens`, `payments` |
   | `bill_payment_refunds` | `bill_payment_refunds_guard_update`, `bill_payment_refunds_no_delete` | — | — |
   | `registros_facturacion` | append-only pair | — | `acks`, `cadenas`, `envios` |
   | `payments` | — | — | `payment_refunds`, `payment_resolutions` |
   | `unpaid_departures`, `order_amendments` | append-only pair | — | — |
   | `time_entries` | append-only pair | — | itself (`corrects_entry_id`), `workforce_chains` |
   | `incidents`, `drawer_opens`, `sessions` | — | — | — |
   | `tills` | — | the four `…_locales_…` triggers on `working_order_lines` | 11 tables (all the till columns) |

   Re-measure before relying on it: the tree moves. The probe is a throwaway root test that runs `applyMigrations(dir, migrationOptionsFor(orderedMigrationSets(ALL_MODULES), null))` (as `scripts/behavioural-triggers.test.ts` does at its `migratedDatabase`) and prints those three lists for the table; delete it before committing.
3. **Replacing a column is TWO generations, never one.** When one generation both adds and removes columns in a table, drizzle-kit asks "created or renamed from another column?", and without a terminal it refuses ("Interactive prompts require a TTY terminal"; read in `drizzle-kit@0.31.11/bin.cjs`, around lines 32694 and 1449). So: change the schema to ADD the new columns and generate; then change it to DROP `till_id` and generate again. Each generation that the upgrade walk refuses gets its own `RESETS` entry. Two traps were measured while building this plan (2026-10-03, Task 9; receipts in `docs/developers/conventions-data.md`, "A generated table rebuild can copy a new column out of the old table" and "A generated table rebuild writes an expression index as a quoted column name"):
   - **The adding generation must not rebuild the table.** A rebuild copies every column of the new schema out of the old table, and this engine refuses `SELECT "source" … FROM incidents` even on an empty table (`no such column: "source" - should this be a string literal in single-quotes?`). A new CHECK forces a rebuild, so add the columns with no CHECKs (drizzle then writes `ALTER TABLE … ADD`, but only when nothing else in that generation forces a rebuild of the table, such as a foreign key added to an existing column) and add the CHECKs in the generation that drops `till_id`.
   - **A rebuild writes an expression index back as quoted column names**, which this engine refuses (`no such column: case when "device_id" …`). Take such an index out of the schema for the rebuilding generations and add it back in a generation of its own, as core `0075` to `0077` do for `incidents_open_dedup`.
4. **Write the migrations around the triggers when the table has any**, the pattern of core `0043`/`0044`/`0045` and `0059`/`0060`/`0061`, with both generations between the drop and the recreate:
   - `pnpm --filter @waitron/<pkg> db:generate:custom --name <topic>_drop_triggers` — `DROP TRIGGER <name>;` for every trigger in both trigger columns above, separated by `--> statement-breakpoint`, with a two-line header saying the next migrations rebuild the table and why the triggers go here.
   - `pnpm --filter @waitron/<pkg> db:generate --name <topic>_add_origin` and then `… --name <topic>_drop_till` — drizzle's rebuilds from the schema. Read the SQL each wrote; do not hand-edit it.
   - `pnpm --filter @waitron/<pkg> db:generate:custom --name <topic>_recreate_triggers` — `CREATE TRIGGER` for each dropped trigger. Copy each trigger's CURRENT text from the latest migration that defines it (the task names the file; confirm with `rg -l "CREATE TRIGGER \`?<name>" packages/*/drizzle | sort | tail -1`), then make only the change the task states.
5. **An added column loses its delete rule in what drizzle generates.** drizzle-kit 0.31.11's add-column SQL writes `REFERENCES t(col)` with no `ON DELETE` (read in `bin.cjs`, around line 24050), so a column it adds records `no action` even where the schema says `restrict`. The engine is not the cause: measured 2026-10-04 on `node:sqlite`, Node v26.7.0 (SQLite 3.53.4), an `ALTER TABLE … ADD … REFERENCES devices(id) ON DELETE restrict` recorded `RESTRICT` in `pragma foreign_key_list`, and the same ADD without it recorded `NO ACTION`; `scripts/schema-constraints.test.ts` does not read delete rules. A later rebuild of the table writes the schema's rule. Do not claim `restrict` in a commit or comment for a column that has only been added.
6. **Refusal texts** a trigger raises stay declared once in `packages/db/src/trigger-refusals.ts`; a changed text changes there and in the SQL together.
7. **The upgrade walk** (`scripts/migration-upgrade.test.ts`) will refuse a step that cannot carry its synthetic rows (a new NOT NULL column with no default, a parent dropped while a child holds rows, a cascade that empties a child). Add a `RESETS` entry for that step with the exact refusal text the test prints, and a one-line comment saying which rebuild and why, in the style of the existing entries (`"identity/0003_session_token_hash_required"`, `"core/0044_drop_table_bill_pointer"`). A `lost` entry names the tables a cascade emptied.
8. **Run, and read the counts:**
   `pnpm exec vitest run scripts/migration-upgrade.test.ts scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/module-graph-honesty.test.ts && pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`
   `scripts/schema-constraints.test.ts` lists every foreign key and unique index by name: update its lists to the new keys (devices, not tills). `scripts/behavioural-triggers.test.ts` pins every hand-written trigger: update the seeded rows and the cases that exercise a changed trigger; its `EXPECTED_TRIGGERS` names stay the same unless the task drops a trigger.
9. **A foreign key to `devices` from another migration set** (identity, payments, fiscal-verifactu, workforce) is allowed: each of those sets already `requires` core (`packages/composition/src/modules.ts`).
10. **Write through every new key once** in a test: a key whose target has no unique index is refused at the first write, not at migrate (CLAUDE.md §3).

---

## Task 1: The source vocabulary, the database columns that carry it, and a shared device fixture

**Files:**
- Create: `packages/shared/src/origin.ts`, `packages/shared/src/origin.test.ts`
- Modify: `packages/shared/src/ids.ts` (add `DeviceId`, `deviceId`), `packages/shared/src/ids.test.ts`, `packages/shared/src/index.ts`, `packages/shared/src/errors.ts` (add `origin.invalid` — named for the concept, CLAUDE.md §3; `shared.invalid_id` predates that rule)
- Create: `packages/db/src/schema/origin.ts`, `packages/db/src/schema/origin.test.ts`
- Modify: `packages/db/src/schema/index.ts` (export it), `packages/db/src/testing/seed.ts`, `packages/db/src/testing/seed.test.ts`

**Interfaces:**
- Produces (`@waitron/shared`):
  - `type DeviceId = Branded<string, "DeviceId">`; `deviceId(value: string): DeviceId`
  - `SOURCES` (readonly tuple, spec §3 order), `type Source`
  - `SALE_SOURCES = ["device", "demo_seed", "readiness_test"] as const`, `type SaleSource`
  - `type JobSource = Exclude<Source, "device">`
  - `type DeviceOrigin = { readonly source: "device"; readonly deviceId: DeviceId }`
  - `type JobOrigin = { readonly source: JobSource; readonly deviceId: null }`
  - `type Origin = DeviceOrigin | JobOrigin`
  - `type SaleOrigin = DeviceOrigin | { readonly source: "demo_seed" | "readiness_test"; readonly deviceId: null }`
  - `deviceOrigin(id: string): DeviceOrigin`; `jobOrigin(source: JobSource): JobOrigin`
  - `readOrigin(source: string, deviceId: string | null): Origin` — throws `origin.invalid` for an unknown source or a mismatched pair
  - `isSaleOrigin(origin: Origin): origin is SaleOrigin`
- Produces (`@waitron/db`):
  - `sourceColumn = enumType(SOURCES)`, `saleSourceColumn = enumType(SALE_SOURCES)`
  - `originChecks(tableName: string, source: AnyColumn, deviceId: AnyColumn)` — a two-element array of checks named `<table>_source_ck` and `<table>_source_device_ck`; a table with other checks spreads it: `(t) => [...originChecks("x", t.source, t.deviceId), check(…)]`
- Produces (`@waitron/db/testing/seed.js`):
  - `seedDevice(db: Database, opts: { locationId: LocationId; label?: string; formFactor?: "till" | "phone-portrait" | "tablet-landscape"; capabilities?: string[]; profileId?: string }): Promise<{ deviceId: DeviceId; profileId: string }>`

- [ ] **Step 1: Write the failing vocabulary tests**

`packages/shared/src/origin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import {
  SALE_SOURCES,
  SOURCES,
  deviceOrigin,
  isSaleOrigin,
  jobOrigin,
  readOrigin,
} from "./origin.js";

const DEVICE = "0f0e0d0c-0b0a-4908-8706-050403020100";

describe("the source vocabulary", () => {
  it("lists exactly the spec's sources, in order", () => {
    expect(SOURCES).toEqual([
      "device",
      "dashboard",
      "fiscal_filing",
      "payment_check",
      "kitchen_timer",
      "demo_seed",
      "readiness_test",
    ]);
  });

  it("allows a sale only from a device, the demo seed or the readiness test", () => {
    expect(SALE_SOURCES).toEqual(["device", "demo_seed", "readiness_test"]);
  });
});

describe("origins", () => {
  it("a device origin carries the device, folded to lower case", () => {
    expect(deviceOrigin(DEVICE.toUpperCase())).toEqual({ source: "device", deviceId: DEVICE });
  });

  it("a job origin carries no device", () => {
    expect(jobOrigin("fiscal_filing")).toEqual({ source: "fiscal_filing", deviceId: null });
  });

  it("reads a stored pair back", () => {
    expect(readOrigin("device", DEVICE)).toEqual({ source: "device", deviceId: DEVICE });
    expect(readOrigin("dashboard", null)).toEqual({ source: "dashboard", deviceId: null });
  });

  it.each([
    ["system", null],
    ["device", null],
    ["dashboard", DEVICE],
  ])("refuses the stored pair (%s, %s)", (source, device) => {
    const caught = (() => {
      try {
        readOrigin(source, device);
      } catch (error) {
        return error;
      }
    })();
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("origin.invalid");
    expect((caught as AppError).params).toEqual({ source, deviceId: device });
  });

  it("tells a sale origin from any other", () => {
    expect(isSaleOrigin(deviceOrigin(DEVICE))).toBe(true);
    expect(isSaleOrigin(jobOrigin("demo_seed"))).toBe(true);
    expect(isSaleOrigin(jobOrigin("readiness_test"))).toBe(true);
    expect(isSaleOrigin(jobOrigin("dashboard"))).toBe(false);
    expect(isSaleOrigin(jobOrigin("payment_check"))).toBe(false);
  });
});
```

Add to `packages/shared/src/ids.test.ts` a case that `deviceId("0F0E0D0C-0B0A-4908-8706-050403020100")` returns the lower-case value and `deviceId("x")` throws `shared.invalid_id` with `{ kind: "DeviceId", value: "x" }` (copy the shape of the existing `tillId` case).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @waitron/shared exec vitest run src/origin.test.ts src/ids.test.ts`
Expected: FAIL — `Cannot find module './origin.js'` and `deviceId is not a function`.

- [ ] **Step 3: Implement**

`packages/shared/src/ids.ts`: beside `TillId` add `export type DeviceId = Branded<string, "DeviceId">;` and beside `tillId` add `export const deviceId = (value: string): DeviceId => brandId(value, "DeviceId");`. Export both from `index.ts`.

`packages/shared/src/errors.ts`, in `ErrorParams` beside `shared.invalid_id`:

```ts
  /** A stored source and device that do not make an origin; the database's CHECKs refuse such a row. */
  "origin.invalid": { source: string; deviceId: string | null };
```

`packages/shared/src/origin.ts`:

```ts
import { AppError } from "./errors.js";
import { deviceId as brandDeviceId } from "./ids.js";
import type { DeviceId } from "./ids.js";

/** Where a record came from. `device` names the device in `device_id`; every other source is a named job with no device. */
export const SOURCES = [
  "device",
  "dashboard",
  "fiscal_filing",
  "payment_check",
  "kitchen_timer",
  "demo_seed",
  "readiness_test",
] as const;
export type Source = (typeof SOURCES)[number];

/** A sale is never recorded from the dashboard or a background job without a device. */
export const SALE_SOURCES = ["device", "demo_seed", "readiness_test"] as const satisfies readonly Source[];
export type SaleSource = (typeof SALE_SOURCES)[number];

export type JobSource = Exclude<Source, "device">;
export type DeviceOrigin = { readonly source: "device"; readonly deviceId: DeviceId };
export type JobOrigin = { readonly source: JobSource; readonly deviceId: null };
export type Origin = DeviceOrigin | JobOrigin;
export type SaleOrigin =
  | DeviceOrigin
  | { readonly source: "demo_seed" | "readiness_test"; readonly deviceId: null };

export const deviceOrigin = (id: string): DeviceOrigin => ({
  source: "device",
  deviceId: brandDeviceId(id),
});

export const jobOrigin = <S extends JobSource>(source: S): JobOrigin & { readonly source: S } => ({
  source,
  deviceId: null,
});

const isSource = (value: string): value is Source => (SOURCES as readonly string[]).includes(value);

export function readOrigin(source: string, deviceId: string | null): Origin {
  if (isSource(source)) {
    if (source === "device" && deviceId !== null) return deviceOrigin(deviceId);
    if (source !== "device" && deviceId === null) return jobOrigin(source);
  }
  throw new AppError("origin.invalid", { source, deviceId });
}

export function isSaleOrigin(origin: Origin): origin is SaleOrigin {
  return (SALE_SOURCES as readonly string[]).includes(origin.source);
}
```

Export every name above from `packages/shared/src/index.ts` (values and types in the barrel's existing two-list style).

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @waitron/shared exec vitest run src/origin.test.ts src/ids.test.ts src/index.test.ts`
Expected: PASS. (`index.test.ts` pins the barrel's export list; add the new names to it there if it fails on them — setup only.)

- [ ] **Step 5: Write the failing column-helper test**

`packages/db/src/schema/origin.test.ts` — declare a throwaway table in the test and read the DDL drizzle builds, then prove both CHECKs refuse on a real `node:sqlite` database:

```ts
import { DatabaseSync } from "node:sqlite";
import { SQLiteSyncDialect, getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { id, table } from "./columns.js";
import { originChecks, saleSourceColumn, sourceColumn } from "./origin.js";

const probe = table(
  "origin_probe",
  { source: sourceColumn("source").notNull(), deviceId: id("device_id") },
  (t) => originChecks("origin_probe", t.source, t.deviceId),
);
const saleProbe = table(
  "sale_origin_probe",
  { source: saleSourceColumn("source").notNull(), deviceId: id("device_id") },
  (t) => originChecks("sale_origin_probe", t.source, t.deviceId),
);

const render = (fragment: SQL) => new SQLiteSyncDialect().sqlToQuery(fragment).sql;

/** The table's DDL with its checks as drizzle renders them (the way `columns.test.ts` renders one). */
function ddl(t: typeof probe | typeof saleProbe): string {
  const config = getTableConfig(t);
  const checks = config.checks.map(
    (c) => `constraint "${c.name}" check (${render(c.value).replaceAll(`"${config.name}".`, "")})`,
  );
  return `create table "${config.name}" ("source" text not null, "device_id" text, ${checks.join(", ")})`;
}

describe("originChecks", () => {
  it("names the two checks after the table", () => {
    expect(getTableConfig(probe).checks.map((c) => c.name)).toEqual([
      "origin_probe_source_ck",
      "origin_probe_source_device_ck",
    ]);
  });

  it("refuses an unknown source and an unpaired device, and accepts the pairs", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(ddl(probe));
    const insert = db.prepare("insert into origin_probe (source, device_id) values (?, ?)");
    insert.run("device", "d1");
    insert.run("dashboard", null);
    expect(() => insert.run("system", null)).toThrow(/origin_probe_source_ck/);
    expect(() => insert.run("device", null)).toThrow(/origin_probe_source_device_ck/);
    expect(() => insert.run("payment_check", "d1")).toThrow(/origin_probe_source_device_ck/);
  });

  it("a sale table refuses the dashboard", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(ddl(saleProbe));
    const insert = db.prepare("insert into sale_origin_probe (source, device_id) values (?, ?)");
    insert.run("demo_seed", null);
    expect(() => insert.run("dashboard", null)).toThrow(/sale_origin_probe_source_ck/);
  });
});
```

The refusals are the assertions that matter; if the rendered text needs another adjustment to run as DDL, make it in `ddl` and keep the refusals as written.

- [ ] **Step 6: Run it to see it fail**

Run: `pnpm --filter @waitron/db exec vitest run src/schema/origin.test.ts`
Expected: FAIL — `Cannot find module './origin.js'`.

- [ ] **Step 7: Implement**

`packages/db/src/schema/origin.ts`:

```ts
import { sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { SALE_SOURCES, SOURCES } from "@waitron/shared";
import { enumCheck, enumType } from "./columns.js";

export const sourceColumn = enumType(SOURCES);
export const saleSourceColumn = enumType(SALE_SOURCES);

/**
 * The source is in its column's list, and a device is named exactly when the source is `device`.
 * A plain array, not `as const`: drizzle's extra-config callback is typed to return a mutable one.
 */
export const originChecks = (tableName: string, source: AnyColumn, deviceId: AnyColumn) => [
  check(`${tableName}_source_ck`, enumCheck(source)),
  check(`${tableName}_source_device_ck`, sql`(${source} = 'device') = (${deviceId} is not null)`),
];
```

Export `sourceColumn`, `saleSourceColumn`, `originChecks` from `packages/db/src/schema/index.ts`. `scripts/column-vocabulary.test.ts` forbids importing engine column builders outside `columns.ts`; this file imports only `check`, which other schema files already import — run that guard to confirm.

- [ ] **Step 8: Run to see it pass**

Run: `pnpm --filter @waitron/db exec vitest run src/schema/origin.test.ts && pnpm exec vitest run scripts/column-vocabulary.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing fixture test**

In `packages/db/src/testing/seed.test.ts` add (in the file's existing `useVenueDb` style, core migrations):

```ts
it("seedDevice pairs an active device on a new till profile at the location", async () => {
  await seedTenant(db);
  const location = await seedLocation(db); // use the file's existing location seeding; add a local helper if none
  const { deviceId, profileId } = await seedDevice(db, { locationId: location, label: "Barra" });
  const [row] = await db
    .select({
      label: devices.label,
      active: devices.active,
      locationId: devices.locationId,
      formFactor: deviceProfiles.formFactor,
      capabilities: deviceProfiles.capabilities,
    })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(eq(devices.id, deviceId));
  expect(row).toEqual({
    label: "Barra",
    active: true,
    locationId: location,
    formFactor: "till",
    capabilities: [],
  });
  expect(profileId).toMatch(/^[0-9a-f-]{36}$/);
});

it("seedDevice reuses a given profile and takes the form factor and capabilities asked for", async () => {
  await seedTenant(db);
  const location = await seedLocation(db);
  const first = await seedDevice(db, {
    locationId: location,
    formFactor: "phone-portrait",
    capabilities: ["take-cash"],
  });
  const second = await seedDevice(db, { locationId: location, profileId: first.profileId });
  expect(second.profileId).toBe(first.profileId);
  expect(second.deviceId).not.toBe(first.deviceId);
});
```

- [ ] **Step 10: Run to see it fail, then implement**

Run: `pnpm --filter @waitron/db exec vitest run src/testing/seed.test.ts` — Expected: FAIL, `seedDevice is not a function`.

Implement in `packages/db/src/testing/seed.ts`. Until Task 14 drops `devices.till_id`, the binding trigger `device_binding_rule_insert` refuses a non-kds device with no till, so the helper also inserts a till named after the device and names it; Task 14 deletes those two lines. Labels default to a counter (`Device 1`, `Device 2`, …) so two calls never collide on a name.

```ts
let deviceCounter = 0;

/** Pairs one active device at `locationId`, on `profileId` or on a new profile of `formFactor` (till by default). */
export async function seedDevice(
  db: Database,
  opts: {
    locationId: LocationId;
    label?: string;
    formFactor?: "till" | "phone-portrait" | "tablet-landscape";
    capabilities?: string[];
    profileId?: string;
  },
): Promise<{ deviceId: DeviceId; profileId: string }> {
  deviceCounter += 1;
  const label = opts.label ?? `Device ${deviceCounter}`;
  const profileId =
    opts.profileId ??
    (
      await db
        .insert(deviceProfiles)
        .values({
          name: `Profile ${deviceCounter}`,
          formFactor: opts.formFactor ?? "till",
          capabilities: opts.capabilities ?? [],
        })
        .returning({ id: deviceProfiles.id })
    )[0]!.id;
  const [till] = await db
    .insert(tills)
    .values({ locationId: opts.locationId, name: label })
    .returning({ id: tills.id });
  const [row] = await db
    .insert(devices)
    .values({
      locationId: opts.locationId,
      deviceProfileId: profileId,
      tillId: till!.id,
      label,
      tokenHash: "seeded",
    })
    .returning({ id: devices.id });
  return { deviceId: brandDeviceId(row!.id), profileId };
}
```

Run again — Expected: PASS. Then `pnpm --filter @waitron/db test:coverage` and read `src/testing/seed.ts` in the table: 100% of its new lines.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src packages/db/src/schema/origin.ts packages/db/src/schema/origin.test.ts packages/db/src/schema/index.ts packages/db/src/testing/seed.ts packages/db/src/testing/seed.test.ts
git commit -s -m "Add the record-source vocabulary and a shared device fixture

Every record that names a till today will name a source instead: a device, or a named
job such as the dashboard or the fiscal filing pass. This adds that list, the origin
type that pairs a source with its device, the database columns and checks that hold
the pair, and a test helper that pairs a device. Nothing uses them yet."
```

---

## Task 2: Takes cash

**Files:**
- Modify: `packages/layouts/src/canvas.ts` (`CAPABILITY_FLAGS`), `packages/layouts/src/device-profile.ts` (`DEFAULT_PROFILE_CAPABILITIES`), their tests
- Modify: `apps/server/src/device-session.ts` (new `assertTakesCash`), `apps/server/src/errors.ts` (`device.cash_not_allowed`), `apps/server/src/till-api.ts` (`/api/sales`, `/api/working-orders/:id/collect`, and the status map near `drawer.no_printer`), `apps/server/src/bill-payments-api.ts` (`POST /api/working-orders/:id/payments`), `apps/server/src/device-api.ts` status map if it maps device codes
- Modify: `apps/dashboard/src/screens/canvas-editor/card-contracts.ts` (the mirrored list), `apps/dashboard/src/i18n/strings.ts` (`device_profiles.capability.take-cash`, en + es)
- Modify: `apps/till/src/layout.ts` (`CapabilityFlag`), `apps/till/src/widgets/tender-pay.ts`, `apps/till/src/widgets/bill-pay-dialog.ts`, `apps/till/src/widgets/card-grid.ts` if it gates the tender card, `apps/till/src/till-app.ts` (passes the capability down), `apps/till/src/i18n/strings.ts` and `apps/till/src/i18n/codes.ts` (en + es)
- Test: `packages/layouts/src/device-profile.test.ts`, `apps/server/src/till-api.test.ts` (or the suite that already covers cash `/api/sales`), `apps/server/src/bill-payments-api.test.ts`, `apps/till/src/widgets/tender-pay.test.ts`, `apps/till/src/widgets/bill-pay-dialog.test.ts`, their `.a11y.test.ts` files, `apps/dashboard/src/screens/device-profiles-screen.test.ts`

**Interfaces:**
- Produces: `"take-cash"` in `CapabilityFlag`; `assertTakesCash(device: DeviceBinding | null): void` in `apps/server/src/device-session.ts` — throws `AppError("device.cash_not_allowed", {})` when a device is present and its capabilities lack `take-cash`; no device passes, as `assertDeviceCapability` does (Task 5 makes every write route carry a device).
- Produces on the till: `tender-pay` and `bill-pay-dialog` take a boolean property `takesCash` (default `true`); when `false` they render no cash choice and show the line `t("tender.cash_at_till")`.

- [ ] **Step 1: Failing test — the till profile takes cash by default, the others do not**

In `packages/layouts/src/device-profile.test.ts`, change the defaults assertion to the new list (approved, class (e)):

```ts
expect(DEFAULT_PROFILE_CAPABILITIES.till).toEqual([
  "integrated-card-payment",
  "open-cash-drawer",
  "print-receipt",
  "show-station",
  "show-expo",
  "show-schedule",
  "take-cash",
]);
expect(DEFAULT_PROFILE_CAPABILITIES["phone-portrait"]).toEqual([]);
expect(DEFAULT_PROFILE_CAPABILITIES["tablet-landscape"]).toEqual([]);
expect(validateCapabilities(["take-cash"])).toEqual(["take-cash"]);
```

Run `pnpm --filter @waitron/layouts exec vitest run src/device-profile.test.ts` — Expected: FAIL (`bad_capabilities` for `take-cash`). Add `"take-cash"` last in `CAPABILITY_FLAGS` and in the till default list; run — PASS.

- [ ] **Step 2: Failing server tests — cash refused without the capability**

Add to the suite that already sells for cash through `/api/sales` with a device cookie (`apps/server/src/till-api.fiscal-sale-paths.test.ts` enrols till cookies; use its helper). Cases:

- (a) A device whose profile has no `take-cash` posts a cash sale → `403` with body code `device.cash_not_allowed`; `select count(*) from sales` is unchanged.
- (b) The same device posts a card sale (manual card) → `200`, one sale.
- (c) A phone-portrait profile WITH `take-cash` posts a cash sale → `200` (spec §10: "on a handheld profile as well as a till").
- (d) `POST /api/working-orders/:id/collect` with body `{ tender: { method: "cash", … } }` (the route reads `tender`, `till-api.ts` ~1804) from a device without `take-cash` → `403 device.cash_not_allowed`, order still open.

Add to `apps/server/src/bill-payments-api.test.ts`:

- (e) A bill payment `{ method: "cash" }` from a device without `take-cash` → `403 device.cash_not_allowed`, no `bill_payments` row.
- (f) **Review Focus 1.** A €20.00 bill on a handheld without `take-cash`: a €5.00 cash part is refused as (e); a €20.00 card part (manual) from the same device succeeds and the bill is paid.

The HTTP status: map `device.cash_not_allowed` to 403 beside `device.forbidden_action` in each route file's status map (`till-api.ts` near line 309, `bill-payments-api.ts`'s map). Existing fixtures whose profile sells cash gain `take-cash` (setup only; list them in the commit).

Run: `pnpm --filter @waitron/server exec vitest run src/till-api.fiscal-sale-paths.test.ts src/bill-payments-api.test.ts -t "cash"` — Expected: the new cases FAIL (200 where 403 expected).

- [ ] **Step 3: Implement the refusal**

`apps/server/src/errors.ts`: `"device.cash_not_allowed": Record<string, never>;` beside `device.forbidden_action`.

`apps/server/src/device-session.ts`:

```ts
/** A device whose profile does not take cash is refused a cash payment. No device passes, as in {@link assertDeviceCapability}. */
export function assertTakesCash(device: DeviceBinding | null): void {
  if (device !== null && !device.capabilities.includes("take-cash")) {
    throw new AppError("device.cash_not_allowed", {});
  }
}
```

Call it, after the route has read the body and before any write, wherever the request's tenders or method include cash: `/api/sales` (any tender with `method === "cash"`), `/api/working-orders/:id/collect` (`tender.method === "cash"`), `POST /api/working-orders/:id/payments` (`method === "cash"`). Each route already resolves the device once (`tryReadDevice` / its `device` variable); pass that. Run the step 2 command — Expected: PASS. Then run the whole of each touched suite once.

- [ ] **Step 4: Failing till-app tests — no cash option, and the line saying where to take it**

`apps/till/src/widgets/tender-pay.test.ts`:
- (a) With `takesCash = false`, no element with the cash tender's `data-test` renders, and the text of `t("tender.cash_at_till")` is shown; the card button still renders.
- (b) With the default, the cash button renders and the line does not.

`apps/till/src/widgets/bill-pay-dialog.test.ts`:
- (c) With `takesCash = false`, the method field offers card only and shows the line; submitting sends `method: "card"`.

`apps/till/src/till-app-bill-payments.test.ts` (or `till-app.test.ts`), **Review Focus 1**: a till app booted with `capabilities` lacking `take-cash` opens the bill-pay dialog with no cash choice; with `take-cash` it offers cash.

Add each new visual state to the widget's `.a11y.test.ts` in both themes.

Run: `pnpm --filter @waitron/till exec vitest run src/widgets/tender-pay.test.ts src/widgets/bill-pay-dialog.test.ts` — Expected: FAIL.

- [ ] **Step 5: Implement in the till app**

- `apps/till/src/layout.ts`: add `"take-cash"` to `CapabilityFlag`.
- `tender-pay.ts` and `bill-pay-dialog.ts`: `@property({ type: Boolean }) takesCash = true;` hide the cash choice when false and render `<p class="cash-at-till">${t("tender.cash_at_till")}</p>` (style from tokens).
- `till-app.ts`: pass `.takesCash=${this.capabilities.includes("take-cash")}` wherever it renders those two widgets (the same places it passes `cardReader`).
- `apps/till/src/i18n/strings.ts`: `"tender.cash_at_till": "This device does not take cash. Take cash at a till."` / `"Este dispositivo no cobra en efectivo. Cobra en efectivo en una caja."`.
- `apps/till/src/i18n/codes.ts`: `device.cash_not_allowed` with the same two sentences.

Run step 4's command and the `.a11y` files — PASS. Look at both widgets in both themes at phone width (open the browser test's screenshot or a dev stack).

- [ ] **Step 6: Dashboard — the tick-box appears**

`apps/dashboard/src/screens/canvas-editor/card-contracts.ts`: add `"take-cash"` to its mirror of `CAPABILITY_FLAGS` (same position). `apps/dashboard/src/i18n/strings.ts`: `"device_profiles.capability.take-cash": "Takes cash"` / `"Cobra en efectivo"`. Add to `device-profiles-screen.test.ts`: the editor shows a `cap-take-cash` switch; toggling it on and saving sends `capabilities` containing `"take-cash"`. Run the suite — FAIL first (no switch), then PASS.

- [ ] **Step 7: Commit**

```bash
git commit -s -m "A device takes cash only when its profile says so

Profiles gain a Takes cash tick-box, on by default for the Till profile only. A cash
sale, cash collection or cash bill payment from a device whose profile lacks it is
refused with device.cash_not_allowed, and the till app offers no cash there and says
to take cash at a till. Card payments are unaffected."
```

---

## Task 3: Profile printer lists and each device's current printers (server)

**Files:**
- Create: `packages/db/src/schema/device-profile-printers.ts`; modify `packages/db/src/schema/devices.ts` (add `paymentSlipPrinterId`), `packages/db/src/schema/index.ts`, `packages/db/src/classification.ts` (classify `device_profile_printers` as `state`)
- Create: `packages/layouts/src/device-printers.ts`, `packages/layouts/src/device-printers.db.test.ts`; modify `packages/layouts/src/device-profile-store.ts`, `packages/layouts/src/index.ts`
- Modify: `apps/server/src/management-api.ts` (profile create/update/get/list bodies), `apps/server/src/join-requests.ts` (`acceptDeviceJoinRequest`), `apps/server/src/device-api.ts` (`assign-device-profile`, `GET /api/device/me`, new `PUT /api/device/printers`, delete `PATCH /management-api/devices/:id/hardware`), `apps/server/src/device.ts` (`requireDeviceBinding`'s printer branch), `apps/server/src/errors.ts` (`device.binding_invalid` field union), `apps/server/src/device-session.ts` (`DeviceBinding.paymentSlipPrinterId`)
- Migration: core, `pnpm --filter @waitron/db db:generate --name profile_printer_lists` (a new table and an added nullable column: no rebuild, no triggers)
- Test: `apps/server/src/management-api.device-profiles.test.ts`, `apps/server/src/device-api.test.ts`, `apps/server/src/join-requests.test.ts`, `scripts/schema-constraints.test.ts`, `scripts/classification-complete.test.ts`

**Interfaces:**
- Produces (schema): `deviceProfilePrinters` — `id` (pk), `deviceProfileId` (not null, fk `device_profiles.id` `cascade`), `printerId` (not null, fk `printers.id` `restrict`), `role` (`enumType(["receipt", "payment_slip"])`, not null, with `enumCheck`), `position` (`count`, not null); unique `(device_profile_id, role, printer_id)` named `device_profile_printers_profile_role_printer_key`. `devices.paymentSlipPrinterId` — nullable fk `printers.id`, declared `restrict`; added by `ALTER TABLE`, so the database records `no action` until Task 14 rebuilds `devices` ("How to change a table's columns" step 5).
- Produces (`@waitron/layouts`):
  - `type PrinterRole = "receipt" | "payment_slip"`
  - `type ProfilePrinterLists = { receiptPrinterIds: string[]; paymentSlipPrinterIds: string[] }`
  - `readProfilePrinterLists(tx, profileId: string): Promise<ProfilePrinterLists>`
  - `setProfilePrinterLists(tx, profileId: string, lists: ProfilePrinterLists): Promise<void>` — replaces both lists (positions in array order), then calls `resettleDevicesOnProfile`
  - `resettleDevicesOnProfile(tx, profileId: string): Promise<void>` — every device on the profile whose current receipt or slip printer is no longer usable moves to the first usable one, or none
  - `firstUsablePrinters(tx, profileId: string, locationId: string): Promise<{ receiptPrinterId: string | null; paymentSlipPrinterId: string | null }>`
  - `chooseDevicePrinter(tx, deviceId: string, role: PrinterRole, printerId: string | null): Promise<void>` — throws `device.binding_invalid` `{ field: "receiptPrinterId" | "paymentSlipPrinterId" }` for a printer not usable for that device
  - "Usable" = on the profile's list for that role, `printers.active`, and `printers.location_id` = the device's location.
- Produces (routes):
  - Profile create/update bodies accept `receiptPrinterIds?: string[]`, `paymentSlipPrinterIds?: string[]` (absent on create = empty; absent on update = unchanged); every profile response carries both arrays.
  - `GET /api/device/me` adds `receiptPrinterId`, `paymentSlipPrinterId`, and `printerChoices: { receipt: { id: string; name: string }[]; paymentSlip: { id: string; name: string }[] }` (usable printers, list order); drops `tillId` in Task 14, not here.
  - `PUT /api/device/printers` (device cookie + open session): body `{ receiptPrinterId?: string | null; paymentSlipPrinterId?: string | null }` → `200 { receiptPrinterId, paymentSlipPrinterId }`.

- [ ] **Step 1: Failing store tests**

`packages/layouts/src/device-printers.db.test.ts` (`useVenueDb` with core + identity migrations, as `device-profile-store.db.test.ts` does; seed a tenant, a location, two printers P1 and P2 and P3 at that location, and devices with `seedDevice`). Cases, each asserting the exact stored values:

- (a) `setProfilePrinterLists(tx, profile, { receiptPrinterIds: [P2, P1], paymentSlipPrinterIds: [P3] })` then `readProfilePrinterLists` → `{ receiptPrinterIds: [P2, P1], paymentSlipPrinterIds: [P3] }`.
- (b) The same printer on both lists is accepted.
- (c) `firstUsablePrinters` → `{ receiptPrinterId: P2, paymentSlipPrinterId: P3 }`; with P2 deactivated → `P1`; with both lists empty → nulls.
- (d) A device on the profile whose receipt printer is P2: setting the receipt list to `[P1]` moves it to P1 in the same transaction; to `[]` moves it to null; its slip printer P3 is untouched when the slip list still holds P3.
- (e) `chooseDevicePrinter(tx, device, "payment_slip", P1)` when P1 is not on the slip list → `AppError` `device.binding_invalid` with `{ field: "paymentSlipPrinterId" }`, device unchanged; `chooseDevicePrinter(tx, device, "receipt", P1)` with P1 listed → stored; `null` → stored as null.
- (f) A printer at another location listed on the profile is never chosen by `firstUsablePrinters` and is refused by `chooseDevicePrinter`.
- (g) **Review Focus 3.** A device whose current receipt printer is deactivated keeps the id stored (decision 6), and `chooseDevicePrinter` refuses choosing an inactive printer.
- (h) Deleting the profile deletes its list rows (cascade); deleting a listed printer is refused by the restrict key (assert the domain code the printer store already raises for a printer in use, or the 1811 refusal read with `restrictRefused`).

Run: `pnpm --filter @waitron/layouts exec vitest run src/device-printers.db.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Schema, migration and store**

Write `packages/db/src/schema/device-profile-printers.ts` as in Interfaces, using `id`, `count`, `enumType`, `enumCheck`, `table`, `newId` from `./columns.js`. Add `paymentSlipPrinterId: id("payment_slip_printer_id").references(() => printers.id, { onDelete: "restrict" })` to `devices`. Classify the table `state` in `CORE_CLASSIFICATION`. Generate the core migration (`db:generate --name profile_printer_lists`) and read it: a `CREATE TABLE`, a unique index and an `ALTER TABLE devices ADD payment_slip_printer_id`. If drizzle rebuilt `devices` instead, stop and follow "How to change a table's columns".

Write `packages/layouts/src/device-printers.ts` with the functions in Interfaces. `setProfilePrinterLists` deletes the profile's rows and inserts the new ones (the `REFERENCES` grep: nothing references `device_profile_printers`, so delete-then-insert is safe — CLAUDE.md §3 "Rewriting rows one at a time…"). `resettleDevicesOnProfile` reads each device on the profile (`select id, location_id, receipt_printer_id, payment_slip_printer_id from devices where device_profile_id = ?`), and for each role whose current id is not usable sets it to `firstUsablePrinters(...)`'s value for that role. Run step 1 — PASS. Run "How to change a table's columns" step 8.

- [ ] **Step 3: Failing route tests**

`apps/server/src/management-api.device-profiles.test.ts`:
- (a) `POST /management-api/device-profiles` with `receiptPrinterIds: [P1], paymentSlipPrinterIds: []` → 201 and the response carries both arrays; `GET` returns them.
- (b) `PUT` without the two fields leaves the lists as they were; `PUT` with `receiptPrinterIds: []` empties it and moves the profile's devices' receipt printer to null.
- (c) A body with `receiptPrinterIds: "x"` → 400 `management.request_invalid` `{ field: "receiptPrinterIds" }`; an unknown printer id → 404 `printer.not_found` (use the code the printer routes already use).

`apps/server/src/join-requests.test.ts`:
- (d) Accepting a device onto a profile listing `[P2, P1]` / `[P3]` stores `receipt_printer_id = P2`, `payment_slip_printer_id = P3`.

`apps/server/src/device-api.test.ts`:
- (e) `POST /management-api/devices/:id/assign-device-profile` to a profile with different lists moves both printers to that profile's first usable ones.
- (f) `PUT /api/device/printers` from a signed-in device: `{ paymentSlipPrinterId: P1 }` with P1 on the slip list → 200 `{ receiptPrinterId: P2, paymentSlipPrinterId: P1 }`; the row matches.
- (g) `{ receiptPrinterId: P3 }` with P3 not on the receipt list → 400 `device.binding_invalid` `{ field: "receiptPrinterId" }`.
- (h) With no session cookie → 401 `session.required`; with no device cookie → 401 `device.unauthorized`.
- (i) `GET /api/device/me` returns `receiptPrinterId`, `paymentSlipPrinterId` and `printerChoices` with names in list order, active printers only.
- (j) `PATCH /management-api/devices/:id/hardware` → 404 (route gone). Delete that route's existing cases (class (a): they pin the per-device receipt picker the spec removes) and say so in the commit.

Run those suites — Expected: the new cases FAIL.

- [ ] **Step 4: Implement the routes**

- `device-profile-store.ts`: `DeviceProfileRow` gains `receiptPrinterIds` and `paymentSlipPrinterIds`; `listDeviceProfiles`/`getDeviceProfile` read them; `createDeviceProfile`/`updateDeviceProfile` take `printerLists?: ProfilePrinterLists` and call `setProfilePrinterLists` in the same transaction after the profile row is written (the profile's own `try` stays around its one statement — see the comment on `translateWriteError`).
- `management-api.ts`: parse the two arrays with a helper that requires an array of UUID strings (`requireBodyUuid` per element), and pass them.
- `join-requests.ts`: after inserting the device, set its two printers from `firstUsablePrinters(tx, input.profileId, row.locationId)`.
- `device-api.ts`: after `assign-device-profile` updates the profile, call `resettleDevicesOnProfile` for the new profile (or set this one device's printers from `firstUsablePrinters`). Add `PUT /api/device/printers` (`requireDevice`, then `requireSession`, then one transaction calling `chooseDevicePrinter` per named field). Delete the hardware PATCH.
- `device.ts`/`errors.ts`: `device.binding_invalid`'s `field` union adds `"paymentSlipPrinterId"`; `requireDeviceBinding`'s `receiptPrinterId` branch goes if the PATCH was its only caller (grep).
- `device-session.ts`: `DeviceBinding` gains `paymentSlipPrinterId`; read it in `deviceBindingColumns`.

Run step 3's suites and `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/schema-constraints.test.ts scripts/classification-complete.test.ts` — PASS (add the new key and unique index to `schema-constraints.test.ts`'s lists).

- [ ] **Step 5: Commit**

```bash
git commit -s -m "Profiles list the printers their devices may use

A profile now keeps a list of receipt printers and a list of payment slip printers.
A device holds its current choice of each: a new device starts on the first usable
printer in each list, and a device whose printer leaves its profile's list, or that
moves to another profile, moves to the first one still listed, in the same
transaction. Staff can switch a device's printers from the device itself
(PUT /api/device/printers); a printer not on the list is refused. The dashboard's
per-device receipt printer setting is removed. Nothing prints from these yet."
```

---

## Task 4: Profile printers, device printers and printer detail on the dashboard

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`DeviceProfile` gains the two arrays; `createDeviceProfile`/`updateDeviceProfile` send them; `DeviceRow` gains `receiptPrinterId`, `paymentSlipPrinterId`; delete `patchDeviceHardware`), `apps/dashboard/src/api/client.test.ts`
- Modify: `apps/dashboard/src/screens/device-profiles-screen.ts` (+ test, a11y test), `apps/dashboard/src/screens/devices-screen.ts` (+ tests), `apps/dashboard/src/screens/printers-screen.ts` (+ tests), `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/api/live-queries.ts` (`listDeviceProfiles` and `listDevices` gain `"device_profile_printers"` and `"printers"` where they read them)
- Modify: the server's device list route (`GET /management-api/devices`, find it with `rg -n '"/management-api/devices"' apps/server/src`) to return each device's two printer ids
- Test: `scripts/live-subscriptions.test.ts`

**Interfaces:**
- Consumes: Task 3's routes and fields.
- Produces: in the profile editor, two lists (`data-test="receipt-printers"`, `data-test="payment-slip-printers"`), each a set of `wt-switch`es, one per active printer, plus up/down buttons to order the switched-on ones (the order is "first printer", decision 5). If `design-system.md` already has an ordered-choice primitive, use it instead and say so in the commit.

- [ ] **Step 1: Failing screen tests**

`device-profiles-screen.test.ts`:
- (a) Opening a profile whose lists are `[P2, P1]` / `[P3]` shows P2 and P1 switched on in the receipt list, in that order, and P3 in the slip list.
- (b) Switching P3 on in the receipt list and saving calls `updateDeviceProfile` with `receiptPrinterIds: [P2, P1, P3]` and the slip list unchanged.
- (c) Moving P1 up and saving sends `[P1, P2]`.
- (d) A venue with no printers shows the line `t("device_profiles.no_printers")` in place of both lists.

`devices-screen.test.ts`:
- (e) The hardware editor has no `hw-printer-*` combobox; `patchDeviceHardware` is never called (delete the hardware save cases — class (a)).
- (f) Each active device row shows its current receipt and slip printer names (`device-receipt-printer-<id>`, `device-slip-printer-<id>`), or `t("devices.no_printer")`.

`printers-screen.test.ts`:
- (g) The printer detail page's `printer-registers` field becomes `printer-profiles`, listing the names of the profiles that offer this printer on either list (e.g. `Mostrador, Camareros`), or `t("printers.no")` (replaces the one `printer-registers` assertion — class (a)).

Add each new state to the screen's `.a11y.test.ts`, both themes. Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/device-profiles-screen.test.ts src/screens/devices-screen.test.ts src/screens/printers-screen.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement**

Client types and calls first, then the three screens. Strings (en / es): `device_profiles.receipt_printers` "Receipt printers" / "Impresoras de tickets"; `device_profiles.payment_slip_printers` "Payment slip printers" / "Impresoras de comprobantes de pago"; `device_profiles.no_printers` "Add a printer first." / "Añade primero una impresora."; `device_profiles.move_up` / `move_down` "Move up"/"Subir", "Move down"/"Bajar"; `devices.receipt_printer_now` "Receipt printer" / "Impresora de tickets"; `devices.slip_printer_now` "Payment slip printer" / "Impresora de comprobantes"; `devices.no_printer` "None" / "Ninguna"; `printers.profiles` "Offered on profiles" / "Ofrecida en los perfiles". The printer detail stops watching `listTills` and watches `listDeviceProfiles`. Run step 1 — PASS. Run `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/native-form-fields.test.ts scripts/style-token-names.test.ts` — PASS.

- [ ] **Step 3: Look at them**

Open the profile editor, the devices list and a printer's detail in both themes and at 390 px wide (browser test screenshots or `wa-wt demo waitron-a238-till-is-a-device`). Nothing overflows; the order buttons are reachable by keyboard.

- [ ] **Step 4: Commit**

```bash
git commit -s -m "Dashboard: set a profile's printer lists and see each device's printers

The profile editor gains the receipt printer and payment slip printer lists, with
their order. The devices list shows each device's current printers and loses its
receipt printer picker. A printer's detail page lists the profiles that offer it in
place of the tills that used it."
```

---

## Task 5: A sign-in session belongs to a device, and every till-app request carries it

**Files:**
- Modify: `packages/identity/src/schema/sessions.ts`, `packages/identity/src/login.ts` (+ `login.test.ts`), `packages/identity/test/fixtures.ts`, every identity test that inserts `sessions` (grep `insert(sessions)` / `insert into sessions`)
- Migration: identity, `sessions` (no triggers, no children), two generations ("How to change a table's columns" step 3): `db:generate --name session_device_add` (adds `device_id`), then `db:generate --name session_device_drop_till`; a `RESETS` entry for each step the walk refuses, e.g. `"identity/<NNNN>_session_device_add": { refused: ["NOT NULL constraint failed: __new_sessions.device_id"] }` (use the text the test prints)
- Modify: `apps/server/src/till-session.ts` (`requireSession`), `apps/server/src/till-api.ts` (`POST /api/session`, `overridePinAttempts`, every write route), `apps/server/src/bill-payments-api.ts`, `apps/server/src/adjustments-api.ts`, `apps/server/src/unpaid-departure-api.ts`, `apps/server/src/device-api.ts` (the three cookie-only kitchen routes), `apps/server/src/till-config.ts`, `apps/server/scripts/settle-invoice-first.ts` (~line 156) and `apps/server/scripts/modelo-303-demo.ts` (~line 507), which call `loginWithPin({ tillId })` and are typechecked with the server — each now pairs a device row first (the server's own pairing helpers, or a direct insert with `seedDevice`'s shape)
- Create: `apps/server/src/request-config.ts`, `apps/server/src/request-config.test.ts`
- Test: `apps/server/src/till-session.test.ts` (or where `requireSession` is tested), `apps/server/src/pin-check-ahead.test.ts`, the route suites that sign in

**Interfaces:**
- Produces: `sessions.device_id` (`id`, not null, fk `devices.id` `restrict`); index `sessions_open_idx` on `device_id`. `loginWithPin(tx, { deviceId: string; personId; pin; checked? })`; `Session.deviceId`.
- Produces: `requireSession(...) : Promise<{ personId: string; sessionId: string; deviceId: DeviceId; device: DeviceBinding }>` — `device` read in the same query (join `devices` and `device_profiles`, `devices.active = true`); a session whose device is revoked throws `device.unauthorized` (decision 3).
- Produces in `till-config.ts`: `interface OriginConfig extends TillConfig { origin: Origin }` and `interface DeviceRequestConfig extends TillConfig { origin: DeviceOrigin }`.
- Produces in `request-config.ts`: `requestCfg(cfg: TillConfig, session: { deviceId: DeviceId }): DeviceRequestConfig` — `{ ...cfg, origin: deviceOrigin(session.deviceId) }`.
- Produces: `overridePinAttempts(pinThrottle, sessionDeviceId: string)` with slot `override:${sessionDeviceId}` (spec §5: the PIN retry limit is keyed by device).

**What does NOT change in this task:** which `till_id` any row is written with. Routes that use `deps.cfg` keep its `tillId`; routes that use `deviceTillCfg` / `requireSaleTillId` keep them. `requestCfg` only adds `origin`.

- [ ] **Step 1: Failing identity tests**

`packages/identity/src/login.test.ts`: `loginWithPin(tx, { deviceId, personId, pin })` stores `device_id = deviceId` and returns it (replace the `tillId` assertion — class (a)). A session insert naming a device id that does not exist is refused (foreign key, errcode 787). Fixtures: `packages/identity/test/fixtures.ts`'s `seedTill` becomes `seedSessionDevice(db): Promise<string>` using `seedDevice` (Task 1). Run `pnpm --filter @waitron/identity exec vitest run` — Expected: FAIL.

- [ ] **Step 2: Schema, migration, login**

`sessions.ts`: replace `tillId` with `deviceId: id("device_id").notNull().references(() => devices.id, { onDelete: "restrict" })`; index on `t.deviceId`. Replace the comment above `personId` with one line: why `person_id` carries no key (keep that reason), and drop the till sentence. `login.ts`: rename the input and output field. Generate the identity migration and add the `RESETS` entry. Run "How to change a table's columns" step 8 and step 1's suite — PASS.

- [ ] **Step 3: Failing server tests**

`apps/server/src/request-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deviceId } from "@waitron/shared";
import { requestCfg } from "./request-config.js";
// Build the TillConfig the way this file's neighbours do (no shared helper exists; copy the literal a nearby
// unit suite uses, e.g. in `receipt-print.test.ts`).
import { testTillConfig } from "./testing/till-config.js";

describe("requestCfg", () => {
  it("runs the request as its session's device and keeps the rest of the configuration", () => {
    const cfg = testTillConfig();
    const device = deviceId("0f0e0d0c-0b0a-4908-8706-050403020100");
    expect(requestCfg(cfg, { deviceId: device })).toEqual({
      ...cfg,
      origin: { source: "device", deviceId: device },
    });
  });
});
```

`till-session` suite: `requireSession` returns `deviceId` and `device` of the device the session was opened on; after that device is revoked, `requireSession` throws `device.unauthorized`. A cash sale from a session on a device without `take-cash`, sent with NO device cookie, is refused `device.cash_not_allowed` (the guard reads the session's device — decision 3); the same for `open-cash-drawer` on `POST /api/drawer/open`. `POST /api/session` from device D stores `sessions.device_id = D`. `pin-check-ahead.test.ts` / the override suites: two sessions on two devices fill separate override buckets (`override:<deviceA>` vs `override:<deviceB>`); two sessions on one device share one (replace the till-keyed expectation — class (a)).

Run — Expected: FAIL.

- [ ] **Step 4: Implement**

- `till-session.ts`: join `devices` and `device_profiles` on `sessions.device_id` (active devices only) and return `deviceId` and the `DeviceBinding` (reuse `device-session.ts`'s `deviceBindingColumns` and `toDeviceBinding` — export them); a missing join row throws `device.unauthorized`.
- Every write route that runs `assertDeviceCapability` or `assertTakesCash` passes `session.device` instead of a `tryReadDevice` result.
- `device-api.ts`'s three cookie-only kitchen routes build `{ ...deps.cfg, origin: deviceOrigin(device.deviceId) }` from the `requireDevice` result.
- `till-api.ts` `POST /api/session`: pass `deviceId: device.deviceId` to `loginWithPin` (the device is already required there).
- `till-config.ts`: add the two interfaces.
- `request-config.ts`: `requestCfg` as in Interfaces.
- Every write route in the table below builds `const cfg = requestCfg(deps.cfg, session)` right after `requireSession` and passes `cfg` where it passed `deps.cfg`; where it built `sendingCfg` or `deviceTillCfg`, build them on top of `cfg` (`{ ...cfg, … }`), so `origin` rides through. Routes (from `till-api.ts` unless named): `PUT /api/session/locale`, `POST /api/dead-ends/sale`, `POST /api/sales`, `POST /api/pay`, `POST /api/working-orders`, `PUT /api/working-orders/:id`, `DELETE /api/working-orders/:id`, `…/place`, `…/prep`, kitchen-notice acknowledge, ticket-item and station advance, watcher done, `POST /api/orders/:id/collect`, both reprints, `POST /api/drawer/open`, `…/collect`, `…/cancel`, every `/api/tables/*`, `/api/parties/*` and `/api/bills/*` route, both `/api/dead-ends/*`, `…/make-at`, `…/lines/*`; `bill-payments-api.ts` (preview, payments, refunds); `adjustments-api.ts` (adjust); `unpaid-departure-api.ts`.
- `overridePinAttempts`: rename the parameter and pass `session.deviceId` at every caller.

Run step 3's tests, then the full `apps/server` suites whose names start `till-api`, `bill-payments`, `adjustments`, `unpaid-departure` once each (they are the routes changed). Fixtures that insert a `sessions` row directly gain a device (`seedDevice`): setup only.

- [ ] **Step 5: Commit**

```bash
git commit -s -m "A sign-in session records its device, and till-app requests carry it

The sessions table names the device a person signed in on (a foreign key, never
null) in place of the till. Every till-app write route now runs with that device as
its origin, ready for the records that will name it. The supervisor PIN retry limit
is counted per device. No record changes which till it is written with yet."
```

---

## Task 6: Money records name their source and device (beside the till, for now)

**Files:**
- Schema: add nullable `source` (`saleSourceColumn`) and `device_id` (`id`, fk `devices.id`; declared `restrict`, recorded as `no action` until Task 10's rebuild — "How to change a table's columns" step 5) to `sales` (`packages/db/src/schema/sales.ts`), `bill_payments`, `bill_payment_refunds` (`bill-payments.ts`), `unpaid_departures` (`sourceColumn`, all sources), `registros_facturacion` (`packages/fiscal-verifactu/src/schema/registros.ts`), `payments` (`packages/payments/src/schema/payments.ts`). No CHECKs yet (they need a rebuild; Task 10 adds them with NOT NULL).
- Migrations: core `money_records_origin`, fiscal-verifactu `registro_origin`, payments `payment_origin` — each `db:generate`; read each: only `ALTER TABLE … ADD` statements. If drizzle wrote a rebuild, stop and follow "How to change a table's columns".
- Code: `packages/core/src/record-sale.ts`, `record-substitution.ts`, `record-correction.ts` (input gains `origin: SaleOrigin`, written to `sales`), `packages/fiscal/src/backend.ts` (`SaleForFiscalRecord.origin: SaleOrigin`), `packages/fiscal-verifactu/src/backend.ts`, `chain.ts`, `registro-row.ts` (write `source`, `device_id`; an anulación copies the original alta's pair), `packages/payments/src/provider.ts` (`CollectParams.tillId` → `origin: DeviceOrigin`), `packages/payments/src/store.ts` (write it on the payment row), `apps/server/src/till-sale.ts`, `bill-payments.ts`, `bill-refunds.ts`, `unpaid-departure.ts`, `cancel-credit.ts`, `working-order.ts` (`issueUnpaidInvoice`), `payments-api.ts` (stuck resolve: `origin` = the stuck payment's `device_id`), `bill-payments-loop.ts`, `apps/server/scripts/demo-seed/seed-sales.ts` (`jobOrigin("demo_seed")`), `apps/server/src/fiscal-readiness-runner.ts` (`jobOrigin("readiness_test")`), `apps/server/scripts/record-one-sale.ts`, `settle-invoice-first.ts`, `modelo-303-demo.ts`, `daily-close-demo.ts`, `daily-close-z-demo.ts` (each passes a `demo_seed` origin — they are operator demo scripts; say so in the commit)
- Fixtures: `packages/core/test/fixtures.ts`, `packages/payments/test/seed.ts`, `packages/fiscal-verifactu/src/testing/seed.ts`, `test/fixtures.ts`, `test/drain-fixtures.ts`, `apps/server/src/testing/fiscal-fixtures.ts` gain a device from `seedDevice` and pass `deviceOrigin` where they pass a till.
- **Raw inserts in tests:** every test that inserts straight into `sales`, `bill_payments`, `bill_payment_refunds`, `unpaid_departures`, `registros_facturacion` or `payments` (at `810ad27b0`: 43 files insert into `sales` and 17 into `bill_payments`; list them with `rg -l "insert\((sales|billPayments|billPaymentRefunds|unpaidDepartures|registrosFacturacion|payments)\)|insert into (sales|bill_payments|bill_payment_refunds|unpaid_departures|registros_facturacion|payments)\b" --glob '*.test.ts' --glob '**/test/**' --glob '**/testing/**'`) gains `source` and `device_id` in this task — setup only — because Task 7 and Task 9 read them and Task 10 makes them required.

**Interfaces:**
- Consumes: `OriginConfig` / `DeviceRequestConfig` (Task 5), `SaleOrigin`, `deviceOrigin`, `jobOrigin` (Task 1).
- Produces: every writer of the six tables takes an origin and writes both columns. `RecordSaleInput`, `RecordSubstitutionInput`, `RecordCorrectionInput` gain `origin: SaleOrigin` (keep `tillId` until Task 10). `SaleForFiscalRecord` gains `origin: SaleOrigin`. `CollectParams.origin: DeviceOrigin` replaces `tillId` (no provider read it). Server functions that write these rows take `cfg: OriginConfig` (or `DeviceRequestConfig` where only a device can reach them) — let the compiler find the callers.

- [ ] **Step 1: Failing tests, one per writer, each asserting the stored pair**

- `packages/core/src/record-sale.test.ts` (and the substitution and correction suites): a sale recorded with `origin: deviceOrigin(D)` stores `source = 'device'`, `device_id = D`; with `jobOrigin("demo_seed")` stores `('demo_seed', null)`.
- `packages/fiscal-verifactu/src/backend.test.ts` (or the suite covering `recordSale`): the alta's `registros_facturacion` row stores the sale's pair; a void's anulación row copies the original alta's pair.
- `packages/payments/src/store.test.ts`: a payment created through `collect` with `origin: deviceOrigin(D)` stores `('device', D)`.
- Server route suites: `POST /api/sales` (cash) from device D → the `sales`, and its `registros_facturacion` row, carry `('device', D)`; `POST /api/pay` → the `payments` row carries D; a bill payment → `bill_payments` carries D, its refund → `bill_payment_refunds` carries the refunding device; an unpaid departure → `unpaid_departures` carries D.
- `apps/server/src/payments-api.test.ts`: **spec §10** — a stuck card payment started on device D and resolved from the dashboard files its sale with `('device', D)`, not the dashboard. Seed the payment with `device_id = D` and the order opened on another device E, and assert D.
- Demo seed (`apps/server/scripts/demo-seed/*.test.ts`): every seeded sale has `('demo_seed', null)`.
- `apps/server/src/fiscal-readiness-runner.test.ts`: the test sale has `('readiness_test', null)`.

Run each — Expected: FAIL (columns missing, then null values).

- [ ] **Step 2: Implement**

Schema and migrations first; run "How to change a table's columns" step 8. Then the core recorders and the fiscal seam (`origin` beside `tillId`), then payments, then the server callers: follow the compiler from the changed signatures. Stuck resolve reads `payments.device_id` of the stuck payment; if it is null (a payment written before this task in a test fixture), the test fixture is wrong — fix the fixture, do not fall back.

The write-path suite `packages/fiscal-verifactu/src/write-path.e2e.test.ts`: its "till_id is inert to the huella and the chain" block keeps passing unchanged in this task. Run it and `inmutabilidad.test.ts` and read both as passing. The golden huella block is not touched.

Run step 1's tests — PASS. Then each touched package's whole suite once.

- [ ] **Step 3: Commit**

```bash
git commit -s -m "Sales, payments and fiscal records name their source and device

Sales, Veri*Factu records, card payments, bill payments, bill refunds and unpaid
departures now store the source and device they came from, beside the till they
still name. Demo sales are recorded as demo_seed and the fiscal readiness test sale
as readiness_test. A stuck card payment resolved from the dashboard files its sale
under the device that started the payment. The huella is unchanged."
```

---

## Task 7: Printing and the cash drawer follow the device

**Files:**
- Modify: `apps/server/src/receipt-print.ts`, `apps/server/src/payment-slip-print.ts`, `apps/server/src/receipt-preview-api.ts`, `apps/server/src/till-sale.ts` (receipt, reprint, payment-slip paths), `apps/server/src/till-api.ts` (receipt, payment-slip, reprint, drawer-open routes; status map loses `drawer.till_switched_off`), `apps/server/src/bill-payments.ts` and `bill-payments-loop.ts` (the loop passes `deviceOrigin(payment.device_id)`), `apps/server/src/device-session.ts` (delete `assertNotHandheld`, `deviceTillCfg`'s `allowCashDrawer`), `apps/server/src/till-config.ts` (delete `allowCashDrawer`), `apps/server/src/errors.ts` (delete `drawer.till_switched_off`), `apps/server/src/print-api.ts` (delete `GET /management-api/tills`, `PATCH …/tills/:id/receipt-printer`, `PATCH …/tills/:id/opens-drawer`)
- Modify: `apps/dashboard/src/screens/printing-rules-screen.ts` (+ test), `apps/dashboard/src/api/client.ts` (delete `Till`, `listTills` only if no other screen still watches it — the devices screen's pairing dialog does until Task 14, so keep `listTills` and `Till`; delete `setTillReceiptPrinter`, `setTillOpensDrawer`), `apps/dashboard/src/i18n/strings.ts`
- Modify: `apps/till/src/till-app.ts` (`drawerErrorKey` loses `drawer.till_switched_off`), `apps/till/src/i18n/strings.ts`, `apps/till/src/api/client.ts`
- Test: `apps/server/src/receipt-print.test.ts`, `till-api.receipt.test.ts`, `till-api.reprint.test.ts`, `sale-till-source.receipt.test.ts`, `receipt-preview-api.test.ts`, `print-api.printer-wiring.test.ts`, `bill-payments-loop.test.ts`, `payment-slip-print` suite, `apps/dashboard/src/screens/printing-rules-screen.test.ts`, `apps/till/src/till-app.test.ts`

**Interfaces:**
- Consumes: `OriginConfig` (Task 5), devices' two printer columns (Task 3), `bill_payments.device_id` (Task 6).
- Produces in `receipt-print.ts`:
  - `interface DevicePrinter extends EscSetting { id: string; hasCashDrawer: boolean; opensDrawer: boolean }` (`opensDrawer` = the device's profile has `open-cash-drawer`)
  - `resolveReceiptPrinter(tx, origin: Origin): Promise<DevicePrinter | undefined>` — the device's current receipt printer when active; `undefined` for a job origin or no printer
  - `resolvePaymentSlipPrinter(tx, origin: Origin): Promise<DevicePrinter | undefined>` — same for `payment_slip_printer_id`
  - every `enqueue*` function takes `cfg: OriginConfig`; drawer paths use `drawerPrinter(tx, origin)`: the receipt printer when `opensDrawer && hasCashDrawer`, else `undefined`.

- [ ] **Step 1: Failing tests — the behaviours that tell old from new (spec §10)**

In `apps/server/src/till-api.receipt.test.ts` (or `sale-till-source.receipt.test.ts`, whichever already enrols two devices), with printers R1, R2, S1 at the location, device A (receipt R1, slip S1) and device B (receipt R2, slip R2), both profiles listing what they hold:

- (a) A's receipt route queues a `document` job on R1; B's on R2 — and **neither** on the setup till's printer (set the setup till's `receipt_printer_id` to a third printer R3 in the fixture and assert no job on R3).
- (b) A's payment-slip route for a card sale queues the slip on **S1**, not R1.
- (c) A's reprint queues on R1.
- (d) A switches its slip printer to R1 through `PUT /api/device/printers`; A's next payment slip goes to R1.
- (e) **Review Focus 2.** A cash sale on a device whose profile has `open-cash-drawer` and whose receipt printer has NO drawer: 200, no `drawer_opens` row, no `drawer` job.
- (f) A cash sale on a **handheld** (phone-portrait profile) with `open-cash-drawer` and a drawer printer: one `drawer_opens` row (`reason = 'cash_sale'`) and one `drawer` job (replaces the handheld-never-opens assertions — class (b)).
- (g) A cash sale on a **till** whose profile lacks `open-cash-drawer`, with a drawer printer: no drawer row or job.
- (h) `POST /api/drawer/open` from a handheld whose profile has `open-cash-drawer` → 200 and a `manual` drawer row; from a profile without it → 403 `device.forbidden_action` (unchanged); from a device with no receipt printer → `drawer.no_printer` (unchanged).

`bill-payments-loop.test.ts`: with the location's receipt print mode `auto`, a card bill payment started on A and completed by the loop, which issues the invoice (`completeBillPayment` → `issueWhenFullyPaid` → `enqueueSaleReceipt`, `bill-payments.ts` ~1154 and ~750), queues the receipt on R1; the same payment started on B queues it on R2.

`receipt-preview-api.test.ts`: the preview's paper width is chosen from the location's ACTIVE devices' current receipt printers (two devices on 58 mm and one on 80 mm printers → the setting `chooseSetting` picks today from the same counts), not from tills.

`printing-rules-screen.test.ts`: the screen renders no `till-row-*`, no `till-receipt-printer-*`, no `till-opens-drawer-*` and no `no-tills`; it never calls `listTills`; its routing, receipt print mode and drawer policy sections render as before (delete the per-till describe block and the `listTills` reload assertions — class (a)).

`apps/till/src/till-app.test.ts`: the `drawer.till_switched_off` banner case goes (class (a)).

Run them — Expected: FAIL.

- [ ] **Step 2: Implement the server**

Rewrite `resolveReceiptPrinter` to read from the device:

```ts
export async function resolveReceiptPrinter(
  tx: Transaction,
  origin: Origin,
): Promise<DevicePrinter | undefined> {
  return resolveDevicePrinter(tx, origin, devices.receiptPrinterId);
}

export async function resolvePaymentSlipPrinter(
  tx: Transaction,
  origin: Origin,
): Promise<DevicePrinter | undefined> {
  return resolveDevicePrinter(tx, origin, devices.paymentSlipPrinterId);
}

async function resolveDevicePrinter(
  tx: Transaction,
  origin: Origin,
  column: typeof devices.receiptPrinterId | typeof devices.paymentSlipPrinterId,
): Promise<DevicePrinter | undefined> {
  if (origin.source !== "device") return undefined;
  const [row] = await tx
    .select({
      id: printers.id,
      hasCashDrawer: printers.hasCashDrawer,
      paperWidth: printers.paperWidth,
      resolution: printers.resolution,
      capabilities: deviceProfiles.capabilities,
    })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .innerJoin(printers, and(eq(printers.id, column), eq(printers.active, true)))
    .where(eq(devices.id, origin.deviceId));
  if (row === undefined) return undefined;
  const { capabilities, ...printer } = row;
  return { ...printer, opensDrawer: (capabilities as string[]).includes("open-cash-drawer") };
}
```

`drawerPrinter(tx, origin)` returns the receipt printer when `printer.opensDrawer && printer.hasCashDrawer`. Every `enqueue*` passes `cfg.origin`. `payment-slip-print.ts` calls `resolvePaymentSlipPrinter`. `drawer_opens` keeps writing `tillId: cfg.tillId` in this task (Task 12 changes it).

The drawer-open route: delete `assertNotHandheld` (its only caller) and the `!printer.tillOpensDrawer` branch; `drawer.no_printer`'s params change from `{ tillId }` to `{ deviceId }` (`apps/server/src/errors.ts` ~814, and the till's wording if it shows a param); keep `assertDeviceCapability(..., "open-cash-drawer", ...)`, `drawer.no_printer` and `drawer.not_attached`. Delete `allowCashDrawer` from `TillConfig` and `deviceTillCfg`. Delete the three per-till routes in `print-api.ts` and `drawer.till_switched_off` everywhere (`rg -n "till_switched_off"`).

`receipt-preview-api.ts`: replace the `tills` join with `devices` (active, at `cfg.locationId`) joined to their current receipt printer (active), ordered by `devices.label`, `devices.id`.

- [ ] **Step 3: Implement the dashboard and till app**

Remove the per-till section from `printing-rules-screen.ts` (`#renderTillPicker`, `#setTillPrinter`, the `tills` state and load, the `printers.receipt_printer_title` subsection, the `no-tills` text) and the strings only it used (`printers.receipt_printer_title`, `printers.receipt_printer`, `printers.opens_drawer`, `printers.receipt_no_printer`, `printers.no_tills`) — `rg` each key first; delete only those with no other reader. Delete the two client calls. Till app: delete the `drawer.till_switched_off` string and mapping.

Run step 1's tests — PASS. Run each touched suite whole once, then `pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/alert-codes.test.ts`.

- [ ] **Step 4: Look at the Printing rules screen** in both themes and at 390 px: the remaining three sections only, no gap where the per-till section was.

- [ ] **Step 5: Commit**

```bash
git commit -s -m "Receipts, payment slips and the cash drawer follow the device

Every receipt, reprint and payment slip prints on the requesting device's own current
printer: receipts on its receipt printer, card slips on its payment slip printer. A
drawer opens when the device's profile allows it and its receipt printer has one,
handhelds included; a till whose profile does not allow it opens nothing. A payment
finished in the background prints on the device that started it. The Printing rules
screen loses its per-till section and the per-till drawer switch, with their routes."
```

---

## Task 8: The till app — Open drawer by profile, and the printer switcher

**Files:**
- Create: `apps/till/src/widgets/printers-dialog.ts`, `printers-dialog.test.ts`, `printers-dialog.a11y.test.ts`
- Modify: `apps/till/src/api/client.ts` (`DeviceIdentity` gains `paymentSlipPrinterId` and `printerChoices`; new `setDevicePrinters(body)` → `PUT /api/device/printers`), `apps/till/src/till-app.ts` (`canOpenDrawer` from the capability; `#onOpenDrawer` loses its handheld early return; holds the device identity's printers; renders the dialog), `apps/till/src/widgets/tab-shell.ts` and `apps/till/src/screens/till-counter-screen.ts` (a `printers` button emitting `open-printers`), `apps/till/src/i18n/strings.ts`
- Test: `apps/till/src/till-app.test.ts`, `apps/till/src/api/client.test.ts`, `tab-shell` and `till-counter-screen` suites and their `.a11y` files

**Interfaces:**
- Consumes: `GET /api/device/me` and `PUT /api/device/printers` (Task 3).
- Produces: `<till-printers-dialog>` with properties `open: boolean`, `receipt: { current: string | null; choices: { id: string; name: string }[] }`, `paymentSlip: { … same }`; emits `printers-change` with `detail: { receiptPrinterId?: string | null; paymentSlipPrinterId?: string | null }` (app-owned component, plain event name — CLAUDE.md §3) and `close`.

- [ ] **Step 1: Failing tests**

`printers-dialog.test.ts`:
- (a) Receipt choices `[P1, P2]` with current P1 render a `wt-combobox name="receiptPrinterId"` with both options and P1 selected; choosing P2 emits `printers-change` with `{ receiptPrinterId: "P2" }` only.
- (b) Slip choices `[S1]` with current S1 render read-only text "S1" and no combobox.
- (c) Empty choices render `t("printers.none")` for that row.
- (d) **Review Focus 3.** A current id not among the choices (an inactive printer) renders as `t("printers.none")` in the read-only case and with no option selected in the combobox case.
- (e) A refused change (the app sets `error` to `device.binding_invalid`) shows the localized message under the field it names, per the forms contract.

`till-app.test.ts`:
- (f) A handheld whose `capabilities` include `open-cash-drawer` shows `open-drawer` on the ticket and calling it calls `api.openDrawer()` (replaces the handheld-hides-drawer case — class (b)); a till without the capability does not show it.
- (g) Clicking the header's Printers button opens the dialog with the device's printers; a `printers-change` calls `setDevicePrinters` with the detail and, on success, updates the shown current printer; a refusal leaves the dialog open with the message.

`api/client.test.ts`: `setDevicePrinters({ paymentSlipPrinterId: "S1" })` sends `PUT /api/device/printers` with that body.

Add the dialog's states and the header button to the `.a11y` files, both themes. Run: `pnpm --filter @waitron/till exec vitest run src/widgets/printers-dialog.test.ts src/till-app.test.ts src/api/client.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement** the dialog (`wt-dialog` or the dialog primitive the till already uses — `rg -n "wt-dialog" apps/till/src/widgets | head`), the header buttons, the client call and the app wiring. Strings (en / es): `printers.open` "Printers" / "Impresoras"; `printers.title` "This device's printers" / "Impresoras de este dispositivo"; `printers.receipt` "Receipt printer" / "Impresora de tickets"; `printers.payment_slip` "Payment slip printer" / "Impresora de comprobantes de pago"; `printers.none` "No printer" / "Sin impresora"; and `device.binding_invalid` in `codes.ts` if the till has no wording for it yet. Run step 1 — PASS.

- [ ] **Step 3: Look** at the dialog and the header with the new button on a till and on a phone (390 px), both themes; the header must not wrap badly on a phone.

- [ ] **Step 4: Commit**

```bash
git commit -s -m "Till app: the drawer button follows the profile, and staff can switch printers

The Open drawer button shows wherever the device's profile allows the drawer,
handhelds included. A Printers button beside Allergens shows the device's current
receipt and payment slip printers and, where its profile lists more than one, lets
staff switch mid-service, for example to a portable printer for card slips."
```

---

## Task 9: Alerts name their source and device

**Files:**
- Schema: `packages/db/src/schema/incidents.ts` — replace `tillId` with `source: sourceColumn("source").notNull()` and `deviceId: id("device_id").references(() => devices.id, { onDelete: "restrict" })`; `originChecks("incidents", …)`; `incidents_till_open_idx` becomes `incidents_origin_open_idx` on `(source, device_id, detected_at)`; `incidents_open_dedup` keys on `(source, case when device_id is null then '' else device_id end, code, case when sale_id is null then '' else sale_id end)` where unacknowledged. Not `coalesce(…)`: drizzle-kit splits an index expression on its commas and writes a broken index (recorded at `packages/db/src/schema/incidents.ts` ~59–61).
- Migration: core, `incidents` (no triggers, no children), two generations: `db:generate --name incident_origin_add`, then `--name incident_origin_drop_till`; a `RESETS` entry for each step the walk refuses (the first refuses on `__new_incidents.source`).
- Code: `packages/core/src/incidents.ts` (`RecordIncidentInput.origin: Origin` replaces `tillId`; `recordIncidentOnce`'s raw `on conflict` target is the new index's expression list written identically, both `case when` expressions included; `openIncidents(tx, origin)`; `Incident`/`TenantIncident` carry `source`, `deviceId`, and `deviceName: string | null` from a left join to `devices`), `packages/core/src/record-sale.ts`, `record-substitution.ts`, `record-correction.ts`, `record-void.ts`, `settle-sale.ts` (incidents use the sale's origin — `record-void`/`settle-sale` read it from the sale row's `source`/`device_id` columns via `readOrigin`), `packages/fiscal-verifactu/src/chain.ts` (`raiseWarning` uses the registro's origin), `drain.ts` and `reconcile.ts` (`jobOrigin("fiscal_filing")`), `packages/payments/src/reconcile.ts`, `packages/payments-sumup/src/provider.ts`, `packages/payments-stripe/src/device-provider.ts`, `apps/server/src/bill-payments-loop.ts`, `bill-refund-alerts.ts` (`jobOrigin("payment_check")`; the `IncidentSink` input in `packages/payments/src/reconcile.ts` takes `origin`; the per-till grouping goes, and `tillsForWorkingOrders` — `packages/payments/src/store.ts` ~768, exported from `packages/payments/src/index.ts` — is deleted with its callers in `payments/src/reconcile.ts` and `payments-sumup/src/provider.ts`), `apps/server/src/dish-not-sent-alert.ts`, `closed-station-alert.ts` (`cfg: OriginConfig`, use `cfg.origin`), the alerts API and the dashboard alert list (show `deviceName`, or the source's name), the error registries whose codes' params name `tillId` — `sale.tender_unsettled`, `sale.tender_shortfall` and `chain.verification_failed` are in `packages/core/src/errors.ts`; `rg -n "tillId" packages/*/src/errors.ts apps/server/src/errors.ts` lists the rest — replace `tillId` with `deviceId: string | null`, `apps/dashboard/src/i18n/alert-messages.ts` if any wording names `{tillId}`.
- Dashboard: `apps/dashboard/src/i18n/strings.ts` gains `source.<name>` for every job source, en + es: `dashboard` "Dashboard" / "Panel"; `fiscal_filing` "Veri*Factu filing" / "Envío Veri*Factu"; `payment_check` "Payment check" / "Comprobación de pagos"; `kitchen_timer` "Kitchen timer" / "Temporizador de cocina"; `demo_seed` "Demo data" / "Datos de demostración"; `readiness_test` "Readiness test" / "Prueba de preparación".
- Test: `packages/core/src/incidents.test.ts`, the payments reconcile suites, fiscal-verifactu drain/reconcile suites, `apps/server/src/alerts-api.test.ts`, `alerts.test.ts`, the dashboard alerts screen suite, `scripts/alert-codes.test.ts`

**Interfaces:**
- Produces: `recordIncident(tx, { origin: Origin; saleId?; error; severity; detectedAt })`, `recordIncidentOnce(…same)`, `openIncidents(tx, origin: Origin)`.

- [ ] **Step 1: Failing tests**

- `incidents.test.ts`: an incident recorded with `deviceOrigin(D)` stores `('device', D)`; with `jobOrigin("fiscal_filing")` stores `('fiscal_filing', null)`; `recordIncidentOnce` twice with the same origin, code and sale writes one row; with two different devices, two rows; with the same job source and no sale, one row. Replace the till-keyed cases (class (a)).
- **spec §10:** a fiscal filing alert raised by the drain (`drain.test.ts`'s retry-exhausted or rejected case) records `('fiscal_filing', null)`, not the sale's device.
- Payment checking: `packages/payments/src/reconcile.test.ts` — a mismatch raises its incident as `('payment_check', null)`; the SumUp unactionable-pending case raises one incident (not one per till) as `('payment_check', null)`; two `payment.bill_capture_mismatch` problems with no sale, open at once, leave one open alert (decision 13 — pin it so the collapse is deliberate).
- `dish-not-sent` (`working-order.pay-and-dispatch.test.ts` or the suite that covers it): the alert from a sale on device D records `('device', D)`.
- `alerts-api.test.ts`: the list returns `deviceName` for a device alert and `source` for a job alert; the dashboard alert row shows the device's name or the source's localized name.
- The database refuses an incident row `('dashboard', D)` and `('system', null)` (write it raw; assert the CHECK names).

Run — Expected: FAIL.

- [ ] **Step 2: Implement** schema → migration (`RESETS`) → `incidents.ts` → every caller (follow the compiler). For `recordIncidentOnce`'s raw SQL, write the conflict target to equal the unique index expression exactly, or SQLite raises `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`. `apps/server/src/pass.ts`'s comment about `incidents.till_id` being NOT NULL is now false: delete it (spec §5 says raising a no-record alert is out of scope). If, grepping, no kitchen alert is raised by time, note `kitchen_timer` unused in the commit (decision 11).

Run step 1, the touched packages' suites, "How to change a table's columns" step 8, and `pnpm exec vitest run scripts/alert-codes.test.ts scripts/ongoing-alert-codes.test.ts`.

- [ ] **Step 3: Look** at the dashboard alert list in both themes at 390 px with one device alert and one job alert.

- [ ] **Step 4: Commit**

```bash
git commit -s -m "Alerts name their source and device instead of a till

An alert raised on a device names that device; one raised by the Veri*Factu filing
pass names fiscal_filing, and one raised by a card or bill payment check names
payment_check. A payment check's alerts are no longer split by till: while one is
open, a second alert with the same code and no sale is not added. The dashboard's
alert list shows the device's name or the source's name."
```

---

## Task 10: Money records lose their till; the cash-up and daily close count by device

**Files:**
- Schema: in `sales`, `bill_payments`, `bill_payment_refunds`, `unpaid_departures`, `registros_facturacion`, `payments`: drop `till_id` (where present), make `source` NOT NULL, add `originChecks`. The sale tables use `saleSourceColumn`.
- Migrations (follow "How to change a table's columns" for each):
  - core: `…_money_records_drop_triggers` (drop `bill_payments_guard_update`, `bill_payments_no_delete`, `bill_payment_refunds_guard_update`, `bill_payment_refunds_no_delete`, `sale_settlements_check_coverage`), `…_money_records_lose_till` (generated rebuilds of `sales`, `bill_payments`, `bill_payment_refunds`, `unpaid_departures`), `…_money_records_recreate_triggers` (recreate the five; copy the bill payment pair from `packages/db/drizzle/0024_bill_payment_triggers.sql` and replace `AND new.till_id IS old.till_id` with `AND new.source IS old.source AND new.device_id IS old.device_id`; copy `sale_settlements_check_coverage` unchanged from the latest file that defines it — `rg -l "sale_settlements_check_coverage" packages/db/drizzle`)
  - fiscal-verifactu: `…_registro_lose_till` (rebuild; no hand-written triggers on it)
  - payments: `…_payment_origin_required` (rebuild)
  - `RESETS` entries for each step the walk refuses.
- Code: delete every `tillId` from `RecordSaleInput`, `RecordSubstitutionInput`, `RecordCorrectionInput`, `SaleForFiscalRecord`, `PendingRegistro`, `RegistroRowContext`; `record-sale.ts`/`record-substitution.ts`/`record-correction.ts` stop reading `tills` for the location (read `cfg`/input `locationId` — add `locationId: LocationId` to the inputs if they do not carry one; every caller has `cfg.locationId`); `record-void.ts`, `settle-sale.ts`, `list-outstanding-sales.ts`, `backend.recordVoid` read the stored origin; `bill-payments.ts` (`completeBillPayment` takes the row's origin rather than overriding `tillId`), `bill-payments-loop.ts`, `payments-api.ts` (stuck lists return `deviceId` and `deviceName` from a left join to `devices`; stuck resolve passes the payment's origin), `till-api.ts`/`unpaid-departure-api.ts`/`cancel-credit.ts`/`working-order.ts` (`requireSaleTillId`, `withSaleTillWhenIssuing`, `deviceSaleCfg`, `saleTillId` go — the request's `origin` is what files the sale), `packages/reporting/src/cash-up.ts`, `close-types.ts`, `types.ts`, `record-daily-close.ts`, `daily-close-hash.ts`, `errors.ts` (`close.invalid_cash_input` `tillId?` → `deviceId?`; reasons `duplicate_till`/`uncounted_cash_till`/`unknown_till` → `duplicate_device`/`uncounted_cash_device`/`unknown_device`), `packages/db/src/schema/daily-closes.ts` (the snapshot mirror type), the report API that returns the cash-up, `apps/dashboard/src/api/client.ts` (`TillCashUpRow` → `OriginCashUpRow { source; deviceId; deviceName; byMethod; cashTakings }`, `CashUpDto.byOrigin`; the stuck rows' `tillId`/`tillName` → `deviceId`/`deviceName`), `dashboard-sales-screen.ts`, `payments-screen.ts`, `live-queries.ts` (the stuck lists name `devices`, not `tills`)
- Test: every suite of the files above; `packages/fiscal-verifactu/src/write-path.e2e.test.ts`'s "till_id is inert" block becomes "the source and device are inert to the huella and the chain" (class (a)). Its golden block and `inmutabilidad.test.ts` get ONLY the setup edits the Global Constraints allow (the raw insert's column list; the golden input's `tillId` → origin); every golden literal and assertion stays byte for byte — diff both files before committing and read every changed line.

**Interfaces:**
- Produces (reporting, decision 15): `OriginCashUp { source: Source; deviceId: DeviceId | null; byMethod: TenderMethodLine[]; cashTakings: Decimal }`; `CashUp.byOrigin: OriginCashUp[]` (one row per device, plus one per job source with takings; `tenderTotal` and `tipTotal` sum every row, as today); `DeviceReconciliation { deviceId: DeviceId; openingFloat; payouts; countedCash; cashTakings; cashVariance }`; `DailyCloseSnapshot.cashReconciliation.byDevice` (device rows only); `CashCountInput.deviceId`. The dashboard row heading is the device's name, or the source's localized name (Task 9's `source.*` strings) for a job row.

- [ ] **Step 1: Failing tests**

- **spec §10, database refusals** (in `scripts/behavioural-triggers.test.ts` or a new `packages/db/src/schema/sales.origin.test.ts` using `useVenueDb`): an insert into `sales` with `('dashboard', null)` is refused by `sales_source_ck`; `('device', null)` by `sales_source_device_ck`; `('payment_check', null)` into `payments` by `payments_source_ck`; `('device', D)` succeeds. The same for `registros_facturacion` (raw insert with the other columns from an existing fixture).
- `bill_payments_guard_update` refuses changing `device_id` on a bill payment (the trigger's new arm); refuses changing `source`.
- `packages/reporting/src/cash-up.test.ts`: cash sales on devices A and B and a bill payment on A → `byOrigin` rows for A and B with the exact amounts the till-keyed version had (class (d)); a `demo_seed` cash sale adds a `('demo_seed', null)` row and still counts in `tenderTotal`.
- `record-daily-close.test.ts`: counts keyed by device; `duplicate_device`, `uncounted_cash_device`, `unknown_device` refusals with `deviceId` params; the snapshot carries `byDevice`.
- `daily-close-hash.test.ts`: two snapshots differing only in a `byDevice[].deviceId` hash differently.
- `payments-api.test.ts`: the stuck payment list returns `deviceName` of the device that started the payment.
- **spec §5.** Attesting a stuck bill payment from the dashboard (`payments-api.ts`'s attest route) and resolving one (its resolve route), and the same two for a bill refund, leave the row's `source`/`device_id` as the device stored, and the sale the attest issues carries that device, not `dashboard`.
- `dashboard-sales-screen.test.ts`: the per-device table's row heading is the device's NAME, not a raw id (spec §8).
- **Review Focus 4.** Revoke device A after it sold; the Sales screen's row, the stuck-payments row and the alert list still show A's name (`deviceName` comes from a join that does not filter `active`).

Run — Expected: FAIL.

- [ ] **Step 2: Implement** schema → migrations (three files in core; one each in fiscal-verifactu and payments) → `RESETS` → code, following the compiler from the deleted `tillId` fields. `requireSaleTillId` and `device.till_required`'s throws go; `device.till_required` itself goes in Task 14 with its strings if a reader remains — `rg -n "till_required"`. Run step 1, every touched package's suite, "How to change a table's columns" step 8, and `pnpm exec vitest run scripts/live-subscriptions.test.ts`.

- [ ] **Step 3: Look** at the Sales screen's per-device table and the payments screen's stuck rows in both themes at 390 px.

- [ ] **Step 4: Commit**

```bash
git commit -s -m "Sales and payments lose their till; the cash-up counts by device

Sales, Veri*Factu records, card payments, bill payments, refunds and unpaid
departures no longer name a till. The database refuses a sale or payment whose
source is not a device, the demo seed or the readiness test, and a row whose source
and device do not pair. The cash-up and the daily close count cash per device, and
the Sales screen names each device rather than showing a raw id. The huella is
unchanged."
```

---

## Task 11: Orders name their source, device and location

**Files:**
- Schema: `packages/db/src/schema/orders.ts` — replace `tillId` with `source: sourceColumn("source").notNull()`, `deviceId` (fk `devices` `restrict`), `locationId: id("location_id").notNull().references(() => locations.id, { onDelete: "restrict" })`, `originChecks("working_orders", …)`.
- Migrations (core), per "How to change a table's columns":
  - `…_working_orders_drop_triggers`: drop the three ON `working_orders` and the seven on `working_order_lines` that read it (table above).
  - `…_working_orders_add_origin`, then `…_working_orders_drop_till`: the two generated rebuilds ("How to change a table's columns" step 3).
  - `…_working_orders_recreate_triggers`: recreate all ten. Copy `working_orders_enforce_transition` from `0056_placed_order_handover.sql` and replace each `new.till_id IS old.till_id` with `new.source IS old.source AND new.device_id IS old.device_id AND new.location_id IS old.location_id`. Copy the two `…_check_locales_insert`/`…_check_variant_locales_insert` from `0027_line_vat_class_triggers.sql` and the two `…_update` from `0064_line_locale_triggers_text_only.sql`, replacing `JOIN tills t ON t.id = wo.till_id JOIN locations l ON l.id = t.location_id` with `JOIN locations l ON l.id = wo.location_id`. Copy the three `…_require_open_parent_*` and the two `working_orders_release_main_bill*` unchanged from their latest files (`0066_line_make_at_station_trigger.sql` for `…_require_open_parent_update` — NOT `0053`, which would undo the make-at-station change; `0045_recreate_triggers_after_rebuild.sql` for the release pair; `rg -l` the rest and take the highest number).
  - `RESETS`: each rebuild is refused while restrict children hold rows (the walk prints the text) — one `refused` entry per refusing step.
- Code: `apps/server/src/working-order.ts` (`createOpenOrder(tx, cfg: OriginConfig, …)` writes `source`, `device_id`, `location_id = cfg.locationId`), every caller (`parkOrder`, `openTab`, `partyMainBill`, `splitBill`, `payWorkingOrder`, `payIntegrated`), `apps/server/src/parties.ts` (`seatTable(tx, cfg: OriginConfig, req)`), `apps/server/src/boot.ts` (`core.seatTable` binds `{ ...till, origin: jobOrigin("dashboard") }`), `packages/module/src/module.ts` (fix the comment at line ~29 to say the origin is `dashboard`), `packages/bookings/src/testing/fake-core.ts`, readers that joined `tills` for the location: `watcher-board.ts`, `station-move.ts`, `location-settings-api.ts`, `packages/venue-service/src/kitchen-notices.ts`, `payments-api.ts` (any left), `packages/payments/src/store.ts` (`ReconcilableRow.tillId` and `tillsForWorkingOrders` are gone after Task 9 — confirm), `trigger-refusals.ts` unchanged.
- Test: `packages/db/src/schema/orders.test.ts`, `orders.transition.test.ts`, `scripts/behavioural-triggers.test.ts` (seed rows and cases for the transition and locale triggers), `apps/server/src/booking-seat.test.ts`, `working-order.test.ts`, `till-api.parties.test.ts`, `watcher-board.test.ts`, `station-move.test.ts`, `kitchen-notices.test.ts`, every suite inserting `working_orders` directly (they gain `source`, and `device_id` or `'dashboard'`, and `location_id` — setup only)

- [ ] **Step 1: Failing tests**

- **spec §10.** `booking-seat.test.ts`: seating a booking from the dashboard creates an order with `('dashboard', null)` and `location_id` = the booking's location.
- `till-api.parties.test.ts` / `till-api.tables.test.ts`: seating a table from device D creates an order with `('device', D)`; parking from D likewise.
- `orders.transition.test.ts`: `working_orders_enforce_transition` refuses changing `device_id`, `source` or `location_id` on a placed order (one case each), and still allows the handover stamp (`0056`'s exception).
- `behavioural-triggers.test.ts`: the locale triggers refuse a line whose names miss the ORDER's location's invoice languages, read through `working_orders.location_id` (re-point the existing cases' seed rows; the refusals asserted are the same).
- The database refuses an order `('kitchen_timer', D)` (`working_orders_source_device_ck`).

Run — Expected: FAIL.

- [ ] **Step 2: Implement** schema → three migrations → `RESETS` → code. Run step 1, "How to change a table's columns" step 8, and the whole `apps/server`, `packages/bookings`, `packages/venue-service` suites that touch orders once each.

- [ ] **Step 3: Commit**

```bash
git commit -s -m "Orders name who opened them and where, not a till

An order records its source and device and carries its own location, which the
line-language checks now read directly. Seating a booking from the dashboard opens
its order as dashboard. The order-transition trigger holds the new columns fixed as
it held the till."
```

---

## Task 12: Order history, working time, drawer openings and the trusted clock

**Files:**
- `packages/db/src/schema/order-amendments.ts` (`capturedBySource: sourceColumn("captured_by_source").notNull()`, `capturedByDeviceId: id("captured_by_device_id")` fk `devices` `restrict`; `originChecks` on the two — write the CHECK names as `order_amendments_captured_by_source_ck` / `…_source_device_ck` by passing those names), `packages/db/src/order-amendment-hash.ts` (+ test), `packages/db/src/append-order-amendment.ts` (+ test), `apps/server/src/working-order.ts` (`markOrderPlaced`, `cancelPlaced` pass `cfg.origin`), `apps/server/src/unpaid-departure.ts`
- `packages/workforce/src/schema/time-entries.ts` (`captured_by_source` NOT NULL — spec §2.2, every record carries a source — and `captured_by_device_id`, with `originChecks` under the names `time_entries_captured_by_source_ck` / `…_source_device_ck`), `chain-hash.ts` (+ test), `chain.ts` (+ test), `clocking.ts` (`tillId` inputs → `origin: Origin`, required; a manually recorded entry and an approved correction are `jobOrigin("dashboard")`)
- `packages/db/src/schema/drawer-opens.ts` — `tillId` → `deviceId` (fk `devices`, nullable); rewrite `drawer_opens_target_ck` on `device_id` with the same arms; `apps/server/src/receipt-print.ts` writes `deviceId: cfg.origin.deviceId` (every drawer path has a device origin; a calibration writes none)
- `packages/fiscal/src/clock.ts` (`TrustedClockOptions.tillId` → `deviceId: string`), `packages/fiscal/src/errors.ts` (`clock.degraded` `{ deviceId; anchorAgeSeconds }`), `apps/dashboard/src/i18n/alert-messages.ts` if its wording names `{tillId}`
- Migrations: core `order_amendments` and `drawer_opens`, workforce `time_entries` — each two generations (add, then drop the till column; "How to change a table's columns" step 3); no hand-written triggers on any of them (the append-only pairs are reinstalled by `applyMigrations`); a `RESETS` entry per refusing step.

**Interfaces:**
- Produces: `AmendmentHashInput.capturedBySource: Source; capturedByDeviceId: string | null` (replacing `capturedByTillId`); canonical order `…, Reason, CapturedBySource, CapturedByDeviceId, CapturedByNodeId, …` with `CapturedByDeviceId` = `""` when null. `EntryHashInput.capturedBySource: Source; capturedByDeviceId: string | null` (`?? ""` for the device), in `CapturedByTillId`'s position.

- [ ] **Step 1: Failing hash tests (spec §10)**

`packages/db/src/order-amendment-hash.test.ts`:

```ts
it("changes when only the source changes", () => {
  expect(computeAmendmentHash({ ...base, capturedBySource: "dashboard", capturedByDeviceId: null })).not.toBe(
    computeAmendmentHash({ ...base, capturedBySource: "payment_check", capturedByDeviceId: null }),
  );
});

it("changes when only the device changes", () => {
  expect(computeAmendmentHash({ ...base, capturedByDeviceId: DEVICE_A })).not.toBe(
    computeAmendmentHash({ ...base, capturedByDeviceId: DEVICE_B }),
  );
});

it("hashes a missing device as an empty field", () => {
  expect(canonicalString({ ...base, capturedBySource: "dashboard", capturedByDeviceId: null })).toContain(
    "CapturedBySource=dashboard&CapturedByDeviceId=&CapturedByNodeId=",
  );
});
```

(`base` gains `capturedBySource: "device", capturedByDeviceId: DEVICE_A`; export `canonicalString` for the test if it is not exported — or assert through the digest of a hand-built string as the file's golden cases do.) The two recorded golden digests change (class (c)): recompute them from the new canonical string by hand-building the string in the test and hashing it with `createHash("sha256")`, so the golden case still pins the canonical order rather than echoing the function.

`packages/workforce/src/chain-hash.test.ts`: the same three cases for `EntryHashInput`. `chain.test.ts`'s "till swapped" tamper case becomes "device swapped".

`drawer-opens` schema test: a `cash_sale` row with no `device_id` is refused by `drawer_opens_target_ck`; a `calibration` row with one is refused.

`packages/fiscal/src/clock.test.ts`: `clock.degraded` carries `deviceId`.

Run — Expected: FAIL.

- [ ] **Step 2: Implement** schema → migrations (core, workforce) → `RESETS` → hash functions → append paths → callers. Run step 1, the touched suites, and "How to change a table's columns" step 8.

- [ ] **Step 3: Commit**

```bash
git commit -s -m "Order history, working time and drawer openings name the device

Order history and the working-time record now hash the source and device that
captured each entry in place of the till, so a captured entry cannot be re-pointed
at another device. Drawer openings name the device. History recorded before this
change no longer verifies, which is why this ships with a venue reset."
```

---

## Task 13: No setup till and no default till

**Files:**
- `apps/server/src/till-config.ts` (delete `tillId` from `TillConfig`, `WAITRON_TILL_TILL_ID` from `loadTillConfig` and `TILL_ID_VARS` — the partial-config check keeps the other three), `apps/server/src/trading-config.ts`, `apps/server/src/setup-api.ts`, `adopt.ts`, `boot.ts` (promotion `writeTradingEnv`; `mountConfigurationExportApi`'s `tillId`; `mountMirrorBundleApi`'s `designated`), `mirror-bundle.ts`, `mirror-bundle-api.ts`, `mirror-bundle-fetch.ts`, `configuration-export-api.ts`, `configuration-transfer.ts` (drop `tillName` and its validation), `provision.ts` (`recoverProvisionedVenue` matches on location, node and series alone), `fiscal-readiness-runner.ts`, `demo-seed.ts`, `apps/server/scripts/demo-seed/seed.ts` and `seed-floor.ts` (no placeholder till), `apps/server/scripts/dev-setup.ts`, `apps/server/scripts/cloud-integration-fixture.ts`, `apps/server/.env.example`, `apps/till/README.md`
- `packages/provisioning/src/venue-plan.ts` (`AdoptResult` and `VenueRequest` lose the till; the `create-till` action goes), `venue-apply.ts` (the `create-till` branch and the "plan is missing create-till" throw go; `VenueResult` loses `tillId`), `cli.ts` (`--till-name`, its prompt and usage line go)
- `apps/setup/src/screens/venue-screen.ts`, `review-screen.ts`, `setup-app.ts`, `api/client.ts`, `apps/setup/src/i18n/strings/venue.ts` (delete `venue.label.till_name`, `venue.field.till_name`, `venue.help.till_name`, `review.till`, `review.help.till` in both languages)
  - (2026-10-03: A243, #1143, already deleted `review.help.till`. In `apps/setup/src/screens/review-screen.test.ts` three places use the Till row and need updating here: the `everyRowDraft` helper sets `draft.venue.tillName`; "explains every group under its heading, and no row" looks up `[data-test=summary-tillName]`; and "shows the generated demo choices and full location details for review" sets `draft.venue.tillName` and expects `[data-test=summary-tillName]` to read "Caja 1".)
- Every test of the above (class (a)); `apps/server/src/testing/*venue*.ts` helpers stop reading `result.tillId`

**Interfaces:**
- Consumes: Tasks 5–12 (nothing reads `cfg.tillId` for a write any more). If the compiler, after deleting `TillConfig.tillId`, names a writer, that writer was missed by an earlier task: fix it there in this task with a failing test first, and name it in the commit.

- [ ] **Step 1: Failing tests (spec §10)**

- `packages/provisioning/src/venue-plan.test.ts` / `venue-apply.test.ts`: a plan has no `create-till` action; applying it creates no `tills` row and returns no `tillId`.
- `apps/server/src/provision-till.test.ts` (rename to `provision-venue.test.ts` if every case is about the venue): setup completes with no till; a second run finds the half-finished venue by location, node and series (`recoverProvisionedVenue`) with no till name in the request.
- `till-config.test.ts`: `loadTillConfig` succeeds with no `WAITRON_TILL_TILL_ID`; setting it does nothing (the key is not read); the partial-config refusal lists only the three remaining variables.
- `boot.test.ts`: the server starts and sells from a paired device with no `WAITRON_TILL_TILL_ID` in its environment.
- `configuration-transfer.test.ts`: a bundle has no `tillName`; one carrying it is still accepted (an unknown key is ignored) — or refused, matching how the validator treats unknown keys today (read it; state which in the test name).
- `apps/setup`: the venue page has no till name field; the review page has no Till row; the request body has no `tillName`.
- `dev-setup.test.ts`: dev setup writes no `WAITRON_TILL_TILL_ID` and pairs its till, handheld and kitchen display through `enrolDeviceForTest` (the real pairing path) with no setup till.
- Demo (spec §2.8, §7): after a Demo setup through `apps/server/src/demo-seed.ts` and `apps/server/scripts/demo-seed/seed.ts`, `select count(*) from devices` is 0, and every seeded sale carries `('demo_seed', null)` (the second half was pinned in Task 6; keep it). If the demo seed pairs a device today, that pairing goes.

Run — Expected: FAIL.

- [ ] **Step 2: Implement**, deleting rather than defaulting. Run step 1, then each touched package's suites once, and `pnpm exec vitest run scripts/claude-md-pointers.test.ts` (a path a doc names may have gone; Task 15 fixes the prose, but the guard must stay green at every commit — fix a dead pointer here if it fails).

- [ ] **Step 3: Look** at the setup wizard's venue and review pages in both themes at 390 px.

- [ ] **Step 4: Commit**

```bash
git commit -s -m "Setup creates no till, and the server has no default till

Setting up a venue no longer creates a till or asks for its name, and the server no
longer reads WAITRON_TILL_TILL_ID: every record now takes its device from the request
or names its own source. Finding a half-finished setup again matches on the
location, node and series alone. Demo and dev venues start with no devices; dev
setup still pairs its till, handheld and kitchen display the normal way."
```

---

## Task 14: Pairing makes no till, device names are unique, and the tills table goes

**Files:**
- `packages/db/src/schema/devices.ts` (drop `tillId`; add `uniqueIndex("devices_location_label_active_key").on(t.locationId, t.label).where(sql\`${t.active} = 1\`)` — decision 4), `packages/db/src/schema/tenants.ts` (delete `tills`), `packages/db/src/classification.ts` (delete its entry), `packages/db/src/schema/index.ts`, `packages/db/src/trigger-refusals.ts` (`REGISTER_BINDING_REFUSAL` → `NON_KDS_BINDING_REFUSAL = "a non-kds device binds no station or watcher"`; `KDS_BINDING_REFUSAL` → `"a kds device binds a station or a watcher"`), `packages/db/src/testing/seed.ts` (`seedDevice` stops inserting a till)
- Before the rebuild, re-measure what points at `devices`: by now every `device_id` added in Tasks 3–12 is a key into it (about 16, none cascading), so the rebuild of `devices` is refused while any of those tables holds rows — the upgrade walk's `RESETS` entry covers it. The upgrade walk applies migrations in date order across sets, while a real boot runs core before the other sets, so core's `DROP TABLE tills` meets the fiscal-verifactu and workforce sets' till columns already dropped in Tasks 10 and 12; that holds only because every venue is reset (Global Constraints).
- Migrations (core), per "How to change a table's columns": `…_devices_drop_triggers` (drop `device_binding_rule_insert`, `device_binding_rule_update`, `device_profile_form_factor_locked`), `…_devices_lose_till` (the generated rebuild of `devices` and `DROP TABLE tills`), `…_devices_recreate_triggers` (recreate the three from `0072_device_binding_watcher_sql.sql` and the latest file defining `device_profile_form_factor_locked`; in the binding pair delete every `till_id` condition and the `old.till_id IS NOT new.till_id` gate term, keep the kds arm as "exactly one of station or watcher" and make the non-kds arm "no station and no watcher", with the new texts). `RESETS` entry.
- `apps/server/src/device.ts` (delete `createRegister`, `requireLiveRegister`, `TILL_NAME_UNIQUE`; `resolveDeviceBinding` returns no till; a name clash on accept throws `device.name_taken` — translate the unique violation on `devices_location_label_active_key` with `constraintTarget`), `join-requests.ts` (no `tillId`; `registerId` input goes), `join-api.ts` and `device-api.ts` (status maps: delete `device.register_required`, `device.register_name_taken`, `device.till_required`; add `device.name_taken` → 409), `apps/server/src/device-session.ts` (`DeviceBinding.tillId`, `requireSaleTillId`, `deviceTillCfg` go if Task 10 left any), `device-api.ts` `GET /api/device/me` (no `tillId`), `apps/server/src/errors.ts`, `apps/server/src/testing/enrol.ts` (no `registerId`)
- `apps/dashboard/src/screens/devices-screen.ts` (the handheld picker, `bindingOf`'s `"register"`, `#renderBindingPicker`'s register branch, the `tills` state and `listTills` watch go), `apps/dashboard/src/api/client.ts` (delete `Till`, `listTills`, `registerId`), `apps/dashboard/src/api/live-queries.ts` (no `tills`), `apps/dashboard/src/i18n/codes.ts` (`device.name_taken` en/es; delete the three old codes), `apps/dashboard/src/i18n/strings.ts` (`devices.till`), every dashboard test stubbing `listTills`
- `apps/till/src/api/client.ts` (`DeviceIdentity.tillId`, `DevDevice.tillId` go), `apps/till/src/i18n/codes.ts` (`device.till_required` goes), `apps/till/src/screens/till-device-chooser.ts` comment
- Every remaining test file that inserts into `tills` or names `tillId` for a device (the inventory: 101 test files and 11 helpers inserted into `tills` at `810ad27b0`; `rg -l "insert\(tills\)|into tills|tills\b" --glob '*.test.ts' --glob '**/testing/**' --glob '**/test/**'` lists what is left after Tasks 5–13). Each moves to `seedDevice` or loses the till insert — setup only.
- Guards: `scripts/schema-constraints.test.ts`, `scripts/behavioural-triggers.test.ts`, `packages/fiscal-verifactu/src/privileges.expected.ts` (`tills: "SIU"` goes), `packages/db/src/index.test.ts`, `packages/db/src/constraint-target.test.ts`, the `schema-ownership.test.ts` files in identity, workforce and fiscal-verifactu, `packages/fiscal-verifactu/src/migrations.test.ts`, `packages/sync-enrolment/src/migration-tables.test.ts`, `apps/server/src/testing/clear-provision-fixture.ts`
- `packages/shared/src/ids.ts` (delete `TillId`/`tillId` once nothing imports them — `rg -n "TillId|tillId\(" packages apps scripts`)

- [ ] **Step 1: Failing tests**

- `apps/server/src/device.test.ts` / `join-requests.test.ts`:
  - (a) Accepting a till-profile device creates no `tills` row (the table no longer exists after step 2; before it, assert `count(*) from tills` unchanged).
  - (b) Accepting a handheld needs no till and stores no binding beyond its profile.
  - (c) **Review Focus 5** (decision 4). A second ACTIVE device named "Barra" at the same location → `device.name_taken` and the join request survives (the transaction rolls back); the same name at another location → accepted; after revoking the first "Barra", pairing a new "Barra" there → accepted.
- (d) Decision 12: `POST /api/session` from a kitchen display → `403 device.forbidden_action` `{ action: "sign_in" }` (replaces the `device.till_required` sign-in case — class (a)); from a till or a phone → 200.
- `behavioural-triggers.test.ts`: a kds device with both a station and a watcher is refused with the new kds text; a till device with a station is refused with `NON_KDS_BINDING_REFUSAL`; a till device with neither is accepted.
- `devices-screen.test.ts`: accepting a handheld shows no till picker and sends no `registerId` (replaces the picker cases — class (a)); a `device.name_taken` refusal shows its localized message.
- `apps/dashboard/src/api/client-routes.test.ts`: no route names `tills`.

Run — Expected: FAIL.

- [ ] **Step 2: Implement** schema → migrations → `RESETS` → server → dashboard → till → test fixture sweep → guards. Then:

`rg -n "tills\b|tillId|till_id|TillId|tillName|WAITRON_TILL_TILL_ID|register_required|till_required|register_name_taken|till_switched_off|opens_drawer|createRegister" apps packages scripts deploy bench .github .husky`

Expected: no hits outside `packages/*/drizzle/` (shipped migration history, untouched), the new migrations' own `DROP` statements, and words that name till DEVICES rather than till records (for example the `venue.tills` labels in `packages/venue-service/src/dashboard/strings.ts` and the operations screen beside it, which list till devices — read each to decide). Any other hit is a missed reader: fix it.

- [ ] **Step 3: Run every guard and the packages the sweep touched**

`pnpm exec vitest run scripts/` (the root project) and, for each package whose test files the sweep edited, `pnpm --filter <pkg> test:coverage` — read each package's coverage table: still at 98/98/98/95. Check free memory first; run the browser packages (`apps/dashboard`, `apps/till`, `apps/setup`) one or two at a time as headroom allows.

- [ ] **Step 4: Look** at the devices screen's accept dialog for a handheld, both themes, 390 px.

- [ ] **Step 5: Commit**

```bash
git commit -s -m "Pairing makes no till, device names are unique, and the tills table goes

Pairing a till device no longer creates a till record, and a handheld is no longer
pointed at one: the dashboard's till picker is gone. Device names are unique among a
location's active devices (device.name_taken), so a sale's device name identifies
one device, while a revoked device's name can be used again. The tills table and
every column that named it are dropped, with the codes device.register_required,
device.till_required and device.register_name_taken."
```

---

## Task 15: Docs, rules and the backlog

**Files:** `CLAUDE.md` (§5's drawer rule; §1's prose is untouched), `docs/developers/conventions-ui.md` (the drawer section "A till opens its drawer only while it is set to; a handheld does what a till does", retitled), `docs/developers/design-system.md` (the Printing rules screen and the profile editor if described), `docs/developers/conventions-data.md` (any mention of `tills`, `till_id`, `WAITRON_TILL_TILL_ID`, the setup till), `docs/developers/testing-guide.md` and `ci-and-gates.md` (same sweep), `apps/server/README.md`, `apps/till/README.md`, `deploy/` docs, `docs/backlog.md`

- [ ] **Step 1: Sweep every prose claim about tills (CLAUDE.md §1, "a behaviour change retires every receipt")**

`rg -n -i "till record|setup till|tills table|till_id|tillId|WAITRON_TILL_TILL_ID|opens_drawer|per-till|a handheld never opens|handheld.*drawer|till picker|register_required|till_required" --glob '!packages/*/drizzle/**' --glob '!docs/superpowers/**' --glob '!docs/handoffs/**' .`

Read every hit in its paragraph. A historical doc (a dated spec, plan or backlog entry recording what was true then) gets a dated pointer — "2026-10-03: superseded by A238, `docs/superpowers/specs/2026-10-03-till-is-a-device-design.md`" — not a rewrite. A rule or a present-tense description is rewritten to the new behaviour, and every rewritten sentence is a new claim: check each against the code (`file:line`) before keeping it.

- [ ] **Step 2: CLAUDE.md §5's drawer rule** — replace its till- and handheld-specific sentences with: a device opens a drawer when its profile has `open-cash-drawer` and its current receipt printer has one, handhelds included; nothing per-till decides it; `take-cash` decides whether a device may take cash at all (`device.cash_not_allowed`). Keep the parts that still hold (separate audited `drawer` jobs, receipt jobs carry no drawer command, the manual open needs an enrolled device and `cash.drawer` under a `gated` policy, the calibration exception, drawer jobs cannot be resent). Name the guards that still pin each part and their file paths; run `pnpm exec vitest run scripts/claude-md-pointers.test.ts`. CLAUDE.md is format-checked: `pnpm exec prettier --check CLAUDE.md`.

- [ ] **Step 3: Backlog** — mark A238 done with the PR number once known; delete its findings that this change retires; leave A239–A242 as they are (A239 and A240 now say "Needs A238 — landed").

- [ ] **Step 4: Commit**

```bash
git commit -s -m "Docs: a till is a device

The drawer rule in CLAUDE.md, the UI conventions, the design system notes and the
READMEs now describe devices, profiles and their printers instead of till records,
the setup till and WAITRON_TILL_TILL_ID. Historical specs and plans keep their text
with a dated pointer to the A238 spec."
```

---

## After the last task

1. Update the ledger `docs/handoffs/2026-10-03-a238-till-is-a-device.md` (in the main checkout) to say the build is complete and the next step is `/finish-branch`.
2. Run `/finish-branch /Users/clintongormley/workspace/worktrees/waitron-a238-till-is-a-device` with the note "plan: docs/superpowers/plans/2026-10-03-till-is-a-device.md; FULL review path; venue reset in the PR's first line; owner review before landing (fiscal tables)".
3. Rebuild the dev venue with `wa-wt reset demo waitron-a238-till-is-a-device`, pair a till and a phone, and walk: a cash sale on the till (receipt on its printer, drawer opens), a card sale on the phone (slip on its slip printer), switching the phone's slip printer, and a cash attempt on the phone without Takes cash. Screenshots for the PR.
4. Tell the owner the branch is ready to land and that the owner's box needs setting up again.
