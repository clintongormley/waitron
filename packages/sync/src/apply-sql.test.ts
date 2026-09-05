import { describe, expect, it } from "vitest";
import { applyStatementFor, deleteStatementFor } from "./apply-sql.js";
import type { EnrolledTable } from "@waitron/sync-enrolment";

// apply-sql.ts is now a PURE function of an injected EnrolledTable (its `table`, `columns`,
// `conflictKey`, `mode`, `watermarkColumn`, `captureOps`) — it imports no domain schema (SP-2a
// inversion). So this suite builds representative local fixtures rather than reading a central
// registry or the Drizzle schema. The SQL is a pure function of `columns`, so these pinned column
// lists need only be internally consistent; the REAL column lists (that `columns` equals
// getTableColumns(schema) and cannot drift) are pinned in each OWNING package's enrolment.test.ts
// (@waitron/db, @waitron/identity, @waitron/payments), which is where that schema-completeness
// assertion now lives.

// Group A — append-only → insert-only.
const salesEntry: EnrolledTable = {
  table: "sales",
  mode: "insert-only",
  conflictKey: ["id"],
  watermarkColumn: null,
  captureOps: ["insert"],
  fkRank: 3,
  lane: "ordered",
  columns: ["id", "tenant_id", "total"],
};
// Group B, and the one table whose conflict key is (tenant_id) not (id) — so tenant_id is the column
// EXCLUDED from the SET list. Columns match the real payment_policy shape.
const policyEntry: EnrolledTable = {
  table: "payment_policy",
  mode: "watermark-upsert",
  conflictKey: ["tenant_id"],
  watermarkColumn: "updated_at",
  captureOps: ["insert", "update"],
  fkRank: 0,
  lane: "ordered",
  columns: ["tenant_id", "offline_mode", "offline_amount_cap", "created_at", "updated_at"],
};
// Group C — watermark-upsert with a NULL watermark: the upsert is unconditional (no WHERE), and it is
// DELETE-capable.
const woEntry: EnrolledTable = {
  table: "working_orders",
  mode: "watermark-upsert",
  conflictKey: ["id"],
  watermarkColumn: null,
  captureOps: ["insert", "update", "delete"],
  fkRank: 2,
  lane: "ordered",
  columns: ["id", "tenant_id", "status"],
};
const woLinesEntry: EnrolledTable = { ...woEntry, table: "working_order_lines", fkRank: 3 };
// A wide Group-B table (structural SET-list assertion).
const productsEntry: EnrolledTable = {
  table: "products",
  mode: "watermark-upsert",
  conflictKey: ["id"],
  watermarkColumn: "updated_at",
  captureOps: ["insert", "update"],
  fkRank: 2,
  lane: "ordered",
  columns: ["id", "tenant_id", "descriptions", "unit_price", "active", "updated_at"],
};
// Identity config: mutable, NULL watermark → unconditional Group-C upsert; webauthn_credentials is
// DELETE-capable (a passkey is revoked), persons is not (suspended, never removed).
const personsEntry: EnrolledTable = {
  table: "persons",
  mode: "watermark-upsert",
  conflictKey: ["id"],
  watermarkColumn: null,
  captureOps: ["insert", "update"],
  fkRank: 0,
  lane: "ordered",
  columns: ["id", "tenant_id", "display_name", "pin_hash", "role", "status"],
};
const credsEntry: EnrolledTable = {
  table: "webauthn_credentials",
  mode: "watermark-upsert",
  conflictKey: ["id"],
  watermarkColumn: null,
  captureOps: ["insert", "update", "delete"],
  fkRank: 1,
  lane: "ordered",
  columns: ["id", "tenant_id", "person_id", "credential_id", "public_key", "counter"],
};
// The C1 table-service floor closure: watermark-upsert with NULL watermark, NO delete captured.
const diningEntry: EnrolledTable = {
  table: "dining_tables",
  mode: "watermark-upsert",
  conflictKey: ["id"],
  watermarkColumn: null,
  captureOps: ["insert", "update"],
  fkRank: 1,
  lane: "ordered",
  columns: ["id", "tenant_id", "label", "status_id"],
};

describe("applyStatementFor emits the exact static statement per mode", () => {
  it("insert-only → ON CONFLICT DO NOTHING (representative: sales)", () => {
    // Group A. No DO UPDATE SET column list — a re-delivery carrying different bytes is a no-op, so
    // the append-only stored row is never overwritten (spec §3 requirement 2).
    expect(applyStatementFor(salesEntry)).toBe(
      "insert into sales select * from jsonb_populate_record(null::sales, $1) on conflict (id) do nothing",
    );
  });

  it("watermark-upsert WITH a watermark → DO UPDATE SET … WHERE excluded.wm > t.wm (representative: payment_policy)", () => {
    // Group B, and the one table whose conflict key is (tenant_id) not (id) — so tenant_id is the
    // column EXCLUDED from the SET list. The WHERE makes an older/equal image a no-op (spec §3).
    expect(applyStatementFor(policyEntry)).toBe(
      "insert into payment_policy select * from jsonb_populate_record(null::payment_policy, $1) " +
        "on conflict (tenant_id) do update set offline_mode = excluded.offline_mode, " +
        "offline_amount_cap = excluded.offline_amount_cap, created_at = excluded.created_at, " +
        "updated_at = excluded.updated_at where excluded.updated_at > payment_policy.updated_at",
    );
  });

  it("watermark-upsert with NULL watermark → unconditional DO UPDATE SET, no WHERE (representative: working_orders)", () => {
    // Group C. No monotonic column exists on working_orders (spec §2), so the upsert is
    // unconditional; non-regression rests on the seq cursor (spec §3), not a row-level watermark.
    expect(applyStatementFor(woEntry)).toBe(
      "insert into working_orders select * from jsonb_populate_record(null::working_orders, $1) " +
        "on conflict (id) do update set tenant_id = excluded.tenant_id, status = excluded.status",
    );
  });

  it("throws for a watermark table whose columns have no non-key column to upsert", () => {
    // The preserved loud-failure (formerly the columnNamesFor "no drizzle object" guard, adapted to
    // the injected-columns shape): a watermark-upsert entry whose only column is its conflict key would
    // emit an empty SET — a broken enrolment, not a valid statement. `enrol` always derives a real
    // column list, so this only fires on a hand-built fixture.
    expect(() => applyStatementFor({ ...woEntry, columns: ["id"] })).toThrow(/no non-key columns/);
  });
});

describe("deleteStatementFor emits an idempotent delete-by-key (Group C only)", () => {
  it("delete by id cast to uuid (representative: working_orders)", () => {
    expect(deleteStatementFor(woEntry)).toBe(
      "delete from working_orders where id = ($1->>'id')::uuid",
    );
  });

  it("delete by id cast to uuid (representative: working_order_lines)", () => {
    expect(deleteStatementFor(woLinesEntry)).toBe(
      "delete from working_order_lines where id = ($1->>'id')::uuid",
    );
  });

  it("refuses a non-delete-capable table", () => {
    // Group A/B carry no `delete` capture op, so there is no delete to apply — asking for one is a
    // programming error, not a silent empty statement.
    expect(() => deleteStatementFor(salesEntry)).toThrow(/delete/i);
    expect(() => deleteStatementFor(policyEntry)).toThrow(/delete/i);
  });
});

describe("the DO UPDATE SET list is the entry's columns minus the conflict key (products)", () => {
  // Assert the filter STRUCTURALLY: every non-key column appears once as `<col> = excluded.<col>`, the
  // conflict key never does, and the watermark WHERE is present.
  it("covers every non-key column, excludes the key", () => {
    const sql = applyStatementFor(productsEntry);
    for (const col of productsEntry.columns) {
      if (col === "id") {
        expect(sql).not.toContain("id = excluded.id"); // the conflict key is never in the SET list
      } else {
        expect(sql).toContain(`${col} = excluded.${col}`);
      }
    }
    expect(sql).toContain("where excluded.updated_at > products.updated_at");
  });
});

describe("the C1 table-service tables apply as an unconditional upsert and refuse a delete", () => {
  it("dining_tables: unconditional upsert (no watermark WHERE), no delete statement", () => {
    const statement = applyStatementFor(diningEntry);
    expect(statement).toContain("on conflict (id) do update set");
    expect(statement).not.toContain("where excluded."); // watermarkColumn null → unconditional
    expect(() => deleteStatementFor(diningEntry)).toThrow(); // deactivate-only: no delete captured
  });
});

describe("identity config tables apply as unconditional Group-C upserts (spec §3)", () => {
  it("persons upsert is UNCONDITIONAL (no watermark WHERE), mutable config columns in the SET", () => {
    const stmt = applyStatementFor(personsEntry);
    expect(stmt).toContain("on conflict (id) do update set");
    // null watermark → unconditional; monotonicity via seq cursor. Assert the absence of the WATERMARK
    // WHERE specifically (`where excluded.<col> > <table>.<col>`), not the substring "where" anywhere —
    // a future SET column merely CONTAINING "where" would otherwise misfire this. It must still fail if
    // a watermark WHERE is present (proven by deletion against the payment_policy case above).
    expect(stmt).not.toMatch(/where\s+excluded\./i);
    // A person is mutable config: pin_hash/role/status must all be in the SET list.
    expect(stmt).toContain("pin_hash = excluded.pin_hash");
    expect(stmt).toContain("role = excluded.role");
    expect(stmt).toContain("status = excluded.status");
  });

  it("webauthn_credentials builds a Group-C delete", () => {
    expect(deleteStatementFor(credsEntry)).toBe(
      "delete from webauthn_credentials where id = ($1->>'id')::uuid",
    );
  });
});

describe("generated SQL carries only literal identifiers and the single $1 bind (CLAUDE.md §3)", () => {
  // The identifier-escaping question does not arise because NO identifier is runtime-derived from row
  // data: table/column names come from the injected EnrolledTable (each owning package derived them
  // from its own schema). The only bind is $1 (the whole row_image). Proven here for a representative
  // spread of every mode.
  const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;
  const fixtures = [
    salesEntry,
    policyEntry,
    woEntry,
    woLinesEntry,
    productsEntry,
    personsEntry,
    credsEntry,
    diningEntry,
  ];

  it("every interpolated identifier is a safe [a-z_][a-z0-9_]* token", () => {
    for (const e of fixtures) {
      expect(e.table).toMatch(SAFE_IDENT);
      for (const k of e.conflictKey) expect(k).toMatch(SAFE_IDENT);
      if (e.watermarkColumn !== null) expect(e.watermarkColumn).toMatch(SAFE_IDENT);
      for (const c of e.columns) expect(c).toMatch(SAFE_IDENT);
    }
  });

  it("each statement has exactly one bind ($1) and no statement-chaining or comment", () => {
    for (const e of fixtures) {
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
