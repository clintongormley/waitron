import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  captureError,
  kitchenCourses,
  locations,
  parties,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId as brandLocationId, type LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment } from "./operations.js";
import { departments } from "./schema/service.js";
import { serviceStepCompletions, serviceSteps } from "./schema/service-steps.js";
import { clearServiceDeleteSettings } from "./service-delete-settings.js";
import {
  listServiceSteps,
  listStepCourses,
  saveServiceSteps,
  STARTER_STEPS,
} from "./service-steps.js";
import { STARTER_STEP_NAMES } from "./starter-content.js";

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

async function seedVenue(
  name: string,
  invoiceLocales: string[] = ["en-GB"],
  options: { tenant?: boolean; province?: string } = {},
): Promise<{ locationId: LocationId }> {
  if (options.tenant === true) await seedTenant(db);
  const [row] = await db
    .insert(locations)
    .values({
      name,
      invoiceLocales,
      province: options.province ?? null,
      operationDescription: "Hospitality",
    })
    .returning({ id: locations.id });
  return { locationId: brandLocationId(row!.id) };
}

async function seedCourse(
  cfg: { locationId: LocationId },
  name: string,
  displayOrder: number,
  active = true,
): Promise<string> {
  const [row] = await db
    .insert(kitchenCourses)
    .values({ locationId: cfg.locationId, name, displayOrder, active })
    .returning({ id: kitchenCourses.id });
  return row!.id;
}

async function departmentRows(departmentId: string) {
  return db
    .select()
    .from(serviceSteps)
    .where(eq(serviceSteps.departmentId, departmentId))
    .orderBy(asc(serviceSteps.position), asc(serviceSteps.id));
}

function starterSteps(departmentId: string, names: readonly string[]) {
  return [
    { start: "seated", minutes: 0 },
    { start: "after_previous", minutes: 2 },
    { start: "all_served", minutes: 10 },
  ].map((step, index) => ({
    id: expect.any(String),
    departmentId,
    name: names[index],
    courseId: null,
    ...step,
  }));
}

const spanishSteps = STARTER_STEPS.map((step) => STARTER_STEP_NAMES[step.name].es);

describe("a new department's starter steps", () => {
  it.each([
    {
      title:
        "a department created in an English venue starts with Set up, Take order and Anything else?",
      locales: ["en"],
      names: ["Set up", "Take order", "Anything else?"],
    },
    {
      title: "a department created in a Spanish venue starts with the file's Spanish names",
      locales: ["es-ES", "en-GB"],
      names: spanishSteps,
    },
    {
      title:
        "a venue with no country whose first receipt language the screens lack starts with the English names",
      locales: ["fr"],
      names: ["Set up", "Take order", "Anything else?"],
    },
    {
      title:
        "a Spanish venue whose first receipt language the screens lack starts with its staff language's names",
      locales: ["fr"],
      venue: { tenant: true },
      names: spanishSteps,
    },
    {
      title: "a Spanish venue with en-US receipts starts with its staff language's names",
      locales: ["en-US"],
      venue: { tenant: true },
      names: spanishSteps,
    },
    {
      title: "a Barcelona venue with ca-ES receipts starts with its staff language's names",
      locales: ["ca-ES"],
      venue: { tenant: true, province: "Barcelona" },
      names: spanishSteps,
    },
  ] as const)("$title", async ({ locales, names, ...row }) => {
    const venue = "venue" in row ? row.venue : {};
    const cfg = await seedVenue(`Starter ${locales.join(" ")}`, [...locales], venue);
    const department = await scoped((tx) =>
      createDepartment(tx, cfg, { name: "Dining", orderStart: "table" }),
    );
    expect(await scoped((tx) => listServiceSteps(tx, cfg))).toEqual(
      starterSteps(department.id, [...names]),
    );
  });
});

describe("service steps", () => {
  it("lists each active department's steps in order, and none of a deleted department", async () => {
    const cfg = await seedVenue("Listing steps");
    const { dining, bar, gone } = await scoped(async (tx) => ({
      dining: await createDepartment(tx, cfg, { name: "Dining", orderStart: "table" }),
      bar: await createDepartment(tx, cfg, { name: "Bar", orderStart: "counter" }),
      gone: await createDepartment(tx, cfg, { name: "Gone", orderStart: "table" }),
    }));
    await scoped(async (tx) => {
      await saveServiceSteps(tx, cfg, dining.id, [
        { name: "Set up", start: "seated", courseId: null, minutes: 0 },
        { name: "Take order", start: "after_previous", courseId: null, minutes: 2 },
      ]);
      await saveServiceSteps(tx, cfg, bar.id, [
        { name: "Check in", start: "seated", courseId: null, minutes: 5 },
      ]);
      await saveServiceSteps(tx, cfg, gone.id, [
        { name: "Gone step", start: "seated", courseId: null, minutes: 0 },
      ]);
      await tx.update(departments).set({ active: false }).where(eq(departments.id, gone.id));
    });
    const listed = await scoped((tx) => listServiceSteps(tx, cfg));
    const byDepartment = [dining.id, bar.id].sort();
    expect(listed.map((step) => [step.departmentId, step.name])).toEqual(
      byDepartment.flatMap((id) =>
        id === dining.id
          ? [
              [dining.id, "Set up"],
              [dining.id, "Take order"],
            ]
          : [[bar.id, "Check in"]],
      ),
    );
    expect(listed.find((step) => step.name === "Take order")).toEqual({
      id: expect.any(String),
      departmentId: dining.id,
      name: "Take order",
      start: "after_previous",
      courseId: null,
      minutes: 2,
    });
  });

  it("lists the venue's live courses in firing order", async () => {
    const cfg = await seedVenue("Listing courses");
    const mains = await seedCourse(cfg, "Mains", 2);
    const starters = await seedCourse(cfg, "Starters", 1);
    await seedCourse(cfg, "Retired", 0, false);
    expect(await scoped((tx) => listStepCourses(tx, cfg))).toEqual([
      { id: starters, name: "Starters" },
      { id: mains, name: "Mains" },
    ]);
  });

  it("keeps a renamed or moved step's id, deletes one not sent, and gives a new one an id", async () => {
    const cfg = await seedVenue("Change set");
    const mains = await seedCourse(cfg, "Mains", 1);
    const department = await scoped((tx) =>
      createDepartment(tx, cfg, { name: "Dining", orderStart: "table" }),
    );
    await scoped((tx) =>
      saveServiceSteps(tx, cfg, department.id, [
        { name: "Set up", start: "seated", courseId: null, minutes: 0 },
        { name: "Take order", start: "after_previous", courseId: null, minutes: 2 },
        { name: "Dessert?", start: "course_served", courseId: mains, minutes: 10 },
      ]),
    );
    const first = await departmentRows(department.id);
    const [setUp, takeOrder, dessert] = first;
    await scoped((tx) =>
      saveServiceSteps(tx, cfg, department.id, [
        { id: takeOrder!.id, name: "  Order  ", start: "seated", courseId: null, minutes: 3 },
        { id: dessert!.id, name: "Dessert?", start: "course_served", courseId: mains, minutes: 10 },
        { name: "Anything else?", start: "since_last_order", courseId: null, minutes: 20 },
      ]),
    );
    const second = await departmentRows(department.id);
    expect(second.map((row) => row.position)).toEqual([0, 1, 2]);
    expect(second.map((row) => row.id).slice(0, 2)).toEqual([takeOrder!.id, dessert!.id]);
    expect(second.map((row) => row.id)).not.toContain(setUp!.id);
    expect(second[2]!.id).not.toBe(setUp!.id);
    expect(
      second.map(({ name, start, courseId, minutes }) => [name, start, courseId, minutes]),
    ).toEqual([
      ["Order", "seated", null, 3],
      ["Dessert?", "course_served", mains, 10],
      ["Anything else?", "since_last_order", null, 20],
    ]);
  });

  it("refuses a step id of another department, naming it, and writes nothing", async () => {
    const cfg = await seedVenue("Foreign step");
    const { dining, bar } = await scoped(async (tx) => ({
      dining: await createDepartment(tx, cfg, { name: "Dining", orderStart: "table" }),
      bar: await createDepartment(tx, cfg, { name: "Bar", orderStart: "counter" }),
    }));
    await scoped(async (tx) => {
      await saveServiceSteps(tx, cfg, dining.id, [
        { name: "Set up", start: "seated", courseId: null, minutes: 0 },
      ]);
      await saveServiceSteps(tx, cfg, bar.id, [
        { name: "Check in", start: "seated", courseId: null, minutes: 0 },
      ]);
    });
    const [barStep] = await departmentRows(bar.id);
    const before = await departmentRows(dining.id);
    const error = await captureError(() =>
      scoped((tx) =>
        saveServiceSteps(tx, cfg, dining.id, [
          { name: "New", start: "seated", courseId: null, minutes: 0 },
          { id: barStep!.id, name: "Stolen", start: "seated", courseId: null, minutes: 0 },
        ]),
      ),
    );
    expect(error).toMatchObject({
      code: "service_step.not_found",
      params: { stepId: barStep!.id },
    });
    expect(await departmentRows(dining.id)).toEqual(before);
    expect(await departmentRows(bar.id)).toEqual([barStep]);
  });

  it.each(["inactive", "of no venue"] as const)(
    "refuses a course that is %s, naming it, and writes nothing",
    async (kind) => {
      const cfg = await seedVenue(`Bad course ${kind}`);
      const courseId =
        kind === "inactive" ? await seedCourse(cfg, "Retired", 0, false) : randomUUID();
      const department = await scoped((tx) =>
        createDepartment(tx, cfg, { name: "Dining", orderStart: "table" }),
      );
      await scoped((tx) =>
        saveServiceSteps(tx, cfg, department.id, [
          { name: "Set up", start: "seated", courseId: null, minutes: 0 },
        ]),
      );
      const before = await departmentRows(department.id);
      const error = await captureError(() =>
        scoped((tx) =>
          saveServiceSteps(tx, cfg, department.id, [
            { name: "Dessert?", start: "course_served", courseId, minutes: 10 },
          ]),
        ),
      );
      expect(error).toMatchObject({ code: "course.not_found", params: { courseId } });
      expect(await departmentRows(department.id)).toEqual(before);
    },
  );

  it("an empty list deletes the department's steps", async () => {
    const cfg = await seedVenue("Empty list");
    const department = await scoped((tx) =>
      createDepartment(tx, cfg, { name: "Dining", orderStart: "table" }),
    );
    await scoped((tx) =>
      saveServiceSteps(tx, cfg, department.id, [
        { name: "Set up", start: "seated", courseId: null, minutes: 0 },
        { name: "Take order", start: "after_previous", courseId: null, minutes: 2 },
      ]),
    );
    await scoped((tx) => saveServiceSteps(tx, cfg, department.id, []));
    expect(await departmentRows(department.id)).toEqual([]);
  });
});

describe("a step's completions", () => {
  async function doneOnEach(stepIds: string[]): Promise<string> {
    return scoped(async (tx) => {
      const [party] = await tx
        .insert(parties)
        .values({ openedBy: "sender" })
        .returning({ id: parties.id });
      await tx.insert(serviceStepCompletions).values(
        stepIds.map((stepId) => ({
          partyId: party!.id,
          stepId,
          doneAt: "2026-10-22T20:33:00.000Z",
          doneBy: "waiter-1",
        })),
      );
      return party!.id;
    });
  }

  const completedSteps = (partyId: string) =>
    db
      .select({ stepId: serviceStepCompletions.stepId })
      .from(serviceStepCompletions)
      .where(eq(serviceStepCompletions.partyId, partyId))
      .then((rows) => rows.map((row) => row.stepId));

  it("a department save keeps a renamed step's completions and drops a removed step's", async () => {
    const cfg = await seedVenue("Completions on save");
    const department = await scoped((tx) =>
      createDepartment(tx, cfg, { name: "Dining", orderStart: "table" }),
    );
    await scoped((tx) =>
      saveServiceSteps(tx, cfg, department.id, [
        { name: "Set up", start: "seated", courseId: null, minutes: 0 },
        { name: "Take order", start: "after_previous", courseId: null, minutes: 2 },
      ]),
    );
    const [setUp, takeOrder] = await departmentRows(department.id);
    const partyId = await doneOnEach([setUp!.id, takeOrder!.id]);
    await scoped((tx) =>
      saveServiceSteps(tx, cfg, department.id, [
        { id: setUp!.id, name: "Lay the table", start: "seated", courseId: null, minutes: 0 },
      ]),
    );
    expect(await completedSteps(partyId)).toEqual([setUp!.id]);
  });

  it("a department delete takes its steps' completions", async () => {
    const cfg = await seedVenue("Completions on delete");
    const { dining, bar } = await scoped(async (tx) => ({
      dining: await createDepartment(tx, cfg, { name: "Dining", orderStart: "table" }),
      bar: await createDepartment(tx, cfg, { name: "Bar", orderStart: "counter" }),
    }));
    const [diningStep] = await departmentRows(dining.id);
    const [barStep] = await departmentRows(bar.id);
    const partyId = await doneOnEach([diningStep!.id, barStep!.id]);
    await scoped((tx) => clearServiceDeleteSettings(tx, cfg, [], dining.id));
    expect(await completedSteps(partyId)).toEqual([barStep!.id]);
  });
});
