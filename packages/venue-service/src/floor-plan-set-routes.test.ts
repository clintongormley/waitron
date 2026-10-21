import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  floorPlanSets,
  floorPlanTables,
  locations,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  persons,
  registerModulePermissions,
  startManagementSession,
} from "@waitron/identity";
import type { CoreServices, ModuleRouteContext } from "@waitron/module";
import { locationId as brandLocationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { saveMenuPeriod } from "./menu-timetable.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { createDepartment, createServiceZone } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { departmentFloorPlanSets } from "./schema/floor-plan-sets.js";
import { menuPeriods } from "./schema/menus.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
  ],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const BASE = "/management-api/venue-service/floor-plan-sets";
const noopLog: Logger = () => {};

/** Core's two ports as the route sees them: sets are real rows, layouts are what the test says. */
function fakeCore(locationId: string) {
  const counts = new Map<string, { onPlan: number; spare: number }>();
  const showing = new Map<string, string[]>();
  const copies: [string, string][] = [];
  const removed: string[][] = [];
  const asked: string[][] = [];
  const floorPlanSetsPort: CoreServices["floorPlanSets"] = {
    async create(tx) {
      const [row] = await tx
        .insert(floorPlanSets)
        .values({ locationId })
        .returning({ id: floorPlanSets.id });
      return row!.id;
    },
    async copyLayouts(_tx, fromSetId, toSetId) {
      copies.push([fromSetId, toSetId]);
    },
    async readLayouts(tx, zoneIds, pairs) {
      asked.push(pairs.map(({ setId, zoneId }) => `${setId}:${zoneId}`));
      const tables =
        zoneIds.length === 0
          ? []
          : await tx
              .select({ zoneId: floorPlanTables.zoneId })
              .from(floorPlanTables)
              .where(inArray(floorPlanTables.zoneId, [...zoneIds]));
      const tableCounts = new Map(
        zoneIds.map((zoneId) => [zoneId, tables.filter((t) => t.zoneId === zoneId).length]),
      );
      return {
        tableCounts,
        layouts: pairs.map(({ setId, zoneId }) => ({
          setId,
          zoneId,
          revision: 0,
          ...(counts.get(`${setId}:${zoneId}`) ?? {
            onPlan: 0,
            spare: tableCounts.get(zoneId)!,
          }),
        })),
      };
    },
    async zonesShowing(_tx, setId) {
      return showing.get(setId) ?? [];
    },
  };
  const floorDeletion: CoreServices["floorDeletion"] = {
    readImpact: () => Promise.reject(new Error("unused")),
    clear: () => Promise.reject(new Error("unused")),
    async removeSets(tx, setIds) {
      removed.push([...setIds]);
      if (setIds.length > 0)
        await tx.delete(floorPlanSets).where(inArray(floorPlanSets.id, [...setIds]));
    },
  };
  return {
    counts,
    showing,
    copies,
    removed,
    asked,
    core: { floorPlanSets: floorPlanSetsPort, floorDeletion },
  };
}

async function casaMarina() {
  const [location] = await db
    .insert(locations)
    .values({
      name: `Casa Marina ${randomUUID()}`,
      invoiceLocales: ["es-ES"],
      operationDescription: "Hostelería",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    })
    .returning({ id: locations.id });
  const locationId = brandLocationId(location!.id);
  const cfg = { locationId };
  const fake = fakeCore(locationId);
  const app = new Hono();
  VENUE_SERVICE_ROUTES.mount(
    app,
    { db, cfg, core: fake.core as unknown as ModuleRouteContext["core"] },
    noopLog,
  );
  const made = await withTransaction(db, async (tx) => {
    const restaurant = (
      await createDepartment(tx, cfg, { name: "Restaurant", orderStart: "table" })
    ).id;
    const bar = (await createDepartment(tx, cfg, { name: "Bar", orderStart: "table" })).id;
    const deli = (await createDepartment(tx, cfg, { name: "Deli", orderStart: "counter" })).id;
    const terrace = (
      await createServiceZone(tx, cfg, {
        name: "Terrace",
        departmentId: restaurant,
        displayOrder: 2,
      })
    ).id;
    const inside = (
      await createServiceZone(tx, cfg, {
        name: "Inside",
        departmentId: restaurant,
        displayOrder: 1,
      })
    ).id;
    const counter = (
      await createServiceZone(tx, cfg, { name: "Counter", departmentId: bar, displayOrder: 0 })
    ).id;
    for (const [zoneId, labels] of [
      [inside, ["1", "2", "3"]],
      [terrace, ["T1", "T2"]],
      [counter, ["B1"]],
    ] as const)
      for (const label of labels) await tx.insert(floorPlanTables).values({ zoneId, label });
    const menu = (await createCatalogue(tx, { name: "Carta" })).id;
    const { document } = await buildMenuDocument(tx, menu);
    await publishMenu(tx, menu, menuDocumentHash(document), "person-1");
    const period = async (name: string, colour: "grey" | "blue") =>
      (await saveMenuPeriod(tx, cfg, restaurant, { name, menuId: menu, staffMenuIds: [], colour }))
        .id;
    const lunch = await period("Lunch", "grey");
    const dinner = await period("Dinner", "blue");
    const person = async (role: "manager" | "supervisor") => {
      const [row] = await tx
        .insert(persons)
        .values({ displayName: `${role} ${randomUUID()}`, pinHash: hashPin("1234"), role })
        .returning({ id: persons.id });
      return `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: row!.id })).token}`;
    };
    return {
      restaurant,
      bar,
      deli,
      inside,
      terrace,
      counter,
      lunch,
      dinner,
      manager: await person("manager"),
      supervisor: await person("supervisor"),
    };
  });
  const send = (
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    cookie = made.manager,
  ) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const add = async (departmentId: string, name: string, fromSetId?: string) => {
    const res = await send("POST", "", {
      departmentId,
      name,
      ...(fromSetId === undefined ? {} : { fromSetId }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { setId: string }).setId;
  };
  const standard = await add(made.restaurant, "Standard");
  const dinnerSet = await add(made.restaurant, "Dinner", standard);
  const privateParty = await add(made.restaurant, "Private party", standard);
  const barStandard = await add(made.bar, "Standard");
  await db
    .update(menuPeriods)
    .set({ floorPlanSetId: dinnerSet })
    .where(eq(menuPeriods.id, made.dinner));
  return { ...made, ...fake, cfg, send, standard, dinnerSet, privateParty, barStandard };
}
type Venue = Awaited<ReturnType<typeof casaMarina>>;

async function refusal(res: Response) {
  return {
    status: res.status,
    ...((await res.json()) as { error: { code: string; params: unknown } }).error,
  };
}

async function model(v: Venue, cookie = v.manager) {
  const res = await v.send("GET", "", undefined, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    departments: {
      id: string;
      name: string;
      zones: unknown[];
      sets: {
        id: string;
        name: string;
        isDefault: boolean;
        usedBy: unknown[];
        layouts: unknown[];
      }[];
    }[];
  };
}

const periodSet = async (periodId: string) =>
  (
    await db
      .select({ setId: menuPeriods.floorPlanSetId })
      .from(menuPeriods)
      .where(eq(menuPeriods.id, periodId))
  )[0]!.setId;

const linkOf = async (setId: string) =>
  db.select().from(departmentFloorPlanSets).where(eq(departmentFloorPlanSets.setId, setId));

describe("the floor plan sets model", () => {
  it("lists a department's default first, its zones, and the periods each set serves", async () => {
    const v = await casaMarina();
    v.counts.set(`${v.dinnerSet}:${v.inside}`, { onPlan: 2, spare: 1 });
    const read = await model(v);
    expect(read.departments.find((d) => d.id === v.restaurant)).toEqual({
      id: v.restaurant,
      name: "Restaurant",
      zones: [
        { id: v.inside, name: "Inside", tableCount: 3 },
        { id: v.terrace, name: "Terrace", tableCount: 2 },
      ],
      sets: [
        {
          id: v.standard,
          name: "Standard",
          isDefault: true,
          usedBy: [{ id: v.lunch, name: "Lunch", colour: "grey" }],
          layouts: [
            { zoneId: v.inside, onPlan: 0, spare: 3 },
            { zoneId: v.terrace, onPlan: 0, spare: 2 },
          ],
        },
        {
          id: v.dinnerSet,
          name: "Dinner",
          isDefault: false,
          usedBy: [{ id: v.dinner, name: "Dinner", colour: "blue" }],
          layouts: [
            { zoneId: v.inside, onPlan: 2, spare: 1 },
            { zoneId: v.terrace, onPlan: 0, spare: 2 },
          ],
        },
        {
          id: v.privateParty,
          name: "Private party",
          isDefault: false,
          usedBy: [],
          layouts: [
            { zoneId: v.inside, onPlan: 0, spare: 3 },
            { zoneId: v.terrace, onPlan: 0, spare: 2 },
          ],
        },
      ],
    });
    expect(read.departments.find((d) => d.id === v.deli)).toEqual({
      id: v.deli,
      name: "Deli",
      zones: [],
      sets: [],
    });
    expect(read.departments.find((d) => d.id === v.bar)!.sets.map((s) => s.id)).toEqual([
      v.barStandard,
    ]);
  });

  it("asks core for each set's layouts of its own department's zones only", async () => {
    const v = await casaMarina();
    v.asked.length = 0;
    await model(v);
    expect(v.asked).toHaveLength(1);
    expect([...v.asked[0]!].sort()).toEqual(
      [
        ...[v.standard, v.dinnerSet, v.privateParty].flatMap((setId) =>
          [v.inside, v.terrace].map((zoneId) => `${setId}:${zoneId}`),
        ),
        `${v.barStandard}:${v.counter}`,
      ].sort(),
    );
  });
});

describe("adding a set", () => {
  it("copies the named set's layouts into a later set", async () => {
    const v = await casaMarina();
    expect(v.copies).toEqual([
      [v.standard, v.dinnerSet],
      [v.standard, v.privateParty],
    ]);
  });

  it("refuses a copy source on a department's first set", async () => {
    const v = await casaMarina();
    const res = await v.send("POST", "", {
      departmentId: v.deli,
      name: "Standard",
      fromSetId: v.standard,
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      code: "floor_plan_set.invalid",
      params: { field: "fromSetId" },
    });
  });

  it("refuses a later set without a copy source", async () => {
    const v = await casaMarina();
    const res = await v.send("POST", "", { departmentId: v.restaurant, name: "Brunch" });
    expect(await refusal(res)).toEqual({
      status: 400,
      code: "floor_plan_set.invalid",
      params: { field: "fromSetId" },
    });
  });

  it("refuses a copy source of another department", async () => {
    const v = await casaMarina();
    const res = await v.send("POST", "", {
      departmentId: v.restaurant,
      name: "Brunch",
      fromSetId: v.barStandard,
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      code: "floor_plan_set.invalid",
      params: { field: "fromSetId" },
    });
  });

  it("refuses a name the department already has, and a blank one", async () => {
    const v = await casaMarina();
    const taken = await v.send("POST", "", {
      departmentId: v.restaurant,
      name: "Dinner",
      fromSetId: v.standard,
    });
    expect(await refusal(taken)).toEqual({
      status: 409,
      code: "floor_plan_set.name_taken",
      params: { departmentId: v.restaurant, name: "Dinner" },
    });
    const blank = await v.send("POST", "", {
      departmentId: v.restaurant,
      name: "  ",
      fromSetId: v.standard,
    });
    expect(await refusal(blank)).toEqual({
      status: 400,
      code: "floor_plan_set.invalid",
      params: { field: "name" },
    });
  });

  it("refuses an unknown department", async () => {
    const v = await casaMarina();
    const res = await v.send("POST", "", { departmentId: randomUUID(), name: "Standard" });
    expect(await refusal(res)).toEqual({
      status: 400,
      code: "floor_plan_set.invalid",
      params: { field: "departmentId" },
    });
  });
});

describe("renaming, copying and the default", () => {
  it("renames a set, refusing another set's name and an unknown set", async () => {
    const v = await casaMarina();
    expect((await v.send("PATCH", `/${v.dinnerSet}`, { name: "Evening" })).status).toBe(204);
    expect((await linkOf(v.dinnerSet))[0]!.name).toBe("Evening");
    expect(await refusal(await v.send("PATCH", `/${v.dinnerSet}`, { name: "Standard" }))).toEqual({
      status: 409,
      code: "floor_plan_set.name_taken",
      params: { departmentId: v.restaurant, name: "Standard" },
    });
    const unknown = randomUUID();
    expect(await refusal(await v.send("PATCH", `/${unknown}`, { name: "Late" }))).toEqual({
      status: 404,
      code: "floor_plan_set.not_found",
      params: { setId: unknown },
    });
  });

  it("copies a set into a new set of its department", async () => {
    const v = await casaMarina();
    const res = await v.send("POST", `/${v.dinnerSet}/copy`, { name: "Late" });
    expect(res.status).toBe(201);
    const { setId } = (await res.json()) as { setId: string };
    expect(v.copies.at(-1)).toEqual([v.dinnerSet, setId]);
    expect(await linkOf(setId)).toEqual([
      { setId, departmentId: v.restaurant, name: "Late", isDefault: false },
    ]);
  });

  it("makes another set the default in one request", async () => {
    const v = await casaMarina();
    expect((await v.send("POST", `/${v.dinnerSet}/make-default`)).status).toBe(204);
    const sets = (await model(v)).departments.find((d) => d.id === v.restaurant)!.sets;
    expect(sets.map(({ name, isDefault }) => ({ name, isDefault }))).toEqual([
      { name: "Dinner", isDefault: true },
      { name: "Private party", isDefault: false },
      { name: "Standard", isDefault: false },
    ]);
  });
});

describe("deleting a set", () => {
  it("names nothing for a set no period or zone uses", async () => {
    const v = await casaMarina();
    const res = await v.send("GET", `/${v.privateParty}/delete-impact`);
    expect(await res.json()).toEqual({ periods: [], zonesShowing: [] });
  });

  it("names the periods that use it and the zones showing it", async () => {
    const v = await casaMarina();
    v.showing.set(v.dinnerSet, [v.inside]);
    const res = await v.send("GET", `/${v.dinnerSet}/delete-impact`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      periods: [{ id: v.dinner, name: "Dinner" }],
      zonesShowing: [{ id: v.inside, name: "Inside" }],
    });
  });

  it("refuses to delete the default", async () => {
    const v = await casaMarina();
    const res = await v.send("POST", `/${v.standard}/delete`, { replaceWith: null });
    expect(await refusal(res)).toEqual({
      status: 409,
      code: "floor_plan_set.is_default",
      params: { setId: v.standard },
    });
    expect(v.removed).toEqual([]);
  });

  it("empties its periods' field when replaced by the default", async () => {
    const v = await casaMarina();
    const res = await v.send("POST", `/${v.dinnerSet}/delete`, { replaceWith: null });
    expect(res.status).toBe(204);
    expect(await periodSet(v.dinner)).toBeNull();
    expect(await linkOf(v.dinnerSet)).toEqual([]);
    expect(v.removed).toEqual([[v.dinnerSet]]);
  });

  it("empties its periods' field when the default is named as the replacement", async () => {
    const v = await casaMarina();
    const res = await v.send("POST", `/${v.dinnerSet}/delete`, { replaceWith: v.standard });
    expect(res.status).toBe(204);
    expect(await periodSet(v.dinner)).toBeNull();
  });

  it("gives its periods the replacement set", async () => {
    const v = await casaMarina();
    const res = await v.send("POST", `/${v.dinnerSet}/delete`, { replaceWith: v.privateParty });
    expect(res.status).toBe(204);
    expect(await periodSet(v.dinner)).toBe(v.privateParty);
    expect(await linkOf(v.dinnerSet)).toEqual([]);
  });

  it("refuses a replacement of another department, or the set itself, and deletes nothing", async () => {
    const v = await casaMarina();
    for (const replaceWith of [v.barStandard, v.dinnerSet]) {
      const res = await v.send("POST", `/${v.dinnerSet}/delete`, { replaceWith });
      expect(await refusal(res)).toEqual({
        status: 400,
        code: "floor_plan_set.invalid",
        params: { field: "replaceWith" },
      });
    }
    expect(v.removed).toEqual([]);
    expect(await linkOf(v.dinnerSet)).toHaveLength(1);
    expect(await periodSet(v.dinner)).toBe(v.dinnerSet);
  });
});

describe("request shapes", () => {
  it("refuses a body key the route does not take", async () => {
    const v = await casaMarina();
    const res = await v.send("PATCH", `/${v.dinnerSet}`, { name: "Evening", isDefault: true });
    expect(await refusal(res)).toEqual({
      status: 400,
      code: "management.request_invalid",
      params: { field: "isDefault" },
    });
  });

  it("leaves the default alone when it is made the default again", async () => {
    const v = await casaMarina();
    expect((await v.send("POST", `/${v.standard}/make-default`)).status).toBe(204);
    expect((await linkOf(v.standard))[0]!.isDefault).toBe(true);
    expect((await linkOf(v.dinnerSet))[0]!.isDefault).toBe(false);
  });
});

describe("who may use the routes", () => {
  it("refuses a request with no session before reading its body", async () => {
    const v = await casaMarina();
    const res = await v.send("POST", "", { colour: "red" }, "");
    expect(await refusal(res)).toMatchObject({
      status: 401,
      code: "management_session.required",
    });
  });

  it("refuses a venue.view person's write before reading its body", async () => {
    const v = await casaMarina();
    for (const [method, path] of [
      ["POST", ""],
      ["PATCH", `/${v.dinnerSet}`],
      ["POST", `/${v.dinnerSet}/delete`],
      ["PATCH", "/not-a-uuid"],
    ] as const) {
      const res = await v.send(method, path, { colour: "red" }, v.supervisor);
      expect(await refusal(res)).toEqual({
        status: 403,
        code: "authorization.not_permitted",
        params: { permission: "venue.configure" },
      });
    }
  });

  it("lets a venue.view person read the model and refuses every write", async () => {
    const v = await casaMarina();
    expect((await model(v, v.supervisor)).departments.length).toBeGreaterThan(0);
    const writes: [method: "GET" | "POST" | "PATCH", path: string, body?: unknown][] = [
      ["POST", "", { departmentId: v.deli, name: "Standard" }],
      ["PATCH", `/${v.dinnerSet}`, { name: "Evening" }],
      ["POST", `/${v.dinnerSet}/copy`, { name: "Late" }],
      ["POST", `/${v.dinnerSet}/make-default`],
      ["POST", `/${v.dinnerSet}/delete`, { replaceWith: null }],
    ];
    for (const [method, path, body] of writes) {
      const res = await v.send(method, path, body, v.supervisor);
      expect(await refusal(res)).toEqual({
        status: 403,
        code: "authorization.not_permitted",
        params: { permission: "venue.configure" },
      });
    }
    expect(
      (await v.send("GET", `/${v.dinnerSet}/delete-impact`, undefined, v.supervisor)).status,
    ).toBe(200);
    expect(await linkOf(v.dinnerSet)).toHaveLength(1);
  });
});

describe("a period's floor plan choices", () => {
  const choices = async (v: Venue, cookie = v.manager) => {
    const res = await v.send("GET", "/period-choices", undefined, cookie);
    expect(res.status).toBe(200);
    return (await res.json()) as {
      departments: { id: string; sets: { id: string; name: string; isDefault: boolean }[] }[];
    };
  };

  it("lists each department with a zone holding a table, and its sets with the default first", async () => {
    const v = await casaMarina();
    const garden = await withTransaction(db, async (tx) => {
      const id = (await createDepartment(tx, v.cfg, { name: "Garden", orderStart: "table" })).id;
      await createServiceZone(tx, v.cfg, { name: "Lawn", departmentId: id });
      return id;
    });
    expect((await v.send("POST", "", { departmentId: garden, name: "Lawn" })).status).toBe(201);

    const read = await choices(v);

    expect(read.departments.map((d) => d.id).sort()).toEqual([v.restaurant, v.bar].sort());
    expect(read.departments.find((d) => d.id === v.restaurant)).toEqual({
      id: v.restaurant,
      sets: [
        { id: v.standard, name: "Standard", isDefault: true },
        { id: v.dinnerSet, name: "Dinner", isDefault: false },
        { id: v.privateParty, name: "Private party", isDefault: false },
      ],
    });
    expect(read.departments.find((d) => d.id === v.bar)).toEqual({
      id: v.bar,
      sets: [{ id: v.barStandard, name: "Standard", isDefault: true }],
    });
  });

  it("asks core for table counts and no layout, and lets a venue.view person read it", async () => {
    const v = await casaMarina();
    v.asked.length = 0;
    expect((await choices(v, v.supervisor)).departments.length).toBe(2);
    expect(v.asked).toEqual([[]]);
  });
});
