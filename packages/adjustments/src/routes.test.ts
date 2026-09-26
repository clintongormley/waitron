import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashPin,
  IDENTITY_MIGRATIONS,
  persons,
  registerModulePermissions,
  startManagementSession,
  type PersonRoleValue,
} from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import { ADJUSTMENTS_PERMISSIONS } from "./permissions.js";
import { ADJUSTMENTS_ROUTES } from "./routes.js";

// A manager holds `adjustment.manage` only once the module's seat is registered, as boot does.
registerModulePermissions(ADJUSTMENTS_PERMISSIONS);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, ADJUSTMENTS_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const REASONS = "/management-api/adjustments/reasons";
const ORDER = "/management-api/adjustments/reason-order";
const MISSING = "00000000-0000-4000-8000-00000000dead";
const noopLog: Logger = () => {};

const COMPLAINT = {
  name: "Complaint",
  names: { en: "Complaint", es: "Queja" },
  actions: ["comp", "discount_percent"],
  maxPercentBp: 5000,
  maxAmount: "30.00",
  applyRole: "supervisor",
  approverRole: "manager",
  noteRequired: true,
};

interface Fixture {
  app: Hono;
  cookie: Record<PersonRoleValue, string>;
}

async function fixture(): Promise<Fixture> {
  await seedTenant(db);
  const cookie = {} as Record<PersonRoleValue, string>;
  await db.transaction(async (tx) => {
    for (const role of ["staff", "supervisor", "manager", "admin"] as const) {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: `A ${role}`, pinHash: hashPin("1234"), role })
        .returning({ id: persons.id });
      const session = await startManagementSession(tx, { personId: person!.id });
      cookie[role] = `${MANAGEMENT_COOKIE}=${session.token}`;
    }
  });
  const app = new Hono();
  ADJUSTMENTS_ROUTES.mount(
    app,
    {
      db,
      cfg: { locationId: locationId("00000000-0000-4000-8000-000000000001") },
      core: {} as ModuleRouteContext["core"],
    },
    noopLog,
  );
  return { app, cookie };
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  cookie?: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function reasonCount(): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`select count(*) as n from adjustment_reasons`);
  return result.rows[0]!.n;
}

describe("adjustment reason management routes", () => {
  it("lets a manager create, edit, reorder and deactivate reasons", async () => {
    const fx = await fixture();
    const manager = fx.cookie.manager;
    expect(await (await send(fx.app, "GET", REASONS, manager)).json()).toEqual({ reasons: [] });

    const created = await send(fx.app, "POST", REASONS, manager, COMPLAINT);
    expect(created.status).toBe(201);
    const complaint = (await created.json()) as { id: string };
    expect(complaint).toEqual({ id: expect.any(String), ...COMPLAINT, active: true, position: 0 });
    const second = (await (
      await send(fx.app, "POST", REASONS, manager, {
        ...COMPLAINT,
        name: "Entry error",
        names: {},
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRole: "staff",
        approverRole: "staff",
        noteRequired: false,
      })
    ).json()) as { id: string };

    const edited = await send(fx.app, "PUT", `${REASONS}/${complaint.id}`, manager, {
      ...COMPLAINT,
      maxAmount: "45.50",
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ id: complaint.id, maxAmount: "45.50" });

    expect(
      (await send(fx.app, "PUT", ORDER, manager, { ids: [second.id, complaint.id] })).status,
    ).toBe(204);
    const listed = (await (await send(fx.app, "GET", REASONS, manager)).json()) as {
      reasons: { id: string; position: number }[];
    };
    expect(listed.reasons.map((r) => [r.id, r.position])).toEqual([
      [second.id, 0],
      [complaint.id, 1],
    ]);

    expect((await send(fx.app, "DELETE", `${REASONS}/${second.id}`, manager)).status).toBe(204);
    const active = (await (await send(fx.app, "GET", REASONS, manager)).json()) as {
      reasons: { id: string }[];
    };
    expect(active.reasons.map((r) => r.id)).toEqual([complaint.id]);
    const all = (await (
      await send(fx.app, "GET", `${REASONS}?includeInactive=true`, manager)
    ).json()) as { reasons: { id: string; active: boolean }[] };
    expect(all.reasons.map((r) => [r.id, r.active])).toEqual([
      [second.id, false],
      [complaint.id, true],
    ]);
  });

  it("lets an admin manage reasons too", async () => {
    const fx = await fixture();
    expect((await send(fx.app, "POST", REASONS, fx.cookie.admin, COMPLAINT)).status).toBe(201);
  });

  it("refuses a supervisor or staff member, and writes nothing", async () => {
    const fx = await fixture();
    for (const role of ["staff", "supervisor"] as const) {
      for (const [method, path, body] of [
        ["GET", REASONS, undefined],
        ["POST", REASONS, COMPLAINT],
        ["PUT", `${REASONS}/${MISSING}`, COMPLAINT],
        ["DELETE", `${REASONS}/${MISSING}`, undefined],
        ["PUT", ORDER, { ids: [] }],
      ] as const) {
        const response = await send(fx.app, method, path, fx.cookie[role], body);
        expect(response.status, `${role} ${method} ${path}`).toBe(403);
        expect(await response.json()).toEqual({
          error: {
            code: "authorization.not_permitted",
            params: { permission: "adjustment.manage" },
          },
        });
      }
    }
    expect(await reasonCount()).toBe(0);
  });

  it("refuses a request with no management session", async () => {
    const fx = await fixture();
    const response = await send(fx.app, "POST", REASONS, undefined, COMPLAINT);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "management_session.required" },
    });
    expect(await reasonCount()).toBe(0);
  });

  it("answers a taken name with 409 and an unknown reason with 404", async () => {
    const fx = await fixture();
    const manager = fx.cookie.manager;
    await send(fx.app, "POST", REASONS, manager, COMPLAINT);
    const taken = await send(fx.app, "POST", REASONS, manager, COMPLAINT);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({
      error: { code: "adjustment_reason.name_taken", params: { name: "Complaint" } },
    });
    for (const [method, body] of [
      ["PUT", COMPLAINT],
      ["DELETE", undefined],
    ] as const) {
      const missing = await send(fx.app, method, `${REASONS}/${MISSING}`, manager, body);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({
        error: { code: "adjustment_reason.not_found", params: { reasonId: MISSING } },
      });
    }
    const malformed = await send(fx.app, "DELETE", `${REASONS}/not-a-uuid`, manager);
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
  });

  it.each<[string, Record<string, unknown>]>([
    ["name", { name: 7 }],
    ["names", { names: null }],
    ["names", { names: ["Queja"] }],
    ["names", { names: { es: 7 } }],
    ["actions", { actions: "comp" }],
    ["actions", { actions: ["refund"] }],
    ["maxPercentBp", { maxPercentBp: undefined }],
    ["maxPercentBp", { maxPercentBp: "50" }],
    ["maxAmount", { maxAmount: undefined }],
    ["maxAmount", { maxAmount: 30 }],
    ["maxAmount", { maxAmount: "30.001" }],
    ["maxAmount", { maxAmount: "1e3" }],
    ["applyRole", { applyRole: "owner" }],
    ["approverRole", { approverRole: undefined }],
    ["noteRequired", { noteRequired: "yes" }],
  ])("refuses a body whose %s is malformed (%o), writing nothing", async (field, overrides) => {
    const fx = await fixture();
    const response = await send(fx.app, "POST", REASONS, fx.cookie.manager, {
      ...COMPLAINT,
      ...overrides,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field } },
    });
    expect(await reasonCount()).toBe(0);
  });

  it("refuses a reorder body that is not a list of ids", async () => {
    const fx = await fixture();
    for (const body of [{}, { ids: "x" }, { ids: ["not-a-uuid"] }]) {
      const response = await send(fx.app, "PUT", ORDER, fx.cookie.manager, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "ids" } },
      });
    }
  });
});
