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
import { appendChainEntries, copyRows, seedFixtureVenue, seedPerson } from "../test/fixtures.js";

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

  it("ends with a too-large batch after the batches before an entry that cannot fit a batch alone", async () => {
    const giant = await seedPerson(suite.db, "a".repeat(WORKFORCE_RETURN_MAX_BYTES));
    const [fits] = await appendChainEntries(suite.db, oldBox, [clockIn(personId, 0)]);
    await appendChainEntries(suite.db, oldBox, [clockIn(giant, 1), clockIn(personId, 2)]);

    const batches = await readWorkforceReturn(suite.db, oldBox);

    expect(batches.map((batch) => batch.entries.map((row) => row.id))).toEqual([[fits], []]);
    expect(batches[1]).toEqual({ entries: [], staff: [], devices: [], tooLarge: true });
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
    ["a too-large mark that is not true", { entries: [], staff: [], devices: [], tooLarge: false }],
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
      expect.objectContaining({
        code: "attendance.return_entry_invalid",
        params: { reason: "malformed batch" },
      }) as AppError,
    );
  });

  const refusedFor = (reason: string) =>
    expect.objectContaining({
      code: "attendance.return_entry_invalid",
      params: { reason },
    }) as AppError;
  const entriesOf = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ ...entry, id: `e${i}`, sequence_no: i + 1 }));

  it("refuses a batch over the row cap and reads one at it", () => {
    const at = { entries: entriesOf(WORKFORCE_RETURN_ROW_CAP), staff: [], devices: [] };
    const over = { entries: entriesOf(WORKFORCE_RETURN_ROW_CAP + 1), staff: [], devices: [] };

    expect(readWorkforceBatch(at)).toEqual(at);
    expect(() => readWorkforceBatch(over)).toThrow(refusedFor("batch exceeds bounds"));
  });

  it("refuses a batch over the byte limit and reads one at it", () => {
    const named = (length: number) => ({
      entries: [],
      staff: [{ id: "p1", displayName: "a".repeat(length) }],
      devices: [],
    });
    const atLimit = named(WORKFORCE_RETURN_MAX_BYTES - bytes(named(0)));

    expect(bytes(atLimit)).toBe(WORKFORCE_RETURN_MAX_BYTES);
    expect(readWorkforceBatch(atLimit)).toEqual(atLimit);
    expect(() =>
      readWorkforceBatch(named(WORKFORCE_RETURN_MAX_BYTES - bytes(named(0)) + 1)),
    ).toThrow(refusedFor("batch exceeds bounds"));
  });

  it("refuses the batch that says an entry was too large to send", () => {
    expect(() =>
      readWorkforceBatch({ entries: [], staff: [], devices: [], tooLarge: true }),
    ).toThrow(refusedFor("entry too large to return"));
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
    await copyRows(main.db, "nodes", rows(suite.db, "nodes", oldBox));
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
    await copyRows(main.db, "persons", rows(suite.db, "persons", personId));
    await copyRows(main.db, "time_entries", batch.entries.slice(0, 2));
    await appendChainEntries(main.db, mainBox, [clockIn(personId, 10)]);

    expect(await receive({ ...batch, entries: batch.entries.slice(2) })).toBe(true);

    const old = await heldChain(oldBox);
    expect(verifyChain(old)).toEqual({ ok: true });
    expect(old.at(-1)!.sequenceNo).toBe(4);
  });

  it("stores a manager's proposal, a worker's request and the worker's self-approval of it", async () => {
    const manager = await seedPerson(suite.db, "Marta");
    const missingOut = (
      by: string,
      direction: "manager_proposal" | "worker_request",
    ): TimeEntryAppend => ({
      ...clockIn(personId, 1),
      entryKind: "correction",
      recordedByPersonId: by,
      correctionReason: "Forgot to clock out",
      correctionStatus: "requested",
      correctionActorId: by,
      extension: {
        selfApproved: false,
        authorKind: by === manager ? "manager" : "worker",
        direction,
        missingEntryKind: "out",
        respondsToEntryId: null,
        payPeriodClosureId: null,
      },
    });
    const request = missingOut(personId, "worker_request");
    const [, , requested] = await appendChainEntries(suite.db, oldBox, [
      clockIn(personId, 0),
      missingOut(manager, "manager_proposal"),
      request,
    ]);
    await appendChainEntries(suite.db, oldBox, [
      {
        ...request,
        correctionStatus: "approved",
        extension: {
          ...request.extension!,
          selfApproved: true,
          authorKind: "manager",
          respondsToEntryId: requested!,
        },
      },
    ]);

    expect(await receive(await readBatch())).toBe(true);

    const held = await heldChain(oldBox);
    expect(held.map((row) => row.extension?.direction ?? null)).toEqual([
      null,
      "manager_proposal",
      "worker_request",
      "worker_request",
    ]);
    expect(held[3]!.extension).toMatchObject({ selfApproved: true, respondsToEntryId: requested });
    expect(verifyChain(held)).toEqual({ ok: true });
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
    await copyRows(main.db, "persons", rows(suite.db, "persons", personId));
    await copyRows(main.db, "time_entries", batch.entries.slice(0, 1));

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

  type Arrange = (entries: ReturnRow[]) => Promise<ReturnRow[] | void>;
  const invalid = (reason: string) => ({
    refusal: "attendance.return_entry_invalid",
    params: { reason },
  });
  const holdFirst = async (entries: ReturnRow[]) => {
    await copyRows(main.db, "time_entries", entries.slice(0, 1));
  };
  const swapThird = (change: ReturnRow) => (entries: ReturnRow[]) =>
    entries.slice(1).map((row, i) => (i === 1 ? { ...row, ...change } : row));

  async function nameAClosure(previous: string): Promise<TimeEntryAppend> {
    await suite.db.run(sql`insert into pay_period_closures (id, node_id, period_start, period_end,
      clock, scheduled_close_at, closed_at, snapshot, sequence_no, closure_hash)
      values ('closure-1', ${oldBox}, '2026-01-01', '2026-02-01', '{}', '2026-02-01', '2026-02-01',
        '{}', 1, ${"A".repeat(64)})`);
    return {
      ...clockIn(personId, 2),
      entryKind: "confirmation",
      recordedByPersonId: null,
      extension: {
        selfApproved: false,
        authorKind: "automatic",
        direction: null,
        missingEntryKind: null,
        respondsToEntryId: previous,
        payPeriodClosureId: "closure-1",
      },
    };
  }

  async function correctAnotherBoxsEntry(): Promise<TimeEntryAppend> {
    const [foreign] = await appendChainEntries(suite.db, otherBox, [clockIn(personId, 9)]);
    return {
      ...clockIn(personId, 2),
      entryKind: "correction",
      correctsEntryId: foreign!,
      correctionReason: "Forgot",
      correctionStatus: "requested",
      correctionActorId: personId,
    };
  }

  it.each<[string, object, Arrange, number[], ((previous: string) => Promise<TimeEntryAppend>)?]>([
    [
      "a held id with different content",
      { refusal: "attendance.return_entry_clash" },
      async (entries) => {
        await holdFirst(entries);
        await copyRows(main.db, "time_entries", [
          { ...entries[2]!, recorded_at: "2026-01-05T09:30:00.000Z" },
        ]);
      },
      [1, 2, 3],
    ],
    [
      "another id at a taken position",
      { refusal: "attendance.return_entry_clash" },
      async (entries) => {
        await holdFirst(entries);
        await copyRows(main.db, "time_entries", [{ ...entries[2]!, id: "another" }]);
      },
      [1, 2, 3],
    ],
    [
      "another box's row",
      invalid("entry from another box"),
      async (entries) => {
        await holdFirst(entries);
        return swapThird({ node_id: otherBox })(entries);
      },
      [1, 2],
    ],
    [
      "a source whose nodes row is missing",
      invalid("unknown source box"),
      async (entries) => {
        await main.db.run(sql`delete from nodes where id = ${oldBox}`);
        return entries;
      },
      [],
    ],
    [
      "a gap before the first new row",
      invalid("chain does not continue"),
      async (entries) => {
        await holdFirst(entries);
        return entries.slice(2);
      },
      [1],
    ],
    [
      "a wrong hash",
      invalid("hash mismatch"),
      async (entries) => {
        await holdFirst(entries);
        return swapThird({ recorded_at: "2026-01-05T09:30:00.000Z" })(entries);
      },
      [1, 2],
    ],
    [
      "a pay-period closure the main box lacks",
      invalid("missing pay-period closure"),
      holdFirst,
      [1, 2],
      nameAClosure,
    ],
    [
      "a correction of another box's entry the main box lacks",
      invalid("missing earlier entry"),
      holdFirst,
      [1, 2],
      correctAnotherBoxsEntry,
    ],
  ])("refuses %s with %j, keeping the rows before it", async (_, refusal, arrange, kept, third) => {
    const [, second] = await appendChainEntries(suite.db, oldBox, [
      clockIn(personId, 0),
      clockIn(personId, 1),
    ]);
    await appendChainEntries(suite.db, oldBox, [
      third ? await third(second!) : clockIn(personId, 2),
      clockIn(personId, 3),
    ]);
    const batch = await readBatch();
    await copyRows(main.db, "persons", rows(suite.db, "persons", personId));
    const entries = (await arrange(batch.entries)) ?? batch.entries.slice(1);

    expect(await receive({ ...batch, entries })).toEqual(refusal);

    expect((await heldChain(oldBox)).map((row) => row.sequenceNo)).toEqual(kept);
  });

  it("refuses an entry naming a person or device the batch does not describe", async () => {
    const { deviceId } = await seedDevice(suite.db, { label: "Bar till" });
    await appendChainEntries(suite.db, oldBox, [
      { ...clockIn(personId, 0), origin: deviceOrigin(deviceId) },
    ]);
    const batch = await readBatch();
    const refused = invalid("missing staff or device name");

    expect(await receive({ ...batch, staff: [] })).toEqual(refused);
    expect(await receive({ ...batch, devices: [] })).toEqual(refused);
    expect(await heldChain(oldBox)).toEqual([]);
    expect(rows(main.db, "persons", personId)).toEqual([]);
  });
});
