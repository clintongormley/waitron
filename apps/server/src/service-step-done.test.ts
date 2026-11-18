import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowIso, orderEvents, parties, partyTables } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createDepartment,
  createServiceZone,
  serviceStepCompletions,
  setProfileServiceAccess,
} from "@waitron/venue-service";
import { markServiceStepDone } from "./service-step-done.js";
import { readTableSteps } from "./service-step-signals.js";
import {
  inTx,
  join,
  OPERATOR,
  orderForParty,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { departmentOf, setOpenedAt, setSteps } from "./testing/service-steps.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const OPENED = "2020-01-01T20:30:00.000Z";
const OPENED_MS = Date.parse(OPENED);
const NOW = Date.parse("2099-01-01T00:00:00.000Z");
const MINUTE = 60_000;

const seated = (name: string, minutes = 0) =>
  ({ name, start: "seated", courseId: null, minutes }) as const;

async function liveAt(v: PartyVenue, partyId: string, tableId: string, nowMs = NOW) {
  return (await liveStepsAt(v, partyId, tableId, nowMs)).map((step) => step.stepId);
}

/** The table's live steps with when each is due, minutes after `from`. */
async function dueMinutesAt(
  v: PartyVenue,
  partyId: string,
  tableId: string,
  nowMs: number,
  from: number,
) {
  return (await liveStepsAt(v, partyId, tableId, nowMs)).map((step) => ({
    stepId: step.stepId,
    dueMinutes: (step.dueAt - from) / MINUTE,
  }));
}

async function liveStepsAt(v: PartyVenue, partyId: string, tableId: string, nowMs: number) {
  return inTx(v, async (tx) => {
    const [party] = await tx
      .select({ openedAt: parties.openedAt })
      .from(parties)
      .where(eq(parties.id, partyId));
    const tables = await tx
      .select({ tableId: partyTables.tableId })
      .from(partyTables)
      .where(and(eq(partyTables.partyId, partyId), isNull(partyTables.leftAt)));
    const steps = await readTableSteps(
      tx,
      [{ partyId, openedAt: party!.openedAt, tableIds: tables.map((row) => row.tableId) }],
      nowMs,
    );
    return steps.get(tableId)!.live;
  });
}

async function profile(v: PartyVenue): Promise<string> {
  const [row] = await seedDeviceProfiles(v.db, {
    name: `Till ${randomUUID()}`,
    formFactor: "till",
    capabilities: [...CAPABILITY_FLAGS],
  });
  return row!.id;
}

/** A till's Done on the step it shows as due at `dueAt`, arriving at `nowMs`. */
async function done(
  v: PartyVenue,
  partyId: string,
  stepId: string,
  dueAt: number,
  nowMs = NOW,
  deviceProfileId?: string,
) {
  const profileId = deviceProfileId ?? (await profile(v));
  return inTx(v, (tx) =>
    markServiceStepDone(tx, {
      deviceProfileId: profileId,
      partyId,
      stepId,
      dueAt,
      personId: OPERATOR,
      nowMs,
    }),
  );
}

async function lastOrderAt(v: PartyVenue, partyId: string): Promise<number> {
  const rows = await inTx(v, (tx) =>
    tx
      .select({ at: orderEvents.at })
      .from(orderEvents)
      .where(and(eq(orderEvents.partyId, partyId), sql`${orderEvents.kind} like 'group.%'`)),
  );
  return Math.max(...rows.map((row) => Date.parse(row.at)));
}

function completions(v: PartyVenue, partyId: string) {
  return inTx(v, (tx) =>
    tx
      .select({
        partyId: serviceStepCompletions.partyId,
        stepId: serviceStepCompletions.stepId,
        doneAt: serviceStepCompletions.doneAt,
        doneBy: serviceStepCompletions.doneBy,
      })
      .from(serviceStepCompletions)
      .where(eq(serviceStepCompletions.partyId, partyId)),
  );
}

async function seatedAtTable1(v: PartyVenue) {
  const tableId = await v.table("Mesa 1");
  const { partyId } = await seat(v, tableId);
  await setOpenedAt(v, partyId, OPENED);
  return { tableId, partyId };
}

async function terrace(v: PartyVenue) {
  return inTx(v, async (tx) => {
    const department = await createDepartment(tx, { name: "Terrace service" });
    const zone = await createServiceZone(tx, {
      name: "Terrace",
      departmentId: department.id,
    });
    return { departmentId: department.id, zoneId: zone.id };
  });
}

describe("markServiceStepDone", () => {
  it("records Done with the person and the time, and the step stops showing", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [seated("Set up")]);
    const { tableId, partyId } = await seatedAtTable1(v);
    expect(await liveAt(v, partyId, tableId)).toEqual([setUp]);

    expect(await done(v, partyId, setUp!, OPENED_MS)).toEqual({ cleared: [setUp] });

    expect(await completions(v, partyId)).toEqual([
      { partyId, stepId: setUp, doneAt: new Date(NOW).toISOString(), doneBy: OPERATOR },
    ]);
    expect(await liveAt(v, partyId, tableId)).toEqual([]);
  });

  it("a second Done writes nothing and clears nothing", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [seated("Set up")]);
    const { partyId } = await seatedAtTable1(v);
    await done(v, partyId, setUp!, OPENED_MS);

    expect(await done(v, partyId, setUp!, OPENED_MS, NOW + MINUTE)).toEqual({ cleared: [] });

    expect(await completions(v, partyId)).toHaveLength(1);
  });

  it("Done on an every-N-minutes step before its repeat is due records once; a second tap clears nothing", async () => {
    const v = await setupPartyVenue(suite.db);
    const [drinks] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [
      { name: "Drinks?", start: "since_last_order", courseId: null, minutes: 20 },
    ]);
    const { tableId, partyId } = await seatedAtTable1(v);
    await orderForParty(v, partyId, ["Caña"]);
    const ordered = await lastOrderAt(v, partyId);

    const firstRepeat = ordered + 20 * MINUTE;
    expect(await done(v, partyId, drinks!, firstRepeat, ordered + 19 * MINUTE)).toEqual({
      cleared: [drinks],
    });
    expect(await done(v, partyId, drinks!, firstRepeat, ordered + 19 * MINUTE + 30_000)).toEqual({
      cleared: [],
    });

    expect(await completions(v, partyId)).toEqual([
      {
        partyId,
        stepId: drinks,
        doneAt: new Date(ordered + 19 * MINUTE).toISOString(),
        doneBy: OPERATOR,
      },
    ]);
    expect(await liveAt(v, partyId, tableId, ordered + 40 * MINUTE)).toEqual([drinks]);
  });

  it("a repeat of a Done on an every-N-minutes repeat that has since passed leaves the next repeat to show", async () => {
    const v = await setupPartyVenue(suite.db);
    const [drinks] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [
      { name: "Drinks?", start: "since_last_order", courseId: null, minutes: 20 },
    ]);
    const { tableId, partyId } = await seatedAtTable1(v);
    await orderForParty(v, partyId, ["Caña"]);
    const ordered = await lastOrderAt(v, partyId);
    const shown = ordered + 20 * MINUTE;

    expect(await done(v, partyId, drinks!, shown, ordered + 40 * MINUTE - 100)).toEqual({
      cleared: [drinks],
    });
    expect(await done(v, partyId, drinks!, shown, ordered + 40 * MINUTE + 100)).toEqual({
      cleared: [],
    });

    expect(await completions(v, partyId)).toHaveLength(1);
    expect(await dueMinutesAt(v, partyId, tableId, ordered + 40 * MINUTE + 100, ordered)).toEqual([
      { stepId: drinks, dueMinutes: 40 },
    ]);
  });

  it("a Done on an every-N-minutes repeat a later repeat has taken over from clears the one showing", async () => {
    const v = await setupPartyVenue(suite.db);
    const [drinks] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [
      { name: "Drinks?", start: "since_last_order", courseId: null, minutes: 20 },
    ]);
    const { tableId, partyId } = await seatedAtTable1(v);
    await orderForParty(v, partyId, ["Caña"]);
    const ordered = await lastOrderAt(v, partyId);

    expect(await done(v, partyId, drinks!, ordered + 20 * MINUTE, ordered + 45 * MINUTE)).toEqual({
      cleared: [drinks],
    });

    expect(await dueMinutesAt(v, partyId, tableId, ordered + 46 * MINUTE, ordered)).toEqual([
      { stepId: drinks, dueMinutes: 60 },
    ]);
  });

  it("Done also records the due steps the shown one was hiding, so their followers start", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp, bread, water, coffee] = await setSteps(
      v,
      await departmentOf(v, v.tables.zoneId),
      [
        { ...seated("Set up"), key: "setup" },
        { name: "Bread?", start: "after_step", afterStepKey: "setup", courseId: null, minutes: 0 },
        seated("Water?", 5),
        seated("Coffee?", 60),
      ],
    );
    const { tableId, partyId } = await seatedAtTable1(v);
    const at = OPENED_MS + 7 * MINUTE;
    expect(await liveAt(v, partyId, tableId, at)).toEqual([setUp, water, coffee]);

    expect(await done(v, partyId, water!, OPENED_MS + 5 * MINUTE, at)).toEqual({
      cleared: [setUp, water],
    });

    expect((await completions(v, partyId)).map((row) => row.stepId).sort()).toEqual(
      [setUp, water].sort(),
    );
    expect(await liveAt(v, partyId, tableId, at + MINUTE)).toEqual([bread, coffee]);
  });

  describe("a till whose clock is a few seconds ahead of the server's", () => {
    /** A party whose first every-20-minutes repeat was done; the next falls due at `next`. */
    async function repeatAfterDone(v: PartyVenue) {
      const [drinks] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [
        { name: "Drinks?", start: "since_last_order", courseId: null, minutes: 20 },
      ]);
      const { tableId, partyId } = await seatedAtTable1(v);
      await orderForParty(v, partyId, ["Caña"]);
      const ordered = await lastOrderAt(v, partyId);
      await done(v, partyId, drinks!, ordered + 20 * MINUTE, ordered + 21 * MINUTE);
      return { drinks: drinks!, tableId, partyId, ordered, next: ordered + 40 * MINUTE };
    }

    it("clears a repeat it shows 5 seconds before the server reaches it, as done when it fell due", async () => {
      const v = await setupPartyVenue(suite.db);
      const { drinks, tableId, partyId, ordered, next } = await repeatAfterDone(v);

      expect(await done(v, partyId, drinks, next, next - 5_000)).toEqual({ cleared: [drinks] });

      expect((await completions(v, partyId)).map((row) => row.doneAt).sort()).toEqual([
        new Date(ordered + 21 * MINUTE).toISOString(),
        new Date(next).toISOString(),
      ]);
      expect(await dueMinutesAt(v, partyId, tableId, next + MINUTE, ordered)).toEqual([
        { stepId: drinks, dueMinutes: 60 },
      ]);
    });

    it("an order sent between an early Done and the time it was recorded at still starts the next repeat", async () => {
      const v = await setupPartyVenue(suite.db);
      const { drinks, tableId, partyId, next } = await repeatAfterDone(v);
      expect(await done(v, partyId, drinks, next, next - 20_000)).toEqual({ cleared: [drinks] });

      vi.useFakeTimers({ toFake: ["Date"], now: next - 10_000 });
      try {
        await orderForParty(v, partyId, ["Caña"]);
      } finally {
        vi.useRealTimers();
      }
      const reordered = await lastOrderAt(v, partyId);
      expect(reordered).toBe(next - 10_000);

      const repeat = reordered + 20 * MINUTE;
      expect(await dueMinutesAt(v, partyId, tableId, repeat, reordered)).toEqual([
        { stepId: drinks, dueMinutes: 20 },
      ]);
      expect(await done(v, partyId, drinks, repeat, repeat)).toEqual({ cleared: [drinks] });
    });

    it("clears nothing for a repeat it shows 31 seconds before the server reaches it", async () => {
      const v = await setupPartyVenue(suite.db);
      const { drinks, partyId, next } = await repeatAfterDone(v);

      expect(await done(v, partyId, drinks, next, next - 31_000)).toEqual({ cleared: [] });

      expect(await completions(v, partyId)).toHaveLength(1);
    });

    it("records Done on a step that does not repeat at the server's time", async () => {
      const v = await setupPartyVenue(suite.db);
      const [water] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [
        seated("Water?", 5),
      ]);
      const { partyId } = await seatedAtTable1(v);
      const dueAt = OPENED_MS + 5 * MINUTE;

      expect(await done(v, partyId, water!, dueAt, dueAt - 5_000)).toEqual({ cleared: [water] });

      expect((await completions(v, partyId)).map((row) => row.doneAt)).toEqual([
        new Date(dueAt - 5_000).toISOString(),
      ]);
    });
  });

  it("Done on a step not yet due is accepted", async () => {
    const v = await setupPartyVenue(suite.db);
    const [water] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [
      seated("Water?", 5),
    ]);
    const { tableId, partyId } = await seatedAtTable1(v);

    expect(await done(v, partyId, water!, OPENED_MS + 5 * MINUTE, OPENED_MS + MINUTE)).toEqual({
      cleared: [water],
    });

    expect(await liveAt(v, partyId, tableId, OPENED_MS + 10 * MINUTE)).toEqual([]);
  });

  it("a party at two tables of one department records each step once and names it once", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [seated("Set up")]);
    const { partyId } = await seatedAtTable1(v);
    await join(v, partyId, await v.table("Mesa 2"));

    expect(await done(v, partyId, setUp!, OPENED_MS)).toEqual({ cleared: [setUp] });

    expect(await completions(v, partyId)).toHaveLength(1);
  });

  it("refuses a step of a department none of the party's tables is in", async () => {
    const v = await setupPartyVenue(suite.db);
    await setSteps(v, await departmentOf(v, v.tables.zoneId), [seated("Set up")]);
    const outside = await terrace(v);
    const [water] = await setSteps(v, outside.departmentId, [seated("Water?")]);
    const { partyId } = await seatedAtTable1(v);

    await expect(done(v, partyId, water!, OPENED_MS)).rejects.toMatchObject({
      code: "service_step.not_found",
      params: { stepId: water },
    });
    expect(await completions(v, partyId)).toEqual([]);
  });

  it("refuses a step that no longer exists", async () => {
    const v = await setupPartyVenue(suite.db);
    const department = await departmentOf(v, v.tables.zoneId);
    const [setUp] = await setSteps(v, department, [seated("Set up")]);
    const { partyId } = await seatedAtTable1(v);
    await setSteps(v, department, [seated("Water?")]);

    await expect(done(v, partyId, setUp!, OPENED_MS)).rejects.toMatchObject({
      code: "service_step.not_found",
      params: { stepId: setUp },
    });
  });

  it("refuses a party that has left", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [seated("Set up")]);
    const { partyId } = await seatedAtTable1(v);
    await inTx(v, (tx) =>
      tx
        .update(parties)
        .set({ state: "closed", closedAt: nowIso() })
        .where(eq(parties.id, partyId)),
    );

    await expect(done(v, partyId, setUp!, OPENED_MS)).rejects.toMatchObject({
      code: "party.not_open",
      params: { partyId },
    });
    await expect(done(v, randomUUID(), setUp!, OPENED_MS)).rejects.toMatchObject({
      code: "party.not_open",
    });
  });

  it("Done on one department's step leaves the other table's step", async () => {
    const v = await setupPartyVenue(suite.db);
    const [setUp] = await setSteps(v, await departmentOf(v, v.tables.zoneId), [seated("Set up")]);
    const outside = await terrace(v);
    const [water] = await setSteps(v, outside.departmentId, [seated("Water?", 5)]);
    const { tableId, partyId } = await seatedAtTable1(v);
    const terraceTable = await v.table("T1", outside.zoneId);
    // `joinTables` refuses a table of another zone (`service_zone.join_mismatch`).
    await inTx(v, (tx) => tx.insert(partyTables).values({ partyId, tableId: terraceTable }));

    expect(await done(v, partyId, setUp!, OPENED_MS)).toEqual({ cleared: [setUp] });

    expect(await liveAt(v, partyId, tableId)).toEqual([]);
    expect(await liveAt(v, partyId, terraceTable)).toEqual([water]);
  });

  it("refuses a step found on a table in a zone the profile may not serve", async () => {
    const v = await setupPartyVenue(suite.db);
    const restaurant = await departmentOf(v, v.tables.zoneId);
    const [setUp] = await setSteps(v, restaurant, [seated("Set up")]);
    const outside = await terrace(v);
    const [water] = await setSteps(v, outside.departmentId, [seated("Water?")]);
    const { partyId } = await seatedAtTable1(v);
    const terraceTable = await v.table("T1", outside.zoneId);
    // `joinTables` refuses a table of another zone (`service_zone.join_mismatch`).
    await inTx(v, (tx) => tx.insert(partyTables).values({ partyId, tableId: terraceTable }));
    const tablesOnly = await profile(v);
    await inTx(v, (tx) =>
      setProfileServiceAccess(tx, tablesOnly, {
        departmentId: restaurant,
        allowedZoneIds: [v.tables.zoneId],
        startingZoneId: v.tables.zoneId,
      }),
    );

    await expect(done(v, partyId, water!, OPENED_MS, NOW, tablesOnly)).rejects.toMatchObject({
      code: "service_zone.not_allowed",
      params: { zoneId: outside.zoneId },
    });
    expect(await completions(v, partyId)).toEqual([]);
    expect(await done(v, partyId, setUp!, OPENED_MS, NOW, tablesOnly)).toEqual({
      cleared: [setUp],
    });
  });
});
