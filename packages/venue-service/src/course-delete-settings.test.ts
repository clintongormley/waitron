import { asc, eq } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  departments,
  kitchenCourses,
  serviceSteps,
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
  saveServiceSteps,
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

  const [dessert] = await db
    .insert(kitchenCourses)
    .values({ name: "Dessert", displayOrder: 1 })
    .returning({ id: kitchenCourses.id });
  return { courseId: dessert!.id };
}

async function department(courseId: string, name: string, steps: Step[]) {
  const [row] = await db
    .insert(departments)
    .values({ name, tradingName: name })
    .returning({ id: departments.id });
  await run((tx) =>
    saveServiceSteps(
      tx,
      row!.id,
      steps.map(([name, start, minutes = 0, course], index) => ({
        key: name,
        name,
        start,
        minutes,
        courseId: course === "dessert" ? courseId : null,
        afterStepKey: start === "after_step" ? steps[index - 1]![0] : null,
      })),
    ),
  );
  return row!.id;
}

const stepsOf = (departmentId: string) =>
  db
    .select({ name: serviceSteps.name, start: serviceSteps.start, minutes: serviceSteps.minutes })
    .from(serviceSteps)
    .where(eq(serviceSteps.departmentId, departmentId))
    .orderBy(asc(serviceSteps.position), asc(serviceSteps.id));

it("counts the steps that start when the course is served, in every department", async () => {
  const { courseId } = await venue("Counting");
  await department(courseId, "Dining", [
    ["Set up", "seated"],
    ["Dessert?", "course_served", 10, "dessert"],
  ]);
  await department(courseId, "Terrace", [
    ["Set up", "seated"],
    ["Dessert?", "course_served", 5, "dessert"],
  ]);
  expect(await run((tx) => readCourseDeleteSettings(tx, courseId))).toEqual([
    { key: "course_service_steps", count: 2, targets: [] },
  ]);
});

it("reports nothing when no step names it", async () => {
  const { courseId } = await venue("Nothing");
  await department(courseId, "Dining", [["Set up", "seated"]]);
  expect(await run((tx) => readCourseDeleteSettings(tx, courseId))).toEqual([]);
});

it("clears them and leaves other steps", async () => {
  const { courseId } = await venue("Clearing");
  const dining = await department(courseId, "Dining", [
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

it("deleting a course removes its named descendants regardless of their positions, keeping unrelated starts", async () => {
  const { courseId } = await venue("Descendants");
  const dining = await department(courseId, "Dining", [
    ["Set up", "seated"],
    ["Dessert?", "course_served", 10, "dessert"],
    ["Coffee", "after_step", 5],
    ["Bill", "after_step", 2],
    ["Water", "seated", 3],
  ]);
  expect(await run((tx) => readCourseDeleteSettings(tx, courseId))).toEqual([
    { key: "course_service_steps", count: 3, targets: [] },
  ]);
  await run((tx) => clearCourseDeleteSettings(tx, courseId));
  expect(await stepsOf(dining)).toEqual([
    { name: "Set up", start: "seated", minutes: 0 },
    { name: "Water", start: "seated", minutes: 3 },
  ]);
});

it("an unrelated Everything served start is left as it is", async () => {
  const { courseId } = await venue("Left alone");
  const dining = await department(courseId, "Dining", [
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
