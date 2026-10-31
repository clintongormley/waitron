import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { AppError, jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { WorkforceBackend, type ClockEventInput } from "./clocking.js";
import { readLatestLiveEntry } from "./record-reads.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { seedEmployment, seedLocation, seedPerson } from "../test/fixtures.js";
import { planningEveryStatement } from "../test/query-plans.js";

const backend = new WorkforceBackend();
const origin = jobOrigin("dashboard");

let locationId: string;
let nodeId: string;
let manager: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    await seedTenant(db);
    locationId = await seedLocation(db);
    nodeId = await seedNode(db, brandLocationId(locationId));
    const [row] = await db
      .insert(persons)
      .values({ displayName: "Manager", pinHash: "scrypt$00$00", role: "manager" })
      .returning({ id: persons.id });
    manager = row!.id;
  },
});

async function worker(name: string): Promise<string> {
  const personId = await seedPerson(suite.db, name);
  await seedEmployment(suite.db, { personId });
  return personId;
}

function at(personId: string, time: string, location = locationId): ClockEventInput {
  return {
    nodeId,
    personId,
    locationId: location,
    at: `2026-01-05T${time}:00Z`,
    offsetMinutes: 0,
    origin,
  };
}

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function rejection(fn: () => Promise<unknown>): Promise<string | undefined> {
  const error = await captureError(fn);
  return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
}

async function rowCount(personId: string): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from time_entries where person_id = ${personId}`,
  );
  return Number(rows[0]!.n);
}

async function latest(personId: string, kind?: "in") {
  const entry = await run((tx) => readLatestLiveEntry(tx, personId, kind ? { kind } : undefined));
  return (
    entry && { kind: entry.entryKind, at: new Date(entry.eventAt).toISOString().slice(11, 16) }
  );
}

async function missing(personId: string, kind: "in" | "out", time: string): Promise<void> {
  const correctionId = await run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      personId,
      locationId,
      missingEntryKind: kind,
      at: `2026-01-05T${time}:00Z`,
      offsetMinutes: 0,
      reason: "Forgot",
      actorPersonId: personId,
      origin,
    }),
  );
  await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId, approverPersonId: manager }),
  );
}

describe("clocking across a backward step of the box's clock", () => {
  it("reads a clock-out dated before its clock-in as out, and lets the person clock in again", async () => {
    const p = await worker("stepped");
    await run((tx) => backend.clockIn(tx, at(p, "21:00")));
    const firstIn = (
      await suite.db.execute<{ id: string }>(
        sql`select id from time_entries where person_id = ${p} and entry_kind = 'in'`,
      )
    ).rows[0]!.id;

    // The clock is stepped back an hour.
    await run((tx) => backend.clockOut(tx, at(p, "20:30")));
    expect(await rowCount(p)).toBe(2);
    expect(await latest(p)).toEqual({ kind: "out", at: "20:30" });

    expect(await rejection(() => run((tx) => backend.clockOut(tx, at(p, "20:50"))))).toBe(
      "attendance.no_open_entry",
    );
    expect(await rowCount(p)).toBe(2);

    await run((tx) => backend.clockIn(tx, at(p, "20:45")));
    expect(await latest(p)).toEqual({ kind: "in", at: "20:45" });
    await run((tx) => backend.clockOut(tx, at(p, "21:30")));
    expect(await latest(p)).toEqual({ kind: "out", at: "21:30" });
    expect(await latest(p, "in")).toEqual({ kind: "in", at: "20:45" });

    // A manager retimes the clock-in written under the wrong clock.
    const retime = await run((tx) =>
      backend.requestCorrection(tx, {
        nodeId,
        correctsEntryId: firstIn,
        at: "2026-01-05T20:00:00Z",
        offsetMinutes: 0,
        reason: "Clock was an hour fast",
        actorPersonId: p,
        origin,
      }),
    );
    await expect(
      run((tx) =>
        backend.approveCorrection(tx, { nodeId, correctionId: retime, approverPersonId: manager }),
      ),
    ).resolves.toEqual(expect.any(String));
  });

  it("reads an ordinary day as today's rule does (control)", async () => {
    const p = await worker("ordinary");
    await run((tx) => backend.clockIn(tx, at(p, "09:00")));
    expect(await latest(p)).toEqual({ kind: "in", at: "09:00" });
    await run((tx) => backend.clockOut(tx, at(p, "17:00")));
    expect(await latest(p)).toEqual({ kind: "out", at: "17:00" });
    expect(await latest(p, "in")).toEqual({ kind: "in", at: "09:00" });
    expect(await latest(await worker("never clocked"))).toBeUndefined();
  });

  it("reads the latest chain's entry when the person moved location (control)", async () => {
    const p = await worker("moved");
    const a = await seedLocation(suite.db);
    const b = await seedLocation(suite.db);
    await run((tx) => backend.clockIn(tx, at(p, "09:00", a)));
    await run((tx) => backend.clockOut(tx, at(p, "12:00", a)));
    await run((tx) => backend.clockIn(tx, at(p, "13:00", b)));
    const { rows } = await suite.db.execute<{ location_id: string; sequence_no: number }>(
      sql`select location_id, sequence_no from time_entries where person_id = ${p} order by event_at`,
    );
    expect(rows.map((r) => [r.location_id, Number(r.sequence_no)])).toEqual([
      [a, 1],
      [a, 2],
      [b, 1],
    ]);
    const entry = await run((tx) => readLatestLiveEntry(tx, p));
    expect({ kind: entry?.entryKind, locationId: entry?.locationId }).toEqual({
      kind: "in",
      locationId: b,
    });
  });

  it("lets an approved missing clock-out dated after the latest clock-in decide (control)", async () => {
    const p = await worker("missing after");
    await run((tx) => backend.clockIn(tx, at(p, "09:00")));
    await missing(p, "out", "17:00");
    expect(await latest(p)).toEqual({ kind: "out", at: "17:00" });
  });

  it("keeps the latest clock-in when an approved missing clock-out is dated before it (control)", async () => {
    const p = await worker("missing before");
    await missing(p, "in", "08:00");
    await missing(p, "out", "12:00");
    await run((tx) => backend.clockIn(tx, at(p, "13:00")));
    expect(await latest(p)).toEqual({ kind: "in", at: "13:00" });
  });

  it("reads approved missing clock-ins for kind in and skips missing clock-outs", async () => {
    const p = await worker("kind in corrections");
    await run((tx) => backend.clockIn(tx, at(p, "09:00")));
    await run((tx) => backend.clockOut(tx, at(p, "12:00")));
    await missing(p, "in", "13:00");
    await missing(p, "out", "14:00");
    expect(await latest(p, "in")).toEqual({ kind: "in", at: "13:00" });
    expect(await latest(p)).toEqual({ kind: "out", at: "14:00" });
  });

  it("keeps a chain per node as well as per location", async () => {
    const p = await worker("two nodes");
    const second = await seedNode(suite.db, brandLocationId(locationId));
    await run((tx) => backend.clockIn(tx, at(p, "09:00")));
    await run((tx) => backend.clockOut(tx, at(p, "12:00")));
    await run((tx) => backend.clockIn(tx, { ...at(p, "13:00"), nodeId: second }));
    expect(await latest(p)).toEqual({ kind: "in", at: "13:00" });
  });

  // The plan's accepted residual (Task 15a, the lead's ruling (e)): times are still compared
  // across chains, so a move of location within a backward step reads the other chain's later
  // entry until real time passes it, and the clock actions follow that reading.
  it("still reads another location's later-dated entry after a step, as the plan accepts", async () => {
    const p = await worker("residual");
    const a = await seedLocation(suite.db);
    const b = await seedLocation(suite.db);
    await run((tx) => backend.clockIn(tx, at(p, "21:00", a)));
    await run((tx) => backend.clockOut(tx, at(p, "21:10", a)));
    // The clock is stepped back an hour.
    await run((tx) => backend.clockIn(tx, at(p, "20:15", b)));
    expect(await latest(p)).toEqual({ kind: "out", at: "21:10" });
    expect(await rejection(() => run((tx) => backend.clockOut(tx, at(p, "20:40", b))))).toBe(
      "attendance.no_open_entry",
    );
    await run((tx) => backend.clockIn(tx, at(p, "20:45", b)));
    expect(await rowCount(p)).toBe(4);
  });

  // This read runs on every clock action while the venue's write lock is held, and a person's
  // entries grow for as long as they work there.
  it("finds the deciding entry through indexes, never reading the person's whole history", async () => {
    const p = await worker("planned");
    const other = await seedLocation(suite.db);
    await run((tx) => backend.clockIn(tx, at(p, "09:00")));
    await run((tx) => backend.clockOut(tx, at(p, "12:00")));
    await run((tx) => backend.clockIn(tx, at(p, "13:00", other)));
    await missing(p, "out", "17:00");
    for (const kind of [undefined, "in"] as const) {
      const plans = await run(async (tx) => {
        const { recording, statements } = planningEveryStatement(tx);
        await readLatestLiveEntry(recording, p, kind ? { kind } : undefined);
        return statements.flatMap((statement) => statement.plan());
      });
      expect(plans.filter((line) => /TEMP B-TREE|\(person_id=\?\)$/.test(line))).toEqual([]);
      expect(plans).toContain(
        "SEARCH head USING INDEX time_entries_person_chain_idx (person_id=? AND node_id=? AND location_id=?)",
      );
      expect(
        plans.filter((line) => line.startsWith("SCAN") && !/^SCAN workforce_chains\b/.test(line)),
      ).toEqual([]);
    }
  });
});
