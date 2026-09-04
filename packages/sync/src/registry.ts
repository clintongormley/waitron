// The enrolment registry for the app-level sync outbox: the tenant-scoped, non-fiscal tables an
// apply mode is registered for — twenty-two in all = 17 (14 commercial + 3 C1 dining) + 2 identity-config
// + 3 kitchen KDS (kitchen_stations, kitchen_courses, ticket_items — spec
// docs/superpowers/specs/2026-09-02-sync-kitchen-enrolment-design.md).
// This is the audit surface for "what crosses the wire" — the
// fiscal lane is deliberately absent (spec §1). The fourteen slice-1 rows each carry a capture trigger
// in packages/sync/drizzle/0000_sync_outbox.sql and match spec §2 and those triggers exactly; the three
// C1 table-service rows (dining_tables, floor_zones, table_service_statuses) carry their capture triggers
// in packages/sync/drizzle/0006_enrol_table_service.sql and add no grants (the tables already hold
// SELECT/INSERT/UPDATE — 0044/0048/0052; spec
// docs/superpowers/specs/2026-08-27-sync-cloud-mirror-c1-enrolment-design.md). The two identity-config
// rows (persons, webauthn_credentials) flow the venue's people DOWN so a secondary can authenticate them
// on failover (spec docs/superpowers/specs/2026-08-16-identity-config-flow-down-design.md); their capture triggers
// are in packages/sync/drizzle/0007_sync_identity_capture.sql. The three kitchen KDS rows (kitchen_stations,
// kitchen_courses, ticket_items) enrol the routed-menu FK closure so a subscriber does not stall the
// ordered lane on a routed product/ticket; their capture triggers are in
// packages/sync/drizzle/0008_enrol_kitchen.sql and add no grants (the tables already hold
// SELECT/INSERT/UPDATE — 0055/0058). registry.test.ts pins all these agreements.

/** insert-only → `ON CONFLICT DO NOTHING`; watermark-upsert → `ON CONFLICT DO UPDATE SET …`. */
export type SyncMode = "insert-only" | "watermark-upsert";

/** The DML the capture trigger fires on. A grant fact per spec §2, not a design intention. */
export type CaptureOp = "insert" | "update" | "delete";

/** Which replication lane carries a table. `payments`/`payment_refunds` ride the tight FAST lane
 * (ahead of the rest, to shrink the double-charge exposure active-active selling creates); every other
 * enrolled table rides the ORDERED lane. The lane is the wire dimension both peers agree on (spec §4b).*/
export type SyncLane = "ordered" | "fast";

/** Every sync lane, for callers that must act ACROSS all lanes — e.g. the disposal guard, which reads
 * an origin's whole tail: `seq` is a single global identity, but each lane's cursor advances only over
 * its own tables, so "fully drained" is a per-lane question answered for every lane. */
export const SYNC_LANES = ["ordered", "fast"] as const satisfies readonly SyncLane[];

export interface EnrolledTable {
  /** The physical table name — an English, [a-z_]+ identifier (regime-neutral; spec §2). */
  table: string;
  mode: SyncMode;
  /** The columns of the `ON CONFLICT (…)` target — the primary key. `(id)` for all but
   * `payment_policy`, whose PK is `(tenant_id)` (one row per tenant, payment-policy.ts:16). */
  conflictKey: string[];
  /** The monotonic column guarding a watermark upsert (`WHERE excluded.<wm> > <t>.<wm>`), or `null`
   * when the table has none — then the upsert is unconditional and monotonicity comes from the seq
   * cursor (spec §3). */
  watermarkColumn: string | null;
  captureOps: CaptureOp[];
  /** A STATIC topological rank: a parent's rank is strictly less than every child's. Apply runs
   * seq-ascending (spec §6), so this is a hint that never contradicts the FK graph, not the apply
   * order. Level-based (longest path from a root), so siblings may share a rank. */
  fkRank: number;
  /** Which replication lane carries this table (spec §4b). `payments`/`payment_refunds` ride the tight
   * fast lane; every other enrolled table rides the ordered lane. */
  lane: SyncLane;
}

// fkRank levels (0 = FK roots). The FK graph of spec §2 + the C1 table-service closure:
//   floor_zones/table_service_statuses → dining_tables (zone_id/status_id, both nullable);
//   dining_tables → working_orders (working_orders.delivery_table_id, the C1 gate edge);
//   working_orders → {working_order_lines, payments, sales}; sales → {sale_lines, tenders,
//   sale_settlements, sale_substitutions, sale_voids}; payments → payment_refunds;
//   catalogues → categories → products; payment_policy standalone.
// The identity-config closure (spec §3): persons → webauthn_credentials
// (webauthn_credentials.person_id); persons FKs only tenants (unenrolled), so it is its own root.
// The kitchen KDS closure (spec 2026-09-02-sync-kitchen-enrolment-design.md §2/§4): the kitchen config
// tables are PARENTS of already-enrolled children — kitchen_stations → {categories, products,
// ticket_items} (categories/products/ticket_items .station_id), kitchen_courses → {products,
// working_order_lines, ticket_items} (their .course_id) — plus ticket_items → nothing (an FK leaf:
// nothing enrolled or un-enrolled points back at it, so unlike C1's dining_tables there is NO cycle and
// no excluded back-edge). ticket_items also FKs working_order_lines (working_order_line_id, CASCADE).
// The dining_tables.tab_id → working_orders back-edge is a nullable pointer set by a later UPDATE and
// is deliberately NOT ranked (a static rank cannot encode the dining_tables ↔ working_orders cycle;
// runtime correctness rests on seq-ascending apply, not fkRank — see spec §5).
// Level 0: floor_zones, table_service_statuses, catalogues, payment_policy, persons, kitchen_stations,
//          kitchen_courses.
// Level 1: dining_tables, categories, webauthn_credentials.
// Level 2: working_orders, products.
// Level 3: working_order_lines, sales, payments.
// Level 4: sale_lines, tenders, sale_settlements, sale_substitutions, sale_voids, payment_refunds,
//          ticket_items.
export const ENROLLED: readonly EnrolledTable[] = [
  // Group A — append-only → insert-only apply. Captured AFTER INSERT (spec §2).
  {
    table: "sales",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 3,
    lane: "ordered",
  },
  {
    table: "sale_lines",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "ordered",
  },
  {
    table: "tenders",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "ordered",
  },
  {
    table: "sale_settlements",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "ordered",
  },
  {
    table: "sale_substitutions",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "ordered",
  },
  {
    table: "sale_voids",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "ordered",
  },
  // payment_refunds is captured AFTER INSERT ONLY (append-only trail), so insert-only apply is
  // correct even though its app-role grant is SELECT, INSERT, UPDATE (0001_payments_rls.sql:32) —
  // spec §2's table lists "SELECT, INSERT" (the divergence Task 2 flagged). The UPDATE grant does
  // not change the mode: nothing captures a payment_refunds UPDATE, so nothing applies one.
  {
    table: "payment_refunds",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 4,
    lane: "fast",
  },

  // Group B — mutable with a monotonic `updated_at` watermark → watermark upsert. Captured AFTER
  // INSERT OR UPDATE. updated_at receipts: catalogue.ts:30/46/78, payments.ts:91, payment-policy.ts:22.
  {
    table: "catalogues",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  },
  {
    table: "categories",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 1,
    lane: "ordered",
  },
  {
    table: "products",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 2,
    lane: "ordered",
  },
  {
    table: "payments",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 3,
    lane: "fast",
  },
  {
    table: "payment_policy",
    mode: "watermark-upsert",
    conflictKey: ["tenant_id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  },

  // Group C — mutable, NO watermark column, DELETE-capable → single ordered lane. Captured AFTER
  // INSERT OR UPDATE OR DELETE; they hold the DELETE grant (0004_working_orders.sql:73,75). The
  // upsert is unconditional (watermarkColumn null); non-regression rests on the seq cursor (spec §3).
  {
    table: "working_orders",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 2,
    lane: "ordered",
  },
  {
    table: "working_order_lines",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 3,
    lane: "ordered",
  },

  // Group D — mutable, NO watermark column, NO delete (deactivate via `active`) → ordered lane. The
  // table-service floor closure that working_orders.delivery_table_id depends on (C1 — spec
  // docs/superpowers/specs/2026-08-27-sync-cloud-mirror-c1-enrolment-design.md). Captured AFTER INSERT
  // OR UPDATE; they hold SELECT/INSERT/UPDATE but NOT DELETE (0044/0048/0052), so no delete is captured
  // or applied. watermarkColumn null (no updated_at) → unconditional upsert, non-regression from the
  // seq cursor, exactly like working_orders. dining_tables outranks working_orders (delivery_table_id
  // FK); the reverse dining_tables.tab_id → working_orders edge is a nullable back-pointer set by a
  // LATER update, deliberately excluded from the fkRank hint (a static rank cannot encode the cycle).
  {
    table: "floor_zones",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  },
  {
    table: "table_service_statuses",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  },
  {
    table: "dining_tables",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 1,
    lane: "ordered",
  },

  // Group E — identity CONFIG flowing DOWN to a read-only secondary (spec §3). Mutable, NO watermark
  // column (persons/webauthn_credentials carry no updated_at), so — like Group C — the upsert is
  // UNCONDITIONAL and monotonicity rests on the seq cursor under the single-writer-per-row invariant
  // (identity config is authored on the PRIMARY only). persons holds no DELETE grant (a person is
  // suspended, never removed — packages/identity/drizzle/0001_identity_rls.sql:17-20), so it captures
  // insert+update only; webauthn_credentials holds DELETE (a passkey is revoked outright —
  // 0008_silent_mauler.sql:32-33), so its revocation MUST propagate and it captures insert+update+delete.
  // Both ride the ORDERED lane (config, not the payments fast lane). fkRank: persons is a root (FK
  // only to tenants, unenrolled) = 0; webauthn_credentials FKs persons = 1.
  {
    table: "persons",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  },
  {
    table: "webauthn_credentials",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 1,
    lane: "ordered",
  },

  // Group F — kitchen KDS closure (spec docs/superpowers/specs/2026-09-02-sync-kitchen-enrolment-design.md).
  // The runtime-mutable FK closure of the kitchen-display tables, enrolled onto the ORDERED lane so a
  // routed menu does not stall it: categories/products/working_order_lines already carry FKs pointing
  // INTO kitchen_stations/kitchen_courses (categories_station_fk/products_station_fk 0055:49,52;
  // products_course_fk/working_order_lines_course_fk 0058:34,39), so an absent kitchen parent parks an
  // enrolled child on 23503 and halts the lane (spec §1). Mutable with NO watermark column
  // (created_at only; ticket_items runs real state UPDATEs queued→preparing→ready) → Group C/D
  // mechanism: unconditional upsert, monotonicity from the seq cursor under single-writer-per-row
  // (kitchen config authored on the primary; a ticket's lifecycle written by the node owning the line).
  // NO delete grant on any of the three (SELECT/INSERT/UPDATE only — 0055:20,37, 0058:24): stations/
  // courses deactivate via `active`, ticket_items is removed only by the working_order_lines line-FK
  // CASCADE (ticket_items_line_fk … ON DELETE CASCADE, 0055:64-66), reproduced on the subscriber by the
  // same migration — so no ticket_items DELETE is captured and insert+update is complete (spec §5).
  // fkRank: kitchen_stations/kitchen_courses are FK roots (config parents only) = 0; ticket_items is a
  // leaf child of working_order_lines(3), kitchen_stations(0), kitchen_courses(0) = 4. No cycle to break.
  {
    table: "kitchen_stations",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  },
  {
    table: "kitchen_courses",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 0,
    lane: "ordered",
  },
  {
    table: "ticket_items",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update"],
    fkRank: 4,
    lane: "ordered",
  },
];

/** The physical table names on one lane, derived once from ENROLLED (never a second hand-kept array).
 * The source route maps `?lane=` → this list → readSyncLogSince's `tables` filter (spec §4c). */
export function tablesForLane(lane: SyncLane): string[] {
  return ENROLLED.filter((e) => e.lane === lane).map((e) => e.table);
}
