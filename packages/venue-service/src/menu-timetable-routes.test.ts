import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildMenuDocument,
  createCatalogue,
  menuDocumentHash,
  publishMenu,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  settings as businessDaySettingsTable,
  floorZones,
  kitchenStations,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { hashPin, registerModulePermissions, startManagementSession } from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { readOpeningHoursModel, saveMenuPeriod } from "./menu-timetable.js";
import type { MenuSlot, OpeningHoursModel } from "./menu-timetable-types.js";
import { saveSpecialDay } from "./special-days.js";
import { addFloorPlanSet } from "./floor-plan-set-store.js";
import { configureZone, createDepartment } from "./operations.js";
import { VENUE_SERVICE_PERMISSIONS } from "./permissions.js";
import { VENUE_SERVICE_ROUTES } from "./routes.js";
import { ensureDefaultSeasons } from "./seasons.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const scoped = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(db, fn);
const BASE = "/management-api/venue-service";
const noopLog: Logger = () => {};

const isPeriodSave = (method: string, path: string) =>
  (method === "POST" && path.endsWith("/menu-periods")) ||
  (method === "PATCH" && path.startsWith("/menu-periods/"));

async function routed() {
  await seedVenue(db, {
    name: `House ${randomUUID()}`,
    invoiceLocales: ["es-ES"],
    operationDescription: "Hospitality",
    timeZone: "Europe/Madrid",
  });
  const fixtureId = randomUUID();
  const cfg = {};
  await db.insert(kitchenStations).values({ name: "Kitchen", isDefault: true });
  const zone = async (name: string, departmentId: string) =>
    (
      await db.insert(floorZones).values({ name, departmentId }).returning({ id: floorZones.id })
    )[0]!.id;
  let barZone: string;
  let counterZone: string;
  const made = await scoped(async (tx) => {
    await ensureDefaultSeasons(tx);
    const restaurant = (await createDepartment(tx, { name: "Restaurant", orderStart: "table" })).id;
    const deli = (await createDepartment(tx, { name: "Deli", orderStart: "counter" })).id;
    barZone = await zone("Bar", restaurant);
    counterZone = await zone("Deli counter", deli);
    await configureZone(tx, { zoneId: barZone, departmentId: restaurant });
    await configureZone(tx, { zoneId: counterZone, departmentId: deli });
    const menu = async (name: string) => {
      const id = (await createCatalogue(tx, { name: `${name} ${fixtureId}` })).id;
      const { document } = await buildMenuDocument(tx, id);
      await publishMenu(tx, id, menuDocumentHash(document), "person-1");
      return id;
    };
    const breakfastMenu = await menu("Breakfasts");
    const lunchMenu = await menu("Lunch");
    const coffeeMenu = await menu("Coffee");
    const takeawayMenu = await menu("Takeaway deli");
    const morningPeriod = (
      await saveMenuPeriod(tx, restaurant, {
        name: "Morning service",
        menuId: breakfastMenu,
        staffMenuIds: [],
      })
    ).id;
    const christmas = (
      await saveSpecialDay(
        tx,
        null,
        {
          name: "Christmas",
          repeatsYearly: false,
          dates: [{ date: "2030-12-25", closedAllDay: false }],
          paint: [],
        },
        new Date(),
        1,
      )
    ).id;
    const person = async (role: "manager" | "supervisor" | "staff") => {
      const [row] = await seedPersons(tx, {
        displayName: `${role} ${randomUUID()}`,
        pinHash: hashPin("1234"),
        role,
      });
      return `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: row!.id })).token}`;
    };
    return {
      restaurant,
      deli,
      breakfastMenu,
      lunchMenu,
      coffeeMenu,
      takeawayMenu,
      morningPeriod,
      christmas,
      manager: await person("manager"),
      supervisor: await person("supervisor"),
      staff: await person("staff"),
    };
  });
  const app = new Hono();
  VENUE_SERVICE_ROUTES.mount(app, { db, cfg: {}, core: {} as ModuleRouteContext["core"] }, noopLog);
  const send = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    cookie: string,
    body?: unknown,
  ) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined
        ? method === "DELETE" && path.startsWith("/special-dates/")
          ? { body: JSON.stringify({ expectedClockRevision: 1 }) }
          : {}
        : {
            body: JSON.stringify(
              body !== null && typeof body === "object" && !Array.isArray(body)
                ? {
                    ...(isPeriodSave(method, path) ? {} : { expectedClockRevision: 1 }),
                    ...body,
                  }
                : body,
            ),
          }),
    });
  const model = () => scoped((tx) => readOpeningHoursModel(tx, new Date()));
  const season = (await model()).currentSeasonId!;
  return { ...made, cfg, barZone: barZone!, counterZone: counterZone!, app, send, model, season };
}

type Routed = Awaited<ReturnType<typeof routed>>;
const restaurantOf = (model: OpeningHoursModel, r: Routed) =>
  model.departments.find((department) => department.id === r.restaurant)!;
const week = (slots: MenuSlot[]) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, slots: weekday === 1 ? slots : [] }));

async function answers(response: Response, status: number, error?: Record<string, unknown>) {
  expect(response.status).toBe(status);
  if (error !== undefined) expect(await response.json()).toEqual({ error });
}

describe("the opening-hours routes", () => {
  it("refuse an end offset on a period create or update, changing nothing", async () => {
    const r = await routed();
    const before = await r.model();
    for (const [method, path, body] of [
      [
        "POST",
        `/departments/${r.restaurant}/menu-periods`,
        { name: "Afternoons", menuId: r.coffeeMenu, staffMenuIds: [], endOffsetMinutes: 0 },
      ],
      ["PATCH", `/menu-periods/${r.morningPeriod}`, { name: "Afternoons", endOffsetMinutes: 0 }],
      ["PATCH", `/menu-periods/${r.morningPeriod}`, { endOffsetMinutes: 0 }],
    ] as const)
      await answers(await r.send(method, path, r.manager, body), 400, {
        code: "management.request_invalid",
        params: { field: "endOffsetMinutes" },
      });
    expect(await r.model()).toEqual(before);
  });

  it("show the model to anyone who may view the venue's settings", async () => {
    const r = await routed();
    const read = await r.send("GET", "/opening-hours", r.supervisor);
    expect(read.status).toBe(200);
    const body = (await read.json()) as OpeningHoursModel;
    expect(body).toEqual(JSON.parse(JSON.stringify(await r.model())));
    expect(restaurantOf(body, r).periods.map((period) => period.name)).toEqual(["Morning service"]);
    await answers(await r.send("GET", "/opening-hours", r.staff), 403);
  });

  it("create, rename and delete a named period, and save the week", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      staffMenuIds: [],
      name: "Midday",
      menuId: r.lunchMenu,
    });
    expect(created.status).toBe(201);
    const middayPeriod = (await created.json()) as { id: string };
    expect(middayPeriod).toEqual({ id: expect.any(String) });
    expect(
      restaurantOf(await r.model(), r).periods.find((period) => period.id === middayPeriod.id),
    ).toMatchObject({ name: "Midday", menuId: r.lunchMenu });

    const renamed = await r.send("PATCH", `/menu-periods/${middayPeriod.id}`, r.manager, {
      name: "Lunch service",
      menuId: r.coffeeMenu,
    });
    expect(renamed.status).toBe(204);
    expect(await renamed.text()).toBe("");
    expect(
      restaurantOf(await r.model(), r).periods.find((period) => period.id === middayPeriod.id),
    ).toMatchObject({ name: "Lunch service", menuId: r.coffeeMenu });

    const monday = [{ periodId: r.morningPeriod, startsAt: "09:00", endsAt: "12:00" }];
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        departments: [{ departmentId: r.restaurant, days: week(monday) }],
      }),
      204,
    );
    await answers(
      await r.send("PUT", `/zones/${r.barZone}/period-menus/${r.morningPeriod}`, r.manager, {
        menuId: r.coffeeMenu,
      }),
      404,
    );
    let model = await r.model();
    const restaurant = restaurantOf(model, r);
    expect(model.currentSeasonId).not.toBeNull();
    expect(
      restaurant.seasonWeeks
        .find((entry) => entry.seasonId === model.currentSeasonId)!
        .week.find((day) => day.weekday === 1)!.slots,
    ).toEqual(monday);

    await answers(
      await r.send("PUT", `/zones/${r.barZone}/period-menus/${r.morningPeriod}`, r.manager, {
        menuId: null,
      }),
      404,
    );
    await answers(
      await r.send("POST", `/menu-periods/${middayPeriod.id}/delete`, r.manager, {
        replacementPeriodId: null,
        expectedClockRevision: 1,
      }),
      204,
    );
    model = await r.model();
    expect(restaurantOf(model, r).periods.map((period) => period.id)).toEqual([r.morningPeriod]);
  });

  it("change only what a period update sends, keeping a rename made in the meantime", async () => {
    const r = await routed();
    await answers(
      await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, {
        name: "Early breakfasts",
        menuId: r.breakfastMenu,
      }),
      204,
    );
    const pointed = await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, {
      menuId: r.coffeeMenu,
    });
    expect(pointed.status).toBe(204);
    expect(await pointed.text()).toBe("");
    expect(
      restaurantOf(await r.model(), r).periods.find((period) => period.id === r.morningPeriod),
    ).toMatchObject({ name: "Early breakfasts", menuId: r.coffeeMenu });
    const renamed = await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, {
      name: "Morning service",
    });
    expect(renamed.status).toBe(204);
    expect(await renamed.text()).toBe("");
    expect(
      restaurantOf(await r.model(), r).periods.find((period) => period.id === r.morningPeriod),
    ).toMatchObject({ name: "Morning service", menuId: r.coffeeMenu });
    await answers(await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, {}), 400, {
      code: "management.request_invalid",
      params: { field: "body" },
    });
    await answers(
      await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, {
        menuId: r.coffeeMenu,
        name: 7,
      }),
      400,
      { code: "management.request_invalid", params: { field: "name" } },
    );
  });

  it("update a period only by PATCH: a PUT to its address finds no route and changes nothing", async () => {
    const r = await routed();
    const before = await r.model();
    const put = await r.send("PUT", `/menu-periods/${r.morningPeriod}`, r.manager, {
      name: "Early breakfasts",
      menuId: r.coffeeMenu,
    });
    expect(put.status).toBe(404);
    expect(await r.model()).toEqual(before);
  });

  it("tell a period name another period has apart from a name refused for itself", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      staffMenuIds: [],
      name: "PM service",
      menuId: r.coffeeMenu,
    });
    const afternoonPeriod = ((await created.json()) as { id: string }).id;
    await answers(
      await r.send("PATCH", `/menu-periods/${afternoonPeriod}`, r.manager, {
        name: " Morning service ",
      }),
      409,
      {
        code: "menu_period.name_taken",
        params: { departmentId: r.restaurant, name: "Morning service" },
      },
    );
    await answers(
      await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
        staffMenuIds: [],
        name: "  ",
        menuId: r.coffeeMenu,
      }),
      400,
      { code: "menu_timetable.invalid", params: { field: "name" } },
    );
    expect(restaurantOf(await r.model(), r).periods.map((period) => period.name)).toEqual([
      "Morning service",
      "PM service",
    ]);
  });

  it("refuse every write to anyone who may not manage venue service, changing nothing", async () => {
    const r = await routed();
    const before = await r.model();
    const writes: ["POST" | "PUT" | "PATCH" | "DELETE", string, unknown][] = [
      [
        "POST",
        `/departments/${r.restaurant}/menu-periods`,
        { name: "PM service", menuId: r.coffeeMenu, staffMenuIds: [] },
      ],
      [
        "PATCH",
        `/menu-periods/${r.morningPeriod}`,
        { name: "PM service", menuId: r.coffeeMenu, staffMenuIds: [] },
      ],
      [
        "POST",
        `/menu-periods/${r.morningPeriod}/delete`,
        { replacementPeriodId: null, expectedClockRevision: 1 },
      ],
    ];
    for (const [method, path, body] of writes) {
      const response = await r.send(method, path, r.supervisor, body);
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    expect(await r.model()).toEqual(before);
  });

  it("answer each refusal with its status and params", async () => {
    const r = await routed();
    const unknown = randomUUID();
    await answers(
      await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
        staffMenuIds: [],
        name: "Takeaway",
        menuId: unknown,
      }),
      400,
      {
        code: "catalogue.not_found",
        params: { catalogueId: unknown },
      },
    );
    await answers(
      await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
        staffMenuIds: [unknown],
        name: "Takeaway",
        menuId: r.coffeeMenu,
      }),
      400,
      { code: "catalogue.not_found", params: { catalogueId: unknown } },
    );
    await answers(
      await r.send("POST", `/departments/${unknown}/menu-periods`, r.manager, {
        staffMenuIds: [],
        name: "Takeaway",
        menuId: r.coffeeMenu,
      }),
      404,
      { code: "department.not_found", params: { departmentId: unknown } },
    );
    await answers(
      await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, { menuId: unknown }),
      404,
      { code: "catalogue.not_found", params: { catalogueId: unknown } },
    );
    await answers(
      await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
        staffMenuIds: [],
        name: "Morning service",
        menuId: r.coffeeMenu,
      }),
      409,
      {
        code: "menu_period.name_taken",
        params: { departmentId: r.restaurant, name: "Morning service" },
      },
    );
    await answers(
      await r.send("PATCH", `/menu-periods/${unknown}`, r.manager, {
        name: "X",
        menuId: r.coffeeMenu,
      }),
      404,
      { code: "menu_period.not_found", params: { periodId: unknown } },
    );
    await answers(
      await r.send("PUT", `/zones/${r.barZone}/period-menus/${unknown}`, r.manager, {
        menuId: null,
      }),
      404,
    );
    await answers(
      await r.send("PUT", `/zones/${r.counterZone}/period-menus/${r.morningPeriod}`, r.manager, {
        menuId: r.takeawayMenu,
      }),
      404,
    );
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        departments: [
          {
            departmentId: r.restaurant,
            days: week([{ periodId: r.morningPeriod, startsAt: "09:00", endsAt: "12:00" }]),
          },
        ],
      }),
      204,
    );
    await answers(
      await r.send("PUT", `/departments/${r.restaurant}/menus`, r.manager, {
        menuIds: [r.lunchMenu, r.coffeeMenu],
      }),
      404,
    );
  });

  it("refuse a clock revision on a period create or update, changing nothing", async () => {
    const r = await routed();
    const before = await r.model();
    for (const [method, path, body] of [
      [
        "POST",
        `/departments/${r.restaurant}/menu-periods`,
        { name: "Afternoons", menuId: r.coffeeMenu, staffMenuIds: [], expectedClockRevision: 1 },
      ],
      [
        "PATCH",
        `/menu-periods/${r.morningPeriod}`,
        { name: "Afternoons", expectedClockRevision: 1 },
      ],
      ["PATCH", `/menu-periods/${r.morningPeriod}`, { expectedClockRevision: 1 }],
    ] as const)
      await answers(await r.send(method, path, r.manager, body), 400, {
        code: "management.request_invalid",
        params: { field: "expectedClockRevision" },
      });
    expect(await r.model()).toEqual(before);
  });

  it("refuse a malformed id or body naming the field", async () => {
    const r = await routed();
    for (const [method, path, body, field] of [
      [
        "POST",
        `/departments/${r.restaurant}/menu-periods`,
        { name: 7, menuId: r.coffeeMenu, staffMenuIds: [] },
        "name",
      ],
      ["POST", `/departments/${r.restaurant}/menu-periods`, { name: "X", menuId: "x" }, "menuId"],
      [
        "POST",
        `/departments/${r.restaurant}/menu-periods`,
        { name: "X", menuId: r.coffeeMenu, departmentId: r.deli },
        "departmentId",
      ],
      ["PATCH", `/menu-periods/${r.morningPeriod}`, { name: "X", menuId: "x" }, "menuId"],
    ] as const)
      await answers(await r.send(method, path, r.manager, body), 400, {
        code: "management.request_invalid",
        params: { field },
      });
    for (const [method, path] of [
      ["POST", "/departments/x/menu-periods"],
      ["PATCH", "/menu-periods/x"],
      ["POST", "/menu-periods/x/delete"],
    ] as const) {
      const response = await r.send(method, path, r.manager, {});
      expect(response.status, `${method} ${path}`).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "shared.invalid_id",
      );
    }
  });
});

describe("the opening-hours period API", () => {
  it("reads the opening-hours model with venue-view permission", async () => {
    const r = await routed();
    const response = await r.send("GET", "/opening-hours", r.supervisor);
    expect(response.status).toBe(200);
    const model = (await response.json()) as OpeningHoursModel;
    expect(model).toEqual(
      JSON.parse(JSON.stringify(await scoped((tx) => readOpeningHoursModel(tx, new Date())))),
    );
    expect(model.departments.find((department) => department.id === r.restaurant)!.periods).toEqual(
      [
        {
          id: r.morningPeriod,
          name: "Morning service",
          menuId: r.breakfastMenu,
          colour: "red",
          staffMenuIds: [],
          floorPlanSetId: null,
          weekdays: [],
          routingUses: [],
        },
      ],
    );
    await answers(await r.send("GET", "/opening-hours", r.staff), 403);
  });

  it("creates colour and ordered staff menus, then updates each without losing omitted fields", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Lunch",
      colour: "blue",
      menuId: r.lunchMenu,
      staffMenuIds: [r.coffeeMenu, r.takeawayMenu],
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const period = async () =>
      (await scoped((tx) => readOpeningHoursModel(tx, new Date()))).departments
        .find((department) => department.id === r.restaurant)!
        .periods.find((value) => value.id === id)!;
    expect(await period()).toEqual({
      id,
      name: "Lunch",
      colour: "blue",
      menuId: r.lunchMenu,
      staffMenuIds: [r.coffeeMenu, r.takeawayMenu],
      floorPlanSetId: null,
      weekdays: [],
      routingUses: [],
    });
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, { colour: "green" }),
      204,
    );
    expect(await period()).toEqual({
      id,
      name: "Lunch",
      colour: "green",
      menuId: r.lunchMenu,
      staffMenuIds: [r.coffeeMenu, r.takeawayMenu],
      floorPlanSetId: null,
      weekdays: [],
      routingUses: [],
    });
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, {
        staffMenuIds: [r.takeawayMenu, r.coffeeMenu],
      }),
      204,
    );
    expect(await period()).toEqual({
      id,
      name: "Lunch",
      colour: "green",
      menuId: r.lunchMenu,
      staffMenuIds: [r.takeawayMenu, r.coffeeMenu],
      floorPlanSetId: null,
      weekdays: [],
      routingUses: [],
    });
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, { staffMenuIds: [] }),
      204,
    );
    expect((await period()).staffMenuIds).toEqual([]);
  });

  it("takes the next unused colour only when it is absent", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Lunch",
      menuId: r.lunchMenu,
      staffMenuIds: [],
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const model = await scoped((tx) => readOpeningHoursModel(tx, new Date()));
    expect(
      model.departments
        .find((department) => department.id === r.restaurant)!
        .periods.find((value) => value.id === id)!.colour,
    ).toBe("orange");
  });

  it("creates and updates a period in a newer calendar colour", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Lunch",
      colour: "indigo",
      menuId: r.lunchMenu,
      staffMenuIds: [],
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const colour = async () =>
      (await scoped((tx) => readOpeningHoursModel(tx, new Date()))).departments
        .find((department) => department.id === r.restaurant)!
        .periods.find((value) => value.id === id)!.colour;
    expect(await colour()).toBe("indigo");
    await answers(await r.send("PATCH", `/menu-periods/${id}`, r.manager, { colour: "teal" }), 204);
    expect(await colour()).toBe("teal");
    await answers(await r.send("PATCH", `/menu-periods/${id}`, r.manager, { colour: "sky" }), 204);
    expect(await colour()).toBe("sky");
  });

  for (const method of ["POST", "PATCH"] as const) {
    for (const [field, value] of [
      ["colour", null],
      ["colour", ["blue"]],
      ["colour", "beige"],
      ["colour", 1],
      ["staffMenuIds", null],
      ["staffMenuIds", "x"],
      ["staffMenuIds", [null]],
      ["staffMenuIds", ["not-a-uuid"]],
    ] as const) {
      it(`${method} refuses malformed ${field} ${JSON.stringify(value)} without writing`, async () => {
        const r = await routed();
        const before = await r.model();
        const path =
          method === "POST"
            ? `/departments/${r.restaurant}/menu-periods`
            : `/menu-periods/${r.morningPeriod}`;
        await answers(
          await r.send(method, path, r.manager, {
            name: "Lunch",
            menuId: r.lunchMenu,
            staffMenuIds: [],
            [field]: value,
          }),
          400,
          { code: "management.request_invalid", params: { field } },
        );
        expect(await r.model()).toEqual(before);
      });
    }
  }

  it("requires staffMenuIds on creation", async () => {
    const r = await routed();
    await answers(
      await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
        name: "Lunch",
        menuId: r.lunchMenu,
      }),
      400,
      { code: "management.request_invalid", params: { field: "staffMenuIds" } },
    );
  });

  it("rejects duplicate and customer staff menus with the domain refusal", async () => {
    const r = await routed();
    for (const method of ["POST", "PATCH"] as const) {
      const path =
        method === "POST"
          ? `/departments/${r.restaurant}/menu-periods`
          : `/menu-periods/${r.morningPeriod}`;
      for (const staffMenuIds of [[r.lunchMenu], [r.coffeeMenu, r.coffeeMenu]]) {
        await answers(
          await r.send(method, path, r.manager, {
            name: "Lunch",
            menuId: r.lunchMenu,
            staffMenuIds,
          }),
          400,
          { code: "menu_period.invalid", params: { field: "staffMenuIds" } },
        );
      }
    }
  });
});

describe("retired menu timetable routes", () => {
  it("answers 404 for each old endpoint and leaves opening hours unchanged", async () => {
    const r = await routed();
    const before = await r.model();
    for (const [method, path, body] of [
      ["GET", "/menu-timetable", undefined],
      ["PUT", `/departments/${r.restaurant}/menus`, { menuIds: [r.coffeeMenu] }],
      ["PUT", `/departments/${r.restaurant}/all-day-menu`, { menuId: r.coffeeMenu }],
      ["PUT", `/zones/${r.barZone}/all-day-menu`, { menuId: r.coffeeMenu }],
      ["PUT", `/zones/${r.barZone}/period-menus/${r.morningPeriod}`, { menuId: r.coffeeMenu }],
    ] as const) {
      await answers(await r.send(method, path, r.manager, body), 404);
      expect(await r.model()).toEqual(before);
    }
  });

  it("chooses any active catalogue as a period's customer menu", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Lunch",
      menuId: r.takeawayMenu,
      staffMenuIds: [],
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(
      restaurantOf(await r.model(), r).periods.find((period) => period.id === id)!.menuId,
    ).toBe(r.takeawayMenu);
  });
});

it("answers the unmatched-route 404 to the retired dated timetable and zone closure writers for a real date", async () => {
  const r = await routed();
  const before = await r.model();
  for (const [path, sent] of [
    [`/special-dates/${r.christmas}/menu-timetables/${r.restaurant}`, { slots: [] }],
    [`/special-dates/${r.christmas}/zone-closed-times/${r.barZone}`, { ranges: [] }],
  ] as const) {
    const response = await r.send("PUT", path, r.manager, sent);
    expect({ path, status: response.status, body: await response.text() }).toEqual({
      path,
      status: 404,
      body: "404 Not Found",
    });
  }
  expect(await r.model()).toEqual(before);
});

describe("the season weeks route", () => {
  const closedWeek = (ranges: { startsAt: string; endsAt: string }[]) =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, ranges: weekday === 1 ? ranges : [] }));
  const otherSeason = (model: OpeningHoursModel, r: Routed) =>
    model.seasons.find((season) => season.id !== r.season)!.id;
  const monday = (r: Routed) => [{ periodId: r.morningPeriod, startsAt: "09:00", endsAt: "12:00" }];
  const closed = [{ startsAt: "10:00", endsAt: "11:00" }];
  const body = (r: Routed) => ({
    departments: [{ departmentId: r.restaurant, days: week(monday(r)) }],
    zones: [{ zoneId: r.barZone, days: closedWeek(closed) }],
  });

  it("saves a department week and a zone week in the season it names and no other", async () => {
    const r = await routed();
    const named = otherSeason(await r.model(), r);
    await answers(await r.send("PUT", `/seasons/${named}/weeks`, r.manager, body(r)), 204);
    const model = await r.model();
    expect(restaurantOf(model, r).seasonWeeks).toEqual(
      model.seasons.map((season) => ({
        seasonId: season.id,
        week: week(season.id === named ? monday(r) : []),
      })),
    );
    expect(restaurantOf(model, r).zones[0]!.seasonWeeks).toEqual(
      model.seasons.map((season) => ({
        seasonId: season.id,
        week: closedWeek(season.id === named ? closed : []),
      })),
    );
  });

  it("refuses a zone closure outside its department's hours, naming the range, and stores nothing", async () => {
    const r = await routed();
    const before = await r.model();
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        departments: [{ departmentId: r.restaurant, days: week(monday(r)) }],
        zones: [
          {
            zoneId: r.barZone,
            days: closedWeek([
              { startsAt: "10:00", endsAt: "11:00" },
              { startsAt: "11:30", endsAt: "13:00" },
            ]),
          },
        ],
      }),
      400,
      {
        code: "zone_closed_time.invalid",
        params: {
          field: "zones.0.days.1.ranges.1",
          reason: "outside_hours",
          zoneId: r.barZone,
          weekday: 1,
        },
      },
    );
    expect(await r.model()).toEqual(before);
  });

  it("names a refused closure on a later zone by that zone's place in the request", async () => {
    const r = await routed();
    const before = await r.model();
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        ...body(r),
        zones: [
          { zoneId: r.barZone, days: closedWeek(closed) },
          { zoneId: r.counterZone, days: closedWeek(closed) },
        ],
      }),
      400,
      {
        code: "zone_closed_time.invalid",
        params: {
          field: "zones.1.days.1.ranges.0",
          reason: "outside_hours",
          zoneId: r.counterZone,
          weekday: 1,
        },
      },
    );
    expect(await r.model()).toEqual(before);
  });

  it("checks the zone against the department week the same request sends", async () => {
    const r = await routed();
    expect(restaurantOf(await r.model(), r).seasonWeeks).toEqual(
      (await r.model()).seasons.map((season) => ({ seasonId: season.id, week: week([]) })),
    );
    await answers(await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, body(r)), 204);
    const model = await r.model();
    expect(
      restaurantOf(model, r).zones[0]!.seasonWeeks.find((entry) => entry.seasonId === r.season)!
        .week,
    ).toEqual(closedWeek(closed));
  });

  it("accepts a closure across two touching periods", async () => {
    const r = await routed();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Dinner",
      menuId: r.lunchMenu,
      staffMenuIds: [],
    });
    expect(created.status).toBe(201);
    const dinner = ((await created.json()) as { id: string }).id;
    const across = [{ startsAt: "15:00", endsAt: "17:00" }];
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        departments: [
          {
            departmentId: r.restaurant,
            days: week([
              { periodId: r.morningPeriod, startsAt: "13:00", endsAt: "16:00" },
              { periodId: dinner, startsAt: "16:00", endsAt: "23:00" },
            ]),
          },
        ],
        zones: [{ zoneId: r.barZone, days: closedWeek(across) }],
      }),
      204,
    );
    const model = await r.model();
    expect(
      restaurantOf(model, r).zones[0]!.seasonWeeks.find((entry) => entry.seasonId === r.season)!
        .week,
    ).toEqual(closedWeek(across));
  });

  it("refuses a malformed or unknown season id, changing nothing", async () => {
    const r = await routed();
    const before = await r.model();
    await answers(await r.send("PUT", `/seasons/x/weeks`, r.manager, body(r)), 400, {
      code: "shared.invalid_id",
      params: { kind: "SeasonId", value: "x" },
    });
    const seasonId = randomUUID();
    await answers(await r.send("PUT", `/seasons/${seasonId}/weeks`, r.manager, body(r)), 404, {
      code: "season.not_found",
      params: { seasonId },
    });
    expect(await r.model()).toEqual(before);
  });

  it("answers 400 for a department or zone the body names that the venue does not hold, changing nothing", async () => {
    const r = await routed();
    const before = await r.model();
    const unknown = randomUUID();
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        departments: [{ departmentId: unknown, days: week([]) }],
      }),
      400,
      { code: "department.not_found", params: { departmentId: unknown } },
    );
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        zones: [{ zoneId: unknown, days: closedWeek([]) }],
      }),
      400,
      { code: "service_zone.not_found", params: { zoneId: unknown } },
    );
    expect(await r.model()).toEqual(before);
  });

  it("refuses a malformed body naming the field, changing nothing", async () => {
    const r = await routed();
    const before = await r.model();
    const days = week(monday(r));
    const zoneDays = closedWeek(closed);
    const cases: [Record<string, unknown>, string][] = [
      [{ seasonId: r.season }, "seasonId"],
      [{ departments: {} }, "departments"],
      [{ zones: "x" }, "zones"],
      [{ departments: [null] }, "departments.0"],
      [{ zones: [[]] }, "zones.0"],
      [{ departments: [{ departmentId: "x", days }] }, "departments.0.departmentId"],
      [{ zones: [{ zoneId: 7, days: zoneDays }] }, "zones.0.zoneId"],
      [
        { departments: [{ departmentId: r.restaurant, days, seasonId: r.season }] },
        "departments.0.seasonId",
      ],
      [{ zones: [{ zoneId: r.barZone, days: zoneDays, kind: "closed" }] }, "zones.0.kind"],
      [
        {
          departments: [
            { departmentId: r.restaurant, days },
            { departmentId: r.restaurant, days },
          ],
        },
        "departments.1.departmentId",
      ],
      [
        {
          zones: [
            { zoneId: r.barZone, days: zoneDays },
            { zoneId: r.barZone, days: zoneDays },
          ],
        },
        "zones.1.zoneId",
      ],
    ];
    for (const [sent, field] of cases)
      await answers(await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, sent), 400, {
        code: "management.request_invalid",
        params: { field },
      });
    expect(await r.model()).toEqual(before);
  });

  it("names a refused week by its place in the request, every other param unchanged", async () => {
    const r = await routed();
    const before = await r.model();
    const overlapping = [
      { periodId: r.morningPeriod, startsAt: "09:00", endsAt: "12:00" },
      { periodId: r.morningPeriod, startsAt: "11:00", endsAt: "13:00" },
    ];
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        departments: [{ departmentId: r.restaurant, days: week(overlapping) }],
      }),
      400,
      {
        code: "menu_timetable.invalid",
        params: { field: "departments.0.days.1.slots", reason: "overlap" },
      },
    );
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        departments: [{ departmentId: r.restaurant, days: week(monday(r)) }],
        zones: [
          {
            zoneId: r.barZone,
            days: closedWeek([
              { startsAt: "16:00", endsAt: "18:00" },
              { startsAt: "17:00", endsAt: "19:00" },
            ]),
          },
        ],
      }),
      400,
      {
        code: "zone_closed_time.invalid",
        params: { field: "zones.0.days.1.ranges", reason: "overlap" },
      },
    );
    expect(await r.model()).toEqual(before);
  });

  it("refuses an entry with no days through its week's own code, named by its place", async () => {
    const r = await routed();
    const before = await r.model();
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        departments: [{ departmentId: r.restaurant }],
      }),
      400,
      { code: "menu_timetable.invalid", params: { field: "departments.0.days" } },
    );
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        zones: [{ zoneId: r.barZone }],
      }),
      400,
      { code: "zone_closed_time.invalid", params: { field: "zones.0.days" } },
    );
    expect(await r.model()).toEqual(before);
  });

  it("refuses a save with no clock revision or a stale one, changing nothing", async () => {
    const r = await routed();
    await scoped((tx) =>
      tx
        .update(businessDaySettingsTable)
        .set({ revision: 2 })
        .where(eq(businessDaySettingsTable.module, "business_day")),
    );
    const before = await r.model();
    for (const expectedClockRevision of [undefined, 0])
      await answers(
        await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
          ...body(r),
          expectedClockRevision,
        }),
        409,
        { code: "hours.clock_changed", params: {} },
      );
    expect(await r.model()).toEqual(before);
    await answers(
      await r.send("PUT", `/seasons/${r.season}/weeks`, r.manager, {
        ...body(r),
        expectedClockRevision: 2,
      }),
      204,
    );
  });

  it("refuses someone who may not manage venue service, changing nothing", async () => {
    const r = await routed();
    const before = await r.model();
    for (const person of [r.supervisor, r.staff])
      await answers(await r.send("PUT", `/seasons/${r.season}/weeks`, person, body(r)), 403);
    expect(await r.model()).toEqual(before);
  });

  it("refuses someone who may not manage venue service before checking the body", async () => {
    const r = await routed();
    const before = await r.model();
    const path = `/seasons/${r.season}/weeks`;
    const refused = await r.send("PUT", path, r.supervisor, body(r));
    expect(refused.status).toBe(403);
    const { error } = (await refused.json()) as { error: Record<string, unknown> };
    for (const malformed of [
      { zones: "x" },
      { departments: [{ departmentId: "x" }] },
      { ...body(r), stray: true },
      { ...body(r), expectedClockRevision: "x" },
    ])
      await answers(await r.send("PUT", path, r.supervisor, malformed), 403, error);
    expect(await r.model()).toEqual(before);
  });
});

describe("a period's Floor plan field", () => {
  async function withSets() {
    const r = await routed();
    const set = (departmentId: string, name: string) =>
      scoped(async (tx) => {
        const row = { id: await addFloorPlanSet(tx, { departmentId, name }) };
        return row!.id;
      });
    const standard = await set(r.restaurant, "Standard");
    const dinner = await set(r.restaurant, "Dinner");
    const deliSet = await set(r.deli, "Counter");
    const stored = async (periodId: string) =>
      restaurantOf(await r.model(), r).periods.find((p) => p.id === periodId)!.floorPlanSetId;
    return { ...r, standard, dinner, deliSet, stored };
  }

  it("stores a set on create, keeps it when absent, and empties it on null", async () => {
    const r = await withSets();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Dinner",
      menuId: r.lunchMenu,
      staffMenuIds: [],
      floorPlanSetId: r.dinner,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(await r.stored(id)).toBe(r.dinner);
    await answers(await r.send("PATCH", `/menu-periods/${id}`, r.manager, { name: "Late" }), 204);
    expect(await r.stored(id)).toBe(r.dinner);
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, { floorPlanSetId: null }),
      204,
    );
    expect(await r.stored(id)).toBeNull();
    await answers(
      await r.send("PATCH", `/menu-periods/${id}`, r.manager, { floorPlanSetId: r.standard }),
      204,
    );
    expect(await r.stored(id)).toBe(r.standard);
  });

  it("leaves the field empty on a create that does not send it", async () => {
    const r = await withSets();
    expect(await r.stored(r.morningPeriod)).toBeNull();
    const created = await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
      name: "Dinner",
      menuId: r.lunchMenu,
      staffMenuIds: [],
    });
    expect(await r.stored(((await created.json()) as { id: string }).id)).toBeNull();
  });

  it("refuses another department's set on create and on PATCH, changing nothing", async () => {
    const r = await withSets();
    const before = await r.model();
    await answers(
      await r.send("POST", `/departments/${r.restaurant}/menu-periods`, r.manager, {
        name: "Dinner",
        menuId: r.lunchMenu,
        staffMenuIds: [],
        floorPlanSetId: r.deliSet,
      }),
      400,
      { code: "menu_period.invalid", params: { field: "floorPlanSetId" } },
    );
    await answers(
      await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, {
        floorPlanSetId: r.deliSet,
      }),
      400,
      { code: "menu_period.invalid", params: { field: "floorPlanSetId" } },
    );
    await answers(
      await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, {
        floorPlanSetId: randomUUID(),
      }),
      400,
      { code: "menu_period.invalid", params: { field: "floorPlanSetId" } },
    );
    expect(await r.model()).toEqual(before);
  });

  it("refuses a value that is neither an id nor null, changing nothing", async () => {
    const r = await withSets();
    for (const floorPlanSetId of [7, "", "x", false, [r.dinner]])
      await answers(
        await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, { floorPlanSetId }),
        400,
        { code: "management.request_invalid", params: { field: "floorPlanSetId" } },
      );
    expect(await r.stored(r.morningPeriod)).toBeNull();
  });

  it("cannot move a period that names a set into another department", async () => {
    const r = await withSets();
    await answers(
      await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, {
        floorPlanSetId: r.dinner,
      }),
      204,
    );
    await answers(
      await r.send("PATCH", `/menu-periods/${r.morningPeriod}`, r.manager, {
        departmentId: r.deli,
      }),
      400,
      { code: "management.request_invalid", params: { field: "departmentId" } },
    );
    expect(await r.stored(r.morningPeriod)).toBe(r.dinner);
  });
});
