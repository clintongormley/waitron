import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EnrolledTable } from "@waitron/sync";
import { ALL_SYNC_ENROLMENTS } from "./modules.js";

// The behaviour-preserving oracle for the SP-2a inversion. Before the flip, this pinned the assembled
// module set against `@waitron/sync`'s central `ENROLLED`; that constant is now deleted, so the frozen
// snapshot below IS the oracle — a 28-table copy of the shared metadata the deleted
// `packages/sync/src/registry.test.ts` SPEC pinned (mode / conflictKey / watermarkColumn / captureOps /
// fkRank / lane). The assembled `ALL_SYNC_ENROLMENTS` (`ALL_MODULES.flatMap(m => m.sync ?? [])`) must reproduce it exactly, so a
// per-package enrolment array that drifts fails HERE, in the composition root where the whole set is
// visible. The per-table `columns` are asserted (derived, cannot drift) in each OWNING package's
// enrolment.test.ts and are not re-pinned here.

type Shared = Pick<
  EnrolledTable,
  "mode" | "conflictKey" | "watermarkColumn" | "captureOps" | "fkRank" | "lane"
>;

const shared = (e: EnrolledTable): Shared => ({
  mode: e.mode,
  conflictKey: e.conflictKey,
  watermarkColumn: e.watermarkColumn,
  captureOps: e.captureOps,
  fkRank: e.fkRank,
  lane: e.lane,
});

// The frozen 28-table snapshot (the former central ENROLLED shared fields, plus the six fiscal-record
// lane tables from FISCAL_ENROLMENT, SP-3a). fkRank values match the FK graph pinned by the
// topological-order test below.
const SPEC: Record<string, Shared> = {
  // Group A — append-only → insert-only (AFTER INSERT only).
  sales: { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 3, lane: "ordered" }, // prettier-ignore
  sale_lines: { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "ordered" }, // prettier-ignore
  tenders: { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "ordered" }, // prettier-ignore
  sale_settlements: { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "ordered" }, // prettier-ignore
  sale_substitutions: { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "ordered" }, // prettier-ignore
  sale_voids: { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "ordered" }, // prettier-ignore
  payment_refunds: { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 4, lane: "fast" }, // prettier-ignore
  // Group B — mutable + monotonic updated_at watermark → watermark upsert (AFTER INSERT OR UPDATE).
  catalogues: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }, // prettier-ignore
  categories: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 1, lane: "ordered" }, // prettier-ignore
  products: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 2, lane: "ordered" }, // prettier-ignore
  payments: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 3, lane: "fast" }, // prettier-ignore
  payment_policy: { mode: "watermark-upsert", conflictKey: ["tenant_id"], watermarkColumn: "updated_at", captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }, // prettier-ignore
  // Group C — mutable, NO watermark, DELETE-capable → ordered lane (AFTER INSERT OR UPDATE OR DELETE).
  working_orders: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update", "delete"], fkRank: 2, lane: "ordered" }, // prettier-ignore
  working_order_lines: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update", "delete"], fkRank: 3, lane: "ordered" }, // prettier-ignore
  // Group D — table-service floor closure (C1): mutable, NO watermark, NO delete.
  floor_zones: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }, // prettier-ignore
  table_service_statuses: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }, // prettier-ignore
  dining_tables: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 1, lane: "ordered" }, // prettier-ignore
  // Identity CONFIG flow-down (spec §3): mutable, NO watermark. persons no delete; webauthn delete.
  persons: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }, // prettier-ignore
  webauthn_credentials: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update", "delete"], fkRank: 1, lane: "ordered" }, // prettier-ignore
  // Group F — kitchen KDS closure: mutable, NO watermark, NO delete.
  kitchen_stations: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }, // prettier-ignore
  kitchen_courses: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 0, lane: "ordered" }, // prettier-ignore
  ticket_items: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 4, lane: "ordered" }, // prettier-ignore
  // Group G — fiscal-record lane (SP-3a, FISCAL_ENROLMENT). All ordered: the fiscal chain is
  // indifferent to replication lag, and none is fast-lane-eligible. registros_facturacion is the
  // INSERT-ONLY immutable ledger; acks is the one fiscal table that DELETES.
  registros_facturacion: { mode: "insert-only", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert"], fkRank: 5, lane: "ordered" }, // prettier-ignore
  registro_sif: { mode: "watermark-upsert", conflictKey: ["id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 4, lane: "ordered" }, // prettier-ignore
  cadenas: { mode: "watermark-upsert", conflictKey: ["tenant_id", "node_id"], watermarkColumn: "actualizado_en", captureOps: ["insert", "update"], fkRank: 6, lane: "ordered" }, // prettier-ignore
  envios: { mode: "watermark-upsert", conflictKey: ["registro_id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 6, lane: "ordered" }, // prettier-ignore
  envio_flujo: { mode: "watermark-upsert", conflictKey: ["tenant_id"], watermarkColumn: null, captureOps: ["insert", "update"], fkRank: 2, lane: "ordered" }, // prettier-ignore
  acks: { mode: "watermark-upsert", conflictKey: ["registro_id"], watermarkColumn: null, captureOps: ["insert", "update", "delete"], fkRank: 6, lane: "ordered" }, // prettier-ignore
};

const assembled = ALL_SYNC_ENROLMENTS;
const byName = new Map(assembled.map((e) => [e.table, e]));

describe("the assembled module enrolment set reproduces the frozen 28-table snapshot (behaviour-preserving)", () => {
  it("covers exactly the 28 snapshot tables, no duplicates", () => {
    expect(assembled).toHaveLength(28);
    expect(byName.size).toBe(28);
    expect([...byName.keys()].sort()).toEqual(Object.keys(SPEC).sort());
  });

  for (const [table, spec] of Object.entries(SPEC)) {
    it(`${table} carries its snapshot mode, conflict key, watermark, capture ops, fkRank and lane`, () => {
      const e = byName.get(table);
      if (e === undefined) throw new Error(`assembled set is missing enrolled table ${table}`);
      expect(shared(e)).toEqual(spec);
    });
  }
});

describe("the fast lane carries exactly payments and payment_refunds; the lanes partition the set (spec §4b)", () => {
  const laneTables = (lane: string) => assembled.filter((e) => e.lane === lane).map((e) => e.table);
  it("fast lane is exactly {payments, payment_refunds}", () => {
    expect(new Set(laneTables("fast"))).toEqual(new Set(["payments", "payment_refunds"]));
  });
  it("ordered lane is the remaining twenty-six tables", () => {
    expect(laneTables("ordered")).toHaveLength(26);
  });
  it("every table carries a lane, and the two lanes partition the set", () => {
    expect(laneTables("fast").length + laneTables("ordered").length).toBe(assembled.length);
    for (const e of assembled) expect(e.lane === "fast" || e.lane === "ordered").toBe(true);
  });
});

describe("every enrolled table name is an ASCII lowercase-and-underscore identifier", () => {
  for (const e of assembled) {
    it(`${e.table} is [a-z_]+`, () => {
      expect(e.table).toMatch(/^[a-z_]+$/);
    });
  }
});

describe("captureOps are consistent with each table's mode/watermark", () => {
  for (const e of assembled) {
    it(`${e.table} ops are consistent with its mode/watermark`, () => {
      if (e.mode === "insert-only") {
        expect(e.captureOps).toEqual(["insert"]);
        expect(e.watermarkColumn).toBeNull();
      } else if (e.watermarkColumn !== null) {
        expect(e.captureOps).toEqual(["insert", "update"]);
      } else {
        const hasDelete = e.captureOps.includes("delete");
        expect(e.captureOps).toEqual(
          hasDelete ? ["insert", "update", "delete"] : ["insert", "update"],
        );
      }
    });
  }
});

describe("fkRank is a topological order — every parent ranks strictly before its child", () => {
  // The FK graph of spec §2 + the C1 table-service closure + the identity + kitchen closures, copied
  // from the deleted registry.test.ts (each edge cited there). Runtime correctness rests on seq-ascending
  // apply, not fkRank; this asserts the static hint never contradicts the FK graph.
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
    ["products", "working_order_lines"],
    ["floor_zones", "dining_tables"],
    ["table_service_statuses", "dining_tables"],
    ["dining_tables", "working_orders"],
    ["persons", "webauthn_credentials"],
    ["kitchen_stations", "categories"],
    ["kitchen_stations", "products"],
    ["kitchen_courses", "products"],
    ["kitchen_courses", "working_order_lines"],
    ["kitchen_stations", "ticket_items"],
    ["kitchen_courses", "ticket_items"],
    ["working_order_lines", "ticket_items"],
    // Fiscal-record lane (SP-3a). Intra-fiscal FK edges among enrolled tables:
    // registros_facturacion.sif_id → registro_sif.id; cadenas.ultimo_registro_id / envios.registro_id /
    // acks.registro_id → registros_facturacion.id. So registro_sif (4) < registros_facturacion (5) <
    // cadenas/envios/acks (6). envio_flujo (2) references only tenants — no enrolled fiscal parent/child.
    ["registro_sif", "registros_facturacion"],
    ["registros_facturacion", "cadenas"],
    ["registros_facturacion", "envios"],
    ["registros_facturacion", "acks"],
  ];
  for (const [parent, child] of PARENT_CHILD) {
    it(`${parent}.fkRank < ${child}.fkRank`, () => {
      const p = byName.get(parent);
      const c = byName.get(child);
      if (p === undefined || c === undefined) {
        throw new Error(`assembled set is missing ${parent} or ${child}`);
      }
      expect(p.fkRank).toBeLessThan(c.fkRank);
    });
  }
});

describe("inversion proof: @waitron/sync imports no domain SCHEMA (SP-2a)", () => {
  // SP-2a is a SCHEMA inversion: @waitron/sync stops owning enrolment data and stops importing any
  // domain package's Drizzle schema. It STILL depends on @waitron/identity — but only for peers.ts's
  // scrypt helpers (hashSecret/verifySecret, node:crypto), a pre-existing #144 crypto coupling that is
  // NOT a schema import and out of scope for this slice — so identity is deliberately NOT asserted absent
  // here (see docs correction 093331b4). The invariant the inversion establishes is: no @waitron/payments
  // dependency, and no `/src/schema` deep import anywhere under packages/sync/src.
  it("packages/sync/package.json names no @waitron/payments dependency", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../../packages/sync/package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["@waitron/payments"]).toBeUndefined();
  });

  it("no file under packages/sync/src contains a domain-schema deep import (/src/schema)", () => {
    const root = new URL("../../../packages/sync/src/", import.meta.url);
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) =>
      f.endsWith(".ts"),
    );
    // Sanity: the walk found source (an empty list would make the assertion vacuously pass).
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(new URL(f, root), "utf8");
      expect(text, `${f} must not deep-import a domain package's /src/schema`).not.toContain(
        "/src/schema",
      );
    }
  });
});
