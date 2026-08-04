import { CORE_MIGRATIONS, captureError, pgErrorCode, pgErrorMessage } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendToChain, isUniqueViolation, lockChainHead, type TimeEntryAppend } from "./chain.js";
import { verifyChain, type VerifiableEntry } from "./chain-hash.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { seedLocation, seedPerson } from "../test/fixtures.js";

// PGlite, not real Postgres: this suite is about appendToChain's OWN logic — ordering, the genesis
// shape, the error shape, and that a real appended chain re-verifies. RLS and true lock CONTENTION
// are proven elsewhere (rls.test.ts as the app role; chain.concurrency.test.ts on real Postgres —
// PGlite serialises every query onto one backend, so it cannot test contention, see
// chain.pglite-cannot-test-contention.test.ts). PGlite's superuser connection bypasses RLS, so no
// withTenant/asAppUser is needed here.
const pg = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});

let tenantId: string;
let personId: string;
let locationId: string;

beforeEach(async () => {
  tenantId = await seedTenant(pg.db);
  personId = await seedPerson(pg.db, tenantId);
  locationId = await seedLocation(pg.db, tenantId);
});

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

/** Seeds a till at a location so a captured event can attribute to it. Returns its id. */
async function seedTill(location: string): Promise<string> {
  const { rows } = await pg.db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${location}, 'Till 1')
    returning id`);
  return rows[0]!.id;
}

/** Reads a location's whole chain back as verifiable rows, ordered by chain position. */
async function readChain(location: string): Promise<VerifiableEntry[]> {
  const { rows } = await pg.db.execute<{
    sequence_no: number;
    person_id: string;
    location_id: string;
    entry_kind: string;
    event_at: string;
    event_offset_minutes: number;
    recorded_by_person_id: string;
    captured_by_till_id: string | null;
    corrects_entry_id: string | null;
    correction_reason: string | null;
    correction_status: string | null;
    correction_actor_id: string | null;
    prev_entry_hash: string | null;
    entry_hash: string;
    is_first_entry: boolean;
  }>(sql`
    select sequence_no, person_id, location_id, entry_kind,
      to_char(event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_at,
      event_offset_minutes, recorded_by_person_id, captured_by_till_id, corrects_entry_id,
      correction_reason, correction_status, correction_actor_id,
      prev_entry_hash, entry_hash, is_first_entry
    from time_entries where tenant_id = ${tenantId} and location_id = ${location}
    order by sequence_no`);
  return rows.map((r) => ({
    sequenceNo: r.sequence_no,
    personId: r.person_id,
    locationId: r.location_id,
    entryKind: r.entry_kind,
    eventAt: r.event_at,
    eventOffsetMinutes: r.event_offset_minutes,
    recordedByPersonId: r.recorded_by_person_id,
    capturedByTillId: r.captured_by_till_id,
    correctsEntryId: r.corrects_entry_id,
    correctionReason: r.correction_reason,
    correctionStatus: r.correction_status,
    correctionActorId: r.correction_actor_id,
    prevEntryHash: r.prev_entry_hash,
    entryHash: r.entry_hash,
    isFirstEntry: r.is_first_entry,
  }));
}

describe("appendToChain", () => {
  it("assigns sequence_no 1 and genesis shape to the first entry", async () => {
    const result = await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T09:00:00Z")),
    );
    expect(result.sequenceNo).toBe(1);
    const [first] = await readChain(locationId);
    expect(first?.isFirstEntry).toBe(true);
    expect(first?.prevEntryHash).toBeNull();
    expect(first?.entryHash).toMatch(/^[0-9A-F]{64}$/);
    expect(first?.entryHash).toBe(result.entryHash);
  });

  it("chains the second entry to the first via prev_entry_hash", async () => {
    await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T09:00:00Z")),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T17:00:00Z")),
    );
    const [first, second] = await readChain(locationId);
    expect(second?.sequenceNo).toBe(2);
    expect(second?.isFirstEntry).toBe(false);
    expect(second?.prevEntryHash).toBe(first?.entryHash);
  });

  it("advances the chain head to the entry just written", async () => {
    const { id, entryHash } = await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T09:00:00Z")),
    );
    const { rows } = await pg.db.execute<{
      sequence_no: number;
      last_entry_id: string;
      last_entry_hash: string;
    }>(sql`
      select sequence_no, last_entry_id, last_entry_hash from workforce_chains
      where tenant_id = ${tenantId} and location_id = ${locationId}`);
    expect(rows[0]).toEqual({ sequence_no: 1, last_entry_id: id, last_entry_hash: entryHash });
  });

  it("keeps a separate, independent chain per location", async () => {
    const otherLocation = await seedLocation(pg.db, tenantId);
    await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T09:00:00Z")),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, otherLocation, inputAt("2026-01-05T09:00:00Z")),
    );
    // Each location's first entry is its own genesis at position 1 — the chain key is the location.
    expect((await readChain(locationId)).map((e) => e.sequenceNo)).toEqual([1]);
    const other = await readChain(otherLocation);
    expect(other.map((e) => e.sequenceNo)).toEqual([1]);
    expect(other[0]?.isFirstEntry).toBe(true);
  });

  it("produces a chain that re-verifies end to end", async () => {
    for (const at of ["2026-01-05T09:00:00Z", "2026-01-05T13:00:00Z", "2026-01-05T17:00:00Z"]) {
      await pg.db.transaction((tx) => appendToChain(tx, tenantId, locationId, inputAt(at)));
    }
    // The read-back rows recompute to their stored hashes — the eventAt round-trip through the
    // timestamptz column and back matches what was hashed at insert.
    expect(verifyChain(await readChain(locationId))).toEqual({ ok: true });
  });

  it("re-verifies an event_at that carries a sub-second fraction", async () => {
    // The trusted clock is millisecond-precision, but every read-back projects event_at at SECOND
    // precision (`to_char(… 'HH24:MI:SS')`). Hashing the fractional instant at insert while the
    // read-back recomputes over the truncated one is a spurious hash_mismatch on genuine, untouched
    // data — a false tamper alarm on ~999/1000 of real timestamps. Truncating to whole seconds ONCE
    // at the write choke point makes the stored column, the committed hash and the read-back one
    // identical representation, so the chain re-verifies.
    await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T09:00:00.123Z")),
    );
    expect(verifyChain(await readChain(locationId))).toEqual({ ok: true });
  });

  it("rejects a raw insert whose event_at carries a sub-second fraction (defence-in-depth CHECK)", async () => {
    // The DB CHECK backstops the write-path truncation: a row that bypasses appendToChain still
    // cannot store a sub-second event_at that would later read back as tampered. Every other column
    // here is a valid genesis row, so the only constraint this can trip is the new one.
    const error = await captureError(() =>
      pg.db.execute(sql`
        insert into time_entries (
          tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, entry_hash, sequence_no, is_first_entry
        ) values (
          ${tenantId}, ${personId}, ${locationId}, 'in', '2026-01-05T09:00:00.123Z', 0,
          ${personId}, ${"0".repeat(64)}, 1, true)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toContain("time_entries_event_at_second_ck");
  });

  it("rejects a second entry claiming an occupied chain position", async () => {
    await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T09:00:00Z")),
    );
    // Bypasses appendToChain: the unique index is the backstop and must hold against a writer that
    // never took the head lock. Position 1 is already occupied.
    const error = await captureError(() =>
      pg.db.execute(sql`
        insert into time_entries (
          tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
          recorded_by_person_id, entry_hash, sequence_no, is_first_entry
        ) values (
          ${tenantId}, ${personId}, ${locationId}, 'out', '2026-01-05T18:00:00Z', 0,
          ${personId}, ${"0".repeat(64)}, 1, true)`),
    );
    expect(pgErrorCode(error)).toBe("23505");
  });

  it("retries inside a savepoint, then surfaces exhaustion as attendance.append_contention", async () => {
    // Occupy position 1 directly, so every attempt collides for the same reason — three REAL 23505s
    // from Postgres, which only a savepoint per attempt can survive. Without one, the first 23505
    // aborts the whole transaction and the second attempt fails 25P02, a code the retry does not
    // recognise. Mirrors fiscal chain.test.ts's equivalent.
    await pg.db.execute(sql`
      insert into time_entries (
        tenant_id, person_id, location_id, entry_kind, event_at, event_offset_minutes,
        recorded_by_person_id, entry_hash, sequence_no, is_first_entry
      ) values (
        ${tenantId}, ${personId}, ${locationId}, 'in', '2026-01-05T08:00:00Z', 0,
        ${personId}, ${"1".repeat(64)}, 1, true)`);

    const error = await pg.db
      .transaction((tx) => appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T09:00:00Z")))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("attendance.append_contention");
    expect((error as AppError).params).toEqual({ tenantId, locationId, attempts: 3 });
  });

  it("surfaces exhausted retries as a structured AppError, never a bare string", async () => {
    // Stubbing tx.transaction is the only deterministic way to reach exhaustion: PGlite cannot
    // generate three real CONCURRENT collisions. appendToChain touches only tx.transaction on this
    // path, so the stub is exactly that one method.
    const alwaysCollides = {
      transaction: () => Promise.reject(Object.assign(new Error("dup"), { code: "23505" })),
    } as never;
    const error = await appendToChain(
      alwaysCollides,
      tenantId,
      locationId,
      inputAt("2026-01-05T09:00:00Z"),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("attendance.append_contention");
    expect((error as AppError).params).toEqual({ tenantId, locationId, attempts: 3 });
  });

  it("does not retry an error that is not a chain collision", async () => {
    const alwaysFk = {
      transaction: () => Promise.reject(Object.assign(new Error("fk"), { code: "23503" })),
    } as never;
    const error = await appendToChain(
      alwaysFk,
      tenantId,
      locationId,
      inputAt("2026-01-05T09:00:00Z"),
    ).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "23503" });
  });
});

describe("appendToChain commits the correction and capture content to the hash", () => {
  // The tamper-evidence chain must protect the LEGAL-RECORD content it claims to (art. 34.9): the
  // capturing till, the correction's reason, and the accountable actor. These are the record's own
  // attribution, not our metadata (unlike the fiscal `entorno`, CLAUDE.md §5), so they belong in the
  // hash. Each tamper below is applied to the READ-BACK row while its stored `entry_hash` is left
  // untouched — exactly what a party past the immutability floor (the REVOKE + reject_mutation
  // trigger) would leave behind by UPDATE-ing a column but being unable to recompute the chain.

  /** A base `in` captured by a till, then a correction carrying reason + actor, read back as a chain. */
  async function chainWithCorrection(tillId: string): Promise<VerifiableEntry[]> {
    const base = await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, locationId, {
        personId,
        entryKind: "in",
        eventAt: "2026-01-05T09:00:00Z",
        eventOffsetMinutes: 0,
        recordedByPersonId: personId,
        capturedByTillId: tillId,
      }),
    );
    await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, locationId, {
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
    return readChain(locationId);
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

describe("lockChainHead", () => {
  it("creates the chain head row from scratch when a location has none yet", async () => {
    const head = await pg.db.transaction((tx) => lockChainHead(tx, tenantId, locationId));
    expect(head).toEqual({ sequenceNo: 0, lastEntryId: null, lastEntryHash: null });
    const { rows } = await pg.db.execute<{ count: number }>(sql`
      select count(*)::int as count from workforce_chains
      where tenant_id = ${tenantId} and location_id = ${locationId}`);
    expect(rows[0]?.count).toBe(1);
  });

  it("locks the existing head rather than creating a second one", async () => {
    await pg.db.transaction((tx) =>
      appendToChain(tx, tenantId, locationId, inputAt("2026-01-05T09:00:00Z")),
    );
    const head = await pg.db.transaction((tx) => lockChainHead(tx, tenantId, locationId));
    expect(head.sequenceNo).toBe(1);
    expect(head.lastEntryId).not.toBeNull();
    expect(head.lastEntryHash).not.toBeNull();
    const { rows } = await pg.db.execute<{ count: number }>(sql`
      select count(*)::int as count from workforce_chains
      where tenant_id = ${tenantId} and location_id = ${locationId}`);
    expect(rows[0]?.count).toBe(1);
  });
});

describe("isUniqueViolation", () => {
  it("recognises a bare driver error", () => {
    expect(isUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
  });

  it("recognises a violation wrapped in a cause chain", () => {
    const inner = Object.assign(new Error("dup"), { code: "23505" });
    expect(
      isUniqueViolation(new Error("outer", { cause: new Error("mid", { cause: inner }) })),
    ).toBe(true);
  });

  it("does not treat a foreign-key violation as a chain collision", () => {
    expect(isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const looped: Error & { cause?: unknown } = new Error("loop");
    looped.cause = looped;
    expect(isUniqueViolation(looped)).toBe(false);
  });
});
