import { describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { createPublicationStatement, createPublications, publicationName } from "./publications.js";

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
