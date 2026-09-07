import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import {
  createPublicationStatement,
  createPublications,
  ensurePublications,
  publicationName,
  setPublicationTablesStatement,
} from "./publications.js";

describe("publicationName", () => {
  it("carries the environment and class", () => {
    expect(publicationName("production", "ledger")).toBe("waitron_production_ledger");
    expect(publicationName("preproduction", "state")).toBe("waitron_preproduction_state");
  });
});

describe("createPublicationStatement", () => {
  it("names the publication and double-quotes every table", () => {
    expect(createPublicationStatement("production", "ledger", ["sales", "tenders"])).toBe(
      'CREATE PUBLICATION "waitron_production_ledger" FOR TABLE "sales", "tenders"',
    );
  });
  it("refuses an empty table list (a wiring bug, never a valid publication here)", () => {
    expect(() => createPublicationStatement("production", "ledger", [])).toThrow();
  });
  it("refuses a table name that is not a bare lowercase identifier", () => {
    expect(() => createPublicationStatement("production", "ledger", ['sales"; drop'])).toThrow();
  });
});

describe("createPublications", () => {
  // The whole `CREATE PUBLICATION` string lands in a single `sql.raw` StringChunk (confirmed by
  // inspection, same pattern as packages/provisioning/src/instance-apply.test.ts), so reading it
  // back off a fake db.execute lets this assert the literal statements without a database.
  it("executes the ledger statement then the state statement, in order", async () => {
    const statements: string[] = [];
    const db = {
      execute: (query: { queryChunks: { value: string[] }[] }) => {
        statements.push(query.queryChunks.map((chunk) => chunk.value.join("")).join(""));
        return Promise.resolve({ rows: [] });
      },
    } as unknown as Database;

    await createPublications(db, {
      environment: "production",
      ledgerTables: ["sales"],
      stateTables: ["products"],
    });

    expect(statements).toEqual([
      'CREATE PUBLICATION "waitron_production_ledger" FOR TABLE "sales"',
      'CREATE PUBLICATION "waitron_production_state" FOR TABLE "products"',
    ]);
  });
});

describe("setPublicationTablesStatement", () => {
  it("names the publication and double-quotes the new table set (utility DDL, §3)", () => {
    expect(setPublicationTablesStatement("production", "ledger", ["sales", "tenders"])).toBe(
      'ALTER PUBLICATION "waitron_production_ledger" SET TABLE "sales", "tenders"',
    );
  });
  it("refuses an empty table set and a non-identifier table", () => {
    expect(() => setPublicationTablesStatement("production", "ledger", [])).toThrow();
    expect(() => setPublicationTablesStatement("production", "ledger", ['x"; drop'])).toThrow();
  });
});

// A fake db for ensurePublications: it drives the reader with queued membership rows (in class order:
// ledger then state) and records only the DDL (CREATE/ALTER PUBLICATION). Reads bind the name (a
// Param chunk) so their reconstructed text starts with `select`; DDL is a single sql.raw StringChunk
// starting with CREATE/ALTER — that is how the fake tells them apart.
function ensureDb(reads: { rows: unknown[] }[]): { db: Database; ddl: string[] } {
  const ddl: string[] = [];
  let r = 0;
  const db = {
    execute: async (query: { queryChunks: { value?: unknown }[] }) => {
      const text = query.queryChunks
        .map((chunk) => (Array.isArray(chunk.value) ? chunk.value.join("") : ""))
        .join("");
      if (text.startsWith("CREATE PUBLICATION") || text.startsWith("ALTER PUBLICATION")) {
        ddl.push(text);
        return { rows: [] };
      }
      const next = reads[r];
      r += 1;
      if (next === undefined) throw new Error("fake db ran out of queued read results");
      return next;
    },
  };
  return { db: db as unknown as Database, ddl };
}

describe("ensurePublications", () => {
  const opts = {
    environment: "production" as const,
    ledgerTables: ["sales", "tenders"],
    stateTables: ["tenants"],
  };

  it("creates both when both are absent", async () => {
    const { db, ddl } = ensureDb([{ rows: [] }, { rows: [] }]);
    expect(await ensurePublications(db, opts)).toEqual({
      created: ["ledger", "state"],
      updated: [],
    });
    expect(ddl).toEqual([
      'CREATE PUBLICATION "waitron_production_ledger" FOR TABLE "sales", "tenders"',
      'CREATE PUBLICATION "waitron_production_state" FOR TABLE "tenants"',
    ]);
  });

  it("does nothing when both already carry exactly their tables", async () => {
    const { db, ddl } = ensureDb([
      { rows: [{ tablename: "sales" }, { tablename: "tenders" }] },
      { rows: [{ tablename: "tenants" }] },
    ]);
    expect(await ensurePublications(db, opts)).toEqual({ created: [], updated: [] });
    expect(ddl).toEqual([]);
  });

  it("alters only the class whose table set drifted", async () => {
    // ledger is missing `tenders`; state is exact.
    const { db, ddl } = ensureDb([
      { rows: [{ tablename: "sales" }] },
      { rows: [{ tablename: "tenants" }] },
    ]);
    expect(await ensurePublications(db, opts)).toEqual({ created: [], updated: ["ledger"] });
    expect(ddl).toEqual([
      'ALTER PUBLICATION "waitron_production_ledger" SET TABLE "sales", "tenders"',
    ]);
  });
});
