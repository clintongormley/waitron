# Table service — TS-2: configurable service statuses

**Date:** 2026-08-17. **Status:** design (approved with the owner); plan to follow.
**Track:** the second slice of the **table-service track** (sub-project 10). **Runs SUPERVISED** (owner
in the loop), NOT in the unattended campaign. **Builds on TS-1**
([tables + tabs](2026-08-17-table-service-ts1-tables-and-tabs-design.md)).

TS-1 gives each table a **derived** occupancy (`free` / `open-tab` / `delivery-pending`) computed from
real orders — the un-driftable source of truth. TS-2 layers a small, **venue-configured** *manual*
status on top (e.g. "Bill requested", "Needs cleaning") that the floor plan renders alongside occupancy.

## 0. Owner decisions this slice is built on (2026-08-17)

- **Derived truth + a few manual flags**, not a hand-maintained lifecycle. TS-1's occupancy stays the
  truth; TS-2 adds only a venue-defined manual layer.
- **One status at a time** (single-select), not multiple simultaneous flags → a single nullable
  `status_id` on the table.
- **Reset on turnover** — a stale "bill-requested" must not linger onto the next party.
- Three defaults confirmed: the status set is **tenant-wide** (per-location deferrable); the dashboard
  **config editor ships in TS-2** (mirroring the #81 layout/receipt editors); reset is done with a **DB
  trigger** so `payWorkingOrder` stays untouched.

## 1. Scope

**In:** a `table_service_statuses` config entity + CRUD (headless) + a dashboard config editor; a single
`dining_tables.status_id`; `setTableStatus`; reset-on-turnover (a settle/abandon trigger + an `openTab`
clear); and the manual status folded into TS-1's `listTablesWithState` read.

**Out:** the floor-plan **toggle UI** for setting a table's status (lands with the floor-plan slice —
TS-2 provides the `setTableStatus` verb + route it calls); per-location status sets; auto-advancing
statuses from order events (explicitly rejected — derived occupancy already covers what the order knows);
a configured non-null default status on turnover (reset is to NULL).

## 2. Data model

### 2a. `table_service_statuses` (new, `packages/db/src/schema/`)

Tenant-scoped venue config (the same shape family as #81's `till_layouts`).

```text
table_service_statuses
----------------------
id            uuid PK
tenant_id     uuid → tenants (restrict)
label         text NOT NULL          ("Bill requested", "Needs cleaning")
color         text NOT NULL          (a floor-plan swatch; a hex/token string, app-validated)
display_order int  NOT NULL DEFAULT 0
active        bool NOT NULL DEFAULT true    (deactivate, never hard-delete — tables may reference it)
created_at    timestamptz NOT NULL DEFAULT now()

UNIQUE (tenant_id, id)                  -- so dining_tables can composite-FK it
UNIQUE (tenant_id, label)              -- no duplicate status names in a venue
```

FORCE RLS + a `table_service_statuses_tenant_isolation` policy + `GRANT SELECT, INSERT, UPDATE TO
app_user` (no DELETE — deactivate) in a **hand-written custom migration** (§3, CLAUDE.md §3). Enumerated
by the `inmutabilidad` guard.

### 2b. `dining_tables.status_id` (new nullable column on the TS-1 table)

```text
status_id  uuid NULL  composite FK (tenant_id, status_id) → table_service_statuses (tenant_id, id)
```

The table's single current manual status. **Shown always** (occupied *or* free — so a "needs-cleaning"
set on a just-vacated table still displays). Additive nullable column on the existing FORCE-RLS
`dining_tables`; its TS-1 policy + `app_user` grants already cover it (grants are table-wide, RLS
row-level — confirm by the RLS test, §7).

### 2c. Migration

One `packages/db` migration (number via `db:generate`, **not hardcoded**): auto part (create
`table_service_statuses`, add `dining_tables.status_id` + its FK) + a **custom** part (FORCE RLS + policy
+ grant on the config table, and the reset **trigger** of §3b). Commit the journal + snapshot. No
backfill (pre-production).

## 3. Behaviour

New code in `apps/server` beside TS-1's `tables.ts` / `working-order.ts`; the dashboard editor in
`apps/dashboard`.

### 3a. Config CRUD + editor

- `createStatus` / `listStatuses` / `updateStatus` / `deactivateStatus` (`apps/server/src/tables.ts`),
  throwing `status.label_taken` / `status.not_found`. **Gated on the existing `till.configure`
  permission** (#81's venue-config permission — reused, not renamed; configuring service statuses is the
  same "the venue configures its POS" bucket as layouts/receipts).
- A **dashboard config editor** (`apps/dashboard`) to author the status set (label + colour +
  display order + activate/deactivate), mirroring the #81 layout/receipt editor screens (a11y both
  themes, browser-local types).

### 3b. Set the status + reset on turnover

- `setTableStatus(tx, cfg, tableId, statusId | null)` — sets or clears a table's manual status; validates
  the table is active and, when non-null, that the status is `active` (`table.not_found` /
  `status.not_found` / `status.inactive`). An **operational** verb (a logged-in operator sets a table's
  status the way they ring a sale) — gated by the operator **session** (`requireSession`), not
  `till.configure`.
- **Reset on turnover — two non-fiscal resets, `payWorkingOrder` / `recordSale` UNCHANGED:**
  1. A hand-written **AFTER-UPDATE trigger** on `working_orders`
     (`working_orders_clear_table_status`): when a row goes `open → settled|abandoned` with `table_id`
     NOT NULL, `UPDATE dining_tables SET status_id = NULL WHERE (tenant_id, id) = (NEW.tenant_id,
     NEW.table_id)`. So "bill-requested" clears the instant the tab settles. The trigger runs
     SECURITY INVOKER as `app_user`, and the update is same-tenant (`tenant_id = NEW.tenant_id`), so the
     `dining_tables` tenant policy + the TS-1 UPDATE grant permit it.
  2. **`openTab`** clears `status_id` on the table as a **new** tab opens (a "needs-cleaning" set while
     the table was free clears as the next party sits). This is a pre-fiscal write on the open path.
- **Fiscal boundary (H2):** the reset is a manual-UI-status cleanup on a non-fiscal table; it touches
  nothing filed. The fiscal pay path is byte-unchanged (grep receipt in the plan).

## 4. Read

Extend TS-1's `listTablesWithState(tx, cfg, locationId?)` to add
`status: { id, label, color } | null` (LEFT JOIN `table_service_statuses` on
`dining_tables.status_id`). Occupancy and the manual status are independent — a `free` table can carry a
`needs-cleaning` status, an `open-tab` table can carry `bill-requested`. The floor plan renders both.

## 5. Fiscal safety (H2)

**None.** TS-2 adds a non-fiscal config table, a nullable status column, a non-fiscal reset trigger, and
a read. Nothing goes near `computeHuella` / the hash chain / `registros_facturacion` / invoice numbering
/ the alta builders; the pay path is unchanged. The plan states this with a grep receipt over
`record-sale.ts` + the alta builders (unchanged from the TS-1 baseline).

## 6. Conventions

- **English identifiers** — `table_service_statuses`, `status_id`, `label`, `color`, `display_order`,
  `active`. No new `SPANISH_WORDS`. UI copy is localised (en/es) via the dashboard i18n layer.
- **Domain-named error codes** (CLAUDE.md §3): `status.not_found`, `status.inactive`, `status.label_taken`.
  Declared in `apps/server/src/errors.ts` (`import "./errors.js"`); never renamed once shipped. Reuses
  `till.configure` (config) — no new permission.
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **Real Postgres** — `table_service_statuses` cross-tenant RLS isolation (by deletion of the tenant
  predicate); the reset **trigger proven by deletion** (open a tab, set a status, settle → `status_id`
  is NULL; drop the trigger → it lingers); the trigger works under the non-superuser `app_user` (it runs
  as the operator role, same-tenant — fails if run cross-tenant).
- **PGlite** — `setTableStatus` set/clear and its guards (`status.inactive` on a deactivated status,
  `status.not_found`, `table.not_found`); config CRUD incl. `status.label_taken`; **`openTab` clears a
  stale status**; a `needs-cleaning` set on a **free** table still appears in the read (occupancy and
  status are independent); `listTablesWithState` returns the joined `status`.
- Guards — `inmutabilidad` green after the migration (`table_service_statuses` reports
  `relforcerowsecurity = true`). Coverage 98/98/98/95 (server/db), 95/95/90/88 (dashboard editor).

## 8. Deferred (named, not built)

- The floor-plan **status-toggle UI** (this slice ships the verb + route; the floor plan wires the tap).
- **Per-location** status sets (tenant-wide for now).
- A **configured default** status on turnover (reset is to NULL).
- **Auto-advancing** statuses from order events (rejected — derived occupancy covers what the order knows).

## 9. Provenance

Designed against the live tree on 2026-08-17, building on the TS-1 design and the #81 layout/receipt
editor pattern (`@waitron/layouts` + `till_layouts` + validate/store + dashboard editors, per
`docs/backlog.md`). The `working_orders` transition-trigger idiom the reset trigger follows is
`working_orders_enforce_transition` (`packages/db/src/schema/orders.ts:36-48`, migration 0030). The
"trigger updating an RLS table under `app_user` works because the row is same-tenant" claim is to be
re-verified on real Postgres in the plan (CLAUDE.md §1) — the same non-superuser-under-RLS discipline
TS-1's tests use, not reasoned from.
