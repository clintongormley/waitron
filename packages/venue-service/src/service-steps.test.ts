import { seedPerson } from "@waitron/db/testing/seed.js";
import { seedBusinessDay } from "@waitron/db/testing/seed.js";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  captureError,
  departments,
  kitchenCourses,
  parties,
  serviceStepCompletions,
  serviceSteps,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createDepartment } from "./operations.js";
import { clearServiceDeleteSettings } from "./service-delete-settings.js";
import { listServiceSteps, listStepCourses, saveServiceSteps } from "./service-steps.js";
import { STARTER_STEP_NAMES } from "./starter-content.js";

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

async function seedVenueCfg(
  name: string,
  invoiceLocales: string[] = ["en-GB"],
  options: { taxpayer?: boolean; province?: string } = {},
): Promise<void> {
  const venue = {
    name,
    invoiceLocales,
    province: options.province ?? null,
    operationDescription: "Hospitality",
  };
  if (options.taxpayer === true) await seedVenue(db, venue);
  else {
    const { name, province, invoiceLocales, operationDescription } = venue;
    await seedVenueSettings(db, { name, province, invoiceLocales, operationDescription });
    await seedBusinessDay(db);
  }
}

async function seedCourse(name: string, displayOrder: number, active = true): Promise<string> {
  const [row] = await db
    .insert(kitchenCourses)
    .values({ name, displayOrder, active })
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
    { start: "after_step", minutes: 2 },
  ].map((step, index) => ({
    id: expect.any(String),
    departmentId,
    name: names[index],
    courseId: null,
    afterStepId: index === 1 ? expect.any(String) : null,
    ...step,
  }));
}

const spanishSteps = [STARTER_STEP_NAMES["Set up"].es, STARTER_STEP_NAMES["Take order"].es];

describe("a new department's starter steps", () => {
  it.each([
    {
      title:
        "a department created in an English venue starts with Set up and Take order without preset links",
      locales: ["en"],
      names: ["Set up", "Take order"],
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
      names: ["Set up", "Take order"],
    },
    {
      title:
        "a Spanish venue whose first receipt language the screens lack starts with its staff language's names",
      locales: ["fr"],
      venue: { taxpayer: true },
      names: spanishSteps,
    },
    {
      title: "a Spanish venue with en-US receipts starts with its staff language's names",
      locales: ["en-US"],
      venue: { taxpayer: true },
      names: spanishSteps,
    },
    {
      title: "a Barcelona venue with ca-ES receipts starts with its staff language's names",
      locales: ["ca-ES"],
      venue: { taxpayer: true, province: "Barcelona" },
      names: spanishSteps,
    },
  ] as const)("$title", async ({ locales, names, ...row }) => {
    const venue = "venue" in row ? row.venue : {};
    await seedVenueCfg(`Starter ${locales.join(" ")}`, [...locales], venue);
    const department = await scoped((tx) =>
      createDepartment(tx, { name: "Dining", orderStart: "table" }),
    );
    expect(await scoped((tx) => listServiceSteps(tx))).toEqual(
      starterSteps(department.id, [...names]),
    );
  });
  it.each(["both", "missing mains", "missing desserts", "inactive desserts"])(
    "new departments reuse renamed preset links: %s",
    async (availability) => {
      await seedVenueCfg("Linked venue");
      const courses = await db
        .insert(kitchenCourses)
        .values([
          { name: "House hot food", starterKey: availability === "missing mains" ? null : "mains" },
          {
            name: "House sweets",
            starterKey: availability === "missing desserts" ? null : "desserts",
            active: availability !== "inactive desserts",
          },
          { name: "Mains" },
          { name: "Desserts" },
        ])
        .returning({ id: kitchenCourses.id });
      const department = await scoped((tx) => createDepartment(tx, { name: "Dining" }));
      const steps = await departmentRows(department.id);
      expect(
        steps.map(({ name, start, minutes, courseId, afterStepId }) => ({
          name,
          start,
          minutes,
          courseId,
          afterStepId,
        })),
      ).toEqual([
        { name: "Set up", start: "seated", minutes: 0, courseId: null, afterStepId: null },
        {
          name: "Take order",
          start: "after_step",
          minutes: 2,
          courseId: null,
          afterStepId: steps[0]!.id,
        },
        ...(availability === "both"
          ? [
              {
                name: "Dessert?",
                start: "course_served",
                minutes: 5,
                courseId: courses[0]!.id,
                afterStepId: null,
              },
              {
                name: "Coffee or bill?",
                start: "course_served",
                minutes: 5,
                courseId: courses[1]!.id,
                afterStepId: null,
              },
            ]
          : []),
      ]);
    },
  );
});

describe("service steps", () => {
  it("lists each active department's steps in order, and none of a deleted department", async () => {
    await seedVenueCfg("Listing steps");
    const { dining, bar, gone } = await scoped(async (tx) => ({
      dining: await createDepartment(tx, { name: "Dining", orderStart: "table" }),
      bar: await createDepartment(tx, { name: "Bar", orderStart: "counter" }),
      gone: await createDepartment(tx, { name: "Gone", orderStart: "table" }),
    }));
    await scoped(async (tx) => {
      await saveServiceSteps(tx, dining.id, [
        { key: "parent", name: "Set up", start: "seated", courseId: null, minutes: 0 },
        {
          name: "Take order",
          start: "after_step",
          afterStepKey: "parent",
          courseId: null,
          minutes: 2,
        },
      ]);
      await saveServiceSteps(tx, bar.id, [
        { name: "Check in", start: "seated", courseId: null, minutes: 5 },
      ]);
      await saveServiceSteps(tx, gone.id, [
        { name: "Gone step", start: "seated", courseId: null, minutes: 0 },
      ]);
      await tx.update(departments).set({ active: false }).where(eq(departments.id, gone.id));
    });
    const listed = await scoped((tx) => listServiceSteps(tx));
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
      start: "after_step",
      afterStepId: expect.any(String),
      courseId: null,
      minutes: 2,
    });
  });

  it("lists the venue's live courses in firing order", async () => {
    await seedVenueCfg("Listing courses");
    const mains = await seedCourse("Mains", 2);
    const starters = await seedCourse("Starters", 1);
    await seedCourse("Retired", 0, false);
    expect(await scoped((tx) => listStepCourses(tx))).toEqual([
      { id: starters, name: "Starters" },
      { id: mains, name: "Mains" },
    ]);
  });

  it("keeps a renamed or moved step's id, deletes one not sent, and gives a new one an id", async () => {
    await seedVenueCfg("Change set");
    const mains = await seedCourse("Mains", 1);
    const department = await scoped((tx) =>
      createDepartment(tx, { name: "Dining", orderStart: "table" }),
    );
    await scoped((tx) =>
      saveServiceSteps(tx, department.id, [
        { key: "parent", name: "Set up", start: "seated", courseId: null, minutes: 0 },
        {
          name: "Take order",
          start: "after_step",
          afterStepKey: "parent",
          courseId: null,
          minutes: 2,
        },
        { name: "Dessert?", start: "course_served", courseId: mains, minutes: 10 },
      ]),
    );
    const first = await departmentRows(department.id);
    const [setUp, takeOrder, dessert] = first;
    await scoped((tx) =>
      saveServiceSteps(tx, department.id, [
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
    await seedVenueCfg("Foreign step");
    const { dining, bar } = await scoped(async (tx) => ({
      dining: await createDepartment(tx, { name: "Dining", orderStart: "table" }),
      bar: await createDepartment(tx, { name: "Bar", orderStart: "counter" }),
    }));
    await scoped(async (tx) => {
      await saveServiceSteps(tx, dining.id, [
        { key: "parent", name: "Set up", start: "seated", courseId: null, minutes: 0 },
      ]);
      await saveServiceSteps(tx, bar.id, [
        { name: "Check in", start: "seated", courseId: null, minutes: 0 },
      ]);
    });
    const [barStep] = await departmentRows(bar.id);
    const before = await departmentRows(dining.id);
    const error = await captureError(() =>
      scoped((tx) =>
        saveServiceSteps(tx, dining.id, [
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
      await seedVenueCfg(`Bad course ${kind}`);
      const courseId = kind === "inactive" ? await seedCourse("Retired", 0, false) : randomUUID();
      const department = await scoped((tx) =>
        createDepartment(tx, { name: "Dining", orderStart: "table" }),
      );
      await scoped((tx) =>
        saveServiceSteps(tx, department.id, [
          { key: "parent", name: "Set up", start: "seated", courseId: null, minutes: 0 },
        ]),
      );
      const before = await departmentRows(department.id);
      const error = await captureError(() =>
        scoped((tx) =>
          saveServiceSteps(tx, department.id, [
            { name: "Dessert?", start: "course_served", courseId, minutes: 10 },
          ]),
        ),
      );
      expect(error).toMatchObject({ code: "course.not_found", params: { courseId } });
      expect(await departmentRows(department.id)).toEqual(before);
    },
  );

  it("an empty list deletes the department's steps", async () => {
    await seedVenueCfg("Empty list");
    const department = await scoped((tx) =>
      createDepartment(tx, { name: "Dining", orderStart: "table" }),
    );
    await scoped((tx) =>
      saveServiceSteps(tx, department.id, [
        { key: "parent", name: "Set up", start: "seated", courseId: null, minutes: 0 },
        {
          name: "Take order",
          start: "after_step",
          afterStepKey: "parent",
          courseId: null,
          minutes: 2,
        },
      ]),
    );
    await scoped((tx) => saveServiceSteps(tx, department.id, []));
    expect(await departmentRows(department.id)).toEqual([]);
  });
});

describe("a step's completions", () => {
  async function doneOnEach(stepIds: string[]): Promise<string> {
    return scoped(async (tx) => {
      for (const id of ["sender", "waiter-1"]) await seedPerson(tx, { id, displayName: id });
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
    await seedVenueCfg("Completions on save");
    const department = await scoped((tx) =>
      createDepartment(tx, { name: "Dining", orderStart: "table" }),
    );
    await scoped((tx) =>
      saveServiceSteps(tx, department.id, [
        { key: "parent", name: "Set up", start: "seated", courseId: null, minutes: 0 },
        {
          name: "Take order",
          start: "after_step",
          afterStepKey: "parent",
          courseId: null,
          minutes: 2,
        },
      ]),
    );
    const [setUp, takeOrder] = await departmentRows(department.id);
    const partyId = await doneOnEach([setUp!.id, takeOrder!.id]);
    await scoped((tx) =>
      saveServiceSteps(tx, department.id, [
        { id: setUp!.id, name: "Lay the table", start: "seated", courseId: null, minutes: 0 },
      ]),
    );
    expect(await completedSteps(partyId)).toEqual([setUp!.id]);
  });

  it("a department delete takes its steps' completions", async () => {
    await seedVenueCfg("Completions on delete");
    const { dining, bar } = await scoped(async (tx) => ({
      dining: await createDepartment(tx, { name: "Dining", orderStart: "table" }),
      bar: await createDepartment(tx, { name: "Bar", orderStart: "counter" }),
    }));
    const [diningStep] = await departmentRows(dining.id);
    const [barStep] = await departmentRows(bar.id);
    const partyId = await doneOnEach([diningStep!.id, barStep!.id]);
    await scoped((tx) => clearServiceDeleteSettings(tx, [], dining.id));
    expect(await completedSteps(partyId)).toEqual([barStep!.id]);
  });
});

describe("named step starts", () => {
  it("resolves draft keys even when a child is submitted before its new parent", async () => {
    await seedVenueCfg("Named starts");
    const department = await scoped((tx) =>
      createDepartment(tx, { name: "Dining", orderStart: "table" }),
    );
    await scoped((tx) =>
      saveServiceSteps(tx, department.id, [
        {
          key: "order",
          name: "Order",
          start: "after_step",
          afterStepKey: "setup",
          courseId: null,
          minutes: 2,
        },
        { key: "setup", name: "Set up", start: "seated", courseId: null, minutes: 0 },
      ]),
    );
    const rows = await departmentRows(department.id);
    expect(rows.map(({ name, afterStepId }) => [name, afterStepId])).toEqual([
      ["Order", rows[1]!.id],
      ["Set up", null],
    ]);
    await scoped((tx) =>
      saveServiceSteps(tx, department.id, [
        {
          id: rows[0]!.id,
          name: "Order",
          start: "after_step",
          afterStepKey: "replacement",
          courseId: null,
          minutes: 2,
        },
        { key: "replacement", name: "Lay table", start: "seated", courseId: null, minutes: 0 },
      ]),
    );
    const replaced = await departmentRows(department.id);
    expect(replaced[0]!.id).toBe(rows[0]!.id);
    expect(replaced[0]!.afterStepId).toBe(replaced[1]!.id);
    expect(replaced.map((row) => row.id)).not.toContain(rows[1]!.id);
    await scoped((tx) => saveServiceSteps(tx, department.id, []));
    expect(await departmentRows(department.id)).toEqual([]);
  });

  it.each(["missing", "self", "cycle", "duplicate"])(
    "refuses %s request-local references before writing",
    async (kind) => {
      await seedVenueCfg("Invalid named starts");
      const department = await scoped((tx) =>
        createDepartment(tx, { name: "Dining", orderStart: "table" }),
      );
      const before = await departmentRows(department.id);
      const error = await captureError(() =>
        scoped((tx) =>
          saveServiceSteps(tx, department.id, [
            {
              key: "a",
              name: "A",
              start: "after_step",
              afterStepKey: kind === "self" ? "a" : kind === "missing" ? before[0]!.id : "b",
              courseId: null,
              minutes: 2,
            },
            {
              key: kind === "duplicate" ? "a" : "b",
              name: "B",
              start: kind === "cycle" ? "after_step" : "seated",
              afterStepKey: kind === "cycle" ? "a" : null,
              courseId: null,
              minutes: 0,
            },
          ]),
        ),
      );
      expect(error).toMatchObject({ code: "management.request_invalid" });
      expect(await departmentRows(department.id)).toEqual(before);
    },
  );
});
