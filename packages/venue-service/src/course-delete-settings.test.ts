import { asc, eq } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  departments,
  kitchenCourses,
  serviceSteps,
  venueLocationId,
  withTransaction,
  type Database,
  type ServiceStepStart,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import {
  clearCourseDeleteSettings as clear,
  courseDeleteSettingsRemoves,
  readCourseDeleteSettings as read,
} from "./index.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(db, fn);

const readCourseDeleteSettings = async (tx: Transaction, courseId: string) =>
  courseDeleteSettingsRemoves(await read(tx, courseId));
const clearCourseDeleteSettings = async (tx: Transaction, courseId: string) =>
  clear(tx, await read(tx, courseId));

type Step = [name: string, start: ServiceStepStart, minutes?: number, course?: "dessert"];

async function venue(name: string) {
  await seedVenue(db, { name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" });
  const cfg: { locationId: string } = { locationId: await venueLocationId(db) };
  const [dessert] = await db
    .insert(kitchenCourses)
    .values({ ...cfg, name: "Dessert", displayOrder: 1 })
    .returning({ id: kitchenCourses.id });
  return { cfg, courseId: dessert!.id };
}

async function department(
  cfg: { locationId: string },
  courseId: string,
  name: string,
  steps: Step[],
) {
  const [row] = await db
    .insert(departments)
    .values({ ...cfg, name, tradingName: name })
    .returning({ id: departments.id });
  for (const [position, [stepName, start, minutes = 0, course]] of steps.entries())
    await db.insert(serviceSteps).values({
      departmentId: row!.id,
      position,
      name: stepName,
      start,
      minutes,
      courseId: course === "dessert" ? courseId : null,
    });
  return row!.id;
}

const stepsOf = (departmentId: string) =>
  db
    .select({ name: serviceSteps.name, start: serviceSteps.start, minutes: serviceSteps.minutes })
    .from(serviceSteps)
    .where(eq(serviceSteps.departmentId, departmentId))
    .orderBy(asc(serviceSteps.position), asc(serviceSteps.id));

it("counts the steps that start when the course is served, in every department", async () => {
  const { cfg, courseId } = await venue("Counting");
  await department(cfg, courseId, "Dining", [
    ["Set up", "seated"],
    ["Dessert?", "course_served", 10, "dessert"],
  ]);
  await department(cfg, courseId, "Terrace", [
    ["Set up", "seated"],
    ["Dessert?", "course_served", 5, "dessert"],
  ]);
  expect(await run((tx) => readCourseDeleteSettings(tx, courseId))).toEqual([
    { key: "course_service_steps", count: 2, targets: [] },
  ]);
});

it("reports nothing when no step names it", async () => {
  const { cfg, courseId } = await venue("Nothing");
  await department(cfg, courseId, "Dining", [["Set up", "seated"]]);
  expect(await run((tx) => readCourseDeleteSettings(tx, courseId))).toEqual([]);
});

it("clears them and leaves other steps", async () => {
  const { cfg, courseId } = await venue("Clearing");
  const dining = await department(cfg, courseId, "Dining", [
    ["Set up", "seated"],
    ["Dessert?", "course_served", 10, "dessert"],
    ["Anything else?", "all_served", 10],
  ]);
  await run((tx) => clearCourseDeleteSettings(tx, courseId));
  expect(await stepsOf(dining)).toEqual([
    { name: "Set up", start: "seated", minutes: 0 },
    { name: "Anything else?", start: "all_served", minutes: 10 },
  ]);
  expect(await run((tx) => readCourseDeleteSettings(tx, courseId))).toEqual([]);
});

it("a step left first that started after the step before now starts When seated, its minutes kept", async () => {
  const { cfg, courseId } = await venue("Promoting");
  const dining = await department(cfg, courseId, "Dining", [
    ["Dessert?", "course_served", 10, "dessert"],
    ["Coffee", "after_previous", 5],
  ]);
  expect(await run((tx) => readCourseDeleteSettings(tx, courseId))).toEqual([
    { key: "course_service_steps", count: 1, targets: [] },
    { key: "course_seated_steps", count: 1, targets: [] },
  ]);
  await run((tx) => clearCourseDeleteSettings(tx, courseId));
  expect(await stepsOf(dining)).toEqual([{ name: "Coffee", start: "seated", minutes: 5 }]);
});

it("every step tied at the lowest remaining position that starts after the step before now starts When seated", async () => {
  const { cfg, courseId } = await venue("Ties");
  const [row] = await db
    .insert(departments)
    .values({ ...cfg, name: "Dining", tradingName: "Dining" })
    .returning({ id: departments.id });
  const dining = row!.id;
  await db.insert(serviceSteps).values([
    {
      departmentId: dining,
      position: 0,
      name: "Dessert?",
      start: "course_served",
      courseId,
      minutes: 10,
    },
    { departmentId: dining, position: 1, name: "Coffee", start: "after_previous", minutes: 5 },
    { departmentId: dining, position: 1, name: "Tea", start: "after_previous", minutes: 3 },
    { departmentId: dining, position: 2, name: "Bill", start: "after_previous", minutes: 2 },
  ]);
  expect(await run((tx) => readCourseDeleteSettings(tx, courseId))).toEqual([
    { key: "course_service_steps", count: 1, targets: [] },
    { key: "course_seated_steps", count: 2, targets: [] },
  ]);
  await run((tx) => clearCourseDeleteSettings(tx, courseId));
  expect((await stepsOf(dining)).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
    { name: "Bill", start: "after_previous", minutes: 2 },
    { name: "Coffee", start: "seated", minutes: 5 },
    { name: "Tea", start: "seated", minutes: 3 },
  ]);
});

it("a step that stays below another keeps After the step before", async () => {
  const { cfg, courseId } = await venue("Below");
  const dining = await department(cfg, courseId, "Dining", [
    ["Set up", "seated"],
    ["Dessert?", "course_served", 10, "dessert"],
    ["Coffee", "after_previous", 5],
  ]);
  expect(await run((tx) => readCourseDeleteSettings(tx, courseId))).toEqual([
    { key: "course_service_steps", count: 1, targets: [] },
  ]);
  await run((tx) => clearCourseDeleteSettings(tx, courseId));
  expect(await stepsOf(dining)).toEqual([
    { name: "Set up", start: "seated", minutes: 0 },
    { name: "Coffee", start: "after_previous", minutes: 5 },
  ]);
});

it("a first step that does not start after the step before is left as it is", async () => {
  const { cfg, courseId } = await venue("Left alone");
  const dining = await department(cfg, courseId, "Dining", [
    ["Dessert?", "course_served", 10, "dessert"],
    ["Anything else?", "all_served", 10],
  ]);
  expect(await run((tx) => readCourseDeleteSettings(tx, courseId))).toEqual([
    { key: "course_service_steps", count: 1, targets: [] },
  ]);
  await run((tx) => clearCourseDeleteSettings(tx, courseId));
  expect(await stepsOf(dining)).toEqual([
    { name: "Anything else?", start: "all_served", minutes: 10 },
  ]);
});
