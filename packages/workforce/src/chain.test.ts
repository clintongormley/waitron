import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  isPgError,
  newId,
  nowIso,
  pgErrorMessage,
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

// This suite is about appendToChain's OWN logic — ordering, the genesis shape, the error shape, and
// that a real appended chain re-verifies. Serialisation between two appenders is proven elsewhere,
// in ./chain.concurrency.test.ts. The sentence that used to stand here said this suite ran on PGlite
// while the contention one ran on real Postgres through Testcontainers, and pointed at a permanent
// demonstration that PGlite serialises every query onto one backend; all three of those are gone
// with the engine, and one writer at a time is now the product's design rather than a test target's
// limitation.
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

/** The chain key for this suite's default (node, location). */
function key(location = locationId, node = nodeId): ChainKey {
  return { nodeId: node, locationId: location };
}

/** A base `in` clock event's append input at a given instant. */
function inputAt(at: string): TimeEntryAppend {
  return {
    personId,
    entryKind: "in",
    eventAt: at,
    eventOffsetMinutes: 0,
    recordedByPersonId: personId,
  };
}

/** A default base `in` clock event, for tests that do not care about the instant. */
function clockEvent(): TimeEntryAppend {
  return inputAt("2026-01-05T09:00:00Z");
}

/** Seeds a till at a location so a captured event can attribute to it. Returns its id. */
async function seedTill(location: string): Promise<string> {
  // `id` and `created_at` come from the table's `$defaultFn` generators, which drizzle runs for a
  // builder insert and never for raw SQL; the generated DDL declares no SQL default for either, so
  // without them the statement is refused `NOT NULL constraint failed: tills.id`.
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
    // The high-water mark is set once the chain has an entry (spec §4.1).
    expect(rows[0]!.last_recorded_at).not.toBeNull();
  });

  it("keeps a separate, independent chain per (node, location)", async () => {
    const otherLocation = await seedLocation(pg.db);
    const otherNode = await seedNode(pg.db, brandLocationId(otherLocation));
    await pg.db.transaction((tx) => appendToChain(tx, key(), inputAt("2026-01-05T09:00:00Z")));
    await pg.db.transaction((tx) =>
      appendToChain(tx, key(otherLocation, otherNode), inputAt("2026-01-05T09:00:00Z")),
    );
    // Each location's first entry is its own genesis at position 1 — the chain key includes the location.
    expect((await readChain(pg.db, key())).map((e) => e.sequenceNo)).toEqual([1]);
    const other = await readChain(pg.db, key(otherLocation, otherNode));
    expect(other.map((e) => e.sequenceNo)).toEqual([1]);
    expect(other[0]?.isFirstEntry).toBe(true);
  });

  it("keeps one chain per (node, location); two nodes at one location do not collide", async () => {
    // A location's chain is written by two nodes across a promotion (spec §2.1); their entries take
    // the same sequence_no values but ride different chains, so they never clash on the position uq.
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
    // The monotonic clamp (spec §4.1), proven by deletion: replace `Math.max(nowMs, …)` with `nowMs`
    // in attemptAppend and the second row's recorded_at goes BACKWARD, so `verifyChain` still holds
    // (the stored hash recomputes) but the `>=` assertion fails.
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
    // recorded_at is the injected clock, truncated to a whole second and fed to BOTH the hash and the
    // stored column — so the chain re-verifies even from a millisecond-precision clock. The read-back
    // is the stored text, and the truncation writes `toISOString()`, so the fractional field is
    // present and zero: `.678` is gone, `.000` is what a whole second is spelled as here, and
    // `time_entries_recorded_at_second_ck` admits no other form.
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
    // The read-back rows recompute to their stored hashes — the eventAt/recordedAt round-trip through
    // the timestamptz columns and back matches what was hashed at insert.
    expect(verifyChain(await readChain(pg.db, key()))).toEqual({ ok: true });
  });

  it("re-verifies an event_at that carries a sub-second fraction", async () => {
    // The trusted clock is millisecond-precision, but the column stores whole seconds and
    // `time_entries_event_at_second_ck` refuses anything else. Hashing the fractional instant at
    // insert while the read-back recomputes over the truncated one is a spurious hash_mismatch on genuine, untouched
    // data — a false tamper alarm on ~999/1000 of real timestamps. Truncating to whole seconds ONCE
    // at the write choke point makes the stored column, the committed hash and the read-back one
    // identical representation, so the chain re-verifies.
    await pg.db.transaction((tx) => appendToChain(tx, key(), inputAt("2026-01-05T09:00:00.123Z")));
    expect(verifyChain(await readChain(pg.db, key()))).toEqual({ ok: true });
  });

  it("rejects a raw insert whose event_at carries a sub-second fraction (defence-in-depth CHECK)", async () => {
    // The DB CHECK backstops the write-path truncation: a row that bypasses appendToChain still
    // cannot store a sub-second event_at that would later read back as tampered. Every other column
    // here is a valid genesis row, so the only constraint this can trip is the new one.
    const error = await captureError(() =>
      pg.db.execute(sql`
        insert into time_entries (
          id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, recorded_at, entry_hash, sequence_no, is_first_entry
        ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'in',
          '2026-01-05T09:00:00.123Z', 0,
          ${personId}, '2026-01-05T09:00:00.000Z', ${"0".repeat(64)}, 1, true)`),
    );
    // This engine reports every refusal under one `code`, so the CLASS comes off `errcode` and the
    // constraint's NAME off the message — a check's message is `CHECK constraint failed: <name>`.
    // Both are needed: the class alone is also satisfied by any of the six other checks this row
    // passes through.
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toContain("time_entries_event_at_second_ck");
  });

  it("rejects a raw insert whose recorded_at carries a sub-second fraction (defence-in-depth CHECK)", async () => {
    // The recorded_at twin of the check above — the same whole-second backstop for the new column.
    const error = await captureError(() =>
      pg.db.execute(sql`
        insert into time_entries (
          id, person_id, location_id, node_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, recorded_at, entry_hash, sequence_no, is_first_entry
        ) values (${newId()}, ${personId}, ${locationId}, ${nodeId}, 'in',
          '2026-01-05T09:00:00.000Z', 0,
          ${personId}, '2026-01-05T09:00:00.123Z', ${"0".repeat(64)}, 1, true)`),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toContain("time_entries_recorded_at_second_ck");
  });

  /**
   * `time_entries_chain_position_uq` on (node_id, location_id, sequence_no) — the thing that makes
   * a fork of the working-time chain impossible (CLAUDE.md §5). It is checked here from OUTSIDE
   * `appendToChain`, because what it has to hold against is a writer that never went through this
   * file at all: a survivor's row out of a restored backup.
   *
   * It is checked against the index BY NAME, with a control that inserts the same row at the next
   * free position and succeeds. The reason the name matters: this engine reports a primary key, a
   * unique index, a NOT NULL and a CHECK all under one `code` (`ERR_SQLITE_ERROR`), so asserting
   * the code alone passes for a row refused for a completely different reason — which is what the
   * PostgreSQL-era assertion (`23505`) turned into here. The row is written through the table
   * definition so its `id` comes from `$defaultFn`; the raw insert this replaced omitted `id` and
   * was refused NOT NULL, under that same code, before the index was ever reached.
   *
   * Proven by deletion, 2026-09-21, Node v26.7.0: with `drop index time_entries_chain_position_uq`
   * run on the open file first, the fork below is ACCEPTED — `captureError` reports "expected the
   * operation to be rejected, but it succeeded". With the index in place the refusal reads
   * `UNIQUE constraint failed: time_entries.node_id, time_entries.location_id,
   * time_entries.sequence_no`. Note what this engine names: the COLUMNS, not the index, so a test
   * looking for the string `time_entries_chain_position_uq` in the message finds nothing.
   */
  it("rejects a second entry claiming an occupied chain position", async () => {
    await pg.db.transaction((tx) => appendToChain(tx, key(), inputAt("2026-01-05T09:00:00Z")));
    const fork = {
      personId,
      locationId,
      nodeId,
      entryKind: "out" as const,
      // Whole seconds with the fractional field present, and a predecessor hash beside
      // `isFirstEntry: false` — the two CHECKs (`time_entries_event_at_second_ck`,
      // `time_entries_chaining_ck`) that a fork has to clear before the index is even consulted.
      // Both refused this row first while it was being written, under the SAME `code` the index
      // raises.
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
    // The control, in the other direction: the same row at the next free position is accepted, so
    // the refusal above is the POSITION and not something else about the row.
    await expect(
      pg.db.insert(timeEntries).values({ ...fork, sequenceNo: 2 }),
    ).resolves.toBeDefined();
  });

  it("retries inside a savepoint, then surfaces exhaustion as attendance.append_contention", async () => {
    // Occupy position 1 directly, so every attempt collides for the same reason — three refusals
    // the database issued, driving the retry to exhaustion. The savepoint-deletion proof this was
    // written as belonged to PostgreSQL, where the first 23505 aborted the whole transaction and
    // the second attempt came back 25P02; SQLite backs out the refused statement and leaves the
    // transaction open, and whether the case still discriminates the savepoint here is UNMEASURED
    // (this suite does not pass on this branch yet). Mirrors fiscal chain.test.ts's equivalent,
    // where the same note is recorded.
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
    // Stubbing tx.transaction is the only deterministic way to reach exhaustion: one write
    // transaction runs on the venue file at a time, so three real CONCURRENT collisions cannot be
    // generated. appendToChain touches only tx.transaction on this path, so the stub is exactly
    // that one method. The forged rejection carries `errcode`, which is where `node:sqlite` puts
    // the discriminating value and where `isUniqueViolation` reads it (`packages/db/src/sql-state.ts`);
    // 2067 is a unique index. A stub carrying the old `code: "23505"` is not a collision to this
    // predicate and the retry would never run — which is what the control below rests on.
    const alwaysCollides = {
      transaction: () =>
        Promise.reject(Object.assign(new Error("dup"), { errcode: UNIQUE_VIOLATION[0] })),
    } as never;
    const error = await appendToChain(alwaysCollides, key(), inputAt("2026-01-05T09:00:00Z")).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("attendance.append_contention");
    expect((error as AppError).params).toEqual({ nodeId, locationId, attempts: 3 });
  });

  it("does not retry an error that is not a chain collision", async () => {
    // The control in the other direction: a refusal of a DIFFERENT class is re-thrown untouched.
    const alwaysFk = {
      transaction: () =>
        Promise.reject(Object.assign(new Error("fk"), { errcode: FOREIGN_KEY_VIOLATION[0] })),
    } as never;
    const error = await appendToChain(alwaysFk, key(), inputAt("2026-01-05T09:00:00Z")).catch(
      (caught: unknown) => caught,
    );
    expect(error).not.toBeInstanceOf(AppError);
    expect(error).toMatchObject({ errcode: FOREIGN_KEY_VIOLATION[0] });
  });
});

describe("appendToChain commits the correction and capture content to the hash", () => {
  // The tamper-evidence chain must protect the LEGAL-RECORD content it claims to (art. 34.9): the
  // capturing till, the correction's reason, and the accountable actor. These are the record's own
  // attribution, not our metadata (unlike the fiscal `entorno`, CLAUDE.md §5), so they belong in the
  // hash. Each tamper below is applied to the READ-BACK row while its stored `entry_hash` is left
  // untouched — exactly what a party past the immutability floor would leave behind by UPDATE-ing
  // a column but being unable to recompute the chain.

  /** A base `in` captured by a till, then a correction carrying reason + actor, read back as a chain. */
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
    // The read-back projects the till, the reason and the actor, so the recompute matches the stored
    // hash — proving insert-time hashing and the read-back mapping agree on all three columns.
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
