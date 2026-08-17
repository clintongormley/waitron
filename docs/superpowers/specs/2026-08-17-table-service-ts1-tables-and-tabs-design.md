# Table service — TS-1: tables + tabs (the core)

**Date:** 2026-08-17. **Status:** design (approved section-by-section with the owner); plan alongside.
**Track:** the first slice of the **table-service track** (sub-project 10, *tabs*). **Runs SUPERVISED**
(owner in the loop), NOT in the unattended campaign — see
[docs/backlog.md](../../backlog.md) "Table-service track".

The counter POS (#60–64) is walk-up only: a "table" today is just a free-text `label` on a working
order (`packages/db/src/schema/orders.ts:86`; e.g. "Mesa 4" at `apps/server/src/working-order.ts:321`).
This slice introduces the real **tables** primitive and the **running tab**, and is the foundation the
rest of the track leans on (floor plan renders it, KDS routes it, bookings reserve it).

## 0. Owner decisions this slice is built on (2026-08-17)

- **Service model: hybrid.** The venue runs full table service (a waiter tab held open at a table) AND
  counter-order-delivered-to-a-table, side by side.
- **A table carries at most ONE open tab, plus counter deliveries.** Not multiple concurrent tabs
  (confirmed 2026-08-17 over two alternatives — "one tab per dining table + a multi-tab counter table"
  and "many tabs per table everywhere" — both rejected).
- **The counter is NOT a table.** It stays the existing held-order queue (#61 — many concurrent open
  counter orders, none anchored to a table), because it is a *queue*, not an occupancy-bearing spot. Modelling it
  as a multi-tab "table" was considered and rejected: it would force the clean one-tab-per-table DB
  constraint to become conditional, for little gain.
- **QR-code ordering (a future feature) needs NO change to this model.** Order-and-pay-in-one-go is a
  counter-delivery (`delivery_table_id`, no tab); order-onto-the-tab is an `addTabRound` on the table's
  one shared tab; separate checks are TS-5 split-bill. None require multiple concurrent tabs per table.
- **The track is decomposed into slices; this is TS-1 (core).** TS-2 configurable statuses, TS-3
  move/merge, TS-4 transfer-items, TS-5 split-bill each get their own spec. All were requested; they are
  sequenced, not dropped.

## 1. Scope

**In:** the `dining_tables` entity + CRUD (headless); a tab = an `open` working_order anchored to a
table; an **append-only** add-a-round primitive; per-line void on an open tab; pay-closes-the-tab
(reusing the existing fiscal path unchanged); a counter order's "deliver to table N" link; and a
**derived** occupancy read-model.

**Out (each to its slice):** table position / visual layout → floor plan; configurable service statuses
→ TS-2; move & merge → TS-3; transfer items between tabs → TS-4; split the bill → TS-5. Also out: any
waiter-handheld device or new auth (TS-1 reuses the existing till + `@waitron/identity` person session);
kitchen firing of a tab's rounds — see §8.

## 2. Data model

### 2a. `dining_tables` (new, `packages/db/src/schema/`)

Tenant + location scoped, long-lived. Anchored to **`location`** (venue-wide, tenant-scoped —
`packages/db/src/schema/tenants.ts:69`), NOT to `node`: working orders, the held list, the
order-number counter and the prep queue are all node-scoped today
(`working-order.ts:382`, `working_order_counters` PK `(tenant,node)`), and one node == one venue for
now, but a table must not fragment when a venue runs a second node (foreshadowed
`packages/db/src/schema/nodes.ts:6-7`).

```text
dining_tables
-------------
id           uuid PK
tenant_id    uuid  → tenants (restrict)
location_id  uuid  composite FK (tenant_id, location_id) → locations
label        text  the human id ("12", "Terraza 3")
zone         text  NULL   ("terrace" / "bar" / "inside")
capacity     int   NULL   (covers)
active       bool  NOT NULL DEFAULT true   (deactivate, never hard-delete — it has order history)
created_at   timestamptz NOT NULL DEFAULT now()

UNIQUE (tenant_id, id)                          -- so working_orders can composite-FK it
UNIQUE (tenant_id, location_id, label)          -- no duplicate labels in a venue
```

FORCE RLS + a `dining_tables_tenant_isolation` policy (`USING/WITH CHECK (tenant_id =
current_tenant_id())`) + `GRANT SELECT, INSERT, UPDATE ON dining_tables TO app_user` (no DELETE —
deactivate) in a **hand-written custom migration** (`.enableRLS()` alone is insufficient — CLAUDE.md §3).
The `fiscal-verifactu` `inmutabilidad` guard scans every `tenant_id`-bearing table, so it will enumerate
`dining_tables` and require FORCE RLS — run it after the migration.

### 2b. The table↔tab link — a **back-pointer** on `dining_tables`, plus `delivery_table_id` on `working_orders`

**(Revised 2026-08-17.** The tab-covers-a-table link lives on the TABLE, not on the order, so one tab can
cover **several** tables — a *join*, TS-3 — while a table still has at most one tab. This replaced an
earlier `working_orders.table_id` + one-tab-per-table partial-unique, which was 1:1 and could not
express a join. Nothing was built against the old shape.)

```text
dining_tables.tab_id             uuid NULL  composite FK (tenant_id, tab_id) → working_orders (tenant_id, id)
working_orders.delivery_table_id uuid NULL  composite FK (tenant_id, delivery_table_id) → dining_tables (tenant_id, id)
```

- **`dining_tables.tab_id` set** ⇒ this table is covered by that open working_order (its running tab). A
  single nullable FK ⇒ **one open tab per table is automatic** — **no partial-unique, no CHECK**. Several
  tables pointing at the SAME tab is exactly a *join* (built in TS-3); TS-1 only ever sets one table's
  `tab_id` per tab.
- **`working_orders.delivery_table_id` set** ⇒ this (counter) order is *delivered to* that table, not a
  tab. So a tab is "the table's `tab_id` points at the order"; a counter delivery is "the order's
  `delivery_table_id` points at the table"; a walk-up is neither.
- **A settled/abandoned tab's `tab_id` is left as-is** (not nulled) — the occupancy read (§4) counts a
  `tab_id` only while the pointed order is still `open`, and `openTab` overwrites a stale pointer. So the
  fiscal pay path needs **no settle-time write** (§5).
- `working_orders` no longer carries any tab-membership column (only `delivery_table_id`) — a point that
  makes the H2 argument (§5) simpler: nothing about a tab's table reaches the order that is filed.
- Both are additive nullable columns; `dining_tables`'s TS-1 policy + grants and `working_orders`'s
  existing policy + grants cover them with **no change** (grants table-wide, RLS row-level — as #78's
  `products.image` add; confirm by the RLS test in §7). `working_orders.node_id` unchanged.

### 2c. Migration

One `packages/db` migration set (number via `pnpm --filter @waitron/db db:generate` against the live
tree — **do not hardcode**; the campaign may consume numbers first): the auto part (create
`dining_tables`, add `dining_tables.tab_id` + `working_orders.delivery_table_id` + their composite FKs)
plus a **custom** part (FORCE RLS + policy + grant on `dining_tables`). `dining_tables.tab_id` → `working_orders`
and `working_orders.delivery_table_id` → `dining_tables` form a **mutual FK between the two tables**, so
`db:generate` emits them as two `ALTER TABLE … ADD CONSTRAINT` statements (both tables exist before either
FK is added, and both columns are nullable, so there is no create/insert ordering problem). Commit the
`meta/_journal.json` + snapshot. No backfill (pre-production, CLAUDE.md §3).

## 3. Behaviour

The tab is an `open` working_order, so it reuses the existing order → pay → file machinery and **nothing
fiscal changes** (§5). New domain code lives in `apps/server` — the **backend HTTP application** (the
client–server "server"; NOT the domain `node`/`node_id` host identity, and NOT a waiter) — beside the
existing order logic (`working-order.ts` / `till-sale.ts`), which is where order mutation already is; a
`@waitron/tables` package extraction is a later refactor if it grows. Schema in `packages/db`. (Terminology:
the `apps/server` process runs on a `node` and reads its `nodeId` from `TillConfig`; "node" is the host
identity, "server" here is only the backend-app directory name.)

### 3a. Table CRUD (`apps/server/src/tables.ts`)

- `createTable(tx, cfg, { label, zone?, capacity? }) → { id }` — throws `table.label_taken` (catch the
  `(tenant_id, location_id, label)` unique 23505 → the mapped code).
- `listTables(tx, cfg) → DiningTable[]` — the location's `active` tables, by `label`.
- `updateTable(tx, cfg, id, { label?, zone?, capacity? }) → void` — throws `table.not_found`,
  `table.label_taken`.
- `deactivateTable(tx, cfg, id) → void` — sets `active = false`; throws `table.not_found`. (Reactivate is
  `updateTable`-shaped; kept trivial.)

### 3b. Tab verbs (`apps/server/src/working-order.ts`, beside `createOpenOrder`/`parkOrder`)

- `openTab(tx, cfg, { tableId, lines? }) → { tabId, orderNumber }` — takes the `dining_tables` row
  `FOR UPDATE`, validates it is `active` (`table.not_found` / `table.inactive`) and that its `tab_id` does
  not already point at an `open` order (else `tab.already_open`), then creates an `open` working_order
  (reusing `createOpenOrder`, `working-order.ts:252`, incl. the per-node `order_number` allocation) and
  sets the table's `tab_id` to the new order. The per-table `FOR UPDATE` lock **is** the concurrency
  guard: two concurrent `openTab`s on one table serialise, the second seeing an open `tab_id` →
  `tab.already_open` (there is no partial-unique now — the single `tab_id` column gives one-tab-per-table,
  the lock gives the race). A stale `tab_id` pointing at a settled/abandoned order is treated as free and
  overwritten. `lines?` opens the tab with an initial round.
- `addTabRound(tx, cfg, tabId, lines) → void` — **APPENDS** priced lines to the open tab: locks each new
  line's `unit_price_gross` at add-time and assigns the next `line_no`, **without deleting or re-pricing
  existing lines**. This is the one genuinely new order primitive — today's `updateHeldOrder`
  (`working-order.ts:474`) deletes and re-inserts the whole basket (`:511-513`), which re-locks every
  line at the current catalogue price and is wrong for an incremental tab. Throws `tab.not_open` if the
  order is not `open` (or not a tab).
  - **Concurrency (load-bearing for QR).** `line_no` must be allocated under a **per-tab lock** (a
    `SELECT … FOR UPDATE` on the tab row) or a sequence — several rounds can append at once, and with
    QR-code ordering *multiple guests append to one shared tab simultaneously*, so a naïve
    `max(line_no)+1` read races and collides on the `(working_order_id, line_no)` unique
    (`orders.ts:186`). Follow the locking shape the per-node `order_number` allocator already uses
    (`working-order.ts:263`). A real-PG concurrent-`addTabRound` test proves it (§7).
- `voidTabLine(tx, cfg, tabId, lineNo) → void` — deletes one not-yet-paid line from an `open` tab
  (pre-fiscal — nothing is filed, so no fiscal record or amendment is involved). Throws `tab.not_open`,
  `tab.line_not_found`.
- **Pay closes the tab** — **no new verb**: `payWorkingOrder` (`till-sale.ts:253`) is called with the
  tab's id; it settles `open → settled` and files one sale + `registro` the normal way. The table then
  reads *free* (derived). Splitting into separate checks is TS-5.

### 3c. Counter delivery

The existing counter/walk-up path (`recordTillSale` / `POST /api/sales`, `till-sale.ts:1438`) gains an
**optional** `deliveryTableId`, written to `working_orders.delivery_table_id`. Otherwise unchanged — a
counter delivery is a normal immediate/placed sale that simply records where to carry it.

### 3d. HTTP (`apps/server/src/till-api.ts`)

`POST/GET /api/tables`, `PATCH/DELETE /api/tables/:id` (DELETE = deactivate); `GET /api/tables/state`
(§4); `POST /api/tables/:id/tab` (openTab); `POST /api/working-orders/:id/round` (addTabRound);
`DELETE /api/working-orders/:id/lines/:lineNo` (voidTabLine); and `deliveryTableId` threaded through the
existing `POST /api/sales`. All UUID path params reuse the `isUuid()` guard (→ 4xx, not a 500 — the
existing `till-session.ts` guard). Bodies validated the way the sibling till routes are.

## 4. Occupancy read-model

`listTablesWithState(tx, cfg, locationId?) → TableState[]`, where

```text
TableState = {
  id, label, zone, capacity,
  state: 'free' | 'open-tab' | 'delivery-pending',
  hasOpenTab: boolean, tabId?: uuid, tabLineCount?: int, tabTotal?: decimal-string,
  pendingDeliveries: int,
}
```

- **open-tab** — the table's `tab_id` points at an `open` working_order (`dining_tables.tab_id` JOIN
  `working_orders` ON `status = 'open'`); a `tab_id` pointing at a settled/abandoned order counts as
  **free** (a stale pointer, §2b). Returns that order's `tabId`, line count and running total.
- **delivery-pending** — an order with `delivery_table_id` = this table whose `order_prep` state is not
  yet `collected` (and not `abandoned`) — i.e. food still being made / carried. A non-prepped instant
  handover (no `order_prep` row, or already `collected`) leaves **no** lingering occupancy. `order_prep`
  is `packages/db/src/schema/order-prep.ts:36`, state machine `queued→preparing→ready→collected`.
- **Precedence** for the rolled-up `state`: `open-tab` dominates `delivery-pending` dominates `free`. The
  raw signals (`hasOpenTab`, `pendingDeliveries`) are exposed alongside so the floor plan (TS-2 +
  floor-plan slice) can render a richer badge than the single enum.
- One location-scoped query (`dining_tables` LEFT JOIN open tabs, LEFT JOIN pending deliveries via
  `order_prep`). Location-scoped, so it gathers orders across nodes by construction.

## 5. Fiscal safety (H2)

**Commercial/pre-fiscal lane only — the immutable fiscal core is untouched.** To be grep-verified in the
plan and cited:

- TS-1 adds a **non-fiscal** table (`dining_tables`, incl. its `tab_id` back-pointer), one **nullable,
  pre-fiscal** column on `working_orders` (`delivery_table_id`), append/void verbs on `open` orders, and a
  read-model. Nothing writes a `registros_facturacion` row, a `huella`, an invoice number, or a chain link.
- **Pay reuses `payWorkingOrder` → `recordSale` (`packages/core/src/record-sale.ts`) UNCHANGED.** The
  table↔tab link is a back-pointer ON THE TABLE (`dining_tables.tab_id`), so the `working_orders` row that
  is filed carries **no** tab-membership at all (only `delivery_table_id`, which `recordSale` does not
  read): the plan greps `record-sale.ts` + the alta builders (`packages/fiscal-verifactu/src/backend.ts`)
  to prove `delivery_table_id` is not read into the filed record, and pins a test that the **huella is
  independent of whether the order was a tab** — the same basket filed once from a tab (a `dining_tables`
  row points at it) and once walk-up produces the identical huella (mirrors the `entorno`-not-in-hash
  invariant, CLAUDE.md §5).
- The safe long-lived tab state is **`open`** for all three `order_flow` modes: `open` files nothing;
  `placed` under Mode I (`invoice_first`) already files a deferred invoice (`working-order.ts:646`), so a
  tab never enters `placed` — it settles straight from `open` via `payWorkingOrder`.

## 6. Conventions

- **English identifiers** — `dining_tables`, `tab_id`, `delivery_table_id`, `zone`, `capacity`,
  `label`. `mesa`/`mesas` are in the english-only banned list (`packages/db/src/english-only.ts:209-210`);
  the UI renders "Mesa" via i18n. No new `SPANISH_WORDS` tokens.
- **Domain-named error codes** (never the package — CLAUDE.md §3): `table.not_found`, `table.label_taken`,
  `table.inactive`, `tab.already_open`, `tab.not_open`, `tab.line_not_found`. Declared in **`apps/server`'s
  error registry** (`apps/server/src/errors.ts`, which already declares domain codes thrown from the till
  API such as `working_order.*` / `order_prep.*`) and imported by the throwing file (`import "./errors.js"`).
  NB the root `errors-reachable` guard covers `packages/*` barrels, **not** `apps/*`, so this registry is
  not auto-guarded — keep the import present. Never renamed once shipped.
- No backwards-compat / data-migration code (pre-production).

## 7. Testing

- **Real Postgres (Testcontainers)** — `dining_tables` cross-tenant RLS isolation, proven by deletion of
  the tenant predicate; the **one-open-tab-per-table** guard proven by a concurrent-`openTab` race (two
  backends, same table → exactly one wins, the other gets `tab.already_open`) **and by deletion of the
  per-table `FOR UPDATE` lock** in `openTab` (both then succeed, two open tabs point-conflict on the
  table) — the lock is the guard now, not a partial unique; the new columns (`dining_tables.tab_id`,
  `working_orders.delivery_table_id`) visible to the non-superuser `app_user` under the existing policies
  (differential — fails if `asAppUser` is dropped); and a **concurrent-`addTabRound`** race (two backends
  append to one tab at once → both rounds land with distinct `line_no`s, no `(working_order_id, line_no)`
  collision — proven by deletion of the per-tab lock, which then collides).
- **PGlite** — the verb logic: `openTab` sets the table's `tab_id` and refuses a second tab; **`addTabRound`
  appends without re-pricing** (open a tab, add a round, change the catalogue price, add a second round →
  the first round's `unit_price_gross` is unchanged — the load-bearing test, contrasted against
  `updateHeldOrder` which would re-price); `voidTabLine` removes one line and leaves the rest; pay still
  files (settles + a `sales`/`registro` row appears); occupancy reflects free → open-tab → free and
  delivery-pending clears on `collected`.
- **Guards** — `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` green after the migration
  (`dining_tables` reports `relforcerowsecurity = true`); the H2 hash-identity test (§5).
- Coverage 98/98/98/95 for `packages/db` and `apps/server`.

## 8. The KDS / kitchen-firing dependency (surfaced for the owner)

A tab stays `open` (pre-fiscal) until paid, and today food only reaches the kitchen at `place`
(`working-order.ts:704` enqueues `order_prep` at placing). `order_prep`'s PK is
`(tenant_id, working_order_id)` — **one prep row per order** (`order-prep.ts:53`), so it cannot represent
a tab firing successive rounds. **Therefore a tab's rounds do not reach the kitchen until the KDS slice**,
which reworks `order_prep` to key on a *round/ticket* under the order. With the current order (floor plan
before KDS), TS-1 gives tables + tabs + a live floor plan *before* the kitchen sees tab orders —
front-of-house first, kitchen display later, a fine phased rollout. **Open sequencing call:** if the
owner wants the kitchen to see tabs from the start, pull **KDS ahead of floor plan**. Recorded, not yet
decided; it does not change TS-1.

## 9. Owner-review / open questions

- The **floor plan vs KDS ordering** above (§8).
- `delivery-pending` occupancy is defined via `order_prep.collected`; confirm a non-prepped counter
  handover leaving no table occupancy matches how the deli works (a customer sitting with a cold
  sandwich they carried themselves is not "occupying" a table in the tab sense).
- Whether `openTab` should also seed the table's future TS-2 status (out of scope here; noted so TS-2
  wires it).

## 10. Provenance

Designed against the live tree on 2026-08-17 via a full read of the order model (cited inline:
`apps/server/src/working-order.ts`, `till-sale.ts`, `packages/db/src/schema/orders.ts`,
`order-prep.ts`, `tenants.ts`, `nodes.ts`, `packages/core/src/record-sale.ts`). The "no table concept
today" claim: grep found `table`/`tab`/`seat`/`cover`/`party` only as prose / the free-text `label`
(`working-order.ts:321`), and `mesa`/`mesas` in `english-only.ts:209-210`. The fiscal-boundary claim
(a tab must live in `open`; `placed` under Mode I files) is read from `working-order.ts:646` and the
mode wiring; the plan re-verifies it by grep before relying on it (CLAUDE.md §1).
