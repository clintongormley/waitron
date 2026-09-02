import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { applyStatementFor, deleteStatementFor, SYNC_SCHEMA_TABLES } from "./apply-sql.js";
import { ENROLLED, type EnrolledTable } from "./registry.js";

const byName = new Map(ENROLLED.map((e) => [e.table, e]));
function entry(table: string): EnrolledTable {
  const e = byName.get(table);
  if (e === undefined) throw new Error(`test fixture: ${table} is not enrolled`);
  return e;
}

describe("applyStatementFor emits the exact static statement per mode", () => {
  it("insert-only → ON CONFLICT DO NOTHING (representative: sales)", () => {
    // Group A. No DO UPDATE SET column list — a re-delivery carrying different bytes is a no-op, so
    // the append-only stored row is never overwritten (spec §3 requirement 2).
    expect(applyStatementFor(entry("sales"))).toBe(
      "insert into sales select * from jsonb_populate_record(null::sales, $1) on conflict (id) do nothing",
    );
  });

  it("watermark-upsert WITH a watermark → DO UPDATE SET … WHERE excluded.wm > t.wm (representative: payment_policy)", () => {
    // Group B, and the one table whose conflict key is (tenant_id) not (id) — so tenant_id is the
    // column EXCLUDED from the SET list. The WHERE makes an older/equal image a no-op (spec §3).
    expect(applyStatementFor(entry("payment_policy"))).toBe(
      "insert into payment_policy select * from jsonb_populate_record(null::payment_policy, $1) " +
        "on conflict (tenant_id) do update set offline_mode = excluded.offline_mode, " +
        "offline_amount_cap = excluded.offline_amount_cap, created_at = excluded.created_at, " +
        "updated_at = excluded.updated_at where excluded.updated_at > payment_policy.updated_at",
    );
  });

  it("watermark-upsert with NULL watermark → unconditional DO UPDATE SET, no WHERE (representative: working_orders)", () => {
    // Group C. No monotonic column exists on working_orders (spec §2), so the upsert is
    // unconditional; non-regression rests on the seq cursor (spec §3), not a row-level watermark.
    expect(applyStatementFor(entry("working_orders"))).toBe(
      "insert into working_orders select * from jsonb_populate_record(null::working_orders, $1) " +
        "on conflict (id) do update set tenant_id = excluded.tenant_id, till_id = excluded.till_id, " +
        "node_id = excluded.node_id, order_number = excluded.order_number, label = excluded.label, " +
        "status = excluded.status, opened_at = excluded.opened_at, settled_at = excluded.settled_at, " +
        // delivery_table_id added by table-service TS-1 (counter delivery-to-table); collected_at added
        // by KDS-1 (the order-level kitchen-handover marker) — sync's generator derives the SET list from
        // the schema's columns, so both replicate automatically (no generator change needed).
        "delivery_table_id = excluded.delivery_table_id, collected_at = excluded.collected_at",
    );
  });

  it("throws for a watermark table with no registered drizzle schema object", () => {
    // Covers the columnNamesFor guard: a watermark-upsert entry naming a table not in
    // SYNC_SCHEMA_TABLES has no column list to derive, so the statement cannot be built.
    const fake: EnrolledTable = {
      table: "not_a_real_table",
      mode: "watermark-upsert",
      conflictKey: ["id"],
      watermarkColumn: null,
      captureOps: ["insert", "update", "delete"],
      fkRank: 0,
      lane: "ordered",
    };
    expect(() => applyStatementFor(fake)).toThrow(/not_a_real_table/);
  });
});

describe("deleteStatementFor emits an idempotent delete-by-key (Group C only)", () => {
  it("delete by id cast to uuid (representative: working_orders)", () => {
    expect(deleteStatementFor(entry("working_orders"))).toBe(
      "delete from working_orders where id = ($1->>'id')::uuid",
    );
  });

  it("delete by id cast to uuid (representative: working_order_lines)", () => {
    expect(deleteStatementFor(entry("working_order_lines"))).toBe(
      "delete from working_order_lines where id = ($1->>'id')::uuid",
    );
  });

  it("refuses a non-delete-capable table", () => {
    // Group A/B carry no `delete` capture op, so there is no delete to apply — asking for one is a
    // programming error, not a silent empty statement.
    expect(() => deleteStatementFor(entry("sales"))).toThrow(/delete/i);
    expect(() => deleteStatementFor(entry("payment_policy"))).toThrow(/delete/i);
  });
});

describe("the DO UPDATE SET list is the schema's columns minus the conflict key (products)", () => {
  // products is the widest Group B table; assert the filter STRUCTURALLY rather than pinning its
  // long column list — every non-key column appears once as `<col> = excluded.<col>`, the conflict
  // key never does. This is derived from the live drizzle schema, so it cannot drift from it.
  it("covers every non-key column, excludes the key", () => {
    const sql = applyStatementFor(entry("products"));
    const cols = Object.values(getTableColumns(SYNC_SCHEMA_TABLES.products)).map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols.length).toBeGreaterThan(3);
    for (const col of cols) {
      if (col === "id") {
        // The conflict key is never in the SET list.
        expect(sql).not.toContain("id = excluded.id");
      } else {
        expect(sql).toContain(`${col} = excluded.${col}`);
      }
    }
    expect(sql).toContain("where excluded.updated_at > products.updated_at");
  });
});

describe("SYNC_SCHEMA_TABLES covers every enrolled table, and the watermark tables carry their column", () => {
  it("has a drizzle object for all nineteen enrolled tables", () => {
    for (const e of ENROLLED) {
      expect(SYNC_SCHEMA_TABLES[e.table]).toBeDefined();
    }
  });

  it("the C1 tables apply as an unconditional upsert and refuse a delete statement", () => {
    for (const table of ["dining_tables", "floor_zones", "table_service_statuses"]) {
      const e = entry(table);
      const statement = applyStatementFor(e);
      expect(statement).toContain(`on conflict (id) do update set`);
      expect(statement).not.toContain("where excluded."); // watermarkColumn null → unconditional
      expect(() => deleteStatementFor(e)).toThrow(); // deactivate-only: no delete captured
    }
  });

  it("each watermark-upsert table with a named watermark actually has that column", () => {
    // Confirms the spec §2 receipt against the live schema: a registry claiming
    // watermarkColumn:"updated_at" on a table lacking it would emit a WHERE against a missing column.
    for (const e of ENROLLED) {
      if (e.watermarkColumn !== null) {
        const cols = Object.values(getTableColumns(SYNC_SCHEMA_TABLES[e.table])).map((c) => c.name);
        expect(cols).toContain(e.watermarkColumn);
      }
    }
  });
});

describe("identity config tables apply as unconditional Group-C upserts (spec §3)", () => {
  const persons = ENROLLED.find((e) => e.table === "persons")!;
  const creds = ENROLLED.find((e) => e.table === "webauthn_credentials")!;

  it("persons is registered and its upsert is UNCONDITIONAL (no watermark WHERE)", () => {
    expect(SYNC_SCHEMA_TABLES.persons).toBeDefined();
    const stmt = applyStatementFor(persons);
    expect(stmt).toContain("on conflict (id) do update set");
    // null watermark → unconditional; monotonicity via seq cursor. Assert the absence of the WATERMARK
    // WHERE specifically (`where excluded.<col> > <table>.<col>`), not the substring "where" anywhere —
    // a future SET column merely CONTAINING "where" would otherwise misfire this. It must still fail if
    // a watermark WHERE is present (proven by deletion against the payment_policy case above).
    expect(stmt).not.toMatch(/where\s+excluded\./i);
    // A person is mutable config: pin_hash/password_hash/role/status must all be in the SET list.
    expect(stmt).toContain("pin_hash = excluded.pin_hash");
    expect(stmt).toContain("role = excluded.role");
  });

  it("webauthn_credentials is registered and builds a Group-C delete", () => {
    expect(SYNC_SCHEMA_TABLES.webauthn_credentials).toBeDefined();
    expect(deleteStatementFor(creds)).toBe(
      "delete from webauthn_credentials where id = ($1->>'id')::uuid",
    );
  });
});

describe("generated SQL carries only literal identifiers and the single $1 bind (CLAUDE.md §3)", () => {
  // The identifier-escaping question does not arise because NO identifier is runtime-derived: table
  // names come from the fixed ENROLLED registry, column names from the compile-time drizzle schema.
  // The only bind is $1 (the whole row_image). This proves it for every enrolled statement.
  const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

  it("every interpolated identifier is a safe [a-z_][a-z0-9_]* token", () => {
    for (const e of ENROLLED) {
      expect(e.table).toMatch(SAFE_IDENT);
      for (const k of e.conflictKey) expect(k).toMatch(SAFE_IDENT);
      if (e.watermarkColumn !== null) expect(e.watermarkColumn).toMatch(SAFE_IDENT);
      for (const c of Object.values(getTableColumns(SYNC_SCHEMA_TABLES[e.table]))) {
        expect(c.name).toMatch(SAFE_IDENT);
      }
    }
  });

  it("each statement has exactly one bind ($1) and no statement-chaining or comment", () => {
    for (const e of ENROLLED) {
      const stmts = [applyStatementFor(e)];
      if (e.captureOps.includes("delete")) stmts.push(deleteStatementFor(e));
      for (const sql of stmts) {
        expect(sql.match(/\$\d+/g)).toEqual(["$1"]);
        expect(sql).not.toContain(";");
        expect(sql).not.toContain("--");
      }
    }
  });
});
