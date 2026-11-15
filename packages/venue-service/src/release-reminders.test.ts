import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  kitchenCourses,
  departmentCourses,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, seedZone } from "@waitron/db/testing/seed.js";
import { createDepartment, createServiceZone } from "./operations.js";
import {
  readCourseSettingsByZone,
  listDepartmentCourseSettings,
  saveDepartmentCourseSettings,
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

async function seedFixtureVenue(name: string): Promise<void> {
  await seedVenue(db, { name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" });
  await db.insert(kitchenStations).values({ name: "Default prep", isDefault: true });
}

async function setMinutes(departmentId: string, minutes: number | null): Promise<string> {
  const [course] = await db
    .insert(kitchenCourses)
    .values({ name: `Course ${randomUUID()}` })
    .returning();
  await scoped((tx) =>
    saveDepartmentCourseSettings(tx, departmentId, [
      { courseId: course!.id, heldUntilFired: false, reminderMinutes: minutes },
    ]),
  );
  return course!.id;
}

async function departmentWithZone(name: string) {
  return scoped(async (tx) => {
    const department = await createDepartment(tx, { name, orderStart: "table" });
    const zone = await createServiceZone(tx, { name, departmentId: department.id });
    return { departmentId: department.id, zoneId: zone.id };
  });
}

describe("department course settings", () => {
  it("keeps each department's firing and reminder choices together", async () => {
    await seedFixtureVenue("Independent courses");
    const a = await departmentWithZone("A"),
      b = await departmentWithZone("B");
    const courseId = await setMinutes(a.departmentId, null);
    expect(await scoped((tx) => readCourseSettingsByZone(tx, [a.zoneId, b.zoneId]))).toEqual(
      new Map([
        [a.zoneId, [{ courseId, heldUntilFired: false, reminderMinutes: null }]],
        [b.zoneId, []],
      ]),
    );
    await scoped((tx) =>
      saveDepartmentCourseSettings(tx, a.departmentId, [
        { courseId, heldUntilFired: true, reminderMinutes: 10 },
      ]),
    );
    expect(await db.select().from(departmentCourses)).toEqual([]);
    expect(await scoped((tx) => listDepartmentCourseSettings(tx))).toEqual({});
  });

  it("omits inactive and unknown zones and keeps an inactive department's choices", async () => {
    await seedFixtureVenue("Inactive zone");
    const a = await departmentWithZone("A");
    const courseId = await setMinutes(a.departmentId, 25);
    const inactive = await seedZone(db, { name: "Inactive", active: false });
    await db.execute(sql`update departments set active = 0 where id = ${a.departmentId}`);
    expect(
      await scoped((tx) => readCourseSettingsByZone(tx, [a.zoneId, inactive!.id, randomUUID()])),
    ).toEqual(new Map([[a.zoneId, [{ courseId, heldUntilFired: false, reminderMinutes: 25 }]]]));
  });

  it("answers an empty list without a database read", async () => {
    const untouchable = new Proxy({} as Transaction, {
      get() {
        throw new Error("database used");
      },
    });
    expect(await readCourseSettingsByZone(untouchable, [])).toEqual(new Map());
  });
});
