import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  locations,
  tills,
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
import { seedReason } from "../test/seed.js";

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

  it.each<[string, Record<string, unknown>, unknown]>([
    [
      "a name key that is not a language",
      { names: { en: "Complaint", "not a language": "Queja" } },
      { code: "adjustment_reason.invalid", params: { field: "names" } },
    ],
    [
      "a blank name",
      { name: "   " },
      { code: "adjustment_reason.invalid", params: { field: "name" } },
    ],
    [
      "an approver below the applying role",
      { applyRole: "manager", approverRole: "supervisor" },
      { code: "adjustment_reason.invalid", params: { field: "approverRole" } },
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

  it("answers a reorder that leaves out an active reason with 400", async () => {
    const fx = await fixture();
    await send(fx.app, "POST", REASONS, fx.cookie.manager, COMPLAINT);
    const response = await send(fx.app, "PUT", ORDER, fx.cookie.manager, { ids: [] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "adjustment_reason.invalid", params: { field: "ids" } },
    });
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
    const [till] = await db
      .insert(tills)
      .values({ locationId: location!.id, name: "Till 1" })
      .returning({ id: tills.id });
    const [bill] = await db
      .insert(workingOrders)
      .values({ tillId: till!.id, orderNumber: 41, openedAt: "2026-09-15T18:00:00.000Z" })
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
      nominalValue: "24.00",
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
        byAction: { discount_amount: { count: 1, reduction: "5.00", nominalValue: "20.00" } },
      },
    ]);
    expect(body.guests).toMatchObject({ count: 1, reduction: "4.00" });
    // The bill was opened at 20:00 in Madrid on the 15th: 04:59 on the 16th is still the 15th.
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
    const supervisor = await read(`&person=${fx.supervisorId.toUpperCase()}`);
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
    ["from", ""],
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

  it.each<[string, string]>([
    ["person", "&person=not-a-uuid"],
    ["guests", "&guests=yes"],
    ["guests", `&guests=true&person=${MISSING}`],
  ])("refuses a drill-down whose %s is malformed (%s)", async (field, query) => {
    const fx = await reportFixture();
    const response = await send(fx.app, "GET", `${ENTRIES}?${DAY}${query}`, fx.cookie.manager);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "management.request_invalid", params: { field } },
    });
  });

  it("answers a server fault when the module's location is not in the database", async () => {
    const fx = await fixture();
    const response = await send(fx.app, "GET", `${REPORT}?${DAY}`, fx.cookie.manager);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "server.internal" } });
  });
});
