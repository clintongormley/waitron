import { describe, expect, it, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation, seedPerson } from "../test/fixtures.js";
import { computeEntryHash, verifyChain, type EntryHashInput } from "./chain-hash.js";
import { appendToChain, readChain } from "./chain.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";

const extension = {
  authorKind: "worker" as const,
  direction: null,
  missingEntryKind: null,
  respondsToEntryId: null,
  payPeriodClosureId: null,
};
const content: EntryHashInput = {
  sequenceNo: 1,
  personId: "p",
  locationId: "l",
  nodeId: "n",
  entryKind: "in",
  eventAt: "2026-01-05T09:00:00.000Z",
  recordedAt: "2026-01-05T09:00:00.000Z",
  eventOffsetMinutes: 0,
  recordedByPersonId: "p",
  capturedBySource: "dashboard",
  capturedByDeviceId: null,
  correctsEntryId: null,
  correctionReason: null,
  correctionStatus: null,
  correctionActorId: null,
  prevEntryHash: null,
};
describe("record extension hash", () => {
  it.each([
    ["authorKind", "manager"],
    ["direction", "worker_request"],
    ["missingEntryKind", "out"],
    ["respondsToEntryId", "response"],
    ["payPeriodClosureId", "closure"],
  ])("detects a change in %s", (field, value) => {
    const original = { ...content, extension };
    const row = { ...original, isFirstEntry: true, entryHash: computeEntryHash(original) };
    expect(verifyChain([row])).toEqual({ ok: true });
    expect(verifyChain([{ ...row, extension: { ...extension, [field]: value } }])).toEqual({
      ok: false,
      reason: "hash_mismatch",
      sequenceNo: 1,
    });
  });
  it("detects removal of the extension while retaining the basic hash format", () => {
    const original = { ...content, extension };
    const row = { ...original, isFirstEntry: true, entryHash: computeEntryHash(original) };
    expect(verifyChain([{ ...row, extension: null }])).toEqual({
      ok: false,
      reason: "hash_mismatch",
      sequenceNo: 1,
    });
    expect(computeEntryHash({ ...content, extension: null })).toBe(computeEntryHash(content));
  });
});

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
let personId: string;
let locationId: string;
let nodeId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  personId = await seedPerson(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
});
it("round-trips an automatic end with no human recorder and verifies its hash", async () => {
  const automatic = { ...extension, authorKind: "automatic" as const };
  await suite.db.transaction((tx) =>
    appendToChain(
      tx,
      { nodeId, locationId },
      {
        personId,
        entryKind: "out",
        eventAt: "2026-01-05T17:00:00.000Z",
        eventOffsetMinutes: 0,
        recordedByPersonId: null,
        origin: jobOrigin("dashboard"),
        extension: automatic,
      },
    ),
  );
  const rows = await readChain(suite.db, { nodeId, locationId });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ recordedByPersonId: null, extension: automatic });
  expect(verifyChain(rows)).toEqual({ ok: true });
});

it("confirmation leaves the last captured out as the current state", async () => {
  const { WorkforceBackend } = await import("./clocking.js");
  const backend = new WorkforceBackend();
  const input = {
    nodeId,
    locationId,
    personId,
    at: "2026-01-05T09:00:00.000Z",
    offsetMinutes: 0,
    origin: jobOrigin("dashboard"),
  };
  await suite.db.transaction((tx) => backend.clockIn(tx, input));
  await suite.db.transaction((tx) =>
    backend.clockOut(tx, { ...input, at: "2026-01-05T17:00:00.000Z" }),
  );
  const target = suite.db.execute(sql`select id from time_entries where entry_kind = 'out'`)
    .rows[0]!.id as string;
  await suite.db.transaction((tx) =>
    appendToChain(
      tx,
      { nodeId, locationId },
      {
        personId,
        entryKind: "confirmation",
        eventAt: "2026-01-05T18:00:00.000Z",
        eventOffsetMinutes: 0,
        recordedByPersonId: personId,
        origin: jobOrigin("dashboard"),
        extension: { ...extension, respondsToEntryId: target },
      },
    ),
  );
  await suite.db.transaction((tx) =>
    backend.clockIn(tx, { ...input, at: "2026-01-06T09:00:00.000Z" }),
  );
  expect(
    suite.db.execute(sql`select entry_kind from time_entries order by sequence_no`).rows,
  ).toEqual([
    { entry_kind: "in" },
    { entry_kind: "out" },
    { entry_kind: "confirmation" },
    { entry_kind: "in" },
  ]);
});

it("refuses an all-null extension before appending a hash that cannot round-trip", async () => {
  await expect(
    suite.db.transaction((tx) =>
      appendToChain(
        tx,
        { nodeId, locationId },
        {
          personId,
          entryKind: "in",
          eventAt: "2026-01-05T09:00:00.000Z",
          eventOffsetMinutes: 0,
          recordedByPersonId: personId,
          origin: jobOrigin("dashboard"),
          extension: {
            authorKind: null,
            direction: null,
            missingEntryKind: null,
            respondsToEntryId: null,
            payPeriodClosureId: null,
          },
        },
      ),
    ),
  ).rejects.toMatchObject({ code: "attendance.invalid", params: { reason: "empty_extension" } });
  expect(suite.db.execute(sql`select id from time_entries`).rows).toEqual([]);
  expect(suite.db.execute(sql`select * from workforce_chains`).rows).toEqual([]);
});
