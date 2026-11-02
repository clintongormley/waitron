import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorZones,
  kitchenStations,
  locations,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment, createServiceZone, updateDepartment } from "./operations.js";
import { departments } from "./schema/service.js";
import {
  listDepartmentReminderMinutes,
  readReleaseReminderMinutesByZone,
} from "./release-reminders.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

function scoped<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

async function seedLocation(name: string): Promise<LocationId> {
  const [row] = await db
    .insert(locations)
    .values({ name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  const locationId = brandLocationId(row!.id);
  await db.insert(kitchenStations).values({ locationId, name: "Default prep", isDefault: true });
  return locationId;
}

async function setMinutes(departmentId: string, minutes: number | null): Promise<void> {
  await db
    .update(departments)
    .set({ releaseReminderMinutes: minutes })
    .where(eq(departments.id, departmentId));
}

async function departmentWithZone(cfg: { locationId: LocationId }, name: string) {
  return scoped(async (tx) => {
    const department = await createDepartment(tx, cfg, { name, orderStart: "table" });
    const zone = await createServiceZone(tx, cfg, { name, departmentId: department.id });
    return { departmentId: department.id, zoneId: zone.id };
  });
}

describe("readReleaseReminderMinutesByZone", () => {
  it("reads each zone's department's minutes, null where the department has reminders off", async () => {
    const cfg = { locationId: await seedLocation("Reminders on and off") };
    const a = await departmentWithZone(cfg, "A");
    const b = await departmentWithZone(cfg, "B");
    await setMinutes(a.departmentId, 25);
    await setMinutes(b.departmentId, null);
    expect(
      await scoped((tx) => readReleaseReminderMinutesByZone(tx, [a.zoneId, b.zoneId])),
    ).toEqual(
      new Map([
        [a.zoneId, 25],
        [b.zoneId, null],
      ]),
    );
  });

  it("reads 10 for a department nobody has changed", async () => {
    const cfg = { locationId: await seedLocation("Reminder untouched") };
    const a = await departmentWithZone(cfg, "A");
    expect(await scoped((tx) => readReleaseReminderMinutesByZone(tx, [a.zoneId]))).toEqual(
      new Map([[a.zoneId, 10]]),
    );
  });

  it("leaves out a zone with no department, and an id that is no zone", async () => {
    const cfg = { locationId: await seedLocation("Reminder without department") };
    const a = await departmentWithZone(cfg, "A");
    const [bare] = await db
      .insert(floorZones)
      .values({ locationId: cfg.locationId, name: "No department" })
      .returning({ id: floorZones.id });
    const unknown = randomUUID();
    const found = await scoped((tx) =>
      readReleaseReminderMinutesByZone(tx, [a.zoneId, bare!.id, unknown]),
    );
    expect(found.has(bare!.id)).toBe(false);
    expect(found.has(unknown)).toBe(false);
    expect(found.get(a.zoneId)).toBe(10);
  });

  it("still answers for a department that has been made inactive", async () => {
    const cfg = { locationId: await seedLocation("Reminder inactive department") };
    const a = await departmentWithZone(cfg, "A");
    await setMinutes(a.departmentId, 25);
    await db.execute(sql`update departments set active = 0 where id = ${a.departmentId}`);
    expect(await scoped((tx) => readReleaseReminderMinutesByZone(tx, [a.zoneId]))).toEqual(
      new Map([[a.zoneId, 25]]),
    );
  });

  it("answers an empty list with an empty map", async () => {
    const untouchable = new Proxy({} as Transaction, {
      get(_target, key) {
        throw new Error(`the transaction was used: ${String(key)}`);
      },
    });
    expect((await readReleaseReminderMinutesByZone(untouchable, [])).size).toBe(0);
  });
});

describe("listDepartmentReminderMinutes", () => {
  it("lists every active department's minutes", async () => {
    const cfg = { locationId: await seedLocation("Reminder list") };
    const a = await departmentWithZone(cfg, "A");
    const b = await departmentWithZone(cfg, "B");
    const c = await departmentWithZone(cfg, "C");
    await setMinutes(a.departmentId, 25);
    await setMinutes(b.departmentId, null);
    await setMinutes(c.departmentId, 5);
    await db.execute(sql`update departments set active = 0 where id = ${c.departmentId}`);
    expect(await scoped((tx) => listDepartmentReminderMinutes(tx, cfg))).toEqual({
      [a.departmentId]: 25,
      [b.departmentId]: null,
    });
  });
});

describe("updateDepartment", () => {
  it("writes a reminder given alone", async () => {
    const cfg = { locationId: await seedLocation("Reminder update") };
    const a = await departmentWithZone(cfg, "A");
    await scoped((tx) => updateDepartment(tx, cfg, a.departmentId, { releaseReminderMinutes: 5 }));
    const [row] = await db
      .select({ minutes: departments.releaseReminderMinutes })
      .from(departments)
      .where(eq(departments.id, a.departmentId));
    expect(row!.minutes).toBe(5);
  });
});
