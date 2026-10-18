import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorPlans, floorPlanSets, floorTodayZones, floorZones } from "@waitron/db";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import {
  createDepartment,
  createServiceZone,
  departmentFloorPlanSets,
  linkFloorPlanSet,
  menuPeriods,
} from "@waitron/venue-service";
import { readLayout, saveLayout } from "./floor-plan.js";
import { floorDeletionFor } from "./floor-delete.js";
import { resetZone } from "./floor-today-store.js";
import { ALL_MODULES, enabledTableRemovals } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { inTx, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { setsDepartment, standardAndDinner } from "./testing/floor-today-venue.js";
import { seedSessionDevice } from "./testing/session-device.js";
import "./errors.js";

let v: PartyVenue;
let app: Hono;
let cookie: string;
let nowAt = new Date();

const REMOVALS = enabledTableRemovals(ALL_MODULES);

/** Venue times are Madrid's, two hours ahead of UTC in October. */
const SUNDAY_LUNCH = new Date("2026-10-11T13:00:00+02:00");
const LUNCH = new Date("2026-10-12T13:00:00+02:00");
const EDIT = new Date("2026-10-12T14:00:00+02:00");
const AFTER_LUNCH = new Date("2026-10-12T16:00:00+02:00");
const AFTERNOON = new Date("2026-10-12T17:00:00+02:00");

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

beforeAll(async () => {
  app = new Hono();
  mountTillApi(
    app,
    {
      db: v.db,
      backend: v.backend,
      clock: { ...v.clock, now: () => ({ ...v.clock.now(), instant: nowAt }) },
      cfg: v.cfg,
      tableRemovals: REMOVALS,
      secureCookies: false,
      venueLocale: v.cfg.locale,
    },
    () => {},
  );
  const deviceId = await seedSessionDevice(v.db, v.cfg);
  const session = await inTx(v, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    return loginWithPin(tx, { deviceId, personId: person!.id, pin: "5555" });
  });
  cookie = `${SESSION_COOKIE}=${session.token}`;
});

beforeEach(() => {
  nowAt = LUNCH;
});

interface ZoneAnswer {
  id: string;
  hasPlan: boolean;
  layoutSetName: string | null;
  layoutDue: { setId: string; revision: number; periodName: string | null } | null;
}

async function zoneAt(at: Date, zoneId: string): Promise<ZoneAnswer> {
  nowAt = at;
  const answer = await app.request("/api/zones", { headers: { cookie } });
  expect(answer.status, await answer.clone().text()).toBe(200);
  const zones = (await answer.json()) as ZoneAnswer[];
  return zones.find((zone) => zone.id === zoneId)!;
}

async function layoutRevision(setId: string, zoneId: string): Promise<number> {
  const [row] = await inTx(v, (tx) =>
    tx
      .select({ revision: floorPlans.revision })
      .from(floorPlans)
      .where(and(eq(floorPlans.setId, setId), eq(floorPlans.zoneId, zoneId))),
  );
  return row!.revision;
}

/** Standard stands A at 0; Dinner stands it at 40. The first save, at `at`, records the due layout. */
function twoSets(at: Date = LUNCH) {
  return standardAndDinner(v, at, [{ key: "a", label: `A ${randomUUID().slice(0, 6)}` }], {
    standard: { a: 0 },
    dinner: { a: 40 },
  });
}

async function updateToDue(zoneId: string, at: Date): Promise<void> {
  await inTx(v, (tx) => resetZone(tx, v.cfg, REMOVALS, zoneId, at, "due"));
}

/** A layout row of the zone in a set no department holds, which a lookup by zone alone counts. */
async function unlinkedPlanRow(zoneId: string): Promise<void> {
  await inTx(v, async (tx) => {
    const [set] = await tx
      .insert(floorPlanSets)
      .values({ locationId: v.cfg.locationId })
      .returning({ id: floorPlanSets.id });
    await tx
      .insert(floorPlans)
      .values({ zoneId, setId: set!.id, revision: 1, savedAt: LUNCH.toISOString() });
  });
}

describe("GET /api/zones offers the due layout", () => {
  it("offers nothing while the recorded layout is the one running, and names its set", async () => {
    const { d } = await twoSets();

    expect(await zoneAt(LUNCH, d.zoneId)).toMatchObject({
      hasPlan: true,
      layoutSetName: "Standard",
      layoutDue: null,
    });
  });

  it("offers Dinner's layout, naming Dinner, once Lunch is over", async () => {
    const { d } = await twoSets();

    expect(await zoneAt(AFTER_LUNCH, d.zoneId)).toMatchObject({
      layoutSetName: "Standard",
      layoutDue: {
        setId: d.dinner,
        revision: await layoutRevision(d.dinner, d.zoneId),
        periodName: "Dinner",
      },
    });
  });

  it("offers an edit saved to the running set without naming a period", async () => {
    const { d } = await twoSets();
    const layout = { setId: d.standard, zoneId: d.zoneId };
    const plan = await inTx(v, (tx) => readLayout(tx, v.cfg, layout));
    await inTx(v, (tx) =>
      saveLayout(
        tx,
        v.cfg,
        REMOVALS,
        layout,
        {
          revision: plan.revision,
          tables: plan.tables.map((t) => ({
            id: t.id,
            key: t.id,
            label: t.label,
            seats: t.seats,
            fixed: t.fixed,
            placement: t.placement === null ? null : { ...t.placement, x: 20 },
            partKeys: t.partIds,
          })),
        },
        EDIT,
      ),
    );

    expect((await zoneAt(EDIT, d.zoneId)).layoutDue).toEqual({
      setId: d.standard,
      revision: await layoutRevision(d.standard, d.zoneId),
      periodName: null,
    });
  });

  it("names no period when Dinner's field changes after an update to Dinner", async () => {
    const { d } = await twoSets();
    await updateToDue(d.zoneId, AFTER_LUNCH);
    const party = await inTx(v, async (tx) => {
      const [row] = await tx
        .insert(floorPlanSets)
        .values({ locationId: v.cfg.locationId })
        .returning({ id: floorPlanSets.id });
      await linkFloorPlanSet(tx, v.cfg, {
        setId: row!.id,
        departmentId: d.departmentId,
        name: "Private party",
      });
      await tx
        .update(menuPeriods)
        .set({ floorPlanSetId: row!.id })
        .where(eq(menuPeriods.id, d.dinnerPeriod));
      return row!.id;
    });

    expect(await zoneAt(AFTERNOON, d.zoneId)).toMatchObject({
      layoutSetName: "Dinner",
      layoutDue: { setId: party, revision: 0, periodName: null },
    });
  });

  it("names no set and offers the default when the recorded set is deleted", async () => {
    const { d } = await twoSets();
    await updateToDue(d.zoneId, AFTER_LUNCH);
    await inTx(v, async (tx) => {
      await tx
        .update(menuPeriods)
        .set({ floorPlanSetId: null })
        .where(eq(menuPeriods.floorPlanSetId, d.dinner));
      await tx.delete(departmentFloorPlanSets).where(eq(departmentFloorPlanSets.setId, d.dinner));
      await floorDeletionFor(v.cfg, REMOVALS).removeSets(tx, [d.dinner]);
    });

    expect(await zoneAt(AFTERNOON, d.zoneId)).toMatchObject({
      layoutSetName: null,
      layoutDue: {
        setId: d.standard,
        revision: await layoutRevision(d.standard, d.zoneId),
        periodName: null,
      },
    });
  });

  it("offers nothing on a record from yesterday", async () => {
    const { d } = await twoSets(SUNDAY_LUNCH);

    expect(await zoneAt(LUNCH, d.zoneId)).toMatchObject({
      layoutSetName: null,
      layoutDue: null,
    });
  });

  it("writes nothing", async () => {
    const { d } = await twoSets();
    const rows = () =>
      inTx(v, (tx) =>
        tx.select().from(floorTodayZones).where(eq(floorTodayZones.zoneId, d.zoneId)),
      );
    const before = await rows();

    expect((await zoneAt(AFTER_LUNCH, d.zoneId)).layoutDue).toMatchObject({ setId: d.dinner });

    expect(await rows()).toEqual(before);
  });
});

describe("hasPlan says the department has a set", () => {
  it("is true for a zone with no tables whose department has a set", async () => {
    const d = await setsDepartment(v, new Date("2026-10-09T06:00:00Z"));

    expect((await zoneAt(LUNCH, d.zoneId)).hasPlan).toBe(true);
  });

  it("is false for a zone with tables whose department has no set", async () => {
    const zoneId = await inTx(v, async (tx) => {
      const department = await createDepartment(tx, v.cfg, {
        name: `Dept ${randomUUID().slice(0, 8)}`,
        orderStart: "table",
      });
      return (
        await createServiceZone(tx, v.cfg, {
          name: `Setless ${randomUUID().slice(0, 8)}`,
          departmentId: department.id,
        })
      ).id;
    });
    await v.table(`T ${randomUUID().slice(0, 6)}`, zoneId);
    await unlinkedPlanRow(zoneId);

    expect((await zoneAt(LUNCH, zoneId)).hasPlan).toBe(false);
  });

  it("is false for a zone in no department", async () => {
    const zoneId = randomUUID();
    await inTx(v, (tx) =>
      tx
        .insert(floorZones)
        .values({ id: zoneId, locationId: v.cfg.locationId, name: `Loose ${zoneId.slice(0, 8)}` }),
    );
    await unlinkedPlanRow(zoneId);

    expect((await zoneAt(LUNCH, zoneId)).hasPlan).toBe(false);
  });
});
