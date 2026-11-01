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
import { decideCorrectionGroup, requestCorrectionGroup } from "./corrections.js";
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

async function missing(
  personId: string,
  kind: "in" | "out",
  time: string,
  day = "05",
): Promise<void> {
  const correctionId = await run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      personId,
      locationId,
      missingEntryKind: kind,
      at: `2026-01-${day}T${time}:00Z`,
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

  it("reads the latest entry when the person moved location (control)", async () => {
    const p = await worker("moved");
    const a = await seedLocation(suite.db);
    const b = await seedLocation(suite.db);
    await run((tx) => backend.clockIn(tx, at(p, "09:00", a)));
    await run((tx) => backend.clockOut(tx, at(p, "12:00", a)));
    await run((tx) => backend.clockIn(tx, at(p, "13:00", b)));
    const { rows } = await suite.db.execute<{ sequence_no: number }>(
      sql`select sequence_no from time_entries where person_id = ${p} order by event_at`,
    );
    // The suite shares one node across its cases, so positions are read relative to the first.
    const first = Number(rows[0]!.sequence_no);
    expect(rows.map((r) => Number(r.sequence_no) - first + 1)).toEqual([1, 2, 3]);
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

  it("keeps a chain per node", async () => {
    const p = await worker("two nodes");
    const second = await seedNode(suite.db, brandLocationId(locationId));
    await run((tx) => backend.clockIn(tx, at(p, "09:00")));
    await run((tx) => backend.clockOut(tx, at(p, "12:00")));
    await run((tx) => backend.clockIn(tx, { ...at(p, "13:00"), nodeId: second }));
    expect(await latest(p)).toEqual({ kind: "in", at: "13:00" });
  });

  it("lets a clock-out written after an approved later-dated clock-in close it", async () => {
    const p = await worker("approved start then step");
    await missing(p, "in", "09:00", "06");
    // The clock is stepped back to the day before.
    await run((tx) => backend.clockOut(tx, at(p, "10:00")));
    const instant = async (kind?: "in") =>
      (await run((tx) => readLatestLiveEntry(tx, p, kind ? { kind } : undefined)))?.eventAt;
    expect(await latest(p)).toEqual({ kind: "out", at: "10:00" });
    expect(await instant("in")).toBe("2026-01-06T09:00:00.000Z");
    await run((tx) => backend.clockIn(tx, at(p, "11:00")));
    expect(await latest(p)).toEqual({ kind: "in", at: "11:00" });
    expect(await instant("in")).toBe("2026-01-05T11:00:00.000Z");
    expect(await rowCount(p)).toBe(4);
  });

  it("lets a clock action written after an approved correction dated ahead of the clock decide", async () => {
    const p = await worker("correction dated ahead");
    await run((tx) => backend.clockIn(tx, at(p, "09:00")));
    await missing(p, "out", "17:00");
    expect(await latest(p)).toEqual({ kind: "out", at: "17:00" });
    await run((tx) => backend.clockIn(tx, at(p, "13:00")));
    expect(await latest(p)).toEqual({ kind: "in", at: "13:00" });
    expect(await rejection(() => run((tx) => backend.clockIn(tx, at(p, "13:05"))))).toBe(
      "attendance.already_open",
    );
  });

  it("lets a clock-out after an approved clock-in close it with no step (control)", async () => {
    const p = await worker("approved start");
    await missing(p, "in", "09:00");
    await run((tx) => backend.clockOut(tx, at(p, "10:00")));
    await run((tx) => backend.clockIn(tx, at(p, "11:00")));
    expect(await latest(p)).toEqual({ kind: "in", at: "11:00" });
  });

  it("keeps the clock-in when a missing pair dated before it is approved after it (control)", async () => {
    const p = await worker("pair approved later");
    await run((tx) => backend.clockIn(tx, at(p, "13:00")));
    const pair = await run((tx) =>
      requestCorrectionGroup(
        tx,
        (["07:00", "08:00"] as const).map((time, i) => ({
          nodeId,
          personId: p,
          locationId,
          missingEntryKind: i === 0 ? ("in" as const) : ("out" as const),
          at: `2026-01-05T${time}:00Z`,
          offsetMinutes: 0,
          reason: "Forgot",
          actorPersonId: p,
          origin,
        })),
        "request",
      ),
    );
    await run((tx) =>
      decideCorrectionGroup(
        tx,
        { nodeId, correctionIds: pair, actorPersonId: manager, origin },
        "approve",
      ),
    );
    expect(await latest(p)).toEqual({ kind: "in", at: "13:00" });
    expect(await latest(p, "in")).toEqual({ kind: "in", at: "13:00" });
  });

  // One chain per node: the clock-in written after the step is the latest write.
  it("reads the clock-in at another location written after a step", async () => {
    const p = await worker("residual");
    const a = await seedLocation(suite.db);
    const b = await seedLocation(suite.db);
    await run((tx) => backend.clockIn(tx, at(p, "21:00", a)));
    await run((tx) => backend.clockOut(tx, at(p, "21:10", a)));
    // The clock is stepped back an hour.
    await run((tx) => backend.clockIn(tx, at(p, "20:15", b)));
    expect(await latest(p)).toEqual({ kind: "in", at: "20:15" });
    expect(await rejection(() => run((tx) => backend.clockIn(tx, at(p, "20:30", b))))).toBe(
      "attendance.already_open",
    );
    await run((tx) => backend.clockOut(tx, at(p, "20:40", b)));
    expect(await rowCount(p)).toBe(4);
    expect(await latest(p)).toEqual({ kind: "out", at: "20:40" });
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
        "SEARCH head USING INDEX time_entries_person_chain_idx (person_id=? AND node_id=?)",
      );
      expect(
        plans.filter((line) => line.startsWith("SCAN") && !/^SCAN workforce_chains\b/.test(line)),
      ).toEqual([]);
    }
  });
});
