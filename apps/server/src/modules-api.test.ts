import { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, saveSettings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons, startManagementSession } from "@waitron/identity";
import { ALL_MODULES, CARD_PROVIDERS } from "@waitron/composition";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { PAYMENTS_SETTINGS } from "@waitron/payments";
import { mountModulesApi } from "./modules-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let manager: string;
let staff: string;
beforeEach(async () => {
  [manager, staff] = await withTransaction(suite.db, async (tx) => {
    const cookies: string[] = [];
    for (const role of ["manager", "staff"] as const) {
      const [person] = await tx.insert(persons).values({ displayName: role, role }).returning();
      const session = await startManagementSession(tx, { personId: person!.id });
      cookies.push(`${MANAGEMENT_COOKIE}=${session.token}`);
    }
    return cookies as [string, string];
  });
});
function app(enabled: readonly string[] = ["payments"]) {
  const app = new Hono();
  mountModulesApi(
    app,
    { db: suite.db, modules: ALL_MODULES, enabled, providers: CARD_PROVIDERS },
    () => {},
  );
  return app;
}
it("lists optional modules even when disabled, plus every provider, without mandatory or fiscal entries", async () => {
  const response = await app().request("/management-api/modules", { headers: { cookie: manager } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    { id: "workforce", category: "module", enabled: false },
    { id: "workforce-es", category: "module", enabled: false },
    { id: "payments", category: "module", enabled: true },
    { id: "bookings", category: "module", enabled: false },
    { id: "staffing", category: "module", enabled: false },
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
