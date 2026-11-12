import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  handoverActivations,
  handoverReturnBatches,
  openVenueDatabase,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { returnDigest } from "./return-records.js";
import { readCompletedReturns, recordReturnBatchTx } from "./return-completion.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const operationId = "takeover";
const digests = [
  returnDigest({ module: "first-module", payload: "first" }),
  returnDigest({ module: "second-module", payload: "second" }),
  returnDigest({ module: "second-module", payload: "third" }),
];
const inventory = returnDigest(digests);
beforeEach(async () => {
  await seedVenue(suite.db);
  const sourceNodeId = await seedNode(suite.db);
  const destinationNodeId = await seedNode(suite.db);
  await suite.db.insert(handoverActivations).values({
    operationId,
    sourceNodeId,
    destinationNodeId,
    scenario: "emergency",
    evidence: {
      purpose: "waitron.handover.declaration.v1",
      body: {},
      signerNodeId: destinationNodeId,
      signature: "signature",
    },
    personId: "person",
    activatedAt: "2026-11-12T10:00:00.000Z",
  });
});
const completed = () => readCompletedReturns(suite.db);
const record = (index: number, changes: Partial<Parameters<typeof recordReturnBatchTx>[1]> = {}) =>
  withTransaction(suite.db, (tx) =>
    recordReturnBatchTx(tx, {
      operationId,
      inventory,
      index,
      count: 3,
      digest: digests[index]!,
      ...changes,
    }),
  );

it("confirms an ordered cross-module inventory only after every batch arrives, including last-first delivery", async () => {
  expect(await completed()).toEqual(new Set());
  await record(2);
  await record(0);
  expect(await completed()).toEqual(new Set());
  await record(1);
  expect(await completed()).toEqual(new Set([operationId]));
});

it("keeps separate inventories and requires the advertised digest to match", async () => {
  await record(0);
  await record(1, { inventory: "a".repeat(64) });
  await record(2);
  expect(await completed()).toEqual(new Set());
  await record(0, { inventory: "a".repeat(64) });
  await record(2, { inventory: "a".repeat(64) });
  expect(await completed()).toEqual(new Set());
  await record(1);
  await record(0, { inventory: "f".repeat(64) });
  expect(await completed()).toEqual(new Set([operationId]));
});

it("keeps the first count and digest, ignores identical retries, and cannot be completed with conflicting facts", async () => {
  await record(0);
  await record(0);
  await record(0, { digest: "c".repeat(64), count: 1 });
  await record(1, { count: 2 });
  expect(await suite.db.select().from(handoverReturnBatches)).toEqual([
    { operationId, inventory, batchIndex: 0, batchCount: 3, batchDigest: digests[0] },
  ]);
  expect(await completed()).toEqual(new Set());
  await record(1);
  await record(2);
  expect(await completed()).toEqual(new Set([operationId]));
});

it("retains completion across reopened handles and a later venue copy", async () => {
  for (const index of [0, 1, 2]) await record(index);
  const directory = dirname(suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file);
  const reopened = await openVenueDatabase(directory, { exclusive: false });
  try {
    expect(await readCompletedReturns(reopened.venue)).toEqual(new Set([operationId]));
  } finally {
    await reopened.close();
  }
  const copy = await mkdtemp(join(tmpdir(), "return-completion-copy-"));
  try {
    await suite.db.archiveTo(join(copy, "venue.db"));
    const later = await openVenueDatabase(copy);
    try {
      expect(await readCompletedReturns(later.venue)).toEqual(new Set([operationId]));
    } finally {
      await later.close();
    }
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
});
