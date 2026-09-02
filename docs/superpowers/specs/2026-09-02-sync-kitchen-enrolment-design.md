# Sync — kitchen-sync enrolment: the KDS FK-closure onto the ordered lane

**Status:** design, awaiting owner review · **Date:** 2026-09-02 · **Branch:** `feat/sync-kitchen-enrolment`

## 0. Where this sits

The application-level sync outbox captures every committed row of the enrolled "commercial" tables
into `sync_log`; a subscriber pulls the rows past its cursor and re-applies them in seq order,
idempotently ([registry.ts](../../../packages/sync/src/registry.ts),
[app-level-sync design](2026-08-02-app-level-sync-design.md)). The ordered lane now carries nineteen
tables: spec §2's fourteen commercial, C1's three table-service (`dining_tables`/`floor_zones`/
`table_service_statuses`, #153), and identity-config's two (`persons`/`webauthn_credentials`, #195).

The KDS (kitchen display) tables — `kitchen_stations`, `kitchen_courses`, `ticket_items` — were built
single-writer-per-row (KDS-1 for stations/tickets, KDS-2 for courses) but are **not enrolled**: no capture trigger, no apply
mode, no registry entry. This slice enrols their complete runtime-mutable FK closure onto the ordered
lane. It is a DB-and-`@waitron/sync` change only; like C1 it needs neither mirror mode nor the tunnel
and is proven against the existing LAN pull path (a second local Postgres subscriber).

The backlog names this task as "enrol `kitchen_stations` / `ticket_items`" and gates it on "a short
FK-closure design pass" (backlog *Sync completion → Kitchen-sync enrolment*). This spec is that pass.
Its one non-mechanical finding: **the closure is three tables, not the two the backlog named** —
`kitchen_courses` (added in KDS-2, after the backlog note was written) is forced in, exactly as C1's
closure grew from one table to three.

## 1. The scenario, in plain terms

Three **already-enrolled** tables carry foreign keys that point *into* the un-enrolled kitchen config
tables. This is a `23503` gate identical in shape to C1's `working_orders.delivery_table_id →
dining_tables`:

- `categories.station_id → kitchen_stations` — the category's default routing station
  ([0055_kds1_stations_tickets_rls.sql:49-50](../../../packages/db/drizzle/0055_kds1_stations_tickets_rls.sql)).
  `categories` is enrolled (fkRank 1).
- `products.station_id → kitchen_stations` and `products.course_id → kitchen_courses` — the
  per-product routing override and default course
  ([0055:52-53](../../../packages/db/drizzle/0055_kds1_stations_tickets_rls.sql),
  [0058_kds2_courses_fire_rls.sql:34-35](../../../packages/db/drizzle/0058_kds2_courses_fire_rls.sql)).
  `products` is enrolled (fkRank 2).
- `working_order_lines.course_id → kitchen_courses` — the course resolved onto the line at ring time
  ([0058:37-40](../../../packages/db/drizzle/0058_kds2_courses_fire_rls.sql)). `working_order_lines` is
  enrolled (fkRank 3).

All these FK columns are nullable `MATCH SIMPLE`, so a product with no routing needs no parent. But
the moment a product **is** routed to a station or course (the normal case for a laid-out menu), an
ordered-lane subscriber applying that `products`/`categories`/`working_order_lines` row finds no
parent and PostgreSQL raises `23503`. `applyBatch` treats `23503` as a transient parent gap: it
**parks** the row and **holds the cursor below it**
([apply.ts:201-223](../../../packages/sync/src/apply.ts)). For a single-origin mirror nothing ever
delivers that parent, so the row parks forever and **the whole ordered lane stalls behind it** — a
silent, indefinite halt.

So `kitchen_stations` and `kitchen_courses` are a genuine **hard gate**: enrol them (correct `fkRank`)
*before* a real subscriber runs, or a routed-menu sync stalls the lane. `ticket_items` is not itself a
gate — nothing enrolled points at it (§2) — but it is the KDS operational data the mirror exists to
show, and enrolling it forces only parents already being enrolled.

## 2. The closure is three tables (the forced scope)

Split the kitchen tables' foreign keys by kind, reading the three schema files and their RLS
migrations, not assuming:

**`kitchen_stations`** ([kitchen-stations.ts:38-85](../../../packages/db/src/schema/kitchen-stations.ts))
— FKs `tenant_id → tenants` and `(tenant_id, location_id) → locations`
([kitchen-stations.ts:47,79-83](../../../packages/db/src/schema/kitchen-stations.ts)). Both are
**config parents** — provisioned on every node, never synced (present by construction; the mirror is
provisioned once, C2 assumption). A pure FK **root**.

**`kitchen_courses`** ([kitchen-courses.ts:39-77](../../../packages/db/src/schema/kitchen-courses.ts))
— FKs `tenant_id → tenants` and `(tenant_id, location_id) → locations`
([kitchen-courses.ts:48,71-75](../../../packages/db/src/schema/kitchen-courses.ts)). Config parents
only. A pure FK **root**.

**`ticket_items`** ([ticket-items.ts:38-97](../../../packages/db/src/schema/ticket-items.ts)) — the
per-line kitchen ticket. Its FKs:
- `tenant_id → tenants` — config parent.
- `(tenant_id, node_id) → nodes`
  ([0055:56-58](../../../packages/db/drizzle/0055_kds1_stations_tickets_rls.sql)). `nodes` is **present
  by construction** on a subscriber: the C2b operator flow copies every `nodes` row into the mirror at
  adoption ([c2b spec:128](2026-08-29-sync-cloud-mirror-c2b-operator-flow-design.md)), same category
  as `tenants`/`locations`. Not a gate.
- `(tenant_id, working_order_line_id) → working_order_lines` **ON DELETE CASCADE**
  ([0055:63-66](../../../packages/db/drizzle/0055_kds1_stations_tickets_rls.sql)). `working_order_lines`
  is already enrolled (fkRank 3). The cascade is what removes a ticket when its line goes (§5).
- `(tenant_id, station_id) → kitchen_stations`
  ([0055:70-72](../../../packages/db/drizzle/0055_kds1_stations_tickets_rls.sql)) and
  `(tenant_id, course_id) → kitchen_courses`
  ([0058:42-45](../../../packages/db/drizzle/0058_kds2_courses_fire_rls.sql)) — the station/course
  snapshotted onto the line at fire time. Both being enrolled here.

**So this slice enrols exactly three tables: `kitchen_stations`, `kitchen_courses`, `ticket_items`** —
the complete runtime-mutable FK closure. Nothing lies further downstream: nothing enrolled or
un-enrolled points *back* at `ticket_items` (its unique keys are referenced by no other table —
[ticket-items.ts:93-95](../../../packages/db/src/schema/ticket-items.ts)), so unlike C1's
`dining_tables ↔ working_orders` there is **no FK cycle** and **no cycle-break** to encode in `fkRank`.

## 3. How each of the three is enrolled

Apply SQL is generic — `applyStatementFor`/`deleteStatementFor`
([apply-sql.ts](../../../packages/sync/src/apply-sql.ts)) derive each statement from the registry
entry plus the compile-time Drizzle object. Enrolling a table is three mechanical edits plus one
migration:

1. **A registry entry** in `ENROLLED` ([registry.ts:62-265](../../../packages/sync/src/registry.ts)).
2. **Its Drizzle schema object** registered in `SYNC_SCHEMA_TABLES`
   ([apply-sql.ts:46-66](../../../packages/sync/src/apply-sql.ts)) so the generic column-list
   derivation and the completeness assertion cover it. `kitchenStations`, `kitchenCourses`,
   `ticketItems` are all exported from `@waitron/db`'s barrel
   ([db/src/index.ts:28-30](../../../packages/db/src/index.ts)).
3. **A capture trigger** in a new `packages/sync/drizzle/0008_*.sql` (§6) plus its `_journal.json` row.

All three share the **same registry shape** — C1's "no watermark, no delete" shape (the file calls it
Group D):

| field | value | why |
|---|---|---|
| `mode` | `watermark-upsert` | mutable — stations/courses are renamed/reordered/deactivated; `ticket_items` runs real state `UPDATE`s (queued→preparing→ready, `fired_at`, `away_at`) |
| `watermarkColumn` | `null` | none carries an `updated_at` (confirmed — `created_at` only, and `ticket_items` has per-transition timestamps, not a single monotonic column). Non-regression rests on the seq cursor, exactly as `working_orders`/`dining_tables` do |
| `captureOps` | `["insert","update"]` | none holds a DELETE grant: stations/courses deactivate via `active`, `ticket_items` is only ever removed by the line-FK CASCADE (§5). The app-role grant is `SELECT, INSERT, UPDATE` with no DELETE ([0055:14-20,31-37](../../../packages/db/drizzle/0055_kds1_stations_tickets_rls.sql), [0058:18-24](../../../packages/db/drizzle/0058_kds2_courses_fire_rls.sql)) |
| `lane` | `ordered` | only `payments`/`payment_refunds` ride the fast lane |
| `conflictKey` | `["id"]` | each PK is a single `id` uuid |

**No new grants.** `app_user` already holds `SELECT, INSERT, UPDATE` on all three
([0055](../../../packages/db/drizzle/0055_kds1_stations_tickets_rls.sql),
[0058](../../../packages/db/drizzle/0058_kds2_courses_fire_rls.sql)) and `INSERT ON sync_log` is a
table-wide grant already in place ([0000_sync_outbox.sql:62](../../../packages/sync/drizzle/0000_sync_outbox.sql)).
The capture trigger runs as the writing app role (not `SECURITY DEFINER`); the apply path runs as
`app_user` under `withTenant` and satisfies each table's FORCE-RLS `WITH CHECK (tenant_id =
current_tenant_id())` by construction. **The capture triggers are the entire DB change.**

## 4. The `fkRank` cascade — no cycle to break

`fkRank` is a static topological hint the apply loop never reads (apply runs strictly seq-ascending);
its only consumer is the hand-maintained edge guard in
[registry.test.ts:270-319](../../../packages/sync/src/registry.test.ts). The kitchen tables slot in as
**parents of already-enrolled children** and one leaf:

- `kitchen_stations` = **0** (root; config parents only). Parent of `categories` (1), `products` (2),
  `ticket_items` (4).
- `kitchen_courses` = **0** (root). Parent of `products` (2), `working_order_lines` (3),
  `ticket_items` (4).
- `ticket_items` = **4** (child of `working_order_lines` 3, `kitchen_stations` 0, `kitchen_courses` 0).

Seven edges are added to the guard's `PARENT_CHILD` list, all satisfied by the ranks above:
`kitchen_stations → categories`, `kitchen_stations → products`, `kitchen_courses → products`,
`kitchen_courses → working_order_lines`, `kitchen_stations → ticket_items`, `kitchen_courses →
ticket_items`, `working_order_lines → ticket_items`. **No edge is excluded** — there is no back-edge
and no cycle (§2), the key structural difference from C1.

## 5. Runtime safety

- **Single-writer-per-row.** Kitchen config (stations, courses) is authored on the primary only; a
  ticket's lifecycle is written by the node that owns the line. The unconditional upsert
  (`watermarkColumn: null`) is monotonic because the seq cursor delivers a row's writes in commit
  order and re-applies them idempotently — the same argument `working_orders` and `dining_tables`
  rest on.
- **`ticket_items` removal rides the CASCADE, not a captured DELETE.** `working_order_lines` is
  DELETE-capable and captures its deletes (Group C,
  [registry.ts:192-200](../../../packages/sync/src/registry.ts)). When the subscriber applies a
  `working_order_lines` DELETE, the `ticket_items_line_fk … ON DELETE CASCADE` constraint — present on
  the subscriber's schema by the same migration — removes the child `ticket_items` rows locally,
  reproducing the primary's cascade. So no `ticket_items` DELETE need be captured, and capturing
  insert+update is complete. This rests on the invariant that a `ticket_items` INSERT never parks
  ahead of its line's DELETE: all of its parents precede it in the stream — `nodes` present by
  construction (below), `kitchen_stations`/`kitchen_courses`/`working_order_lines` enrolled at
  strictly lower `fkRank` and so committed (and captured) at a lower seq — so by the time the line's
  DELETE arrives the child is already present locally for the cascade to remove. A parked
  `ticket_items` INSERT would require an absent earlier-enrolled or present-by-construction parent —
  the precondition under which the whole ordered lane is already stalled (§1), not a state reachable
  in a healthy single-origin stream.
- **`nodes` present by construction.** `ticket_items.node_id` resolves on the subscriber because the
  operator flow copied the primary's `nodes` rows at adoption (§2). This is the same guarantee C1's
  config parents (`tenants`, `locations`) rely on.

## 6. Migration and tests

**Migration `packages/sync/drizzle/0008_enrol_kitchen.sql`** — a clone of
[0006_enrol_table_service.sql](../../../packages/sync/drizzle/0006_enrol_table_service.sql): three
`CREATE TRIGGER … AFTER INSERT OR UPDATE … EXECUTE FUNCTION sync_capture()`, echo-gated on
`app.sync_apply`, for `kitchen_stations`, `kitchen_courses`, `ticket_items`. No grants. Plus its
`meta/_journal.json` entry (`idx` 8, `tag` `0008_enrol_kitchen`). The `sync` set runs LAST in
`migrations.manifest.json`, after the `db` set created these tables (0054/0055/0057/0058), so each
`CREATE TRIGGER` targets an existing table.

**Test moves** (each a real assertion that must be updated, not a rewrite that hides a regression):

- [registry.test.ts](../../../packages/sync/src/registry.test.ts): add the three `SPEC` entries; count
  `19 → 22` (registry.test.ts:193-194); ordered-lane `17 → 20` (registry.test.ts:218-222); add the
  seven `PARENT_CHILD` edges (registry.test.ts:291-310). The `[a-z_]+` and `captureOps`-by-group
  loops cover the new rows automatically.
- [apply-sql.test.ts](../../../packages/sync/src/apply-sql.test.ts): the `SYNC_SCHEMA_TABLES`-covers-
  `ENROLLED` completeness loop (apply-sql.test.ts:106-109) and the safe-identifier loop cover the new
  rows once they are in both arrays — no edit beyond adding the three to `SYNC_SCHEMA_TABLES`.
- [capture.gate.test.ts](../../../packages/sync/src/capture.gate.test.ts): a new real-PG sub-test
  mirroring the C1 one (capture.gate.test.ts:338-408) — the three kitchen triggers capture an app-role
  insert and fire on {INSERT, UPDATE} and NOT DELETE. Header count `19 → 22`
  (capture.gate.test.ts:17).
- [apply.gate.test.ts](../../../packages/sync/src/apply.gate.test.ts): a new **proven-by-deletion**
  describe mirroring C1's (apply.gate.test.ts:1012-1073): a routed `products` row
  (`station_id`/`course_id` set) applies with no park once its kitchen closure is enrolled — comment
  out a kitchen entry in `ENROLLED` and the batch throws `sync.table_not_enrolled`; plus a negative
  control where the absent kitchen parent parks the routed row on `23503` and holds the cursor. A
  second case seeds the closure + a `working_order_line` and applies a `ticket_items` row.

**Run unfiltered.** `pnpm --filter @waitron/sync test:coverage` for the thresholds and the whole
`@waitron/sync` suite unfiltered (cross-cutting guards do not load under a name-filter, CLAUDE.md §2).
Run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` too — a change touching tenant-scoped
tables re-runs the FORCE-RLS scan (CLAUDE.md §3), though enrolment creates no table and that scan is
unaffected. The three tables already ship FORCE RLS + policy + grants
([0055](../../../packages/db/drizzle/0055_kds1_stations_tickets_rls.sql),
[0058](../../../packages/db/drizzle/0058_kds2_courses_fire_rls.sql)).

## 7. Conventions & receipts (CLAUDE.md)

- **English identifiers.** All three physical names are `[a-z_]+` and already exist; enrolment adds no
  new tokens. The registry's `[a-z_]+` guard covers the new entries.
- **No SQL by concatenation.** The migration's `CREATE TRIGGER` statements are static literals over
  fixed table names; the generic apply SQL binds the whole row as `$1` via `jsonb_populate_record`.
- **Never widen a grant to make a test pass.** This slice adds **no** grant: `app_user` already holds
  exactly `SELECT, INSERT, UPDATE` on the three tables and `INSERT` on `sync_log`. No DELETE is added.
- **A new tenant-scoped table needs FORCE RLS + policy + grants** — not applicable: these three tables
  already exist with the full recipe (their RLS migrations); this slice creates no table.
- **A claim of necessity carries a receipt.** Every "must"/"cannot" here cites a `file:line` in the
  tree, verified against the current code, not memory.

## 8. Out of scope (named, not dropped)

- **Config-flow-down** of `tenants`/`locations`/`nodes` — the mirror is provisioned once (C2's
  assumption); auto-replication of that config is a separate later slice. `kitchen_stations`/
  `kitchen_courses` are runtime-authored config that DOES flow (like `catalogues`/`categories`); the
  provisioned-once tables above do not.
- **The KDS read surface on the mirror** — the dashboard's kitchen view rendering replicated
  `ticket_items` is a C2-server concern, not this DB/`@waitron/sync` slice.
- **Multi-tenant whole-log reader** and the **fiscal hash-chain lane** — later slices, unchanged.

## 9. Provenance

Internal receipts are cited inline as `file:line` against the tree and were read from the current
code, not memory: the kitchen schemas + FKs + grants + RLS (`kitchen-stations.ts`, `kitchen-courses.ts`,
`ticket-items.ts`, and `0055`/`0058`), the enrolled children that gate the lane (`categories`/
`products`/`working_order_lines` FKs in `0055`/`0058`), the enrolment mechanism (`registry.ts`,
`apply-sql.ts`, `0006_enrol_table_service.sql`, `0007_sync_identity_capture.sql`), the apply/park
behaviour (`apply.ts`), the `fkRank` and completeness guards (`registry.test.ts`, `apply-sql.test.ts`,
`capture.gate.test.ts`, `apply.gate.test.ts`), and `nodes` present-by-construction
(`2026-08-29-sync-cloud-mirror-c2b-operator-flow-design.md:128`). External claims: none — this slice is
entirely internal.
