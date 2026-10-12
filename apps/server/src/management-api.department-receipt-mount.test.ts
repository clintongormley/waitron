import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { departments, departmentReceipts, departmentSalePolicies } from "@waitron/venue-service";
import { registerModulePermissions } from "@waitron/identity";
import { tenantReceipts } from "@waitron/db";
import { mountManagementApi, type ManagementApiDeps } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const fiscal = ALL_MODULES.find((module) => module.fiscal?.venueFields !== undefined)!.fiscal!
  .venueFields!;
let venue: Venue;
let id: string;
const policy = { receiptPrintMode: "on_request", printTradingName: false } as const;
beforeEach(async () => {
  registerModulePermissions([{ permission: "venue_service.manage", grantedFrom: "manager" }]);
  venue = await setupVenue(suite.db);
  const [row] = await suite.db
    .select()
    .from(departments)
    .where(eq(departments.locationId, venue.cfg.locationId));
  id = row!.id;
  await suite.db
    .update(departmentSalePolicies)
    .set(policy)
    .where(eq(departmentSalePolicies.departmentId, id));
  await suite.db
    .insert(departmentReceipts)
    .values({ departmentId: id, receipt: { operationDescription: "Meals" } })
    .onConflictDoUpdate({
      target: departmentReceipts.departmentId,
      set: { receipt: { operationDescription: "Meals" } },
    });
  await suite.db
    .insert(tenantReceipts)
    .values({ receipt: { footerMessage: "Global footer", printAddress: true } });
});
function app() {
  const instance = new Hono();
  const deps: ManagementApiDeps & { validateOperationDescription: (value: string) => void } = {
    db: suite.db,
    cfg: { nodeId: venue.cfg.nodeId },
    venueCfg: venue.cfg,
    secureCookies: false,
    rpId: "localhost",
    origin: "http://localhost",
    credentialKeyRing: { current: { version: 1, key: Buffer.alloc(32, 1) } },
    validateOperationDescription: fiscal.validateOperationDescription,
  };
  mountManagementApi(instance, deps, () => {});
  return instance;
}
function request(method: string, path: string, body?: unknown, cookie = venue.managerCookie) {
  return app().request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const path = () => `/management-api/venue-service/departments/${id}/receipt`;
it("management mounts the department receipt and policy without global defaults", async () => {
  const response = await request("GET", path());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    receipt: { operationDescription: "Meals" },
    policy,
    receiptLanguage: "es-ES",
    languages: ["es-ES"],
    warningLanguages: [],
    venueAddress: ["Calle Mayor 1", "28013 Madrid"],
  });
});
it("management saves the department receipt and policy through the replacement mount", async () => {
  const input = {
    receipt: { operationDescription: "Counter meals", printAddress: false },
    policy: { receiptPrintMode: "auto", printTradingName: true },
  };
  expect((await request("PUT", path(), input)).status).toBe(204);
  expect((await (await request("GET", path())).json()).receipt).toEqual(input.receipt);
  expect(
    (
      await suite.db
        .select()
        .from(departmentSalePolicies)
        .where(eq(departmentSalePolicies.departmentId, id))
    )[0],
  ).toMatchObject(input.policy);
  expect((await suite.db.select().from(tenantReceipts))[0]!.receipt).toEqual({
    footerMessage: "Global footer",
    printAddress: true,
  });
});
it("management supplies the installed description validator before writing", async () => {
  const response = await request("PUT", path(), { receipt: { operationDescription: "" }, policy });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "management.request_invalid", params: { field: "operationDescription" } },
  });
  expect(
    (
      await suite.db
        .select()
        .from(departmentReceipts)
        .where(eq(departmentReceipts.departmentId, id))
    )[0]!.receipt,
  ).toEqual({ operationDescription: "Meals" });
});
it.each(["/management-api/receipt", "/management-api/receipt-settings"])(
  "management no longer exposes global receipt route %s",
  async (route) => {
    const before = await suite.db.select().from(tenantReceipts);
    expect((await request("GET", route)).status).toBe(404);
    expect((await request("PUT", route, { receipt: {}, settings: {} })).status).toBe(404);
    expect(await suite.db.select().from(tenantReceipts)).toEqual(before);
  },
);
it("the mounted department receipt retains the layout permission gate", async () => {
  const response = await request("GET", path(), undefined, venue.staffCookie);
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("authorization.not_permitted");
});
