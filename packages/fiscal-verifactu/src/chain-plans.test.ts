import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendToChain } from "./chain.js";
import { heldRecords } from "./filing-cases.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";
import { altaFor, seedNode, seedSale } from "./testing/seed.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const positionIndex = "verifactu_records_node_secuencia_uq";

async function capturePlans(select: (query: string) => boolean, read: () => Promise<unknown>) {
  const plans: string[] = [];
  const prepare = DatabaseSync.prototype.prepare;
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    text,
  ) {
    const statement = prepare.call(this, text);
    if (!select(text)) return statement;
    const all = statement.all;
    statement.all = (...parameters: unknown[]) => {
      const explain = prepare.call(this, `explain query plan ${text}`);
      const plan = Reflect.apply(all, explain, parameters) as { detail: string }[];
      plans.push(...plan.map((row) => String(row.detail)));
      return Reflect.apply(all, statement, parameters);
    };
    return statement;
  });
  try {
    await read();
  } finally {
    spy.mockRestore();
  }
  return plans;
}

it("reads the latest position during append using the unique position index", async () => {
  const node = await seedNode(suite.db);
  const saleId = await seedSale(suite.db, node, 1);
  const plan = await capturePlans(
    (text) =>
      text.includes('from "verifactu_records"') &&
      text.includes('order by "verifactu_records"."secuencia" desc'),
    () =>
      withTransaction(suite.db, (tx) =>
        appendToChain(tx, node.nodeId, altaFor(node, saleId, 1, 1)),
      ),
  );
  expect(plan).toEqual([`SEARCH verifactu_records USING INDEX ${positionIndex} (node_id=?)`]);
});

it.each([
  ["held records", heldRecords],
  [
    "submission alerts",
    (tx: Parameters<typeof heldRecords>[0]) =>
      fiscalSubmissionSource.read({ tx, now: new Date("2026-11-22T12:00:00Z") }),
  ],
] as const)("walks preceding %s through the unique position index", async (_name, read) => {
  const plan = await capturePlans(
    (text) => text.includes("from verifactu_records preceding"),
    () =>
      withTransaction(suite.db, async (tx) => {
        await read(tx);
      }),
  );
  const walks = plan.filter((detail) => /^(SEARCH|SCAN) preceding\b/.test(detail));
  expect(walks.length).toBeGreaterThan(0);
  for (const walk of walks) {
    expect(walk).toContain(`SEARCH preceding USING INDEX ${positionIndex} (node_id=? AND `);
    expect(walk).toContain("secuencia<?");
  }
});

it("has no separate table or duplicate index for the stored chain head", () => {
  expect(
    suite.db.all(sql`
    select name from sqlite_schema
    where name in ('cadenas', 'verifactu_records_node_secuencia_idx')
  `),
  ).toEqual([]);
});
