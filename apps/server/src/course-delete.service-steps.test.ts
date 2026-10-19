import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { kitchenCourses, products, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createDepartment,
  saveServiceSteps,
  serviceSteps,
  type ServiceStepInput,
} from "@waitron/venue-service";
import { deleteCourse, readCourseDeleteImpact } from "./course-delete.js";
import { createCourse } from "./kitchen.js";
import { inTx, setupPartyVenue, seat, type PartyVenue } from "./testing/party-venue.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { buildConfigurationBundle, validateConfigurationBundle } from "./configuration-transfer.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

async function venueWithSteps(
  steps: (courseId: string) => ServiceStepInput[],
): Promise<{ v: PartyVenue; id: string; departmentId: string }> {
  const v = await setupPartyVenue(suite.db);
  const { id } = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Postres" }));
  const departmentId = await inTx(v, async (tx: Transaction) => {
    const department = await createDepartment(tx, v.cfg, { name: "Steps", orderStart: "table" });
    await saveServiceSteps(tx, v.cfg, department.id, steps(id));
    return department.id;
  });
  return { v, id, departmentId };
}

const step = (
  name: string,
  start: ServiceStepInput["start"],
  minutes = 0,
  courseId: string | null = null,
): ServiceStepInput => ({ name, start, minutes, courseId });

const stepsOf = (v: PartyVenue, departmentId: string) =>
  inTx(v, (tx) =>
    tx
      .select({ name: serviceSteps.name, start: serviceSteps.start, minutes: serviceSteps.minutes })
      .from(serviceSteps)
      .where(eq(serviceSteps.departmentId, departmentId))
      .orderBy(asc(serviceSteps.position), asc(serviceSteps.id)),
  );

const courseRows = (v: PartyVenue, id: string) =>
  inTx(v, (tx) =>
    tx
      .select({ id: kitchenCourses.id, active: kitchenCourses.active })
      .from(kitchenCourses)
      .where(eq(kitchenCourses.id, id)),
  );

describe("deleting a course with service steps", () => {
  it("deleting a course nothing names deletes the row outright", async () => {
    const v = await setupPartyVenue(suite.db);
    const { id } = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Unused" }));
    await inTx(v, (tx) => deleteCourse(tx, v.cfg, id));
    expect(await courseRows(v, id)).toEqual([]);
  });

  it("deleting a course only a step names deletes the step and keeps the course inactive, as a product default does", async () => {
    const { v, id, departmentId } = await venueWithSteps((course) => [
      step("Set up", "seated"),
      step("Dessert?", "course_served", 10, course),
      step("Anything else?", "all_served", 10),
    ]);
    await inTx(v, (tx) => deleteCourse(tx, v.cfg, id));
    expect(await stepsOf(v, departmentId)).toEqual([
      { name: "Set up", start: "seated", minutes: 0 },
      { name: "Anything else?", start: "all_served", minutes: 10 },
    ]);
    expect(await courseRows(v, id)).toEqual([{ id, active: false }]);
  });

  it("deleting a course an order still names keeps it inactive and still deletes its steps", async () => {
    const { v, id, departmentId } = await venueWithSteps((course) => [
      step("Set up", "seated"),
      step("Dessert?", "course_served", 10, course),
    ]);
    const { tabId } = await seat(v, await v.table("Reference"));
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, tabId, [{ menuItemId: v.item("Flan"), quantity: "1", courseId: id }]),
    );
    await inTx(v, (tx) => deleteCourse(tx, v.cfg, id));
    expect(await stepsOf(v, departmentId)).toEqual([
      { name: "Set up", start: "seated", minutes: 0 },
    ]);
    expect(await courseRows(v, id)).toEqual([{ id, active: false }]);
  });

  it("the delete impact lists the steps beside the product defaults", async () => {
    const { v, id } = await venueWithSteps((course) => [
      step("Set up", "seated"),
      step("Dessert?", "course_served", 10, course),
    ]);
    await inTx(v, (tx) =>
      tx
        .update(products)
        .set({ courseId: id })
        .where(eq(products.id, v.productId("Flan"))),
    );
    expect((await inTx(v, (tx) => readCourseDeleteImpact(tx, v.cfg, id))).removes).toEqual([
      { key: "course_products", count: 1, targets: [] },
      { key: "course_service_steps", count: 1, targets: [] },
    ]);
  });

  it("after the delete the venue's export still imports", async () => {
    const { v, id, departmentId } = await venueWithSteps((course) => [
      step("Dessert?", "course_served", 10, course),
      step("Coffee", "after_previous", 5),
    ]);
    expect((await inTx(v, (tx) => deleteCourse(tx, v.cfg, id))).removes).toEqual([
      { key: "course_service_steps", count: 1, targets: [] },
      { key: "course_seated_steps", count: 1, targets: [] },
    ]);
    expect(await stepsOf(v, departmentId)).toEqual([
      { name: "Coffee", start: "seated", minutes: 5 },
    ]);
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const bundle = await buildConfigurationBundle(
      suite.db,
      v.cfg,
      ALL_MODULES,
      new Date("2026-10-19T10:00:00Z"),
      versions,
    );
    expect(bundle.tables.service_steps).toContainEqual(
      expect.objectContaining({ name: "Coffee", start: "seated" }),
    );
    expect(() => validateConfigurationBundle(bundle, ALL_MODULES, versions)).not.toThrow();
  });
});
