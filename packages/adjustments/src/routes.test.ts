import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  locations,
  withTransaction,
  workingOrderLines,
  workingOrders,
  type Database,
} from "@waitron/db";
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
import { decimal, locationId } from "@waitron/shared";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import { ADJUSTMENTS_PERMISSIONS } from "./permissions.js";
import { policySnapshotOf } from "./policy.js";
import { recordAdjustment } from "./record.js";
import { ADJUSTMENTS_ROUTES } from "./routes.js";
import { seedReason, seedWorkingOrder } from "../test/seed.js";

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
  names: { en: "Complaint", es: "Complaint (es)" },
  kind: "comp",
  actions: ["comp", "discount_percent"],
  maxPercentBp: null,
  maxAmount: "30.00",
  applyRoles: ["supervisor", "manager", "admin"],
  approverRoles: ["manager", "admin"],
  noteRequired: true,
};

const OTHER = {
  name: "Other",
  names: { en: "Other", es: "Other (es)" },
  kind: "void",
  actions: ["cancel"],
  maxPercentBp: null,
  maxAmount: null,
  applyRoles: [],
  approverRoles: [],
  noteRequired: true,
};

interface Fixture {
  app: Hono;
  cookie: Record<PersonRoleValue, string>;
}

async function fixture(venueLocation = "00000000-0000-4000-8000-000000000001"): Promise<Fixture> {
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
      cfg: { locationId: locationId(venueLocation) },
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
  it("lets a manager create, edit, reorder and delete reasons", async () => {
    const fx = await fixture();
    const manager = fx.cookie.manager;
    expect(await (await send(fx.app, "GET", REASONS, manager)).json()).toEqual({ reasons: [] });

    const created = await send(fx.app, "POST", REASONS, manager, COMPLAINT);
    expect(created.status).toBe(201);
    const complaint = (await created.json()) as { id: string };
    expect(complaint).toEqual({ id: expect.any(String), ...COMPLAINT, position: 0 });
    const second = (await (
      await send(fx.app, "POST", REASONS, manager, {
        ...OTHER,
        name: "Entry error",
        names: {},
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

    expect((await send(fx.app, "DELETE", `${REASONS}/${complaint.id}`, manager)).status).toBe(204);
    const remaining = (await (await send(fx.app, "GET", REASONS, manager)).json()) as {
      reasons: { id: string }[];
    };
    expect(remaining.reasons.map((r) => r.id)).toEqual([second.id]);
    const again = await send(fx.app, "DELETE", `${REASONS}/${complaint.id}`, manager);
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({
      error: { code: "adjustment_reason.not_found", params: { reasonId: complaint.id } },
    });
  });

  it("refuses a supervisor or staff member a Delete of an existing reason, and keeps it", async () => {
    const fx = await fixture();
    const reason = (await (
      await send(fx.app, "POST", REASONS, fx.cookie.manager, COMPLAINT)
    ).json()) as { id: string };
    for (const role of ["staff", "supervisor"] as const) {
      const response = await send(fx.app, "DELETE", `${REASONS}/${reason.id}`, fx.cookie[role]);
      expect(response.status, role).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: "authorization.not_permitted", params: { permission: "adjustment.manage" } },
      });
    }
    const listed = (await (await send(fx.app, "GET", REASONS, fx.cookie.manager)).json()) as {
      reasons: { id: string }[];
    };
    expect(listed.reasons.map((r) => r.id)).toEqual([reason.id]);
  });

  it("deletes a reason that past adjustments name, leaving them as they were", async () => {
    const fx = await fixture();
    const reason = await seedReason(db);
    const workingOrderId = await seedWorkingOrder(db);
    await withTransaction(db, (tx) =>
      recordAdjustment(tx, {
        workingOrderId,
        line: {
          id: randomUUID(),
          name: "Paella",
          quantity: "1",
          listUnitPriceGross: decimal("20.00"),
          creditedTo: null,
          stage: "served",
        },
        quantity: "1",
        reason: { id: reason.id, name: reason.name, policy: policySnapshotOf(reason) },
        action: "comp",
        percentBp: null,
        beforeAmount: decimal("20.00"),
        afterAmount: decimal("0.00"),
        reduction: decimal("20.00"),
        nominalValue: decimal("20.00"),
        requestedBy: randomUUID(),
        approvedBy: null,
        note: null,
      }),
    );
    const recorded = sql`select reason_id, reason_name from adjustments`;
    const before = (await db.execute(recorded)).rows;
    expect(before).toEqual([{ reason_id: reason.id, reason_name: reason.name }]);

    const response = await send(fx.app, "DELETE", `${REASONS}/${reason.id}`, fx.cookie.manager);

    expect(response.status).toBe(204);
    expect((await db.execute(recorded)).rows).toEqual(before);
    expect(await reasonCount()).toBe(0);
  });
  it("reads a reason's delete impact for a manager or an admin, and refuses anyone else", async () => {
    const fx = await fixture();
    const comp = (await (
      await send(fx.app, "POST", REASONS, fx.cookie.manager, COMPLAINT)
    ).json()) as { id: string };
    const other = (await (
      await send(fx.app, "POST", REASONS, fx.cookie.manager, OTHER)
    ).json()) as {
      id: string;
    };
    const impact = (reasonId: string) => `${REASONS}/${reasonId}/delete-impact`;

    for (const role of ["manager", "admin"] as const) {
      const served = await send(fx.app, "GET", impact(comp.id), fx.cookie[role]);
      expect(served.status, role).toBe(200);
      expect(await served.json()).toEqual({
        target: { id: comp.id, name: "Complaint" },
        refusals: [],
        ends: [],
        removes: [],
      });
    }
    const refused = await send(fx.app, "GET", impact(other.id), fx.cookie.manager);
    expect(refused.status).toBe(200);
    expect(await refused.json()).toEqual({
      target: { id: other.id, name: "Other" },
      refusals: [{ code: "adjustment_reason.void_required", params: { withNote: 0 }, targets: [] }],
      ends: [],
      removes: [],
    });

    for (const role of ["staff", "supervisor"] as const) {
      const response = await send(fx.app, "GET", impact(comp.id), fx.cookie[role]);
      expect(response.status, role).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: "authorization.not_permitted", params: { permission: "adjustment.manage" } },
      });
    }
    const anonymous = await send(fx.app, "GET", impact(comp.id));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({
      error: { code: "management_session.required" },
    });

    const missing = await send(fx.app, "GET", impact(MISSING), fx.cookie.manager);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: "adjustment_reason.not_found", params: { reasonId: MISSING } },
    });
    const malformed = await send(fx.app, "GET", impact("not-a-uuid"), fx.cookie.manager);
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
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

  it("answers an unknown reason in the reorder body with 400 and preserves the order", async () => {
    const fx = await fixture();
    const manager = fx.cookie.manager;
    await send(fx.app, "POST", REASONS, manager, COMPLAINT);
    const before = await (await send(fx.app, "GET", REASONS, manager)).json();

    const response = await send(fx.app, "PUT", ORDER, manager, { ids: [MISSING] });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "adjustment_reason.not_found", params: { reasonId: MISSING } },
    });
    expect(await (await send(fx.app, "GET", REASONS, manager)).json()).toEqual(before);
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
    ["names", { names: ["Complaint (es)"] }],
    ["names", { names: { es: 7 } }],
    ["actions", { actions: "comp" }],
    ["actions", { actions: ["refund"] }],
    ["maxPercentBp", { maxPercentBp: undefined }],
    ["maxPercentBp", { maxPercentBp: "50" }],
    ["maxAmount", { maxAmount: undefined }],
    ["maxAmount", { maxAmount: 30 }],
    ["maxAmount", { maxAmount: "30.001" }],
    ["maxAmount", { maxAmount: "1e3" }],
    ["kind", { kind: undefined }],
    ["kind", { kind: "refund" }],
    ["applyRoles", { applyRoles: "staff" }],
    ["applyRoles", { applyRoles: undefined }],
    ["applyRoles", { applyRoles: [] }],
    ["applyRoles", { applyRoles: ["staff", "staff"] }],
    ["applyRoles", { applyRoles: ["chef"] }],
    ["approverRoles", { approverRoles: undefined }],
    ["approverRoles", { approverRoles: [] }],
    ["approverRoles", { approverRoles: ["manager", "manager"] }],
    ["approverRoles", { approverRoles: [7] }],
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

  it.each<[string, Record<string, unknown>, unknown]>([
    [
      "a name key that is not a language",
      { names: { en: "Complaint", "not a language": "Complaint (es)" } },
      { code: "adjustment_reason.invalid", params: { field: "names" } },
    ],
    [
      "a blank name",
      { name: "   " },
      { code: "adjustment_reason.invalid", params: { field: "name" } },
    ],
    [
      "a Comp reason offering Free under a full item limit",
      { maxPercentBp: 5000 },
      { code: "adjustment_reason.invalid", params: { field: "maxPercentBp" } },
    ],
    [
      "a Void reason holding a role",
      { ...OTHER, applyRoles: ["staff"] },
      { code: "adjustment_reason.invalid", params: { field: "applyRoles" } },
    ],
  ])("answers %s with 400, writing nothing", async (_case, overrides, error) => {
    const fx = await fixture();
    const response = await send(fx.app, "POST", REASONS, fx.cookie.manager, {
      ...COMPLAINT,
      ...overrides,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(await reasonCount()).toBe(0);
  });

  it("answers a reorder that leaves out a reason with 400", async () => {
    const fx = await fixture();
    await send(fx.app, "POST", REASONS, fx.cookie.manager, COMPLAINT);
    const response = await send(fx.app, "PUT", ORDER, fx.cookie.manager, { ids: [] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "adjustment_reason.invalid", params: { field: "ids" } },
    });
  });

  it("takes a Void reason with no role lists, as the reason screen sends one", async () => {
    const fx = await fixture();
    const response = await send(fx.app, "POST", REASONS, fx.cookie.manager, OTHER);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: expect.any(String),
      ...OTHER,
      position: 0,
    });
  });

  it("answers deleting the last Void reason, or the last that asks for a note, with 409 and its withNote", async () => {
    const fx = await fixture();
    const manager = fx.cookie.manager;
    const other = (await (await send(fx.app, "POST", REASONS, manager, OTHER)).json()) as {
      id: string;
    };

    const last = await send(fx.app, "DELETE", `${REASONS}/${other.id}`, manager);
    expect(last.status).toBe(409);
    expect(await last.json()).toEqual({
      error: { code: "adjustment_reason.void_required", params: { withNote: false } },
    });
    const turned = await send(fx.app, "PUT", `${REASONS}/${other.id}`, manager, {
      ...COMPLAINT,
      name: "Other",
    });
    expect(turned.status).toBe(409);
    expect(await turned.json()).toEqual({
      error: { code: "adjustment_reason.void_required", params: { withNote: false } },
    });

    await send(fx.app, "POST", REASONS, manager, {
      ...OTHER,
      name: "Mistake",
      noteRequired: false,
    });
    const lastWithNote = await send(fx.app, "DELETE", `${REASONS}/${other.id}`, manager);
    expect(lastWithNote.status).toBe(409);
    expect(await lastWithNote.json()).toEqual({
      error: { code: "adjustment_reason.void_required", params: { withNote: true } },
    });
    const listed = (await (await send(fx.app, "GET", REASONS, manager)).json()) as {
      reasons: { id: string; kind: string; noteRequired: boolean }[];
    };
    expect(listed.reasons.find((r) => r.id === other.id)).toMatchObject({
      kind: "void",
      noteRequired: true,
    });

    await send(fx.app, "POST", REASONS, manager, { ...OTHER, name: "Wrong table" });
    expect((await send(fx.app, "DELETE", `${REASONS}/${other.id}`, manager)).status).toBe(204);
  });

  it("keeps one of two Void reasons deleted together, refusing the other with 409", async () => {
    const fx = await fixture();
    const manager = fx.cookie.manager;
    const pair = [
      (await (await send(fx.app, "POST", REASONS, manager, OTHER)).json()) as { id: string },
      (await (
        await send(fx.app, "POST", REASONS, manager, { ...OTHER, name: "Mistake" })
      ).json()) as { id: string },
    ];

    const responses = await Promise.all(
      pair.map((reason) => send(fx.app, "DELETE", `${REASONS}/${reason.id}`, manager)),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([204, 409]);
    const listed = (await (await send(fx.app, "GET", REASONS, manager)).json()) as {
      reasons: { id: string }[];
    };
    expect(listed.reasons).toHaveLength(1);
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

describe("adjustment settings routes", () => {
  const SETTINGS = "/management-api/adjustments/settings";
  const LIMIT = { maxBillComp: "40.00", billApproverRoles: ["supervisor", "manager"] };

  async function stored(): Promise<unknown[]> {
    return (
      await db.execute(sql`select max_bill_comp, bill_approver_roles from adjustment_settings`)
    ).rows;
  }

  it("lets a manager read no limit, set one, and clear it again", async () => {
    const fx = await fixture();
    const manager = fx.cookie.manager;
    const empty = await send(fx.app, "GET", SETTINGS, manager);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({
      maxBillComp: null,
      billApproverRoles: ["manager", "admin"],
    });

    const saved = await send(fx.app, "PUT", SETTINGS, manager, LIMIT);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(LIMIT);
    expect(await (await send(fx.app, "GET", SETTINGS, manager)).json()).toEqual(LIMIT);

    await send(fx.app, "PUT", SETTINGS, fx.cookie.admin, {
      maxBillComp: null,
      billApproverRoles: ["admin"],
    });
    expect(await stored()).toEqual([{ max_bill_comp: null, bill_approver_roles: '["admin"]' }]);
  });

  it("refuses a supervisor or staff member, and writes nothing", async () => {
    const fx = await fixture();
    for (const role of ["staff", "supervisor"] as const) {
      for (const [method, body] of [
        ["GET", undefined],
        ["PUT", LIMIT],
      ] as const) {
        const response = await send(fx.app, method, SETTINGS, fx.cookie[role], body);
        expect(response.status, `${role} ${method}`).toBe(403);
        expect(await response.json()).toEqual({
          error: {
            code: "authorization.not_permitted",
            params: { permission: "adjustment.manage" },
          },
        });
      }
    }
    expect(await stored()).toEqual([]);
  });

  it("refuses a request with no management session", async () => {
    const fx = await fixture();
    const response = await send(fx.app, "PUT", SETTINGS, undefined, LIMIT);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "management_session.required" },
    });
    expect(await stored()).toEqual([]);
  });

  it.each<[string, string, Record<string, unknown>]>([
    ["maxBillComp", "missing", { maxBillComp: undefined }],
    ["maxBillComp", "a number", { maxBillComp: 40 }],
    ["maxBillComp", "zero", { maxBillComp: "0.00" }],
    ["maxBillComp", "a third decimal place", { maxBillComp: "40.001" }],
    ["billApproverRoles", "missing", { billApproverRoles: undefined }],
    ["billApproverRoles", "not a list", { billApproverRoles: "manager" }],
    ["billApproverRoles", "empty", { billApproverRoles: [] }],
    ["billApproverRoles", "a repeated role", { billApproverRoles: ["admin", "admin"] }],
    ["billApproverRoles", "an unknown role", { billApproverRoles: ["chef"] }],
  ])("refuses a %s that is %s, writing nothing", async (field, _case, overrides) => {
    const fx = await fixture();
    const response = await send(fx.app, "PUT", SETTINGS, fx.cookie.manager, {
      ...LIMIT,
      ...overrides,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field } },
    });
    expect(await stored()).toEqual([]);
  });
});

describe("adjustment report routes", () => {
  const REPORT = "/management-api/adjustments/report";
  const ENTRIES = "/management-api/adjustments/report/entries";
  // Business day 2026-09-15 in Madrid at a 05:00 cutover holds a bill opened at 18:00 UTC.
  const DAY = "from=2026-09-15&to=2026-09-15";

  interface ReportFixture extends Fixture {
    supervisorId: string;
    staffId: string;
    billId: string;
  }

  /** A venue in Madrid with one bill: a €20.00 line credited to the supervisor, who took €5.00
   * off it, and a guest's cancellation of a €4.00 item. */
  async function reportFixture(): Promise<ReportFixture> {
    const [location] = await db
      .insert(locations)
      .values({
        name: "Sala",
        invoiceLocales: ["es"],
        operationDescription: "Restaurante",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00:00",
      })
      .returning({ id: locations.id });
    const fx = await fixture(location!.id);
    const people = await db.select({ id: persons.id, role: persons.role }).from(persons);
    const idOf = (role: PersonRoleValue) => people.find((p) => p.role === role)!.id;
    const [bill] = await db
      .insert(workingOrders)
      .values({
        source: "dashboard",
        deviceId: null,
        locationId: location!.id,
        orderNumber: 41,
        openedAt: "2026-09-15T18:00:00.000Z",
      })
      .returning({ id: workingOrders.id });
    await db.insert(workingOrderLines).values({
      workingOrderId: bill!.id,
      lineNo: 1,
      name: "Paella",
      descriptions: { es: "Paella" },
      quantity: 1000,
      unitPriceGross: 1500,
      listUnitPriceGross: 2000,
      vatClass: "general",
      lineTotal: 1500,
      creditedTo: idOf("supervisor"),
    });
    const reason = await seedReason(db);
    const base = {
      workingOrderId: bill!.id,
      reason: { id: reason.id, name: reason.name, policy: policySnapshotOf(reason) },
      percentBp: null,
      approvedBy: null,
      note: null,
    };
    await withTransaction(db, async (tx) => {
      await recordAdjustment(tx, {
        ...base,
        line: {
          id: randomUUID(),
          name: "Paella",
          quantity: "1",
          listUnitPriceGross: decimal("20.00"),
          creditedTo: idOf("supervisor"),
          stage: "served",
        },
        quantity: "1",
        action: "discount_amount",
        beforeAmount: decimal("20.00"),
        afterAmount: decimal("15.00"),
        reduction: decimal("5.00"),
        nominalValue: decimal("20.00"),
        requestedBy: idOf("supervisor"),
      });
      await recordAdjustment(tx, {
        ...base,
        line: {
          id: randomUUID(),
          name: "Flan",
          quantity: "1",
          listUnitPriceGross: decimal("4.00"),
          creditedTo: null,
          stage: "unsent",
        },
        quantity: "1",
        action: "cancel",
        beforeAmount: decimal("4.00"),
        afterAmount: decimal("0.00"),
        reduction: decimal("4.00"),
        nominalValue: decimal("4.00"),
        requestedBy: idOf("staff"),
        byGuest: true,
      });
    });
    return { ...fx, supervisorId: idOf("supervisor"), staffId: idOf("staff"), billId: bill!.id };
  }

  it("answers a supervisor the day's report, amounts as decimal strings, read on the venue's clock", async () => {
    const fx = await reportFixture();

    const response = await send(fx.app, "GET", `${REPORT}?${DAY}`, fx.cookie.supervisor);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      fromBusinessDay: string;
      overall: Record<string, unknown>;
      people: Record<string, unknown>[];
      guests: Record<string, unknown>;
    };
    expect(body.fromBusinessDay).toBe("2026-09-15");
    expect(body.overall).toMatchObject({
      count: 2,
      reduction: "9.00",
      cancelledNominalValue: "4.00",
      // The guest's cancelled €4.00 stays in the day's sales.
      sales: "24.00",
      ratePercent: "37.5",
    });
    expect(body.people).toMatchObject([
      {
        personId: fx.supervisorId,
        name: "A supervisor",
        count: 1,
        reduction: "5.00",
        sales: "20.00",
        ratePercent: "25.0",
        byAction: {
          discount_amount: { count: 1, reduction: "5.00", cancelledNominalValue: "0.00" },
        },
      },
    ]);
    expect(body.guests).toMatchObject({ count: 1, reduction: "4.00" });
    // The bill was opened at 20:00 in Madrid on the 15th, so the 16th holds none of it.
    const nextDay = await send(
      fx.app,
      "GET",
      `${REPORT}?from=2026-09-16&to=2026-09-16`,
      fx.cookie.supervisor,
    );
    expect(((await nextDay.json()) as { overall: { count: number } }).overall.count).toBe(0);
  });

  it("drills down to everyone's rows, one person's, or the guests'", async () => {
    const fx = await reportFixture();
    const read = async (query: string) => {
      const response = await send(fx.app, "GET", `${ENTRIES}?${DAY}${query}`, fx.cookie.manager);
      expect(response.status).toBe(200);
      return ((await response.json()) as { entries: Record<string, unknown>[] }).entries;
    };

    const everyone = await read("");
    const supervisor = await read(`&personId=${fx.supervisorId.toUpperCase()}`);
    const guests = await read("&guests=true");
    const notGuests = await read("&guests=false");

    expect(everyone).toHaveLength(2);
    expect(notGuests).toEqual(everyone);
    expect(supervisor).toEqual([
      expect.objectContaining({
        action: "discount_amount",
        lineName: "Paella",
        reduction: "5.00",
        nominalValue: "20.00",
        requestedBy: { personId: fx.supervisorId, name: "A supervisor" },
        workingOrderId: fx.billId,
        orderNumber: 41,
      }),
    ]);
    expect(guests).toEqual([
      expect.objectContaining({
        action: "cancel",
        byGuest: true,
        requestedBy: { personId: fx.staffId, name: "A staff" },
      }),
    ]);
  });

  it("refuses a staff member without report.view, and a request with no session", async () => {
    const fx = await reportFixture();
    for (const path of [`${REPORT}?${DAY}`, `${ENTRIES}?${DAY}`]) {
      const refused = await send(fx.app, "GET", path, fx.cookie.staff);
      expect(refused.status, path).toBe(403);
      expect(await refused.json()).toEqual({
        error: { code: "authorization.not_permitted", params: { permission: "report.view" } },
      });
      const anonymous = await send(fx.app, "GET", path);
      expect(anonymous.status, path).toBe(401);
    }
  });

  it.each<[string, string]>([
    ["from", "to=2026-09-15"],
    ["from", "from=&to="],
    ["from", "from=2026-02-30&to=2026-03-01"],
    ["to", "from=2026-09-15"],
    ["to", "from=2026-09-15&to=15-09-2026"],
    ["range", "from=2026-09-16&to=2026-09-15"],
  ])("refuses a report whose %s is malformed (%s)", async (field, query) => {
    const fx = await reportFixture();
    for (const path of [REPORT, ENTRIES]) {
      const response = await send(fx.app, "GET", `${path}?${query}`, fx.cookie.manager);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
  });

  it("drills down a page at a time, each page naming the next until the last", async () => {
    const fx = await reportFixture();
    const read = async (query: string) => {
      const response = await send(fx.app, "GET", `${ENTRIES}?${DAY}${query}`, fx.cookie.manager);
      expect(response.status).toBe(200);
      return (await response.json()) as { entries: { id: string }[]; next: string | null };
    };

    const whole = await read("");
    const first = await read("&limit=1");
    const second = await read(`&limit=1&after=${encodeURIComponent(first.next!)}`);

    expect(whole.next).toBeNull();
    expect(first.entries).toEqual([whole.entries[0]]);
    expect(first.next).toEqual(expect.any(String));
    expect(second).toEqual({ entries: [whole.entries[1]], next: null });
  });

  it("refuses a drill-down whose person id is not a UUID", async () => {
    const fx = await reportFixture();
    const response = await send(
      fx.app,
      "GET",
      `${ENTRIES}?${DAY}&personId=not-a-uuid`,
      fx.cookie.manager,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "shared.invalid_id", params: { kind: "PersonId", value: "not-a-uuid" } },
    });
  });

  it.each<[string, string]>([
    ["guests", "&guests=yes"],
    ["guests", `&guests=true&personId=${MISSING}`],
    ["limit", "&limit="],
    ["limit", "&limit=0"],
    ["limit", "&limit=1.5"],
    ["limit", "&limit=01"],
    ["limit", "&limit=501"],
    ["limit", "&limit=ten"],
    ["after", "&after="],
    ["after", "&after=nope"],
    ["after", `&after=2026-09-15T20:00:00.000Z_not-a-uuid`],
    ["after", `&after=2026-09-15_${MISSING}`],
    ["after", `&after=2026-09-15T20:00:00.000Z${MISSING}`],
  ])("refuses a drill-down whose %s is malformed (%s)", async (field, query) => {
    const fx = await reportFixture();
    const response = await send(fx.app, "GET", `${ENTRIES}?${DAY}${query}`, fx.cookie.manager);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field } },
    });
  });

  describe("with no range asked for", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Only `Date`: the database and the request still run on real timers. */
    function nowIs(instant: string): void {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(instant));
    }

    it.each<[string, string, string, number]>([
      ["22:00 in Madrid", "2026-09-15T20:00:00.000Z", "2026-09-15", 2],
      ["04:30 in Madrid, before the 05:00 cutover", "2026-09-16T02:30:00.000Z", "2026-09-15", 2],
      ["05:30 in Madrid, after the cutover", "2026-09-16T03:30:00.000Z", "2026-09-16", 0],
    ])(
      "reads the venue's current business day at %s",
      async (_when, instant, businessDay, count) => {
        const fx = await reportFixture();
        nowIs(instant);

        const report = await send(fx.app, "GET", REPORT, fx.cookie.supervisor);
        const entries = await send(fx.app, "GET", ENTRIES, fx.cookie.supervisor);

        expect(report.status).toBe(200);
        expect(await report.json()).toMatchObject({
          fromBusinessDay: businessDay,
          toBusinessDay: businessDay,
          overall: { count },
        });
        expect(entries.status).toBe(200);
        expect(((await entries.json()) as { entries: unknown[] }).entries).toHaveLength(count);
      },
    );
  });

  it("answers a server fault when the module's location is not in the database", async () => {
    const fx = await fixture();
    const response = await send(fx.app, "GET", `${REPORT}?${DAY}`, fx.cookie.manager);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
  });
});
