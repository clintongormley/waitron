import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedTaxpayer } from "@waitron/db/testing/seed.js";
import { sql } from "drizzle-orm";
import { AppError, deviceOrigin, jobOrigin } from "@waitron/shared";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { readChain, type TimeEntryAppend } from "./chain.js";
import { verifyChain } from "./chain-hash.js";
import {
  readWorkforceBatch,
  receiveWorkforceBatch,
  type ReturnBatchValue,
  type ReturnRow,
  type WorkforceReturnBatch,
  readWorkforceReturn,
  WORKFORCE_RETURN_MAX_BYTES,
  WORKFORCE_RETURN_ROW_CAP,
} from "./handover-return.js";
import { appendChainEntries, seedFixtureVenue, seedPerson } from "../test/fixtures.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS] });
const main = useVenueDb({ migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS] });

let oldBox: string;
let otherBox: string;
let personId: string;

beforeEach(async () => {
  await seedTaxpayer(suite.db);
  await seedFixtureVenue(suite.db);
  oldBox = await seedNode(suite.db);
  otherBox = await seedNode(suite.db);
  personId = await seedPerson(suite.db);
});

function clockIn(person: string, minute: number): TimeEntryAppend {
  return {
    personId: person,
    entryKind: minute % 2 === 0 ? "in" : "out",
    eventAt: new Date(Date.UTC(2026, 0, 5, 9, minute)).toISOString(),
    eventOffsetMinutes: 0,
    recordedByPersonId: person,
    origin: jobOrigin("dashboard"),
  };
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

describe("readWorkforceReturn", () => {
  it("sends no batch for a box with no entries", async () => {
    await appendChainEntries(suite.db, otherBox, [clockIn(personId, 0)]);

    expect(await readWorkforceReturn(suite.db, oldBox)).toEqual([]);
  });

  it("sends only the sender's own rows, in chain order", async () => {
    const own: string[] = [];
    for (let minute = 0; minute < 3; minute++) {
      own.push(...(await appendChainEntries(suite.db, oldBox, [clockIn(personId, minute)])));
      await appendChainEntries(suite.db, otherBox, [clockIn(personId, minute)]);
    }

    const batches = await readWorkforceReturn(suite.db, oldBox);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.entries.map((row) => [row.id, row.node_id, row.sequence_no])).toEqual([
      [own[0], oldBox, 1],
      [own[1], oldBox, 2],
      [own[2], oldBox, 3],
    ]);
  });

  it("splits at the row cap into consecutive batches", async () => {
    await appendChainEntries(
      suite.db,
      oldBox,
      Array.from({ length: WORKFORCE_RETURN_ROW_CAP + 1 }, (_, i) => clockIn(personId, i)),
    );

    const batches = await readWorkforceReturn(suite.db, oldBox);

    expect(batches.map((batch) => batch.entries.length)).toEqual([WORKFORCE_RETURN_ROW_CAP, 1]);
    expect(batches[1]!.entries[0]!.sequence_no).toBe(WORKFORCE_RETURN_ROW_CAP + 1);
  });

  it("splits before a batch would pass its byte limit, each batch naming only its own staff", async () => {
    const first = await seedPerson(suite.db, "a".repeat(120 * 1024));
    const second = await seedPerson(suite.db, "b".repeat(120 * 1024));
    await appendChainEntries(suite.db, oldBox, [clockIn(first, 0), clockIn(second, 1)]);

    const batches = await readWorkforceReturn(suite.db, oldBox);

    expect(batches.map((batch) => batch.staff.map((row) => row.id))).toEqual([[first], [second]]);
    for (const batch of batches)
      expect(bytes(batch)).toBeLessThanOrEqual(WORKFORCE_RETURN_MAX_BYTES);
  });

  it("names exactly the people and devices the batch's entries point at", async () => {
    const manager = await seedPerson(suite.db, "Marta");
    await seedPerson(suite.db, "Unrelated");
    const { deviceId } = await seedDevice(suite.db, { label: "Bar till" });
    await seedDevice(suite.db, { label: "Unrelated till" });
    const [target] = await appendChainEntries(suite.db, oldBox, [
      { ...clockIn(personId, 0), recordedByPersonId: manager, origin: deviceOrigin(deviceId) },
    ]);
    await appendChainEntries(suite.db, oldBox, [
      {
        ...clockIn(personId, 1),
        entryKind: "correction",
        correctsEntryId: target!,
        correctionReason: "Forgot",
        correctionStatus: "requested",
        correctionActorId: manager,
      },
    ]);

    const [batch] = await readWorkforceReturn(suite.db, oldBox);

    expect(batch!.staff).toEqual(
      [
        { id: personId, displayName: "Ana" },
        { id: manager, displayName: "Marta" },
      ].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    expect(batch!.devices).toEqual([{ id: deviceId, label: "Bar till" }]);
  });

  it("fits the largest row the routes can write within the row cap's share of a batch", async () => {
    const { deviceId } = await seedDevice(suite.db);
    const [target] = await appendChainEntries(suite.db, oldBox, [clockIn(personId, 0)]);
    await appendChainEntries(suite.db, oldBox, [
      {
        personId,
        entryKind: "correction",
        eventAt: "2026-01-05T09:01:00.000Z",
        eventOffsetMinutes: -840,
        recordedByPersonId: personId,
        origin: deviceOrigin(deviceId),
        correctsEntryId: target!,
        // A control character is the longest a character can be in JSON: six bytes.
        correctionReason: "\u0001".repeat(500),
        correctionStatus: "requested",
        correctionActorId: personId,
        extension: {
          selfApproved: false,
          authorKind: "manager",
          direction: "manager_proposal",
          missingEntryKind: null,
          respondsToEntryId: target!,
          payPeriodClosureId: null,
        },
      },
    ]);

    const [batch] = await readWorkforceReturn(suite.db, oldBox);
    const largest = bytes(batch!.entries[1]);

    expect(largest * WORKFORCE_RETURN_ROW_CAP).toBeLessThanOrEqual(WORKFORCE_RETURN_MAX_BYTES);
  });
});

describe("readWorkforceBatch", () => {
  const entry = { id: "e1", node_id: "n1", sequence_no: 1 };

  it.each<[string, ReturnBatchValue]>([
    ["not an object", []],
    ["a missing list", { entries: [], staff: [] }],
    ["an extra key", { entries: [], staff: [], devices: [], records: [] }],
    ["an entry that is not an object", { entries: ["e1"], staff: [], devices: [] }],
    ["an entry with an unknown column", { entries: [{ nope: 1 }], staff: [], devices: [] }],
    ["an entry holding a list", { entries: [{ id: ["e1"] }], staff: [], devices: [] }],
    ["a person without a name", { entries: [], staff: [{ id: "p1" }], devices: [] }],
    [
      "a device with a numeric label",
      { entries: [], staff: [], devices: [{ id: "d1", label: 1 }] },
    ],
  ])("refuses %s", (_, raw) => {
    expect(() => readWorkforceBatch(raw)).toThrow(
      expect.objectContaining({ code: "attendance.invalid" }) as AppError,
    );
  });

  it("reads a batch in its shape", () => {
    const raw = {
      entries: [entry],
      staff: [{ id: "p1", displayName: "Ana" }],
      devices: [{ id: "d1", label: "Bar till" }],
    };

    expect(readWorkforceBatch(raw)).toEqual(raw);
  });
});

const rows = (db: typeof suite.db, table: string, id: string) =>
  db.all<ReturnRow>(sql`select * from ${sql.identifier(table)} where id = ${id}`);

async function copyRows(table: string, copied: ReturnRow[]) {
  for (const row of copied) {
    const entries = Object.entries(row);
    await main.db.run(sql`insert into ${sql.identifier(table)}
      (${sql.join(
        entries.map(([key]) => sql.identifier(key)),
        sql`, `,
      )}) values (${sql.join(
        entries.map(([, value]) => sql`${value}`),
        sql`, `,
      )})`);
  }
}

const NOW = new Date("2026-01-06T12:00:00.000Z");
const receive = (batch: WorkforceReturnBatch) =>
  main.db.transaction((tx) => receiveWorkforceBatch(tx, oldBox, batch, NOW));
const queuedDays = () =>
  main.db.all<{ business_day: string; dirty_revision: number }>(
    sql`select business_day, dirty_revision from attendance_days order by business_day`,
  );
const heldChain = async (nodeId: string) => readChain(main.db, { nodeId });

async function readBatch() {
  const [batch] = await readWorkforceReturn(suite.db, oldBox);
  return batch!;
}

describe("receiveWorkforceBatch", () => {
  let mainBox: string;

  beforeEach(async () => {
    await seedTaxpayer(main.db);
    await seedFixtureVenue(main.db);
    await copyRows("nodes", rows(suite.db, "nodes", oldBox));
    mainBox = await seedNode(main.db);
    await seedDevice(main.db);
  });

  it("continues the old box's chain from the copy's head, beside the main box's own", async () => {
    await appendChainEntries(
      suite.db,
      oldBox,
      [0, 1, 2, 3].map((minute) => clockIn(personId, minute)),
    );
    const batch = await readBatch();
    await copyRows("persons", rows(suite.db, "persons", personId));
    await copyRows("time_entries", batch.entries.slice(0, 2));
    await appendChainEntries(main.db, mainBox, [clockIn(personId, 10)]);

    expect(await receive({ ...batch, entries: batch.entries.slice(2) })).toBe(true);

    const old = await heldChain(oldBox);
    expect(verifyChain(old)).toEqual({ ok: true });
    expect(old.at(-1)!.sequenceNo).toBe(4);
    await appendChainEntries(main.db, mainBox, [clockIn(personId, 11)]);
    expect((await heldChain(mainBox)).map((row) => row.sequenceNo)).toEqual([1, 2]);
  });

  it("adds a missing person suspended with only a name, and a missing device deleted", async () => {
    await seedPerson(main.db, "Ana");
    const { deviceId } = await seedDevice(suite.db, { label: "Bar till" });
    await appendChainEntries(suite.db, oldBox, [
      { ...clockIn(personId, 0), origin: deviceOrigin(deviceId) },
    ]);

    expect(await receive(await readBatch())).toBe(true);

    expect(rows(main.db, "persons", personId)).toEqual([
      expect.objectContaining({
        display_name: "Ana",
        status: "suspended",
        pin_hash: null,
        email: null,
        created_at: NOW.toISOString(),
      }),
    ]);
    expect(rows(main.db, "devices", deviceId)).toEqual([
      expect.objectContaining({ label: "Bar till", active: 0, deleted_at: NOW.toISOString() }),
    ]);
  });

  it("stores corrections of earlier entries and re-queues every day they touch", async () => {
    const correction = (target: string, minute: number): TimeEntryAppend => ({
      ...clockIn(personId, minute),
      entryKind: "correction",
      correctsEntryId: target,
      correctionReason: "Forgot",
      correctionStatus: "requested",
      correctionActorId: personId,
    });
    const [held] = await appendChainEntries(suite.db, oldBox, [
      { ...clockIn(personId, 0), eventAt: "2026-01-04T12:00:00.000Z" },
    ]);
    const [inBatch] = await appendChainEntries(suite.db, oldBox, [clockIn(personId, 1)]);
    const ids = await appendChainEntries(suite.db, oldBox, [
      correction(held!, 2),
      correction(inBatch!, 3),
    ]);
    const batch = await readBatch();
    await copyRows("persons", rows(suite.db, "persons", personId));
    await copyRows("time_entries", batch.entries.slice(0, 1));

    expect(await receive({ ...batch, entries: batch.entries.slice(1) })).toBe(true);

    expect(rows(main.db, "time_entries", ids[0]!)[0]!.corrects_entry_id).toBe(held);
    expect(rows(main.db, "time_entries", ids[1]!)[0]!.corrects_entry_id).toBe(inBatch);
    expect(queuedDays().map((day) => day.business_day)).toEqual(["2026-01-04", "2026-01-05"]);
  });

  it("stores and re-queues nothing for a resent batch, and answers true", async () => {
    await appendChainEntries(suite.db, oldBox, [clockIn(personId, 0), clockIn(personId, 1)]);
    const batch = await readBatch();
    await receive(batch);
    const days = queuedDays();

    expect(await receive(batch)).toBe(true);

    expect(await heldChain(oldBox)).toHaveLength(2);
    expect(queuedDays()).toEqual(days);
  });
});
