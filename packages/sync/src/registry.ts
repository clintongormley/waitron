// The enrolment registry for the commercial-lane sync outbox: the fourteen tenant-scoped, non-fiscal
// tables a capture trigger is attached to (packages/sync/drizzle/0000_sync_outbox.sql) and an apply
// mode is registered for. This is the audit surface for "what crosses the wire" — the fiscal lane is
// deliberately absent (spec §1). Every row here matches spec §2 and the migration's triggers exactly;
// registry.test.ts pins that agreement.

/** insert-only → `ON CONFLICT DO NOTHING`; watermark-upsert → `ON CONFLICT DO UPDATE SET …`. */
export type SyncMode = "insert-only" | "watermark-upsert";

/** The DML the capture trigger fires on. A grant fact per spec §2, not a design intention. */
export type CaptureOp = "insert" | "update" | "delete";

/** Which replication lane carries a table. `payments`/`payment_refunds` ride the tight FAST lane
 * (ahead of the rest, to shrink the double-charge exposure active-active selling creates); every other
 * enrolled table rides the ORDERED lane. The lane is the wire dimension both peers agree on (spec §4b).*/
export type SyncLane = "ordered" | "fast";

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

// fkRank levels (0 = FK roots). The FK graph of spec §2:
//   working_orders → {working_order_lines, payments, sales};
//   sales → {sale_lines, tenders, sale_settlements, sale_substitutions, sale_voids};
//   payments → payment_refunds; catalogues → categories → products; payment_policy standalone.
// Level 0: working_orders, catalogues, payment_policy.
// Level 1: categories, sales, payments, working_order_lines.
// Level 2: products, sale_lines, tenders, sale_settlements, sale_substitutions, sale_voids,
//          payment_refunds.
export const ENROLLED: readonly EnrolledTable[] = [
  // Group A — append-only → insert-only apply. Captured AFTER INSERT (spec §2).
  {
    table: "sales",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 1,
    lane: "ordered",
  },
  {
    table: "sale_lines",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 2,
    lane: "ordered",
  },
  {
    table: "tenders",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 2,
    lane: "ordered",
  },
  {
    table: "sale_settlements",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 2,
    lane: "ordered",
  },
  {
    table: "sale_substitutions",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 2,
    lane: "ordered",
  },
  {
    table: "sale_voids",
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    fkRank: 2,
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
    fkRank: 2,
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
    fkRank: 1,
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
    fkRank: 0,
    lane: "ordered",
  },
  {
    table: "working_order_lines",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    fkRank: 1,
    lane: "ordered",
  },
];

/** The physical table names on one lane, derived once from ENROLLED (never a second hand-kept array).
 * The source route maps `?lane=` → this list → readSyncLogSince's `tables` filter (spec §4c). */
export function tablesForLane(lane: SyncLane): string[] {
  return ENROLLED.filter((e) => e.lane === lane).map((e) => e.table);
}
