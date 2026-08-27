# Sync cloud-mirror — sub-project C1: the `dining_tables` FK-closure enrolment

**Status:** design, awaiting owner review · **Date:** 2026-08-27 · **Branch:** `feat/sync-cloud-mirror-c1-enrolment`

## 0. Where this sits

"Build the sync cloud-mirror peer" (backlog top-tier #2) is three subsystems, proven against a
**local stand-in cloud** (no real hosting, DNS or TLS yet — none exists):

- **A — Peer identity & auth. LANDED (#144).** Each subscriber has its own DB-backed identity and a
  per-peer scrypt bearer token ([spec](2026-08-27-sync-cloud-mirror-peer-identity-design.md)).
- **B — Outbound tunnel. LANDED (#150).** The box always dials outbound; the cloud's pull rides back
  down the box-initiated connection through a blind byte-splice relay
  ([spec](2026-08-27-sync-cloud-mirror-tunnel-design.md)).
- **C — Cloud read-mirror.** A "mirror mode" of `apps/server` that pulls + applies into its own
  Postgres and serves the dashboard read-only. C is the **first real subscriber of the ordered
  lane**, so the `dining_tables` FK-closure enrolment lands here.

C splits in two, at the owner's decision (2026-08-27):

- **C1 — the `dining_tables` FK-closure enrolment (THIS spec).** A DB-and-`@waitron/sync` change: it
  enrols `dining_tables` and its runtime-mutable FK closure into the commercial ordered lane. It
  needs neither mirror mode nor the tunnel — it is proven against the **existing** LAN pull path (a
  second local Postgres subscriber). It is the `fkRank` **hard gate** the whole ordered lane waits on.
- **C2 — the mirror-mode server (later).** A third boot mode of `apps/server` that pulls through B's
  `tunnelHttpClient`, applies into its own Postgres, and serves `apps/dashboard` read-only, writes
  refused. Provisioned once with the box's matching config (config-flow-down stays deferred). Its own
  spec → plan → build.

This spec is **only C1**. C2 and everything past it is out of scope (§8).

## 1. The scenario, in plain terms

The sync outbox captures every committed row of **14 "commercial" tables** into `sync_log`; a
subscriber pulls the rows past its cursor and re-applies them, in seq order, idempotently
([registry.ts](../../../packages/sync/src/registry.ts),
[app-level-sync design](2026-08-02-app-level-sync-design.md)). `working_orders` is one of the 14.

When a walk-up counter order is set to be **delivered to a table**, `working_orders.delivery_table_id`
points at a `dining_tables` row (`orders.ts:93-95`; the FK is the hand-written composite
`(tenant_id, delivery_table_id) → dining_tables(tenant_id, id)`). But **`dining_tables` is not
enrolled** — no capture trigger, no apply mode, no registry entry. So when a real ordered-lane
subscriber pulls such a `working_orders` row and tries to apply it, the FK finds no parent and
PostgreSQL raises `23503`. `applyBatch` treats `23503` as a *transient parent gap*: it **parks** the
row and **holds the cursor below it** ([apply.ts:206-215](../../../packages/sync/src/apply.ts)). For
a single-origin mirror nothing ever delivers that parent, so the row parks forever and the **whole
ordered lane stalls behind it** — a silent, indefinite halt of the mirror's commercial sync.

This is exactly the backlog **HARD GATE**: enrol `dining_tables` (correct `fkRank`) *before* a real
`working_orders` subscriber runs, or a counter-delivery order stalls the lane. C1 closes it.

## 2. The closure is three tables, not one (the forced scope)

`dining_tables` does not stand alone. Split its foreign keys by kind
([dining-tables.ts](../../../packages/db/src/schema/dining-tables.ts)):

- **Config parents — `tenants`, `locations`.** Provisioned on every node and **never synced** (the
  reference-table config-flow-down is a deferred slice, app-level-sync design landing-log; the owner
  confirmed "provision the mirror once", 2026-08-27). Present by construction on any node. Nothing to
  do.
- **Runtime-authored parents — `floor_zones` (via nullable `zone_id`), `table_service_statuses` (via
  nullable `status_id`).** Both are authored through the dashboard (the FP-1 floor-plan editor, the
  table-status editor) and **change during trading** — a new zone, a new status, a reorder, a
  deactivate. They are the same *kind* of data as `catalogues`/`categories`/`products`, which are
  already enrolled, **not** the same kind as `locations`/`tills`, which are provisioned once. They are
  nullable and `MATCH SIMPLE`, so a table with no zone/status needs no parent — but the moment a table
  **carries** a zone or status (the normal case on a laid-out floor), applying that `dining_tables`
  row needs the parent present, or it `23503`-parks just as `working_orders` did. So enrolling
  `dining_tables` **forces** enrolling these two, or C1 trades one stall for another.
- **The mutual FK — `working_orders` (via nullable `tab_id`, the open-tab back-pointer).**
  `dining_tables.tab_id → working_orders(tenant_id, id)` points *back* at `working_orders`, while
  `working_orders.delivery_table_id → dining_tables` points forward — a genuine two-node **cycle**
  ([dining-tables.ts:64-67, 31-32](../../../packages/db/src/schema/dining-tables.ts)). Both edges are
  nullable. `working_orders` is already enrolled; the cycle is handled in the `fkRank` hint (§4) and
  is runtime-safe (§5).

**So C1 enrols exactly three tables: `dining_tables`, `floor_zones`, `table_service_statuses`** — the
complete runtime-mutable FK closure reachable from the enrolled set. There is nothing further
downstream: `floor_zones`'s only non-config parent is `locations` (config); `table_service_statuses`
references only `tenants` (config). Verified by reading the three schema files, not assumed
([floor-zones.ts](../../../packages/db/src/schema/floor-zones.ts),
[table-service-statuses.ts](../../../packages/db/src/schema/table-service-statuses.ts)).

## 3. How each of the three is enrolled

Apply SQL is **generic** — `applyStatementFor`/`deleteStatementFor`
([apply-sql.ts](../../../packages/sync/src/apply-sql.ts)) derive each statement from the registry
entry plus the compile-time Drizzle table object, never a hand-written per-table statement. So
enrolling a table is three mechanical edits plus one migration:

1. **A registry entry** in `ENROLLED` ([registry.ts](../../../packages/sync/src/registry.ts)).
2. **Its Drizzle schema object** registered in `SYNC_SCHEMA_TABLES`
   ([apply-sql.ts](../../../packages/sync/src/apply-sql.ts)) so the generic column-list derivation and
   the completeness assertion cover it. `diningTables`/`floorZones`/`tableServiceStatuses` are all
   exported from `@waitron/db`'s barrel.
3. **A capture trigger** in a new `packages/sync/drizzle/0006_*.sql` (§6).

All three tables share the **same registry shape**, which is a *new* group for this codebase:

| field | value | why |
|---|---|---|
| `mode` | `watermark-upsert` | mutable — the editors run real `UPDATE`s (rename a zone, recolour a status, move a table, set `tab_id`/`status_id`, deactivate) |
| `watermarkColumn` | `null` | none of the three carries an `updated_at` (confirmed — they have `created_at` only). Non-regression rests on the seq cursor, exactly as `working_orders` does ([registry.ts:165-186](../../../packages/sync/src/registry.ts)) |
| `captureOps` | `["insert","update"]` | they **deactivate** via an `active` flag, never hard-delete: the app-role grant is `SELECT, INSERT, UPDATE` with **no DELETE** (`0044_dining_tables_rls.sql:13`, `0048_table_service_statuses_rls.sql:14`, `0052_floor_plan_fp1_rls.sql:15`), so no DELETE is ever captured and none is ever applied |
| `lane` | `ordered` | only `payments`/`payment_refunds` ride the fast lane |
| `conflictKey` | `["id"]` | each PK is a single `id` uuid |

This is a **fourth shape** the registry has not carried before: *mutable, no watermark, no delete*.
The three existing shapes are Group A (insert-only), Group B (watermark + `[insert,update]`), and
Group C (no watermark + `[insert,update,delete]`, DELETE-capable). The new shape is "Group C without
the delete". §6 covers the one test invariant this widens.

**No new grants.** `app_user` already holds `SELECT, INSERT, UPDATE` on all three tables (the RLS
migrations above), and `INSERT ON sync_log` is a table-wide grant already in place
(`0000_sync_outbox.sql`). The capture trigger runs as the writing app role (it is not `SECURITY
DEFINER`) and inserts into `sync_log` under that grant; the apply path runs as `app_user` under
`withTenant` and satisfies each table's FORCE-RLS `WITH CHECK (tenant_id = current_tenant_id())` by
construction. **The capture triggers are the entire DB change.**

## 4. The `fkRank` cascade and breaking the cycle

`fkRank` is documented as "a STATIC topological rank … a hint that never contradicts the FK graph,
**not** the apply order" ([registry.ts:30-33](../../../packages/sync/src/registry.ts)) — the apply
loop runs strictly seq-ascending and never reads `fkRank`. Its only consumer is the guard in
[registry.test.ts:209-242](../../../packages/sync/src/registry.test.ts), a hand-maintained edge list
asserting `parent.fkRank < child.fkRank` for each FK.

**Breaking the cycle.** C1 adds three edges to that guard: `floor_zones → dining_tables`,
`table_service_statuses → dining_tables`, and the gate edge `dining_tables → working_orders`
(`working_orders.delivery_table_id` makes `dining_tables` the parent). C1 **deliberately does not add**
the reverse `working_orders → dining_tables` edge (`dining_tables.tab_id`). A static rank *cannot*
encode a cycle — `dt < wo` and `wo < dt` cannot both hold — so exactly one of the two mutual edges is
dropped from the hint, and it must be the `tab_id` back-pointer: it is a nullable link **set by a
later `UPDATE`**, never a create-time dependency, so excluding it keeps the hint truthful about the
order rows are *created* in. This is documented inline in the registry so a future reader does not
"restore" the missing edge and make the guard unsatisfiable.

**The cascade.** Inserting `dining_tables` *above* `working_orders` pushes the whole working-orders
subtree down one level. Using the existing "longest path from a root" definition (roots = 0):

| table | old `fkRank` | new `fkRank` |
|---|---|---|
| `floor_zones`, `table_service_statuses` | — (new) | 0 |
| `catalogues`, `payment_policy` | 0 | 0 |
| `dining_tables` | — (new) | 1 |
| `categories` | 1 | 1 |
| `working_orders` | 0 | 2 |
| `products` | 2 | 2 |
| `working_order_lines`, `sales`, `payments` | 1 | 3 |
| `sale_lines`, `tenders`, `sale_settlements`, `sale_substitutions`, `sale_voids`, `payment_refunds` | 2 | 4 |

The renumbering touches many registry entries; that is expected and harmless, because `fkRank` is a
hint and the guard enforces only the relative order. (The absolute values could instead be left mostly
alone by giving `dining_tables` a negative rank, but that contradicts the "0 = roots" convention and
the "longest path from a root" definition, and would ripple into `floor_zones`/`table_service_statuses`
needing rank < that. The clean renumber is the honest encoding.)

## 5. Why the apply path is correct despite the cycle

The apply loop resolves the cycle without ever consulting `fkRank`, for the v1 single-source DR
mirror (one box → one cloud, one origin):

- On the source, a `dining_tables` row is **created before** the `working_orders` row that references
  it (you cannot deliver to a table that does not exist), so it carries a **lower seq** and is applied
  first — the `delivery_table_id` FK resolves with no park. The `tab_id` back-pointer is written by a
  **later** `UPDATE` (higher seq), applied after the `working_orders` row already exists, so it too
  resolves. `applyBatch` commits **each row in its own transaction**
  ([apply.ts](../../../packages/sync/src/apply.ts)), so the lower-seq parent is committed before the
  higher-seq child is applied. Seq-ascending order is a topological order for each write's
  dependencies-*at-write-time*, which is all a non-deferrable FK needs.
- `23503`-parking remains the safety net only for the **cross-origin** (multi-peer active-active) and
  **cross-lane** cases (apply.ts's drain note); a single-origin mirror never hits them for this
  closure — all three tables ride the **ordered** lane, the same lane as `working_orders`, so there is
  no cross-lane park, and there is only one origin.

**No un-gated BEFORE triggers.** The sync design's one known apply-path wedge is a business-rule
BEFORE trigger not gated on `app.sync_apply` firing during apply and raising a non-`23503` error
(app-level-sync landing-log, constraint 1). A grep of the DB migrations finds **no `CREATE TRIGGER` on
any of the three tables** — their referential rules are FK *constraints*, which correctly re-check and
`23503`-park on a genuine gap rather than wedging. The plan re-verifies this definitively against a
real database via `information_schema.triggers`, not by grep alone.

**The `working_orders_clear_table_status` cascade (0050) — a trigger _on_ `working_orders` that _targets_
`dining_tables`.** The grep above scoped triggers *on* the three tables and so did not surface this one:
`working_orders_clear_table_status` is an `AFTER UPDATE` trigger on `working_orders`
([0050:48-52](../../../packages/db/drizzle/0050_clear_table_status_trigger.sql)) whose body runs
`UPDATE dining_tables SET status_id = NULL WHERE tenant_id = NEW.tenant_id AND tab_id = NEW.id`
([0050:40-43](../../../packages/db/drizzle/0050_clear_table_status_trigger.sql)) when a tab settles or is
abandoned. It is **not** gated on `app.sync_apply` — deliberately, as an idempotent data-validity cascade
rather than a state-machine gate (0050:29-33) — and 0050's own comment defers `dining_tables`
sync-enrolment to "a future replication slice" (0050:32). **C1 is that slice**, so the hand-off lands
here, and it is safe in both directions:

- **On the apply path it cannot wedge, and does not echo.** When the mirror applies a settling
  `working_orders` UPDATE, `applyBatch` has set `app.sync_apply='on'` in the same transaction
  ([apply.ts:298-312](../../../packages/sync/src/apply.ts)), so the `BEFORE UPDATE`
  `working_orders_enforce_transition` is gated off (0037 — the settle applies verbatim) while this
  `AFTER UPDATE` cascade still fires and clears the mirror's `status_id` locally. The cascaded
  `dining_tables` write is then **echo-suppressed** by the new `dining_tables_capture` `WHEN` clause
  (`app.sync_apply IS DISTINCT FROM 'on'`, 0006:24-26), so it is not re-captured into the mirror's own
  `sync_log`. The cascade is an `AFTER`, same-tenant (`tenant_id = NEW.tenant_id`), idempotent,
  zero-or-more-row `UPDATE` that clears only `status_id`: a zero-match is a no-op and a same-tenant one is
  RLS-permitted (0050:22-27), so it can raise neither `23503` nor `42501` and cannot wedge apply.
- **On the source the same settle now captures a `dining_tables` UPDATE.** With `dining_tables` enrolled,
  the source's settle fires the cascade and captures it as a normal ordered-lane `dining_tables` UPDATE
  (`status_id=NULL`) alongside the `working_orders` UPDATE. It replicates and converges idempotently — a
  null-watermark unconditional upsert whose non-regression rests on the seq cursor, exactly like the
  `working_orders` row beside it. Before C1 that cascaded write was captured nowhere, so a mirror's own
  `working_orders` apply was the *only* thing that cleared its `status_id`; enrolment makes the two paths
  agree. The `apply.gate.test.ts` settle-cascade test exercises this end to end (both rows applied, the
  mirror's `status_id` cleared, cursor advanced, no new `sync_log` row captured).

**No new active-active conflict class.** The three tables ride the ordered lane with a null watermark,
so under multiple origins they carry the same "last-writer-by-seq" property `working_orders` already
has (§3). That rests on the design's **one-writer-per-row** invariant (app-level-sync §1: partitioned
active-active, not multi-master), which C1 neither strengthens nor weakens — it introduces no conflict
class the ordered lane did not already carry. C1's proving ground is the v1 single-origin mirror; the
multi-origin topology enrols these tables the same way it enrols the existing 14.

**Pre-production, so no backfill.** Nothing is deployed; enrolling three tables simply starts their
capture triggers firing on the next write. No data migration, no backfill (CLAUDE.md §3).

## 6. Testing

Real Postgres, not PGlite, for the grant/RLS/trigger/apply behaviour (PGlite connects as a superuser
and cannot show the app-role apply under FORCE RLS; CLAUDE.md §4). `TESTCONTAINERS_RYUK_DISABLED=true`
locally.

- **Headline gate, proven by deletion.** Against a real-PG subscriber pulling the **ordered** lane:
  seed on the source a `floor_zone`, a `table_service_status`, a `dining_table` **carrying both**
  (`zone_id` + `status_id` set), and a `working_order` with `delivery_table_id` pointing at that table.
  Assert the subscriber applies **all four**, **no row parks**, and the cursor advances past them.
  Then **delete `dining_tables` from `ENROLLED`** and re-run: the `working_order` `23503`-parks, the
  cursor holds below it, the assertion fails. Restore → green. That deletion *is* the hard gate, made
  a test. (A second deletion control drops `floor_zones` to prove the zoned `dining_tables` row parks
  without its zone parent.)
- **Registry unit assertions** ([registry.test.ts](../../../packages/sync/src/registry.test.ts)):
  the enrolled count moves 14 → **17**; `tablesForLane('ordered')` moves 12 → **15**; the three new
  entries carry the §3 shape; the new `fkRank` edges hold and the renumbered ranks satisfy every
  existing edge. **The "captureOps match each table's group" invariant is widened**: a `null`
  watermark no longer implies delete-capability — it now admits both `[insert,update]` (deactivate-only)
  and `[insert,update,delete]` (DELETE-capable). This is the one loosening; the tight check that
  captureOps matches the *actual* DB triggers stays in the real-PG gate suite, below. Prove the widened
  invariant still bites by a deletion control (e.g. a watermark table wrongly carrying `delete` must
  still fail).
- **Real-PG gate suites** ([capture.gate.test.ts](../../../packages/sync/src/capture.gate.test.ts),
  [apply.gate.test.ts](../../../packages/sync/src/apply.gate.test.ts)): the "14 capture triggers"
  assertions move to **17**, and the new triggers are asserted present with the right op set
  (`AFTER INSERT OR UPDATE`, echo-gated on `app.sync_apply`).
- **`apply-sql` completeness** ([apply-sql.test.ts](../../../packages/sync/src/apply-sql.test.ts)):
  "a drizzle object for all fourteen enrolled tables" moves to **seventeen**; assert the three new
  tables produce a valid unconditional-upsert statement (`ON CONFLICT (id) DO UPDATE SET …` with no
  `WHERE`, since `watermarkColumn` is null) and **no** delete statement (`deleteStatementFor` must
  throw for a table that captures no delete).
- **Prose to retire** (a behaviour change retires every receipt about the old behaviour, CLAUDE.md
  §1): the "fourteen"/"14"/"twelve"/"12" counts in `registry.ts`, `apply-sql.ts`, `apply.ts:260`,
  `index.ts`, and the `SPEC`-table header comments; the fkRank-levels comment block in `registry.ts`
  (add `dining_tables`/`floor_zones`/`table_service_statuses` and the cycle-break note). Grep the
  whole `@waitron/sync` package for a stale count before claiming it is done.
- **Run unfiltered.** `pnpm --filter @waitron/sync test:coverage` for the 98/98/98/95 thresholds, and
  the whole `@waitron/sync` suite **unfiltered** (cross-cutting guards do not load under a name-filter,
  CLAUDE.md §2). The `inmutabilidad` FORCE-RLS scan already covers these three tenant-scoped tables and
  is unaffected by enrolment, but run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`
  anyway (CLAUDE.md §3 — a change touching tenant-scoped tables re-runs that guard).

## 7. Conventions & receipts (CLAUDE.md)

- **English identifiers.** All three physical names are `[a-z_]+` and already exist; enrolment adds no
  new tokens. The registry's own `[a-z_]+` guard (registry.test.ts) covers the new entries.
- **No SQL by concatenation.** The migration's `CREATE TRIGGER` statements are static literals over
  fixed table names; the generic apply SQL binds the whole row as `$1` via `jsonb_populate_record`
  (apply-sql.ts) — no runtime-derived identifier, so the escaping question does not arise.
- **Never widen a grant to make a test pass.** C1 adds **no** grant: `app_user` already holds exactly
  `SELECT, INSERT, UPDATE` on the three tables and `INSERT` on `sync_log`. No DELETE is added (there is
  nothing to delete).
- **A new tenant-scoped table needs FORCE RLS + policy + grants** — not applicable: these three tables
  already exist with the full recipe (their RLS migrations); C1 does not create a table.
- **A claim of necessity carries a receipt.** Every "must"/"cannot" here cites a `file:line` in the
  branch tree or a run described in §6, not memory.

## 8. Out of scope (named, not dropped)

- **C2 — the mirror-mode server, read-only dashboard, and `tunnelHttpClient` wiring.** Its own
  spec → plan → build. C1 changes nothing about how any node boots or serves.
- **Config-flow-down** of `tenants`/`locations`/`tills`/`nodes` — the mirror is provisioned once (C2's
  assumption); auto-replication of config is a separate later slice.
- **The other single-writer operational tables** (`kitchen_stations`, `ticket_items`) — enrol them
  when the multi-node/cloud-mirror **kitchen-sync** slice lands (backlog HARD GATE note); they are not
  in `dining_tables`'s FK closure and nothing an ordered-lane `working_orders` row references, so they
  do not gate C1.
- **Multi-tenant whole-log reader** and the **fiscal hash-chain lane** — later slices, unchanged.

## 9. Provenance

Internal receipts are cited inline as `file:line` against the branch tree and were read from the
current code, not from memory: the enrolment mechanism
([registry.ts](../../../packages/sync/src/registry.ts),
[apply-sql.ts](../../../packages/sync/src/apply-sql.ts),
[0000_sync_outbox.sql](../../../packages/sync/drizzle/0000_sync_outbox.sql)), the apply/park behaviour
([apply.ts](../../../packages/sync/src/apply.ts), [pull.ts](../../../packages/sync/src/pull.ts)), the
`fkRank` guard ([registry.test.ts](../../../packages/sync/src/registry.test.ts)), the FK graph and
grants of the three tables (`dining-tables.ts`, `floor-zones.ts`, `table-service-statuses.ts`,
`orders.ts`, and the `0044`/`0048`/`0052` RLS migrations), and the absence of `updated_at`, DELETE
grants and BEFORE triggers on the three (grep + schema read, re-verified in the plan against a real
database). External claims: none — C1 is entirely internal. The seeding memories
(`sync-cloud-mirror-peer-identity`, `replication-is-shared-infra`) are point-in-time notes and were
re-verified against code before use.
