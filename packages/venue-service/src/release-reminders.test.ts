import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  departments,
  floorZones,
  kitchenStations,
  withTransaction,
  venueLocationId,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { createDepartment, createServiceZone, updateDepartment } from "./operations.js";
import {
  listDepartmentReminderMinutes,
  readReleaseReminderMinutesByZone,
} from "./release-reminders.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

function scoped<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

async function seedLocation(name: string): Promise<string> {
  await seedVenue(db, { name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" });
  const venueId = await venueLocationId(db);
  const locationId = venueId;
  await db.insert(kitchenStations).values({ name: "Default prep", isDefault: true });
  return locationId;
}

async function setMinutes(departmentId: string, minutes: number | null): Promise<void> {
  await db
    .update(departments)
    .set({ releaseReminderMinutes: minutes })
    .where(eq(departments.id, departmentId));
}

async function departmentWithZone(name: string) {
  return scoped(async (tx) => {
    const department = await createDepartment(tx, { name, orderStart: "table" });
    const zone = await createServiceZone(tx, { name, departmentId: department.id });
    return { departmentId: department.id, zoneId: zone.id };
  });
}

describe("readReleaseReminderMinutesByZone", () => {
  it("reads each zone's department's minutes, null where the department has reminders off", async () => {
    await seedLocation("Reminders on and off");
    const a = await departmentWithZone("A");
    const b = await departmentWithZone("B");
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
    await seedLocation("Reminder untouched");
    const a = await departmentWithZone("A");
    expect(await scoped((tx) => readReleaseReminderMinutesByZone(tx, [a.zoneId]))).toEqual(
      new Map([[a.zoneId, 10]]),
    );
  });

  it("leaves out a zone with no department, and an id that is no zone", async () => {
    const cfg = { locationId: await seedLocation("Reminder without department") };
    const a = await departmentWithZone("A");
    const [bare] = await db
      .insert(floorZones)
      .values({ name: "No department" })
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
    await seedLocation("Reminder inactive department");
    const a = await departmentWithZone("A");
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
    await seedLocation("Reminder list");
    const a = await departmentWithZone("A");
    const b = await departmentWithZone("B");
    const c = await departmentWithZone("C");
    await setMinutes(a.departmentId, 25);
    await setMinutes(b.departmentId, null);
    await setMinutes(c.departmentId, 5);
    await db.execute(sql`update departments set active = 0 where id = ${c.departmentId}`);
    expect(await scoped((tx) => listDepartmentReminderMinutes(tx))).toEqual({
      [a.departmentId]: 25,
      [b.departmentId]: null,
    });
  });
});

describe("updateDepartment", () => {
  it("writes a reminder given alone", async () => {
    await seedLocation("Reminder update");
    const a = await departmentWithZone("A");
    await scoped((tx) => updateDepartment(tx, a.departmentId, { releaseReminderMinutes: 5 }));
    const [row] = await db
      .select({ minutes: departments.releaseReminderMinutes })
      .from(departments)
      .where(eq(departments.id, a.departmentId));
    expect(row!.minutes).toBe(5);
  });
});
