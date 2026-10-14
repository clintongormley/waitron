import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
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
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS, shifts } from "@waitron/workforce";
import { seedVenue } from "../test/seed.js";
import { STAFFING_MIGRATIONS } from "./migrations.js";
import { STAFFING_PERMISSIONS } from "./permissions.js";
import { STAFFING_ROUTES } from "./routes.js";
import { shiftAssignments } from "./schema/staffing.js";
import type { StaffRole } from "./staffing-types.js";

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
    const session = async (role: PersonRoleValue) => {
      const [row] = await tx
        .insert(persons)
        .values({ displayName: `${role} ${randomUUID()}`, pinHash: hashPin("1234"), role })
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
  const send = (
    method: "GET" | "POST" | "PUT" | "DELETE",
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
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const create = async (name: string) => {
    const response = await send("POST", "", cookies.manager, { name, colour: "blue" });
    expect(response.status).toBe(201);
    return (await response.json()) as StaffRole;
  };
  return { ...venue, ...cookies, send, create };
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
    const role = (await response.json()) as StaffRole;
    expect(role).toEqual({
      id: role.id,
      name: "Waiter",
      colour: "green",
      position: 0,
      holderIds: [],
      blockCount: 0,
      shiftCount: 0,
    });
    await answers(await r.send("GET", "", r.supervisor), 200, { staffRoles: [role] });
  });

  it("updates a role, sets its holders and deletes it", async () => {
    const r = await routed();
    const role = await r.create("Waiter");
    await answers(
      await r.send("PUT", `/${role.id}`, r.manager, { name: "Head waiter", colour: "red" }),
      200,
      { ...role, name: "Head waiter", colour: "red" },
    );
    await answers(
      await r.send("PUT", `/${role.id}/holders`, r.manager, { personIds: [r.ana, r.marc] }),
      200,
      { ...role, name: "Head waiter", colour: "red", holderIds: [r.ana, r.marc].sort() },
    );
    const deleted = await r.send("DELETE", `/${role.id}`, r.manager);
    expect(deleted.status).toBe(204);
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
    await answers(
      await r.send("PUT", "/order", r.manager, { staffRoleIds: [b.id, randomUUID()] }),
      400,
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
    const role = await r.create("Waiter");
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
      await r.send("POST", "", r.manager, { name: "Cook", colour: "teal" }),
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
      await r.send("PUT", `/${role.id}/holders`, r.manager, { personIds: [randomUUID()] }),
      400,
      refusal("staffing.invalid", { field: "personIds" }),
    );
    await answers(await r.send("DELETE", "/not-a-uuid", r.manager), 400);

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
        .values({ shiftId: shift!.id, departmentId: r.departmentId, staffRoleId: role.id });
    });
    await answers(
      await r.send("DELETE", `/${role.id}`, r.manager),
      409,
      refusal("staff_role.in_use", { staffRoleId: role.id, shiftCount: 1 }),
    );
  });

  it("refuses a malformed body and an extra key", async () => {
    const r = await routed();
    const role = await r.create("Waiter");
    await answers(
      await r.send("POST", "", r.manager, { name: "Cook", colour: "blue", position: 3 }),
      400,
      refusal("management.request_invalid", { field: "position" }),
    );
    await answers(
      await r.send("PUT", `/${role.id}`, r.manager, { name: 5, colour: "blue" }),
      400,
      refusal("management.request_invalid", { field: "name" }),
    );
    await answers(
      await r.send("PUT", `/${role.id}`, r.manager, { name: "Cook", colour: 1 }),
      400,
      refusal("management.request_invalid", { field: "colour" }),
    );
    await answers(
      await r.send("PUT", `/${role.id}/holders`, r.manager, { personIds: [r.ana], extra: 1 }),
      400,
      refusal("management.request_invalid", { field: "extra" }),
    );
    await answers(
      await r.send("PUT", `/${role.id}/holders`, r.manager, { personIds: ["nope"] }),
      400,
      refusal("management.request_invalid", { field: "personIds" }),
    );
    await answers(
      await r.send("PUT", "/order", r.manager, { staffRoleIds: [role.id], more: true }),
      400,
      refusal("management.request_invalid", { field: "more" }),
    );
  });

  it("lets a supervisor read but not write, and refuses staff and anonymous callers", async () => {
    const r = await routed();
    const role = await r.create("Waiter");
    const notPermitted = (response: Response) => answers(response, 403);
    await answers(await r.send("GET", "", r.supervisor), 200);
    await notPermitted(await r.send("GET", "", r.staff));
    await notPermitted(await r.send("POST", "", r.supervisor, { name: "Cook", colour: "blue" }));
    await notPermitted(
      await r.send("PUT", `/${role.id}`, r.supervisor, { name: "Cook", colour: "blue" }),
    );
    await notPermitted(await r.send("PUT", `/${role.id}/holders`, r.supervisor, { personIds: [] }));
    await notPermitted(await r.send("PUT", "/order", r.supervisor, { staffRoleIds: [role.id] }));
    await notPermitted(await r.send("DELETE", `/${role.id}`, r.supervisor));
    const refused = await r.send("GET", "", r.staff);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "authorization.not_permitted",
    );
    await answers(await r.send("GET", "", ""), 401);
  });
});
