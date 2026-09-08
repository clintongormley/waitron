import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { ensureReplicationShape } from "./replication.js";

// A fake db that drives `ensurePublications`' publication reads (queued rows, ledger then state) and
// `listSubscriptions`' catalog read (the injected subscription rows), and records the DDL the shape
// step emits: CREATE/ALTER PUBLICATION and ALTER SUBSCRIPTION. It tells reads apart by their
// reconstructed text — a bound-parameter read reconstructs starting `select pt.tablename`, the
// subscription list starts `select subname`, and the DDL is a single `sql.raw` StringChunk starting
// CREATE/ALTER (the same reconstruction publications.test.ts uses).
function fakeDb(opts: {
  pubReads: { rows: unknown[] }[];
  subs: { subname: string; enabled: boolean; publications: string[] }[];
}): { db: Database; ddl: string[] } {
  const ddl: string[] = [];
  let pr = 0;
  const db = {
    execute: async (query: { queryChunks: { value?: unknown }[] }) => {
      const text = query.queryChunks
        .map((chunk) => (Array.isArray(chunk.value) ? chunk.value.join("") : ""))
        .join("");
      const trimmed = text.trimStart();
      if (
        trimmed.startsWith("CREATE PUBLICATION") ||
        trimmed.startsWith("ALTER PUBLICATION") ||
        trimmed.startsWith("ALTER SUBSCRIPTION")
      ) {
        ddl.push(trimmed);
        return { rows: [] };
      }
      if (text.includes("pg_subscription")) {
        return { rows: opts.subs };
      }
      const next = opts.pubReads[pr];
      pr += 1;
      if (next === undefined) throw new Error("fake db ran out of queued publication reads");
      return next;
    },
  };
  return { db: db as unknown as Database, ddl };
}

const TABLES = { ledgerTables: ["sales"], stateTables: ["tenants"] } as const;
const noop = (): void => {};

describe("ensureReplicationShape", () => {
  it("ensures both publications and narrows nothing on a primary with no state-naming subscription", async () => {
    // Both publications already present and exact (no CREATE/ALTER), and no subscription still names
    // state — a fresh primary. The shape step must emit no DDL at all.
    const { db, ddl } = fakeDb({
      pubReads: [{ rows: [{ tablename: "sales" }] }, { rows: [{ tablename: "tenants" }] }],
      subs: [],
    });
    await ensureReplicationShape(db, {
      environment: "preproduction",
      mode: "primary",
      ...TABLES,
      log: noop as never,
    });
    expect(ddl).toEqual([]);
  });

  it("creates both publications when absent (every boot, both modes)", async () => {
    const { db, ddl } = fakeDb({
      pubReads: [{ rows: [] }, { rows: [] }],
      subs: [],
    });
    await ensureReplicationShape(db, {
      environment: "preproduction",
      mode: "mirror",
      ...TABLES,
      log: noop as never,
    });
    expect(ddl).toEqual([
      'CREATE PUBLICATION "waitron_preproduction_ledger" FOR TABLE "sales"',
      'CREATE PUBLICATION "waitron_preproduction_state" FOR TABLE "tenants"',
    ]);
  });

  it("narrows an ENABLED subscription still naming the state publication to ledger-only (refresh=false)", async () => {
    // The promotion self-heal (spec §4.2 step 3): a promoted node holds an enabled subscription still
    // naming [ledger, state]. Exactly one ALTER SUBSCRIPTION … SET PUBLICATION "<ledger>" WITH
    // (refresh = false) — never a REFRESH (that would drop the state tables' un-applied WAL, probe C).
    const { db, ddl } = fakeDb({
      pubReads: [{ rows: [{ tablename: "sales" }] }, { rows: [{ tablename: "tenants" }] }],
      subs: [
        {
          subname: "waitron_preproduction_sub_abc",
          enabled: true,
          publications: ["waitron_preproduction_ledger", "waitron_preproduction_state"],
        },
      ],
    });
    await ensureReplicationShape(db, {
      environment: "preproduction",
      mode: "primary",
      ...TABLES,
      log: noop as never,
    });
    expect(ddl).toEqual([
      'ALTER SUBSCRIPTION "waitron_preproduction_sub_abc" SET PUBLICATION "waitron_preproduction_ledger" WITH (refresh = false)',
    ]);
  });

  it("does not narrow a subscription that already names ledger-only", async () => {
    const { db, ddl } = fakeDb({
      pubReads: [{ rows: [{ tablename: "sales" }] }, { rows: [{ tablename: "tenants" }] }],
      subs: [
        {
          subname: "waitron_preproduction_sub_abc",
          enabled: true,
          publications: ["waitron_preproduction_ledger"],
        },
      ],
    });
    await ensureReplicationShape(db, {
      environment: "preproduction",
      mode: "primary",
      ...TABLES,
      log: noop as never,
    });
    expect(ddl).toEqual([]);
  });

  it("does not narrow a DISABLED subscription even if it names state (only ENABLED subs are narrowed)", async () => {
    const { db, ddl } = fakeDb({
      pubReads: [{ rows: [{ tablename: "sales" }] }, { rows: [{ tablename: "tenants" }] }],
      subs: [
        {
          subname: "waitron_preproduction_sub_abc",
          enabled: false,
          publications: ["waitron_preproduction_ledger", "waitron_preproduction_state"],
        },
      ],
    });
    await ensureReplicationShape(db, {
      environment: "preproduction",
      mode: "primary",
      ...TABLES,
      log: noop as never,
    });
    expect(ddl).toEqual([]);
  });

  it("a MIRROR never narrows, even with an enabled state-naming subscription", async () => {
    // A mirror is a pure subscriber; narrowing is a primary/promotion concern only. The same enabled
    // [ledger, state] sub that a primary would narrow is left untouched here.
    const { db, ddl } = fakeDb({
      pubReads: [{ rows: [{ tablename: "sales" }] }, { rows: [{ tablename: "tenants" }] }],
      subs: [
        {
          subname: "waitron_preproduction_sub_abc",
          enabled: true,
          publications: ["waitron_preproduction_ledger", "waitron_preproduction_state"],
        },
      ],
    });
    await ensureReplicationShape(db, {
      environment: "preproduction",
      mode: "mirror",
      ...TABLES,
      log: noop as never,
    });
    expect(ddl).toEqual([]);
  });

  it("logs publications_ensured and subscription_narrowed", async () => {
    const events: { level: string; event: string; fields: unknown }[] = [];
    const log = (level: string, event: string, fields: unknown): void => {
      events.push({ level, event, fields });
    };
    const { db } = fakeDb({
      pubReads: [{ rows: [] }, { rows: [] }],
      subs: [
        {
          subname: "waitron_preproduction_sub_abc",
          enabled: true,
          publications: ["waitron_preproduction_ledger", "waitron_preproduction_state"],
        },
      ],
    });
    await ensureReplicationShape(db, {
      environment: "preproduction",
      mode: "primary",
      ...TABLES,
      log: log as never,
    });
    expect(events.map((e) => e.event)).toEqual([
      "replication.publications_ensured",
      "replication.subscription_narrowed",
    ]);
  });
});
