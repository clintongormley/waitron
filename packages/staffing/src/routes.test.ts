import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  kitchenStations,
  locations,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  persons,
  registerModulePermissions,
  startManagementSession,
  type PersonRoleValue,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { locationId as brandLocationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import {
  VENUE_SERVICE_MIGRATIONS,
  departments,
  menuPeriods,
  departmentDays,
  departmentDayRanges,
  specialDayDates,
  specialDays,
} from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS, shifts, WorkforceBackend } from "@waitron/workforce";
import { seedVenue } from "../test/seed.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";
import { STAFFING_PERMISSIONS } from "./permissions.js";
import { STAFFING_ROUTES } from "./routes.js";
import { shiftAssignments, staffRoles } from "./schema/staffing.js";
import type { StaffingMonth, StaffRole } from "./staffing-types.js";
import type { AreaRef, StaffingBlock } from "./slots.js";

registerModulePermissions(STAFFING_PERMISSIONS);

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    WORKFORCE_MIGRATIONS,
    STAFFING_MIGRATIONS,
  ],
});

const BASE = "/management-api/staffing/staff-roles";
const noopLog: Logger = () => {};

async function routed() {
  const venue = await seedVenue(suite.db);
  const cookies = await withTransaction(suite.db, async (tx) => {
    const session = async (personRole: PersonRoleValue) => {
      const [row] = await tx
        .insert(persons)
        .values({
          displayName: `${personRole} ${randomUUID()}`,
          pinHash: hashPin("1234"),
          role: personRole,
        })
        .returning({ id: persons.id });
      return `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: row!.id })).token}`;
    };
    return {
      manager: await session("manager"),
      supervisor: await session("supervisor"),
      staff: await session("staff"),
    };
  });
  const app = new Hono();
  const cfg = { locationId: brandLocationId(venue.cfg.locationId) };
  STAFFING_ROUTES.mount(
    app,
    { db: suite.db, cfg, core: {} as ModuleRouteContext["core"] },
    noopLog,
  );
  const call = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    cookie: string,
    body?: unknown,
  ) =>
    app.request(path, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const send = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    cookie: string,
    body?: unknown,
  ) => call(method, `${BASE}${path}`, cookie, body);
  const create = async (name: string) => {
    const response = await send("POST", "", cookies.manager, { name, colour: "blue" });
    expect(response.status).toBe(201);
    return (await response.json()) as StaffRole;
  };
  return { ...venue, ...cookies, app, call, send, create };
}

async function displayNameOf(personId: string): Promise<string> {
  const [row] = await suite.db
    .select({ displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.id, personId));
  return row!.displayName;
}

async function answers(response: Response, status: number, body?: unknown) {
  expect(response.status).toBe(status);
  if (body !== undefined) expect(await response.json()).toEqual(body);
}

const refusal = (code: string, params: Record<string, unknown>) => ({ error: { code, params } });

describe("the staff-role routes", () => {
  it("creates a role and lists it to a viewer", async () => {
    const r = await routed();
    const response = await r.send("POST", "", r.manager, { name: " Waiter ", colour: "green" });
    expect(response.status).toBe(201);
    const staffRole = (await response.json()) as StaffRole;
    expect(staffRole).toEqual({
      id: staffRole.id,
      name: "Waiter",
      colour: "green",
      position: 0,
      holderIds: [],
    });
    await answers(await r.send("GET", "", r.supervisor), 200, {
      staffRoles: [{ ...staffRole, holderNames: [] }],
    });
  });

  it("updates a role, sets its holders and deletes it", async () => {
    const r = await routed();
    const staffRole = await r.create("Waiter");
    await answers(
      await r.send("PUT", `/${staffRole.id}`, r.manager, { name: "Head waiter", colour: "red" }),
      200,
      { ...staffRole, name: "Head waiter", colour: "red" },
    );
    await answers(
      await r.send("PUT", `/${staffRole.id}/holders`, r.manager, { personIds: [r.ana, r.marc] }),
      200,
      { ...staffRole, name: "Head waiter", colour: "red", holderIds: [r.ana, r.marc].sort() },
    );
    // The seed names them "Ana <suffix>" and "Marc <suffix>", so Ana sorts first.
    await answers(await r.send("GET", "", r.supervisor), 200, {
      staffRoles: [
        {
          ...staffRole,
          name: "Head waiter",
          colour: "red",
          holderIds: [r.ana, r.marc].sort(),
          holderNames: [await displayNameOf(r.ana), await displayNameOf(r.marc)],
        },
      ],
    });
    await answers(await r.send("DELETE", `/${staffRole.id}`, r.manager), 200, {
      target: { id: staffRole.id, name: "Head waiter" },
      refusals: [],
      ends: [],
      removes: [
        {
          key: "staff_role_holders",
          count: 2,
          targets: expect.arrayContaining([
            expect.objectContaining({ id: r.ana }),
            expect.objectContaining({ id: r.marc }),
          ]) as unknown,
        },
      ],
    });
    await answers(await r.send("GET", "", r.manager), 200, { staffRoles: [] });
  });

  it("reorders at /order rather than treating it as a role id", async () => {
    const r = await routed();
    const a = await r.create("A");
    const b = await r.create("B");
    const response = await r.send("PUT", "/order", r.manager, { staffRoleIds: [b.id, a.id] });
    expect(response.status).toBe(204);
    const listed = (await (await r.send("GET", "", r.manager)).json()) as {
      staffRoles: StaffRole[];
    };
    expect(listed.staffRoles.map(({ name }) => name)).toEqual(["B", "A"]);
    const stranger = randomUUID();
    await answers(
      await r.send("PUT", "/order", r.manager, { staffRoleIds: [b.id, stranger] }),
      400,
      refusal("staff_role.not_found", { staffRoleId: stranger }),
    );
    await answers(
      await r.send("PUT", "/order", r.manager, { staffRoleIds: [b.id] }),
      400,
      refusal("staffing.invalid", { field: "staffRoleIds" }),
    );
    await answers(
      await r.send("PUT", "/order", r.manager, { staffRoleIds: [b.id, 7] }),
      400,
      refusal("management.request_invalid", { field: "staffRoleIds" }),
    );
    await answers(
      await r.send("PUT", "/order", r.manager, { staffRoleIds: "x" }),
      400,
      refusal("management.request_invalid", { field: "staffRoleIds" }),
    );
  });

  it("answers the domain refusals with their statuses", async () => {
    const r = await routed();
    const staffRole = await r.create("Waiter");
    await answers(
      await r.send("POST", "", r.manager, { name: "Waiter", colour: "blue" }),
      409,
      refusal("staff_role.name_taken", { name: "Waiter" }),
    );
    await answers(
      await r.send("POST", "", r.manager, { name: " ", colour: "blue" }),
      400,
      refusal("staffing.invalid", { field: "name" }),
    );
    await answers(
      await r.send("POST", "", r.manager, { name: "Cook", colour: "beige" }),
      400,
      refusal("staffing.invalid", { field: "colour" }),
    );
    const missing = randomUUID();
    await answers(
      await r.send("PUT", `/${missing}`, r.manager, { name: "X", colour: "blue" }),
      404,
      refusal("staff_role.not_found", { staffRoleId: missing }),
    );
    await answers(
      await r.send("PUT", `/${staffRole.id}/holders`, r.manager, { personIds: [randomUUID()] }),
      400,
      refusal("staffing.invalid", { field: "personIds" }),
    );
    await answers(
      await r.send("DELETE", "/not-a-uuid", r.manager),
      400,
      refusal("shared.invalid_id", { kind: "StaffRoleId", value: "not-a-uuid" }),
    );

    await withTransaction(suite.db, async (tx) => {
      const [shift] = await tx
        .insert(shifts)
        .values({
          personId: r.ana,
          locationId: r.cfg.locationId,
          startsAt: "2026-10-14T08:00:00Z",
          startsOffsetMinutes: 120,
          endsAt: "2026-10-14T16:00:00Z",
          endsOffsetMinutes: 120,
        })
        .returning({ id: shifts.id });
      await tx
        .insert(shiftAssignments)
        .values({ shiftId: shift!.id, departmentId: r.departmentId, staffRoleId: staffRole.id });
    });
    await answers(
      await r.send("DELETE", `/${staffRole.id}`, r.manager),
      409,
      refusal("staff_role.in_use", { staffRoleId: staffRole.id, shiftCount: 1 }),
    );
  });

  it("reads what deleting a role would do, and answers staff_role.not_found for another location's role", async () => {
    const r = await routed();
    const staffRole = await r.create("Waiter");
    await answers(await r.send("GET", `/${staffRole.id}/delete-impact`, r.manager), 200, {
      target: { id: staffRole.id, name: "Waiter" },
      refusals: [],
      ends: [],
      removes: [],
    });
    const other = await seedVenue(suite.db);
    const [theirs] = await withTransaction(suite.db, (tx) =>
      tx
        .insert(staffRoles)
        .values({ locationId: other.cfg.locationId, name: "Cook", colour: "red", position: 0 })
        .returning({ id: staffRoles.id }),
    );
    await answers(
      await r.send("GET", `/${theirs!.id}/delete-impact`, r.manager),
      404,
      refusal("staff_role.not_found", { staffRoleId: theirs!.id }),
    );
    await answers(
      await r.send("GET", "/not-a-uuid/delete-impact", r.manager),
      400,
      refusal("shared.invalid_id", { kind: "StaffRoleId", value: "not-a-uuid" }),
    );
  });

  it("refuses a malformed body and an extra key", async () => {
    const r = await routed();
    const staffRole = await r.create("Waiter");
    await answers(
      await r.send("POST", "", r.manager, { name: "Cook", colour: "blue", position: 3 }),
      400,
      refusal("management.request_invalid", { field: "position" }),
    );
    await answers(
      await r.send("PUT", `/${staffRole.id}`, r.manager, { name: 5, colour: "blue" }),
      400,
      refusal("management.request_invalid", { field: "name" }),
    );
    await answers(
      await r.send("PUT", `/${staffRole.id}`, r.manager, { name: "Cook", colour: 1 }),
      400,
      refusal("management.request_invalid", { field: "colour" }),
    );
    await answers(
      await r.send("PUT", `/${staffRole.id}/holders`, r.manager, { personIds: [r.ana], extra: 1 }),
      400,
      refusal("management.request_invalid", { field: "extra" }),
    );
    await answers(
      await r.send("PUT", `/${staffRole.id}/holders`, r.manager, { personIds: ["nope"] }),
      400,
      refusal("management.request_invalid", { field: "personIds" }),
    );
    await answers(
      await r.send("PUT", "/order", r.manager, { staffRoleIds: [staffRole.id], more: true }),
      400,
      refusal("management.request_invalid", { field: "more" }),
    );
  });

  it.each([
    ["POST", ""],
    ["PUT", "/role"],
    ["PUT", "/order"],
    ["PUT", "/role/holders"],
  ] as const)(
    "refuses non-object bodies at %s %s without changing roles",
    async (method, suffix) => {
      const r = await routed();
      const staffRole = await r.create("Waiter");
      const path = suffix.replace("/role", `/${staffRole.id}`);
      const before = await (await r.send("GET", "", r.manager)).json();
      for (const body of ["x", "", 1, true, [], ["x"], null]) {
        await answers(
          await r.send(method, path, r.manager, body),
          400,
          refusal("management.request_invalid", { field: "body" }),
        );
        await answers(await r.send("GET", "", r.manager), 200, before);
      }
      for (const body of [undefined, "", "{"]) {
        await answers(
          await r.app.request(`${BASE}${path}`, {
            method,
            headers: { cookie: r.manager, "content-type": "application/json" },
            body,
          }),
          400,
          refusal("management.request_invalid", { field: "body" }),
        );
        await answers(await r.send("GET", "", r.manager), 200, before);
      }
      const denied = await r.send(method, path, r.supervisor, "x");
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    },
  );

  it("lets a supervisor read the list but not write or read a delete's impact, and refuses staff and anonymous callers", async () => {
    const r = await routed();
    const staffRole = await r.create("Waiter");
    const notPermitted = async (response: Response) => {
      expect(response.status).toBe(403);
      const { error } = (await response.json()) as { error: { code: string } };
      expect(error.code).toBe("authorization.not_permitted");
    };
    await answers(await r.send("GET", "", r.supervisor), 200);
    await notPermitted(await r.send("GET", "", r.staff));
    await notPermitted(await r.send("POST", "", r.supervisor, { name: "Cook", colour: "blue" }));
    await notPermitted(
      await r.send("PUT", `/${staffRole.id}`, r.supervisor, { name: "Cook", colour: "blue" }),
    );
    await notPermitted(
      await r.send("PUT", `/${staffRole.id}/holders`, r.supervisor, { personIds: [] }),
    );
    await notPermitted(
      await r.send("PUT", "/order", r.supervisor, { staffRoleIds: [staffRole.id] }),
    );
    await notPermitted(await r.send("DELETE", `/${staffRole.id}`, r.supervisor));
    await notPermitted(await r.send("GET", `/${staffRole.id}/delete-impact`, r.supervisor));
    // The body's fields are checked only once the caller is authorised, so a bad one is a 403.
    await notPermitted(await r.send("POST", "", r.supervisor, { name: 5, extra: true }));
    await notPermitted(
      await r.send("PUT", `/${staffRole.id}/holders`, r.supervisor, { personIds: "x" }),
    );
    await notPermitted(await r.send("PUT", "/order", r.supervisor, { staffRoleIds: ["nope"] }));
    await answers(await r.send("GET", "", ""), 401);
  });
  it("accepts an upper-case spelling of a staff role id and a person id", async () => {
    const r = await routed();
    const a = await r.create("A");
    const b = await r.create("B");
    const upper = a.id.toUpperCase();
    await answers(
      await r.send("PUT", `/${upper}/holders`, r.manager, { personIds: [r.ana.toUpperCase()] }),
      200,
      { ...a, holderIds: [r.ana] },
    );
    await answers(await r.send("PUT", `/${upper}`, r.manager, { name: "A2", colour: "red" }), 200, {
      ...a,
      name: "A2",
      colour: "red",
      holderIds: [r.ana],
    });
    const reordered = await r.send("PUT", "/order", r.manager, {
      staffRoleIds: [b.id.toUpperCase(), upper],
    });
    expect(reordered.status).toBe(204);
    await answers(await r.send("DELETE", `/${b.id.toUpperCase()}`, r.manager), 200, {
      target: { id: b.id, name: "B" },
      refusals: [],
      ends: [],
      removes: [],
    });
    await answers(await r.send("GET", "", r.manager), 200, {
      staffRoles: [
        {
          ...a,
          name: "A2",
          colour: "red",
          position: 1,
          holderIds: [r.ana],
          holderNames: [await displayNameOf(r.ana)],
        },
      ],
    });
  });
});

const STAFFING = "/management-api/staffing";

/** The routed venue with a staff role and a special day of two dates. */
async function painted() {
  const r = await routed();
  const waiter = await r.create("Waiter");
  const special = await withTransaction(suite.db, async (tx) => {
    const [day] = await tx
      .insert(specialDays)
      .values({ locationId: r.cfg.locationId, name: "Fiesta" })
      .returning({ id: specialDays.id });
    const dates = await tx
      .insert(specialDayDates)
      .values([
        { specialDayId: day!.id, locationId: r.cfg.locationId, date: "2026-08-14" },
        { specialDayId: day!.id, locationId: r.cfg.locationId, date: "2026-08-15" },
      ])
      .returning({ id: specialDayDates.id, date: specialDayDates.date });
    return {
      specialDayId: day!.id,
      aug14: dates.find((d) => d.date === "2026-08-14")!.id,
      aug15: dates.find((d) => d.date === "2026-08-15")!.id,
    };
  });
  const dept: AreaRef = { kind: "department", id: r.departmentId };
  const grill: AreaRef = { kind: "station", id: r.stationId };
  const block = (over: Partial<StaffingBlock> = {}): StaffingBlock => ({
    staffRoleId: waiter.id,
    headcount: 2,
    startsAt: "12:00",
    endsAt: "16:00",
    ...over,
  });
  return { ...r, ...special, waiter: waiter.id, dept, grill, block };
}

const week = (over: Record<number, StaffingBlock[]> = {}) => ({
  0: [],
  1: [],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
  ...over,
});

async function setActive(area: AreaRef, active: boolean) {
  await withTransaction(suite.db, async (tx) => {
    if (area.kind === "department")
      await tx.update(departments).set({ active }).where(eq(departments.id, area.id));
    else await tx.update(kitchenStations).set({ active }).where(eq(kitchenStations.id, area.id));
  });
}

describe("the staffing paint routes", () => {
  it.each(["season", "special day"] as const)(
    "refuses non-object %s save bodies without changing staffing",
    async (kind) => {
      const p = await painted();
      const path =
        kind === "season"
          ? `${STAFFING}/seasons/${p.seasonId}`
          : `${STAFFING}/special-days/${p.specialDayId}`;
      const before = await (await p.call("GET", path, p.manager)).json();
      for (const body of ["x", "", 1, true, [], ["x"], null]) {
        await answers(
          await p.call("PUT", path, p.manager, body),
          400,
          refusal("management.request_invalid", { field: "body" }),
        );
        await answers(await p.call("GET", path, p.manager), 200, before);
      }
      for (const body of [undefined, "", "{"]) {
        await answers(
          await p.app.request(path, {
            method: "PUT",
            headers: { cookie: p.manager, "content-type": "application/json" },
            body,
          }),
          400,
          refusal("management.request_invalid", { field: "body" }),
        );
        await answers(await p.call("GET", path, p.manager), 200, before);
      }
      const denied = await p.call("PUT", path, p.supervisor, "x");
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    },
  );

  it("lists the active areas to a viewer, leaving out a switched-off department and station until they are back on", async () => {
    const p = await painted();
    const all = {
      areas: [
        { area: p.dept, name: "Dining room" },
        { area: p.grill, name: "Grill" },
      ],
    };
    await answers(await p.call("GET", `${STAFFING}/areas`, p.supervisor), 200, all);
    await setActive(p.dept, false);
    await setActive(p.grill, false);
    await answers(await p.call("GET", `${STAFFING}/areas`, p.manager), 200, { areas: [] });
    await setActive(p.dept, true);
    await setActive(p.grill, true);
    await answers(await p.call("GET", `${STAFFING}/areas`, p.manager), 200, all);
  });

  it("saves a season's week and reads it back", async () => {
    const p = await painted();
    const lunch = p.block();
    const night = p.block({ headcount: 1, startsAt: "20:00", endsAt: "02:00" });
    const path = `${STAFFING}/seasons/${p.seasonId}`;
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [
          { area: p.dept, weekday: 0, blocks: [lunch] },
          { area: p.grill, weekday: 6, blocks: [night] },
        ],
      }),
      204,
    );
    await answers(await p.call("GET", path, p.supervisor), 200, {
      cutover: "06:00",
      seasons: [{ id: p.seasonId, name: "Summer", startsOn: "06-01", colour: "grey" }],
      areas: [
        { area: p.dept, name: "Dining room", weekdays: week({ 0: [lunch] }) },
        { area: p.grill, name: "Grill", weekdays: week({ 6: [night] }) },
      ],
      guides: {
        [`department:${p.departmentId}`]: week(),
        [`station:${p.stationId}`]: week(),
      },
    });
    await answers(
      await p.call("PUT", path, p.manager, { edits: [{ area: p.dept, weekday: 0, blocks: [] }] }),
      204,
    );
    const read = (await (await p.call("GET", path, p.manager)).json()) as {
      areas: { weekdays: unknown }[];
    };
    expect(read.areas.map((a) => a.weekdays)).toEqual([week(), week({ 6: [night] })]);
  });

  it("refuses a malformed season edit as staffing.invalid naming the field", async () => {
    const p = await painted();
    const path = `${STAFFING}/seasons/${p.seasonId}`;
    const ok = { area: p.dept, weekday: 1, blocks: [p.block()] };
    const invalid = async (body: unknown, field: string) =>
      answers(
        await p.call("PUT", path, p.manager, body),
        400,
        refusal("staffing.invalid", { field }),
      );
    await invalid({}, "edits");
    await invalid({ edits: "x" }, "edits");
    await invalid({ edits: [ok, 3] }, "edits.1");
    await invalid({ edits: [ok, null] }, "edits.1");
    await invalid({ edits: [ok, []] }, "edits.1");
    await invalid({ edits: [{ ...ok, extra: 1 }] }, "edits.0.extra");
    await invalid({ edits: [ok, { ...ok, weekday: 7 }] }, "edits.1.weekday");
    await invalid({ edits: [ok, { ...ok, weekday: -1 }] }, "edits.1.weekday");
    await invalid({ edits: [ok, { ...ok, weekday: 1.5 }] }, "edits.1.weekday");
    await invalid({ edits: [ok, { ...ok, weekday: "1" }] }, "edits.1.weekday");
    await invalid({ edits: [{ area: p.dept, blocks: [] }] }, "edits.0.weekday");
    await invalid(
      { edits: [{ ...ok, area: { kind: "zone", id: p.departmentId } }] },
      "edits.0.area.kind",
    );
    await invalid({ edits: [{ area: p.dept, weekday: 1 }] }, "edits.0.blocks");
    await invalid(
      { edits: [{ ...ok, blocks: [p.block(), p.block(), p.block({ headcount: 51 })] }] },
      "edits.0.blocks.2.headcount",
    );
    // With the default 06:00 changeover, 05:00–07:00 crosses from one business day into the next.
    await invalid(
      { edits: [{ ...ok, blocks: [p.block({ startsAt: "05:00", endsAt: "07:00" })] }] },
      "edits.0.blocks.0.endsAt",
    );
    await answers(
      await p.call("PUT", path, p.manager, { edits: [ok], extra: true }),
      400,
      refusal("management.request_invalid", { field: "extra" }),
    );
    const read = (await (await p.call("GET", path, p.manager)).json()) as {
      areas: { weekdays: unknown }[];
    };
    expect(read.areas.map((a) => a.weekdays)).toEqual([week(), week()]);
  });

  it("validates a block against the location's own changeover", async () => {
    const p = await painted();
    await withTransaction(suite.db, (tx) =>
      tx
        .update(locations)
        .set({ dayCutover: "03:00:00" })
        .where(eq(locations.id, p.cfg.locationId)),
    );
    const path = `${STAFFING}/seasons/${p.seasonId}`;
    const late = p.block({ startsAt: "05:00", endsAt: "07:00" });
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [{ area: p.dept, weekday: 2, blocks: [late] }],
      }),
      204,
    );
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [
          { area: p.dept, weekday: 2, blocks: [p.block({ startsAt: "02:00", endsAt: "04:00" })] },
        ],
      }),
      400,
      refusal("staffing.invalid", { field: "edits.0.blocks.0.endsAt" }),
    );
  });

  it("answers a season elsewhere with 404, and an area or staff role the body names that is not the venue's with 400", async () => {
    const p = await painted();
    const other = await seedVenue(suite.db);
    const theirs = `${STAFFING}/seasons/${other.seasonId}`;
    await answers(
      await p.call("GET", theirs, p.manager),
      404,
      refusal("season.not_found", { seasonId: other.seasonId }),
    );
    await answers(
      await p.call("PUT", theirs, p.manager, { edits: [] }),
      404,
      refusal("season.not_found", { seasonId: other.seasonId }),
    );
    await answers(
      await p.call("GET", `${STAFFING}/seasons/not-a-uuid`, p.manager),
      400,
      refusal("shared.invalid_id", { kind: "SeasonId", value: "not-a-uuid" }),
    );
    const path = `${STAFFING}/seasons/${p.seasonId}`;
    const theirStation: AreaRef = { kind: "station", id: other.stationId };
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [{ area: theirStation, weekday: 1, blocks: [p.block()] }],
      }),
      400,
      refusal("staffing_area.not_found", { area: `station:${other.stationId}` }),
    );
    await setActive(p.dept, false);
    await answers(
      await p.call("PUT", path, p.manager, { edits: [{ area: p.dept, weekday: 1, blocks: [] }] }),
      400,
      refusal("staffing_area.not_found", { area: `department:${p.departmentId}` }),
    );
    const stranger = randomUUID();
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [{ area: p.grill, weekday: 1, blocks: [p.block({ staffRoleId: stranger })] }],
      }),
      400,
      refusal("staff_role.not_found", { staffRoleId: stranger }),
    );
  });

  it("saves a special day's dates as blocks, an empty row or the season, and reads them back", async () => {
    const p = await painted();
    const path = `${STAFFING}/special-days/${p.specialDayId}`;
    const lunch = p.block();
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [
          { area: p.dept, dateId: p.aug14, blocks: [lunch] },
          { area: p.dept, dateId: p.aug15, blocks: [] },
          { area: p.grill, dateId: p.aug15, blocks: [lunch] },
        ],
      }),
      204,
    );
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [{ area: p.grill, dateId: p.aug15, blocks: null }],
      }),
      204,
    );
    const noGuide = { [p.aug14]: [], [p.aug15]: [] };
    await answers(await p.call("GET", path, p.supervisor), 200, {
      cutover: "06:00",
      name: "Fiesta",
      guides: { [`department:${p.departmentId}`]: noGuide, [`station:${p.stationId}`]: noGuide },
      areas: [
        {
          area: p.dept,
          name: "Dining room",
          dates: [
            { dateId: p.aug14, date: "2026-08-14", blocks: [lunch] },
            { dateId: p.aug15, date: "2026-08-15", blocks: [] },
          ],
        },
        {
          area: p.grill,
          name: "Grill",
          dates: [
            { dateId: p.aug14, date: "2026-08-14", blocks: null },
            { dateId: p.aug15, date: "2026-08-15", blocks: null },
          ],
        },
      ],
    });
  });

  it("refuses a malformed special-day edit, a date not of the special day, an area elsewhere and an unknown staff role with 400, and a special day elsewhere with 404", async () => {
    const p = await painted();
    const path = `${STAFFING}/special-days/${p.specialDayId}`;
    const ok = { area: p.dept, dateId: p.aug14, blocks: null };
    const invalid = async (body: unknown, field: string) =>
      answers(
        await p.call("PUT", path, p.manager, body),
        400,
        refusal("staffing.invalid", { field }),
      );
    await invalid({ edits: null }, "edits");
    await invalid({ edits: [ok, "x"] }, "edits.1");
    await invalid({ edits: [{ ...ok, weekday: 1 }] }, "edits.0.weekday");
    await invalid({ edits: [{ area: p.dept, dateId: p.aug14 }] }, "edits.0.blocks");
    await invalid({ edits: [{ ...ok, blocks: "none" }] }, "edits.0.blocks");
    await invalid({ edits: [{ ...ok, dateId: "2026-08-14" }] }, "edits.0.dateId");
    await invalid({ edits: [{ ...ok, dateId: 5 }] }, "edits.0.dateId");
    await invalid({ edits: [{ area: p.dept, blocks: null }] }, "edits.0.dateId");
    await invalid({ edits: [{ ...ok, area: { kind: "station" } }] }, "edits.0.area.id");
    await invalid(
      { edits: [{ ...ok, blocks: [p.block({ startsAt: "12:10" })] }] },
      "edits.0.blocks.0.startsAt",
    );
    await answers(
      await p.call("PUT", path, p.manager, { edits: [], more: 1 }),
      400,
      refusal("management.request_invalid", { field: "more" }),
    );

    await invalid(
      { edits: [ok, { ...ok, dateId: randomUUID() }, { ...ok, dateId: randomUUID() }] },
      "edits.1.dateId",
    );
    const elsewhere = await seedVenue(suite.db);
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [{ ...ok, area: { kind: "station", id: elsewhere.stationId } }],
      }),
      400,
      refusal("staffing_area.not_found", { area: `station:${elsewhere.stationId}` }),
    );
    const stranger = randomUUID();
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [{ ...ok, blocks: [p.block({ staffRoleId: stranger })] }],
      }),
      400,
      refusal("staff_role.not_found", { staffRoleId: stranger }),
    );
    const [theirs] = await withTransaction(suite.db, (tx) =>
      tx
        .insert(specialDays)
        .values({ locationId: elsewhere.cfg.locationId, name: "Elsewhere" })
        .returning({ id: specialDays.id }),
    );
    const other = theirs!.id;
    await answers(
      await p.call("GET", `${STAFFING}/special-days/${other}`, p.manager),
      404,
      refusal("special_day.not_found", { specialDayId: other }),
    );
    await answers(
      await p.call("PUT", `${STAFFING}/special-days/${other}`, p.manager, { edits: [] }),
      404,
      refusal("special_day.not_found", { specialDayId: other }),
    );
    await answers(
      await p.call("PUT", `${STAFFING}/special-days/nope`, p.manager, { edits: [] }),
      400,
      refusal("shared.invalid_id", { kind: "SpecialDayId", value: "nope" }),
    );
  });

  it("keeps the later of two season edits for the same area and weekday", async () => {
    const p = await painted();
    const path = `${STAFFING}/seasons/${p.seasonId}`;
    const later = p.block({ headcount: 5, startsAt: "18:00", endsAt: "23:00" });
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [
          { area: p.dept, weekday: 5, blocks: [p.block()] },
          { area: p.dept, weekday: 5, blocks: [later] },
        ],
      }),
      204,
    );
    const read = (await (await p.call("GET", path, p.manager)).json()) as {
      areas: { weekdays: unknown }[];
    };
    expect(read.areas[0]!.weekdays).toEqual(week({ 5: [later] }));
  });

  it("keeps the later of two special-day edits for the same area and date", async () => {
    const p = await painted();
    const path = `${STAFFING}/special-days/${p.specialDayId}`;
    const later = p.block({ headcount: 5, startsAt: "18:00", endsAt: "23:00" });
    await answers(
      await p.call("PUT", path, p.manager, {
        edits: [
          { area: p.grill, dateId: p.aug14, blocks: [p.block()] },
          { area: p.grill, dateId: p.aug14, blocks: [later] },
        ],
      }),
      204,
    );
    const read = (await (await p.call("GET", path, p.manager)).json()) as {
      areas: { dates: { blocks: unknown }[] }[];
    };
    expect(read.areas[1]!.dates[0]!.blocks).toEqual([later]);
  });

  it("accepts upper-case spellings of every id", async () => {
    const p = await painted();
    const upperArea = (area: AreaRef): AreaRef => ({ ...area, id: area.id.toUpperCase() });
    const lunch = p.block();
    const shouted = { ...lunch, staffRoleId: lunch.staffRoleId.toUpperCase() };
    await answers(
      await p.call("PUT", `${STAFFING}/seasons/${p.seasonId.toUpperCase()}`, p.manager, {
        edits: [{ area: upperArea(p.dept), weekday: 3, blocks: [shouted] }],
      }),
      204,
    );
    const season = (await (
      await p.call("GET", `${STAFFING}/seasons/${p.seasonId.toUpperCase()}`, p.manager)
    ).json()) as { areas: { weekdays: unknown }[] };
    expect(season.areas[0]!.weekdays).toEqual(week({ 3: [lunch] }));
    const specialPath = `${STAFFING}/special-days/${p.specialDayId.toUpperCase()}`;
    await answers(
      await p.call("PUT", specialPath, p.manager, {
        edits: [{ area: upperArea(p.grill), dateId: p.aug15.toUpperCase(), blocks: [shouted] }],
      }),
      204,
    );
    const special = (await (await p.call("GET", specialPath, p.manager)).json()) as {
      areas: { dates: { blocks: unknown }[] }[];
    };
    expect(special.areas[1]!.dates[1]!.blocks).toEqual([lunch]);
  });

  it("lets a supervisor read the paint but not save it, and refuses staff and anonymous callers", async () => {
    const p = await painted();
    const notPermitted = async (response: Response) => {
      expect(response.status).toBe(403);
      const { error } = (await response.json()) as { error: { code: string } };
      expect(error.code).toBe("authorization.not_permitted");
    };
    const season = `${STAFFING}/seasons/${p.seasonId}`;
    const special = `${STAFFING}/special-days/${p.specialDayId}`;
    for (const path of [`${STAFFING}/areas`, season, special]) {
      await answers(await p.call("GET", path, p.supervisor), 200);
      await notPermitted(await p.call("GET", path, p.staff));
      await answers(await p.call("GET", path, ""), 401);
    }
    // The body is checked only once the caller is authorised, so a bad one is still a 403.
    await notPermitted(await p.call("PUT", season, p.supervisor, { edits: "x" }));
    await notPermitted(await p.call("PUT", special, p.supervisor, { edits: "x" }));
    await notPermitted(
      await p.call("PUT", season, p.supervisor, {
        edits: [{ area: p.dept, weekday: 1, blocks: [p.block()] }],
      }),
    );
    await answers(await p.call("PUT", season, "", { edits: [] }), 401);
  });
});

describe("the staffing month route", () => {
  it("reads a month's slot counts to a viewer", async () => {
    const p = await painted();
    await answers(
      await p.call("PUT", `${STAFFING}/seasons/${p.seasonId}`, p.manager, {
        edits: [{ area: p.grill, weekday: 5, blocks: [p.block({ headcount: 4 })] }],
      }),
      204,
    );
    const response = await p.call("GET", `${STAFFING}/month?month=2026-08`, p.supervisor);
    expect(response.status).toBe(200);
    const month = (await response.json()) as StaffingMonth;
    expect(month.month).toBe("2026-08");
    expect(month.days.find((d) => d.date === "2026-08-21")!.areas).toEqual([
      { area: p.grill, needed: 4, unfilled: null },
    ]);
    expect(month.days.find((d) => d.date === "2026-08-22")!.areas).toEqual([]);
  });

  it.each(["2026-13", "2026-1", "2026-08-01", "", undefined])(
    "refuses the month %j as management.request_invalid",
    async (month) => {
      const p = await painted();
      const query = month === undefined ? "" : `?month=${month}`;
      await answers(
        await p.call("GET", `${STAFFING}/month${query}`, p.manager),
        400,
        refusal("management.request_invalid", { field: "month" }),
      );
    },
  );

  it("refuses staff and anonymous callers", async () => {
    const p = await painted();
    const path = `${STAFFING}/month?month=2026-08`;
    const staff = await p.call("GET", path, p.staff);
    expect(staff.status).toBe(403);
    expect(((await staff.json()) as { error: { code: string } }).error.code).toBe(
      "authorization.not_permitted",
    );
    await answers(await p.call("GET", path, ""), 401);
  });
});

describe("the rota routes", () => {
  const root = "/management-api/staffing/rota";
  it("reads only Monday weeks and requires schedule.manage for every rota operation", async () => {
    const r = await routed();
    await answers(
      await r.call("GET", `${root}?week=2026-12-01`, r.manager),
      400,
      refusal("management.request_invalid", { field: "week" }),
    );
    const ok = await r.call("GET", `${root}?week=2026-11-30`, r.manager);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { week: string }).week).toBe("2026-11-30");
    for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
      const path =
        method === "GET"
          ? `${root}?week=2026-11-30`
          : method === "POST"
            ? `${root}/shifts`
            : `${root}/shifts/${randomUUID()}`;
      const body =
        method === "POST"
          ? {
              week: "2026-11-30",
              businessDay: "2026-12-01",
              personId: r.ana,
              area: { kind: "department", id: r.departmentId },
              staffRoleId: randomUUID(),
              startsAt: "09:00",
              endsAt: "15:00",
            }
          : method === "PATCH"
            ? {}
            : undefined;
      await answers(
        await r.call(method, path, r.staff, body),
        403,
        refusal("authorization.not_permitted", { permission: "schedule.manage" }),
      );
    }
  });
  it("fills a slot, patches and deletes it through the real routes, with scoped errors and strict bodies", async () => {
    const r = await routed();
    const role = await r.create("Waiter");
    const input = {
      week: "2026-11-30",
      businessDay: "2026-12-01",
      personId: r.ana,
      area: { kind: "department", id: r.departmentId },
      staffRoleId: role.id,
      startsAt: "09:00",
      endsAt: "15:00",
    };
    const created = await r.call("POST", `${root}/shifts`, r.manager, input);
    expect(created.status).toBe(201);
    const { shiftId } = (await created.json()) as { shiftId: string };
    await answers(
      await r.call("PATCH", `${root}/shifts/${shiftId}`, r.manager, { personId: r.marc }),
      204,
    );
    const week = (await (await r.call("GET", `${root}?week=2026-11-30`, r.manager)).json()) as {
      shifts: { shiftId: string; personId: string }[];
    };
    expect(week.shifts).toMatchObject([{ shiftId, personId: r.marc }]);
    await answers(
      await r.call("POST", `${root}/shifts`, r.manager, { ...input, versionId: randomUUID() }),
      400,
      refusal("management.request_invalid", { field: "versionId" }),
    );
    for (const field of ["startsAt", "endsAt", "area", "staffRoleId", "personId"]) {
      const response = await r.call("PATCH", `${root}/shifts/${shiftId}`, r.manager, {
        [field]: null,
      });
      expect(response.status).toBe(400);
    }
    const other = await routed();
    await answers(
      await other.call("DELETE", `${root}/shifts/${shiftId}`, other.manager),
      404,
      refusal("shift.not_found", { shiftId }),
    );
    await answers(await r.call("DELETE", `${root}/shifts/${shiftId}`, r.manager), 204);
    await answers(
      await r.call("DELETE", `${root}/shifts/${shiftId}`, r.manager),
      404,
      refusal("shift.not_found", { shiftId }),
    );
  });
});

describe("Rota body references", () => {
  it("refuses an unknown area or staff role in a request body as a bad request", async () => {
    const r = await routed();
    const role = await r.create("Waiter");
    const root = "/management-api/staffing/rota/shifts";
    const input = {
      week: "2026-11-30",
      businessDay: "2026-12-01",
      personId: r.ana,
      area: { kind: "department", id: randomUUID() },
      staffRoleId: role.id,
      startsAt: "09:00",
      endsAt: "15:00",
    };
    await answers(
      await r.call("POST", root, r.manager, input),
      400,
      refusal("staffing_area.not_found", { area: `department:${input.area.id}` }),
    );
    const created = await r.call("POST", root, r.manager, {
      ...input,
      area: { kind: "department", id: r.departmentId },
    });
    expect(created.status).toBe(201);
    const { shiftId } = (await created.json()) as { shiftId: string };
    await answers(
      await r.call("PATCH", `${root}/${shiftId}`, r.manager, { area: input.area }),
      400,
      refusal("staffing_area.not_found", { area: `department:${input.area.id}` }),
    );
    const badRole = randomUUID();
    await answers(
      await r.call("POST", root, r.manager, {
        ...input,
        area: { kind: "department", id: r.departmentId },
        staffRoleId: badRole,
      }),
      400,
      refusal("staff_role.not_found", { staffRoleId: badRole }),
    );
  });
});

describe("changing a week through the route", () => {
  const root = "/management-api/staffing/rota";
  it("requires schedule.manage and strictly validates the week body before copying", async () => {
    const r = await routed();
    await answers(
      await r.call("POST", `${root}/change-week`, r.staff, { week: "2026-11-30" }),
      403,
      refusal("authorization.not_permitted", { permission: "schedule.manage" }),
    );
    for (const body of [
      null,
      [],
      {},
      { week: null },
      { week: "2026-12-01" },
      { week: "2026-11-30", extra: true },
    ]) {
      expect((await r.call("POST", `${root}/change-week`, r.manager, body)).status).toBe(400);
    }
    await answers(
      await r.call("POST", `${root}/change-week`, r.manager, { week: "2026-11-30" }),
      400,
      refusal("staffing.invalid", { field: "week" }),
    );
  });
  it("refuses a non-object or malformed body as the body, and an unknown key by its name", async () => {
    const r = await routed();
    for (const body of ["x", "", 1, true, [], ["x"], null]) {
      await answers(
        await r.call("POST", `${root}/change-week`, r.manager, body),
        400,
        refusal("management.request_invalid", { field: "body" }),
      );
    }
    for (const body of [undefined, "", "{"]) {
      await answers(
        await r.app.request(`${root}/change-week`, {
          method: "POST",
          headers: { cookie: r.manager, "content-type": "application/json" },
          body,
        }),
        400,
        refusal("management.request_invalid", { field: "body" }),
      );
    }
    await answers(
      await r.call("POST", `${root}/change-week`, r.manager, { week: "2026-11-30", extra: true }),
      400,
      refusal("management.request_invalid", { field: "extra" }),
    );
    await answers(
      await r.call("POST", `${root}/change-week`, r.staff, "x"),
      400,
      refusal("management.request_invalid", { field: "body" }),
    );
  });
  it("copies only the route's location, returning the new version and pending swap list", async () => {
    const r = await routed(),
      role = await r.create("Waiter");
    const added = await r.call("POST", `${root}/shifts`, r.manager, {
      week: "2026-11-30",
      businessDay: "2026-12-01",
      personId: r.ana,
      area: { kind: "department", id: r.departmentId },
      staffRoleId: role.id,
      startsAt: "09:00",
      endsAt: "15:00",
    });
    expect(added.status).toBe(201);
    const week = (await (await r.call("GET", `${root}?week=2026-11-30`, r.manager)).json()) as {
      version: { id: string };
    };
    await withTransaction(suite.db, (t) =>
      new WorkforceBackend().publishRoster(t, { versionId: week.version.id }),
    );
    const response = await r.call("POST", `${root}/change-week`, r.manager, { week: "2026-11-30" });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { versionId: string; openSwaps: unknown[] };
    expect(result.versionId).not.toBe(week.version.id);
    expect(result.openSwaps).toEqual([]);
    expect(
      (await r.call("POST", `${root}/change-week`, r.manager, { week: "2026-11-30" })).status,
    ).toBe(409);
  });
});

it("A724 paint routes carry exact period metadata for season and special-day guides", async () => {
  const p = await painted();
  const periodId = await withTransaction(suite.db, async (tx) => {
    const menuId = randomUUID();
    await tx.insert(catalogues).values({ id: menuId, name: "Lunch menu" });
    const [period] = await tx
      .insert(menuPeriods)
      .values({ departmentId: p.departmentId, menuId, name: "Lunch", colour: "blue" })
      .returning();
    const [day] = await tx
      .insert(departmentDays)
      .values({ departmentId: p.departmentId, seasonId: p.seasonId, weekday: 5 })
      .returning();
    await tx.insert(departmentDayRanges).values({
      departmentId: p.departmentId,
      dayId: day!.id,
      periodId: period!.id,
      startsAt: "12:00:00",
      endsAt: "16:00:00",
    });
    return period!.id;
  });
  const guide = {
    periodId,
    periodName: "Lunch",
    periodColour: "blue",
    departmentId: p.departmentId,
    departmentName: "Dining room",
    startsAt: "12:00",
    endsAt: "16:00",
  };
  const season = await p.call("GET", `${STAFFING}/seasons/${p.seasonId}`, p.supervisor);
  expect(season.status).toBe(200);
  expect((await season.json()).guides).toEqual({
    [`department:${p.departmentId}`]: { ...week(), 5: [guide] },
    [`station:${p.stationId}`]: week(),
  });
  const special = await p.call("GET", `${STAFFING}/special-days/${p.specialDayId}`, p.supervisor);
  expect(special.status).toBe(200);
  expect((await special.json()).guides).toEqual({
    [`department:${p.departmentId}`]: { [p.aug14]: [guide], [p.aug15]: [] },
    [`station:${p.stationId}`]: { [p.aug14]: [], [p.aug15]: [] },
  });
});
