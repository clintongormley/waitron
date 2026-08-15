import { describe, expect, it } from "vitest";
import { ENROLLED, tablesForLane, type EnrolledTable } from "./registry.js";

/**
 * The enrolment registry is pinned here against spec §2's fourteen commercial-lane tables
 * (docs/superpowers/specs/2026-08-08-sync-slice1-commercial-outbox-spec.md). This table encodes the
 * spec INDEPENDENTLY of registry.ts, so the two must agree — a registry.ts that drifts from spec §2
 * fails here rather than shipping a wrong apply mode. The ops per group are grant facts, cited in
 * spec §2 to the migration that set each grant, and they match packages/sync/drizzle/0000_sync_outbox.sql's
 * capture triggers exactly (Group A AFTER INSERT, Group B AFTER INSERT OR UPDATE, Group C AFTER
 * INSERT OR UPDATE OR DELETE).
 */
const SPEC: Record<
  string,
  {
    mode: EnrolledTable["mode"];
    conflictKey: string[];
    watermarkColumn: string | null;
    captureOps: EnrolledTable["captureOps"];
    lane: EnrolledTable["lane"];
  }
> = {
  // Group A — append-only → insert-only apply (AFTER INSERT only).
  sales: {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    lane: "ordered",
  },
  sale_lines: {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    lane: "ordered",
  },
  tenders: {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    lane: "ordered",
  },
  sale_settlements: {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    lane: "ordered",
  },
  sale_substitutions: {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    lane: "ordered",
  },
  sale_voids: {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    lane: "ordered",
  },
  // payment_refunds is captured AFTER INSERT ONLY (append-only trail), so insert-only apply is
  // correct EVEN THOUGH the app-role grant is SELECT, INSERT, UPDATE
  // (packages/payments/drizzle/0001_payments_rls.sql:32) — spec §2's table says "SELECT, INSERT",
  // which is the divergence Task 2 flagged. The UPDATE grant does not change the mode: nothing
  // captures a payment_refunds UPDATE, so nothing applies one.
  payment_refunds: {
    mode: "insert-only",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert"],
    lane: "fast",
  },
  // Group B — mutable with a monotonic `updated_at` watermark → watermark upsert (AFTER INSERT OR
  // UPDATE). updated_at receipts: catalogues catalogue.ts:30, categories catalogue.ts:46, products
  // catalogue.ts:78, payments payments.ts:91, payment_policy payment-policy.ts:22.
  catalogues: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    lane: "ordered",
  },
  categories: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    lane: "ordered",
  },
  products: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    lane: "ordered",
  },
  payments: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    lane: "fast",
  },
  // payment_policy's PK is tenant_id (one row per tenant, payment-policy.ts:16), so its conflict
  // key is (tenant_id), not (id).
  payment_policy: {
    mode: "watermark-upsert",
    conflictKey: ["tenant_id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    lane: "ordered",
  },
  // Group C — mutable, NO watermark column, DELETE-capable → single ordered lane (AFTER INSERT OR
  // UPDATE OR DELETE). watermarkColumn null → the apply upsert is unconditional; monotonicity comes
  // from the seq cursor (spec §3). They hold the DELETE grant (0004_working_orders.sql:73,75).
  working_orders: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    lane: "ordered",
  },
  working_order_lines: {
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: null,
    captureOps: ["insert", "update", "delete"],
    lane: "ordered",
  },
};

const byName = new Map(ENROLLED.map((e) => [e.table, e]));

describe("ENROLLED carries exactly spec §2's fourteen commercial-lane tables", () => {
  it("has exactly fourteen rows, no duplicates", () => {
    expect(ENROLLED).toHaveLength(14);
    expect(byName.size).toBe(14);
  });

  it("enrols exactly the spec §2 table set", () => {
    expect([...byName.keys()].sort()).toEqual(Object.keys(SPEC).sort());
  });

  for (const [table, spec] of Object.entries(SPEC)) {
    it(`${table} carries the spec §2 mode, conflict key, watermark, capture ops and lane`, () => {
      const e = byName.get(table);
      if (e === undefined) throw new Error(`registry is missing enrolled table ${table}`);
      expect(e.mode).toBe(spec.mode);
      expect(e.conflictKey).toEqual(spec.conflictKey);
      expect(e.watermarkColumn).toBe(spec.watermarkColumn);
      expect(e.captureOps).toEqual(spec.captureOps);
      expect(e.lane).toBe(spec.lane);
    });
  }
});

describe("the fast lane carries exactly payments and payment_refunds (spec §4b)", () => {
  it("tablesForLane('fast') is exactly {payments, payment_refunds}", () => {
    expect(new Set(tablesForLane("fast"))).toEqual(new Set(["payments", "payment_refunds"]));
  });
  it("tablesForLane('ordered') is the remaining twelve enrolled tables", () => {
    const fast = new Set(["payments", "payment_refunds"]);
    const expected = ENROLLED.filter((e) => !fast.has(e.table)).map((e) => e.table);
    expect(tablesForLane("ordered").sort()).toEqual(expected.sort());
    expect(tablesForLane("ordered")).toHaveLength(12);
  });
  it("every enrolled table carries a lane, and the two lanes partition ENROLLED", () => {
    expect(tablesForLane("fast").length + tablesForLane("ordered").length).toBe(ENROLLED.length);
    for (const e of ENROLLED) expect(e.lane === "fast" || e.lane === "ordered").toBe(true);
  });
});

describe("every enrolled table name is an ASCII lowercase-and-underscore identifier", () => {
  // A mini in-package mirror of packages/db/src/english-only.ts: @waitron/sync is regime-neutral, so
  // no Spanish fiscal token (registros/envios/huella) or any non-[a-z_] character may appear in an
  // enrolled table name — every commercial-lane table is English-named by construction.
  for (const entry of ENROLLED) {
    it(`${entry.table} is [a-z_]+`, () => {
      expect(entry.table).toMatch(/^[a-z_]+$/);
    });
  }
});

describe("captureOps match each table's group", () => {
  // The group is a function of the mode + watermark + delete-capability, exactly as spec §2 splits
  // them. This asserts the registry never mixes, e.g., a watermark table that only captures inserts.
  for (const entry of ENROLLED) {
    it(`${entry.table} ops are consistent with its mode/watermark`, () => {
      if (entry.mode === "insert-only") {
        // Group A: append-only, captured AFTER INSERT only.
        expect(entry.captureOps).toEqual(["insert"]);
        expect(entry.watermarkColumn).toBeNull();
      } else if (entry.watermarkColumn !== null) {
        // Group B: mutable + watermark, captured AFTER INSERT OR UPDATE.
        expect(entry.captureOps).toEqual(["insert", "update"]);
      } else {
        // Group C: mutable, no watermark, DELETE-capable, captured AFTER INSERT OR UPDATE OR DELETE.
        expect(entry.captureOps).toEqual(["insert", "update", "delete"]);
      }
    });
  }
});

describe("fkRank is a topological order — every parent ranks strictly before its child", () => {
  // The FK relationships of spec §2 (each cited there to a file:line):
  //   working_orders → working_order_lines (0004_working_orders.sql order_fk),
  //   working_orders → payments (payments.working_order_id NOT NULL, payments.ts:101-105),
  //   working_orders → sales (sales.working_order_id set-on-park, sales.ts:194-198),
  //   sales → sale_lines/tenders/sale_settlements/sale_substitutions/sale_voids,
  //   payments → payment_refunds (payment-refunds.ts payment_fk),
  //   catalogues → categories → products.
  // Apply runs seq-ascending (spec §6), so fkRank is a static topological hint, not the apply order;
  // this asserts it never contradicts the FK graph.
  const PARENT_CHILD: [string, string][] = [
    ["working_orders", "working_order_lines"],
    ["working_orders", "payments"],
    ["working_orders", "sales"],
    ["sales", "sale_lines"],
    ["sales", "tenders"],
    ["sales", "sale_settlements"],
    ["sales", "sale_substitutions"],
    ["sales", "sale_voids"],
    ["payments", "payment_refunds"],
    ["catalogues", "categories"],
    ["categories", "products"],
  ];
  for (const [parent, child] of PARENT_CHILD) {
    it(`${parent}.fkRank < ${child}.fkRank`, () => {
      const p = byName.get(parent);
      const c = byName.get(child);
      if (p === undefined || c === undefined) {
        throw new Error(`registry is missing ${parent} or ${child}`);
      }
      expect(p.fkRank).toBeLessThan(c.fkRank);
    });
  }
});
