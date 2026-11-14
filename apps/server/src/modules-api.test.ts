import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, readSettings, saveSettings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { startManagementSession } from "@waitron/identity";
import { ALL_MODULES, CARD_PROVIDERS } from "@waitron/composition";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { WORKFORCE_ES_MIGRATIONS } from "@waitron/workforce-es";
import { PAYMENTS_MIGRATIONS, PAYMENTS_SETTINGS } from "@waitron/payments";
import { mountModulesApi } from "./modules-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, BOOKINGS_MIGRATIONS, PAYMENTS_MIGRATIONS, WORKFORCE_ES_MIGRATIONS],
});
import { BOOKINGS_MIGRATIONS } from "@waitron/bookings";
import { MODULES_SETTINGS } from "./modules.js";

let admin: string;
let manager: string;
let staff: string;
beforeEach(async () => {
  [admin, manager, staff] = await withTransaction(suite.db, async (tx) => {
    const cookies: string[] = [];
    for (const role of ["admin", "manager", "staff"] as const) {
      const [person] = await seedPersons(tx, { displayName: role, role });
      const session = await startManagementSession(tx, { personId: person!.id });
      cookies.push(`${MANAGEMENT_COOKIE}=${session.token}`);
    }
    return cookies as [string, string, string];
  });
});
function app(enabled: readonly string[] = ["payments"], isPrimary = true) {
  const app = new Hono();
  mountModulesApi(
    app,
    {
      db: suite.db,
      modules: ALL_MODULES,
      enabled,
      providers: CARD_PROVIDERS,
      isPrimary: () => isPrimary,
      migrationsRoot: null,
    },
    () => {},
  );
  return app;
}
it("lists optional modules even when disabled, plus every provider, without mandatory or fiscal entries", async () => {
  const response = await app().request("/management-api/modules", { headers: { cookie: manager } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    { id: "workforce-es", category: "module", enabled: true, applied: false, revision: 0 },
    { id: "payments", category: "module", enabled: true, applied: true, revision: 0 },
    { id: "bookings", category: "module", enabled: true, applied: false, revision: 0 },
    { id: "sumup", category: "card-provider", enabled: true, revision: 0 },
    { id: "stripe", category: "card-provider", enabled: true, revision: 0 },
  ]);
});
it("refuses unsigned and staff reads with the management error codes", async () => {
  for (const [cookie, status, code] of [
    ["", 401, "management_session.required"],
    [staff, 403, "authorization.not_permitted"],
  ] as const) {
    const response = await app().request("/management-api/modules", { headers: { cookie } });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  }
});

it("shows card providers disabled while their Payments module is off", async () => {
  const response = await app([]).request("/management-api/modules", {
    headers: { cookie: manager },
  });
  expect(response.status).toBe(200);
  const rows = (await response.json()) as { id: string; category: string; enabled: boolean }[];
  expect(rows.filter((row) => row.category === "card-provider")).toEqual([
    { id: "sumup", category: "card-provider", enabled: false, revision: 0 },
    { id: "stripe", category: "card-provider", enabled: false, revision: 0 },
  ]);
});

it("lists a switched-off provider independently from its connected credentials", async () => {
  await withTransaction(suite.db, (tx) =>
    saveSettings(tx, PAYMENTS_SETTINGS, {
      doc: { providers: { stripe: false } },
      expectedRevision: 0,
      personId: null,
    }),
  );
  const response = await app().request("/management-api/modules", { headers: { cookie: manager } });
  expect(response.status).toBe(200);
  expect(await response.json()).toContainEqual({
    id: "stripe",
    category: "card-provider",
    enabled: false,
    revision: 1,
  });
});

function switchBookings(cookie = admin, enabled = false, revision = 0, primary = true) {
  return app(["payments", "bookings"], primary).request("/management-api/modules/bookings/state", {
    method: "PUT",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, revision }),
  });
}
it("saves Bookings for the next restart, preserving the other overrides and applied state", async () => {
  await withTransaction(suite.db, (tx) =>
    saveSettings(tx, MODULES_SETTINGS, {
      doc: { modules: { "fiscal-none": false, payments: false } },
      expectedRevision: 0,
      personId: null,
    }),
  );
  const response = await switchBookings(admin, false, 1);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ enabled: false, applied: true, revision: 2 });
  expect((await readSettings(suite.db, MODULES_SETTINGS)).doc.modules).toEqual({
    "fiscal-none": false,
    payments: false,
    bookings: false,
  });
  expect(
    await (
      await app(["bookings"]).request("/management-api/modules", { headers: { cookie: admin } })
    ).json(),
  ).toContainEqual({
    id: "bookings",
    category: "module",
    enabled: false,
    applied: true,
    revision: 2,
  });
  const stale = await switchBookings(admin, true, 1);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "settings.out_of_date" } });
  expect((await switchBookings(manager, true, 2)).status).toBe(200);
});
it.each([
  ["unsigned", 401, "management_session.required"],
  ["staff", 403, "authorization.not_permitted"],
  ["mirror", 403, "node.read_only"],
] as const)("refuses a %s Bookings change", async (who, status, code) => {
  const response = await switchBookings(
    who === "unsigned" ? "" : who === "staff" ? staff : admin,
    false,
    0,
    who !== "mirror",
  );
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
  expect((await readSettings(suite.db, MODULES_SETTINGS)).revision).toBe(0);
});
it.each([null, "true", 1])("refuses enabled=%s without saving", async (enabled) => {
  const response = await app().request("/management-api/modules/bookings/state", {
    method: "PUT",
    headers: { cookie: admin, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, revision: 0 }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
});
it.each([
  ["bookings", "__drizzle_migrations_bookings"],
  ["payments", "__drizzle_migrations_payments"],
  ["workforce-es", "__drizzle_migrations_workforce_es"],
])("requires %s's own prepared journal without changing data on refusal", async (id, table) => {
  const rows = suite.db.all<{ rowid: number; hash: string }>(
    sql`select rowid, hash from ${sql.identifier(table)}`,
  );
  await suite.db.execute(sql`update ${sql.identifier(table)} set hash = 'different image'`);
  try {
    const response = await app().request(`/management-api/modules/${id}/state`, {
      method: "PUT",
      headers: { cookie: admin, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, revision: 0 }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "module.not_prepared", params: { module: id } },
    });
    expect((await readSettings(suite.db, MODULES_SETTINGS)).revision).toBe(0);
    if (id === "bookings") expect((await switchBookings()).status).toBe(200);
  } finally {
    for (const row of rows)
      await suite.db.execute(
        sql`update ${sql.identifier(table)} set hash = ${row.hash} where rowid = ${row.rowid}`,
      );
  }
});

it.each(["workforce-es", "payments"])(
  "switches %s without changing applied state or other overrides",
  async (id) => {
    await withTransaction(suite.db, (tx) =>
      saveSettings(tx, PAYMENTS_SETTINGS, {
        doc: { providers: { stripe: false, sumup: false } },
        expectedRevision: 0,
        personId: null,
      }),
    );
    const mounted = app([id]);
    const off = await mounted.request(`/management-api/modules/${id}/state`, {
      method: "PUT",
      headers: { cookie: admin, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, revision: 0 }),
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ enabled: false, applied: true, revision: 1 });
    expect((await readSettings(suite.db, MODULES_SETTINGS)).doc.modules).toEqual({ [id]: false });
    const on = await mounted.request(`/management-api/modules/${id}/state`, {
      method: "PUT",
      headers: { cookie: admin, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, revision: 1 }),
    });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ enabled: true, applied: true, revision: 2 });
  },
);
it("requires every provider Off before Payments Off, without saving a refusal", async () => {
  const response = await app().request("/management-api/modules/payments/state", {
    method: "PUT",
    headers: { cookie: admin, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false, revision: 0 }),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "module.providers_enabled" } });
  expect((await readSettings(suite.db, MODULES_SETTINGS)).revision).toBe(0);
});
it.each(["workforce", "staffing", "fiscal-none", "unknown"])(
  "refuses unsupported module %s",
  async (id) => {
    const response = await app().request(`/management-api/modules/${id}/state`, {
      method: "PUT",
      headers: { cookie: admin, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, revision: 0 }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "module.not_prepared" } });
    expect((await readSettings(suite.db, MODULES_SETTINGS)).revision).toBe(0);
  },
);
