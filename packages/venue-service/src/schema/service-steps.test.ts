import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  captureError,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  engineErrorMessage,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  kitchenCourses,
  locations,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "../migrations.js";
import { createDepartment } from "../operations.js";
import { serviceSteps } from "./service-steps.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
let departmentId = "";
let courseId = "";

beforeAll(async () => {
  db = suite.db;
  const [location] = await db
    .insert(locations)
    .values({ name: "Steps", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  const cfg = { locationId: brandLocationId(location!.id) };
  const department = await withTransaction(db, (tx) =>
    createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" }),
  );
  departmentId = department.id;
  const [course] = await db
    .insert(kitchenCourses)
    .values({ locationId: cfg.locationId, name: "Mains", displayOrder: 0 })
    .returning({ id: kitchenCourses.id });
  courseId = course!.id;
});

type Step = typeof serviceSteps.$inferInsert;

function step(overrides: Partial<Step>): Step {
  return {
    departmentId,
    position: 0,
    name: "Set up",
    start: "seated",
    courseId: null,
    minutes: 0,
    ...overrides,
  };
}

const insert = (row: Step) =>
  withTransaction(db, async (tx) => {
    await tx.insert(serviceSteps).values(row);
  });

async function refused(row: Step, kind: readonly number[], words: string) {
  const error = await captureError(() => insert(row));
  expect(isRefusal(error, kind), words).toBe(true);
  expect(engineErrorMessage(error), words).toContain(words);
}

describe("the service_steps table", () => {
  it("stores a step with each start, a course only for a course start", async () => {
    const rows: Step[] = [
      step({ position: 0, name: "Set up", start: "seated", minutes: 0 }),
      step({ position: 1, name: "Take order", start: "after_previous", minutes: 2 }),
      step({ position: 2, name: "Dessert?", start: "course_served", courseId, minutes: 10 }),
      step({ position: 3, name: "Anything else?", start: "all_served", minutes: 120 }),
      step({ position: 4, name: "Check in", start: "since_last_order", minutes: 1 }),
    ];
    for (const row of rows) await insert(row);
    const stored = await db
      .select({
        name: serviceSteps.name,
        start: serviceSteps.start,
        courseId: serviceSteps.courseId,
        minutes: serviceSteps.minutes,
      })
      .from(serviceSteps)
      .where(eq(serviceSteps.departmentId, departmentId))
      .orderBy(asc(serviceSteps.position));
    expect(stored).toEqual([
      { name: "Set up", start: "seated", courseId: null, minutes: 0 },
      { name: "Take order", start: "after_previous", courseId: null, minutes: 2 },
      { name: "Dessert?", start: "course_served", courseId, minutes: 10 },
      { name: "Anything else?", start: "all_served", courseId: null, minutes: 120 },
      { name: "Check in", start: "since_last_order", courseId: null, minutes: 1 },
    ]);
  });

  it("refuses a course start with no course and another start with one", async () => {
    await refused(
      step({ start: "course_served", courseId: null }),
      CHECK_VIOLATION,
      "service_steps_course_ck",
    );
    await refused(step({ start: "seated", courseId }), CHECK_VIOLATION, "service_steps_course_ck");
  });

  it("refuses minutes past 120, and 0 for a repeating start", async () => {
    await refused(
      step({ start: "all_served", minutes: 121 }),
      CHECK_VIOLATION,
      "service_steps_minutes_ck",
    );
    await refused(
      step({ start: "seated", minutes: -1 }),
      CHECK_VIOLATION,
      "service_steps_minutes_ck",
    );
    await refused(
      step({ start: "since_last_order", minutes: 0 }),
      CHECK_VIOLATION,
      "service_steps_minutes_ck",
    );
  });

  it("refuses a start that is not one of the five", async () => {
    await refused(
      step({ start: "later" as Step["start"] }),
      CHECK_VIOLATION,
      "service_steps_start_ck",
    );
  });

  it("refuses a step naming no department or no course", async () => {
    await refused(
      step({ departmentId: randomUUID() }),
      FOREIGN_KEY_VIOLATION,
      "FOREIGN KEY constraint failed",
    );
    await refused(
      step({ start: "course_served", courseId: randomUUID() }),
      FOREIGN_KEY_VIOLATION,
      "FOREIGN KEY constraint failed",
    );
  });
});
