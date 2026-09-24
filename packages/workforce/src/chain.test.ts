import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  engineErrorMessage,
  isRefusal,
  newId,
  nowIso,
  refusalError,
  refusalOn,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendToChain,
  readChainHead,
  readChain,
  type ChainKey,
  type TimeEntryAppend,
} from "./chain.js";
import { verifyChain } from "./chain-hash.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { timeEntries } from "./schema/time-entries.js";
import { seedLocation, seedPerson } from "../test/fixtures.js";

// Concurrent appenders are ./chain.concurrency.test.ts's subject, not this suite's.
const pg = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});

let personId: string;
let locationId: string;
let nodeId: string;

beforeEach(async () => {
  await seedTenant(pg.db);
  personId = await seedPerson(pg.db);
  locationId = await seedLocation(pg.db);
  nodeId = await seedNode(pg.db, brandLocationId(locationId));
});

function key(location = locationId, node = nodeId): ChainKey {
  return { nodeId: node, locationId: location };
}

function inputAt(at: string): TimeEntryAppend {
  return {
    personId,
    entryKind: "in",
    eventAt: at,
    eventOffsetMinutes: 0,
    recordedByPersonId: personId,
  };
}

function clockEvent(): TimeEntryAppend {
  return inputAt("2026-01-05T09:00:00Z");
}

async function seedTill(location: string): Promise<string> {
  // `id` and `created_at` by hand: their `$defaultFn`s run for a builder insert, not for raw SQL.
  const { rows } = await pg.db.execute<{ id: string }>(sql`
    insert into tills (id, location_id, name, created_at)
    values (${newId()}, ${location}, 'Till 1', ${nowIso()})
    returning id`);
  return rows[0]!.id;
}

describe("appendToChain", () => {
  it("assigns sequence_no 1 and genesis shape to the first entry", async () => {
    const result = await pg.db.transaction((tx) =>
      appendToChain(tx, key(), inputAt("2026-01-05T09:00:00Z")),
    );
    expect(result.sequenceNo).toBe(1);
    const [first] = await readChain(pg.db, key());
    expect(first?.isFirstEntry).toBe(true);
    expect(first?.prevEntryHash).toBeNull();
    expect(first?.entryHash).toMatch(/^[0-9A-F]{64}$/);
    expect(first?.entryHash).toBe(result.entryHash);
  });

  it("chains the second entry to the first via prev_entry_hash", async () => {
    await pg.db.transaction((tx) => appendToChain(tx, key(), inputAt("2026-01-05T09:00:00Z")));
    await pg.db.transaction((tx) => appendToChain(tx, key(), inputAt("2026-01-05T17:00:00Z")));
    const [first, second] = await readChain(pg.db, key());
    expect(second?.sequenceNo).toBe(2);
    expect(second?.isFirstEntry).toBe(false);
    expect(second?.prevEntryHash).toBe(first?.entryHash);
  });

  it("advances the chain head to the entry just written", async () => {
    const { id, entryHash } = await pg.db.transaction((tx) =>
      appendToChain(tx, key(), inputAt("2026-01-05T09:00:00Z")),
    );
    const { rows } = await pg.db.execute<{
      sequence_no: number;
      last_entry_id: string;
      last_entry_hash: string;
      last_recorded_at: string | null;
    }>(sql`
      select sequence_no, last_entry_id, last_entry_hash, last_recorded_at from workforce_chains
      where node_id = ${nodeId} and location_id = ${locationId}`);
    expect(rows[0]).toMatchObject({
      sequence_no: 1,
      last_entry_id: id,
      last_entry_hash: entryHash,
    });
    expect(rows[0]!.last_recorded_at).not.toBeNull();
  });

  it("keeps a separate, independent chain per (node, location)", async () => {
    const otherLocation = await seedLocation(pg.db);
    const otherNode = await seedNode(pg.db, brandLocationId(otherLocation));
    await pg.db.transaction((tx) => appendToChain(tx, key(), inputAt("2026-01-05T09:00:00Z")));
    await pg.db.transaction((tx) =>
      appendToChain(tx, key(otherLocation, otherNode), inputAt("2026-01-05T09:00:00Z")),
    );
    expect((await readChain(pg.db, key())).map((e) => e.sequenceNo)).toEqual([1]);
    const other = await readChain(pg.db, key(otherLocation, otherNode));
    expect(other.map((e) => e.sequenceNo)).toEqual([1]);
    expect(other[0]?.isFirstEntry).toBe(true);
  });

  it("keeps one chain per (node, location); two nodes at one location do not collide", async () => {
    // Two nodes write one location across a promotion, taking the same sequence_no values.
    const nodeB = await seedNode(pg.db, brandLocationId(locationId));
    const k1 = key(locationId, nodeId);
    const k2 = key(locationId, nodeB);
    await pg.db.transaction((tx) => appendToChain(tx, k1, clockEvent()));
    await pg.db.transaction((tx) => appendToChain(tx, k1, clockEvent()));
    await pg.db.transaction((tx) => appendToChain(tx, k2, clockEvent()));
    expect((await readChain(pg.db, k1)).map((e) => e.sequenceNo)).toEqual([1, 2]);
    expect((await readChain(pg.db, k2)).map((e) => e.sequenceNo)).toEqual([1]);
    expect(verifyChain(await readChain(pg.db, k1))).toEqual({ ok: true });
    expect(verifyChain(await readChain(pg.db, k2))).toEqual({ ok: true });
  });

  it("keeps recorded_at non-decreasing per chain when the clock steps backward", async () => {
    const k = key();
    let t = Date.parse("2026-09-07T08:00:05.000Z");
    const clock = () => new Date(t);
    await pg.db.transaction((tx) => appendToChain(tx, k, clockEvent(), clock));
    t = Date.parse("2026-09-07T08:00:02.000Z"); // steps BACK
    await pg.db.transaction((tx) => appendToChain(tx, k, clockEvent(), clock));
    const rows = await readChain(pg.db, k);
    expect(rows[1]!.recordedAt >= rows[0]!.recordedAt).toBe(true);
    expect(verifyChain(rows)).toEqual({ ok: true });
  });

  it("stamps recorded_at as a whole second from the injected clock", async () => {
    // `.000` is how a whole second is spelled; `time_entries_recorded_at_second_ck` admits no other.
    const clock = () => new Date(Date.parse("2026-09-07T08:00:05.678Z"));
    await pg.db.transaction((tx) => appendToChain(tx, key(), clockEvent(), clock));
    const [row] = await readChain(pg.db, key());
    expect(row?.recordedAt).toBe("2026-09-07T08:00:05.000Z");
    expect(verifyChain(await readChain(pg.db, key()))).toEqual({ ok: true });
  });

  it("produces a chain that re-verifies end to end", async () => {
    for (const at of ["2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z", "2026-01-05T17:00:00Z"]) {
      await pg.db.transaction((tx) => appendToChain(tx, key(), inputAt(at)));
    }
    expect(verifyChain(await readChain(pg.db, key()))).toEqual({ ok: true });
  });

  it("re-verifies an event_at that carries a sub-second fraction", async () => {
    // Hashing the fractional instant while the column stores whole seconds would be a false
    // hash_mismatch on an untouched row.
    await pg.db.transaction((tx) => appendToChain(tx, key(), inputAt("2026-01-05T09:00:00.123Z")));
    expect(verifyChain(await readChain(pg.db, key()))).toEqual({ ok: true });
  });

  it("rejects a raw insert whose event_at carries a sub-second fraction (defence-in-depth CHECK)", async () => {
    // Every other column here is a valid genesis row, so the only constraint this can trip is the
    // event_at one.
    const error = await captureError(() =>
      pg.db.execute(sql`
        insert into time_entries (
          id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, recorded_at, entry_hash, sequence_no, is_first_entry
        ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'in',
          '2026-01-05T09:00:00.123Z', 0,
          ${personId}, '2026-01-05T09:00:00.000Z', ${"0".repeat(64)}, 1, true)`),
    );
    // The class alone is also satisfied by the row's other checks, so the constraint name is asserted
    // too.
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("time_entries_event_at_second_ck");
  });

  it("rejects a raw insert whose recorded_at carries a sub-second fraction (defence-in-depth CHECK)", async () => {
    const error = await captureError(() =>
      pg.db.execute(sql`
        insert into time_entries (
          id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, recorded_at, entry_hash, sequence_no, is_first_entry
        ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'in',
          '2026-01-05T09:00:00.000Z', 0,
          ${personId}, '2026-01-05T09:00:00.123Z', ${"0".repeat(64)}, 1, true)`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toContain("time_entries_recorded_at_second_ck");
  });

  /**
   * `time_entries_chain_position_uq` is what makes a fork of the working-time chain impossible
   * (CLAUDE.md §5). Checked from OUTSIDE `appendToChain`, because what it must hold against is a
   * writer that never went through it: a survivor's row out of a restored backup. The engine's
   * message names the COLUMNS, not the index, so the refusal is matched by its columns.
   */
  it("rejects a second entry claiming an occupied chain position", async () => {
    await pg.db.transaction((tx) => appendToChain(tx, key(), inputAt("2026-01-05T09:00:00Z")));
    const fork = {
      personId,
      locationId,
      nodeId,
      entryKind: "out" as const,
      // Clears `time_entries_event_at_second_ck` and `time_entries_chaining_ck`, so the index is what
      // refuses it.
      eventAt: "2026-01-05T18:00:00.000Z",
      eventOffsetMinutes: 0,
      recordedByPersonId: personId,
      recordedAt: "2026-01-05T18:00:00.000Z",
      entryHash: "0".repeat(64),
      prevEntryHash: "1".repeat(64),
      isFirstEntry: false,
    };
    const error = await captureError(() =>
      pg.db.insert(timeEntries).values({ ...fork, sequenceNo: 1 }),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "time_entries",
        columns: ["node_id", "location_id", "sequence_no"],
      }),
    ).toBe(true);
    // The control: the same row at the next free position is accepted, so the refusal above is the
    // POSITION.
    await expect(
      pg.db.insert(timeEntries).values({ ...fork, sequenceNo: 2 }),
    ).resolves.toBeDefined();
  });

  it("retries inside a savepoint, then surfaces exhaustion as attendance.append_contention", async () => {
    // Occupy position 1 directly, so every attempt collides. Weaker than its name: replacing the
    // savepoint in ./chain.ts with a plain `attemptAppend(tx, …)` leaves this case passing, and the
    // two stub cases below fail under that change only because their stub has no other method.
    await pg.db.execute(sql`
      insert into time_entries (
        id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
        recorded_by_person_id, recorded_at, entry_hash, sequence_no, is_first_entry
      ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'in',
        '2026-01-05T08:00:00.000Z', 0,
        ${personId}, '2026-01-05T08:00:00.000Z', ${"1".repeat(64)}, 1, true)`);

    const error = await pg.db
      .transaction((tx) => appendToChain(tx, key(), inputAt("2026-01-05T09:00:00Z")))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("attendance.append_contention");
    expect((error as AppError).params).toEqual({ nodeId, locationId, attempts: 3 });
  });

  it("surfaces exhausted retries as a structured AppError, never a bare string", async () => {
    // appendToChain touches only tx.transaction on this path, so the stub is that one method.
    const alwaysCollides = {
      transaction: () =>
        Promise.reject(
          refusalError({
            unique: { table: "time_entries", columns: ["node_id", "location_id", "sequence_no"] },
          }),
        ),
    } as never;
    const error = await appendToChain(alwaysCollides, key(), inputAt("2026-01-05T09:00:00Z")).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("attendance.append_contention");
    expect((error as AppError).params).toEqual({ nodeId, locationId, attempts: 3 });
  });

  it("does not retry an error that is not a chain collision", async () => {
    // A refusal of a DIFFERENT class is re-thrown untouched.
    const alwaysFk = {
      transaction: () => Promise.reject(refusalError({ foreignKey: true })),
    } as never;
    const error = await appendToChain(alwaysFk, key(), inputAt("2026-01-05T09:00:00Z")).catch(
      (caught: unknown) => caught,
    );
    expect(error).not.toBeInstanceOf(AppError);
    expect(error).toMatchObject({ errcode: FOREIGN_KEY_VIOLATION[0] });
  });
});

describe("appendToChain commits the correction and capture content to the hash", () => {
  // Each tamper edits the READ-BACK row and leaves its stored `entry_hash` untouched: what a direct
  // UPDATE that cannot recompute the chain would leave behind.

  async function chainWithCorrection(tillId: string) {
    const base = await pg.db.transaction((tx) =>
      appendToChain(tx, key(), {
        personId,
        entryKind: "in",
        eventAt: "2026-01-05T09:00:00Z",
        eventOffsetMinutes: 0,
        recordedByPersonId: personId,
        capturedByTillId: tillId,
      }),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, key(), {
        personId,
        entryKind: "correction",
        eventAt: "2026-01-05T18:00:00Z",
        eventOffsetMinutes: 0,
        recordedByPersonId: personId,
        correctsEntryId: base.id,
        correctionReason: "forgot to clock out",
        correctionStatus: "requested",
        correctionActorId: personId,
      }),
    );
    return readChain(pg.db, key());
  }

  it("re-verifies a till + reason + actor round-trip untampered (the negative control)", async () => {
    const tillId = await seedTill(locationId);
    expect(verifyChain(await chainWithCorrection(tillId))).toEqual({ ok: true });
  });

  it("flags a correction whose stored reason was rewritten (teeth-test)", async () => {
    const chain = await chainWithCorrection(await seedTill(locationId));
    const tampered = [chain[0]!, { ...chain[1]!, correctionReason: "approved overtime" }];
    expect(verifyChain(tampered)).toEqual({ ok: false, reason: "hash_mismatch", sequenceNo: 2 });
  });

  it("flags a correction whose stored actor was swapped (teeth-test)", async () => {
    const chain = await chainWithCorrection(await seedTill(locationId));
    const tampered = [
      chain[0]!,
      { ...chain[1]!, correctionActorId: "99999999-9999-4999-8999-999999999999" },
    ];
    expect(verifyChain(tampered)).toEqual({ ok: false, reason: "hash_mismatch", sequenceNo: 2 });
  });

  it("flags a base event whose stored capturing till was swapped (teeth-test)", async () => {
    const chain = await chainWithCorrection(await seedTill(locationId));
    const tampered = [
      { ...chain[0]!, capturedByTillId: "99999999-9999-4999-8999-999999999999" },
      chain[1]!,
    ];
    expect(verifyChain(tampered)).toEqual({ ok: false, reason: "hash_mismatch", sequenceNo: 1 });
  });
});

describe("readChainHead", () => {
  it("creates the chain head row from scratch when a (node, location) has none yet", async () => {
    const head = await pg.db.transaction((tx) => readChainHead(tx, key()));
    expect(head).toEqual({
      sequenceNo: 0,
      lastEntryId: null,
      lastEntryHash: null,
      lastRecordedAt: null,
    });
    const { rows } = await pg.db.execute<{ count: number }>(sql`
      select count(*) as count from workforce_chains
      where node_id = ${nodeId} and location_id = ${locationId}`);
    expect(rows[0]?.count).toBe(1);
  });

  it("reads the existing head rather than creating a second one", async () => {
    await pg.db.transaction((tx) => appendToChain(tx, key(), inputAt("2026-01-05T09:00:00Z")));
    const head = await pg.db.transaction((tx) => readChainHead(tx, key()));
    expect(head.sequenceNo).toBe(1);
    expect(head.lastEntryId).not.toBeNull();
    expect(head.lastEntryHash).not.toBeNull();
    expect(head.lastRecordedAt).not.toBeNull();
    const { rows } = await pg.db.execute<{ count: number }>(sql`
      select count(*) as count from workforce_chains
      where node_id = ${nodeId} and location_id = ${locationId}`);
    expect(rows[0]?.count).toBe(1);
  });
});
