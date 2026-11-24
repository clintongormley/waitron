import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, liveBackupQuery } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTaxpayer } from "@waitron/db/testing/seed.js";
import { MalformedHoldingsError } from "@waitron/module";
import { jobOrigin } from "@waitron/shared";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import type { TimeEntryAppend } from "./chain.js";
import { workforceHoldings, workforceLacking } from "./handover-holdings.js";
import { WORKFORCE_HANDOVER } from "./handover-return.js";
import { appendChainEntries, seedFixtureVenue, seedPerson } from "../test/fixtures.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS] });
const other = useVenueDb({ migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS] });

type Row = Record<string, string | number | null>;

let personId: string;

beforeEach(async () => {
  await seedTaxpayer(suite.db);
  await seedFixtureVenue(suite.db);
  await seedTaxpayer(other.db);
  await seedFixtureVenue(other.db);
  personId = await seedPerson(suite.db);
  await copyRows("persons", suite.db.all<Row>(sql`select * from persons where id = ${personId}`));
});

function clockIn(minute: number): TimeEntryAppend {
  return {
    personId,
    entryKind: minute % 2 === 0 ? "in" : "out",
    eventAt: new Date(Date.UTC(2026, 0, 5, 9, minute)).toISOString(),
    eventOffsetMinutes: 0,
    recordedByPersonId: personId,
    origin: jobOrigin("dashboard"),
  };
}

async function copyRows(table: string, copied: Row[]) {
  for (const row of copied) {
    const entries = Object.entries(row);
    await other.db.run(sql`insert into ${sql.identifier(table)}
      (${sql.join(
        entries.map(([key]) => sql.identifier(key)),
        sql`, `,
      )}) values (${sql.join(
        entries.map(([, value]) => sql`${value}`),
        sql`, `,
      )})`);
  }
}

/** A box known to both databases, with its first `copied` entries in both. */
async function sharedBox(entries: number, copied: number): Promise<string> {
  const nodeId = await seedNode(suite.db);
  await copyRows("nodes", suite.db.all<Row>(sql`select * from nodes where id = ${nodeId}`));
  await appendChainEntries(
    suite.db,
    nodeId,
    Array.from({ length: entries }, (_, minute) => clockIn(minute)),
  );
  await copyRows(
    "time_entries",
    suite.db.all<Row>(
      sql`select * from time_entries where node_id = ${nodeId} and sequence_no <= ${copied}
          order by sequence_no`,
    ),
  );
  return nodeId;
}

const hashAt = (nodeId: string, sequenceNo: number) =>
  suite.db.all<{ entry_hash: string }>(
    sql`select entry_hash from time_entries where node_id = ${nodeId} and sequence_no = ${sequenceNo}`,
  )[0]!.entry_hash;

const holdingsOf = (db: typeof suite.db) => workforceHoldings(liveBackupQuery(db));
const lackingIn = (db: typeof suite.db, holdings: Parameters<typeof workforceLacking>[1]) =>
  workforceLacking(liveBackupQuery(db), holdings);

describe("workforceHoldings", () => {
  it("lists each box's chain by its last position and that row's hash", async () => {
    const first = await seedNode(suite.db);
    const second = await seedNode(suite.db);
    await seedNode(suite.db);
    await appendChainEntries(suite.db, first, [clockIn(0), clockIn(1)]);
    await appendChainEntries(suite.db, second, [clockIn(2)]);
    await appendChainEntries(suite.db, first, [clockIn(3)]);

    const expected = [
      { nodeId: first, sequenceNo: 3, entryHash: hashAt(first, 3) },
      { nodeId: second, sequenceNo: 1, entryHash: hashAt(second, 1) },
    ].sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
    expect(await holdingsOf(suite.db)).toEqual(expected);
  });

  it("lists nothing for a database with no entries", async () => {
    expect(await holdingsOf(suite.db)).toEqual([]);
  });
});

describe("workforceLacking", () => {
  it("names a chain the other database lacks, holds fewer rows of, or holds with another hash", async () => {
    const absent = await seedNode(suite.db);
    await appendChainEntries(suite.db, absent, [clockIn(0)]);
    const shorter = await sharedBox(3, 2);
    const differing = await sharedBox(2, 1);
    await appendChainEntries(other.db, differing, [clockIn(30)]);
    const identical = await sharedBox(2, 2);
    const longer = await sharedBox(1, 1);
    await appendChainEntries(other.db, longer, [clockIn(40)]);

    const lacking = await lackingIn(other.db, await holdingsOf(suite.db));

    expect(lacking).toHaveLength(3);
    expect(lacking).toEqual(
      expect.arrayContaining([
        { nodeId: absent, reason: "record_missing" },
        { nodeId: shorter, reason: "record_missing" },
        { nodeId: differing, reason: "hash_differs" },
      ]),
    );
    expect(lacking.map((chain) => chain.nodeId)).not.toContain(identical);
    expect(lacking.map((chain) => chain.nodeId)).not.toContain(longer);
  });

  it("names nothing when the other database holds every chain", async () => {
    await sharedBox(2, 2);

    expect(await lackingIn(other.db, await holdingsOf(suite.db))).toEqual([]);
  });

  it.each([
    ["not a list", { nodeId: "n", sequenceNo: 1, entryHash: "A" }],
    ["an entry that is not an object", ["n"]],
    ["an entry that is a list", [["n", 1, "A"]]],
    ["a null entry", [null]],
    ["a missing node id", [{ sequenceNo: 1, entryHash: "A" }]],
    ["a hash that is not text", [{ nodeId: "n", sequenceNo: 1, entryHash: 1 }]],
    ["a position of zero", [{ nodeId: "n", sequenceNo: 0, entryHash: "A" }]],
    ["a fractional position", [{ nodeId: "n", sequenceNo: 1.5, entryHash: "A" }]],
    ["a position given as text", [{ nodeId: "n", sequenceNo: "1", entryHash: "A" }]],
  ])("refuses holdings with %s", async (_, holdings) => {
    await expect(lackingIn(other.db, holdings)).rejects.toBeInstanceOf(MalformedHoldingsError);
  });
});

describe("WORKFORCE_HANDOVER", () => {
  it("fills the holdings and lacking seats", () => {
    expect(WORKFORCE_HANDOVER.holdings).toBe(workforceHoldings);
    expect(WORKFORCE_HANDOVER.lacking).toBe(workforceLacking);
  });
});
