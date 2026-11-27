import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { startManagementSession } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { createMenu, previewMenu, publishMenu } from "@waitron/menu";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { mountMenuApi } from "./menu-api.js";
import { fixturePinHash } from "./testing/known-secret-hashes.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
const settings = { enabled: true, address: "lunch", photos: "small" };

async function fixture() {
  await seedVenue(suite.db, { name: "Main" });
  const rows = await withTransaction(suite.db, async (tx) => {
    const [manager, staff] = await seedPersons(tx, [
      { displayName: "Manager", role: "manager", pinHash: fixturePinHash("1234") },
      { displayName: "Clerk", role: "staff", pinHash: fixturePinHash("1234") },
    ]);
    const managerSession = await startManagementSession(tx, {
      method: "password",
      personId: manager!.id,
    });
    const staffSession = await startManagementSession(tx, {
      method: "password",
      personId: staff!.id,
    });
    const menu = await createMenu(tx, { name: "Lunch" });
    const { hash } = await previewMenu(tx, menu.id);
    await publishMenu(tx, menu.id, hash, manager!.id);
    return { menu, managerSession, staffSession };
  });
  const app = new Hono();
  mountMenuApi(app, { db: suite.db, venueLocale: "en" }, () => {});
  return {
    staffToken: rows.staffSession.token,
    send(method: "GET" | "PUT", body?: unknown, token = rows.managerSession.token) {
      return app.request("/management-api/menus/" + rows.menu.id + "/customer-online-settings", {
        method,
        headers: { cookie: MANAGEMENT_COOKIE + "=" + token, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
  };
}

it("saves settings and reads the same value through the management API", async () => {
  const f = await fixture();
  const saved = await f.send("PUT", settings);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual(settings);
  const read = await f.send("GET");
  expect(read.status).toBe(200);
  expect(read.headers.get("cache-control")).toBe("no-store");
  expect(await read.json()).toEqual(settings);
});

it("requires menu management permission for reads and writes", async () => {
  const f = await fixture();
  for (const [method, body] of [
    ["GET", undefined],
    ["PUT", settings],
  ] as const) {
    const response = await f.send(method, body, f.staffToken);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  }
});

it.each([
  [{ ...settings, enabled: "true" }, "enabled"],
  [{ ...settings, address: ["lunch"] }, "address"],
  [{ ...settings, photos: ["small"] }, "photos"],
  [{ enabled: false, photos: "small" }, "address"],
  [null, "body"],
])("refuses an invalid request body %j", async (body, field) => {
  const f = await fixture();
  const response = await f.send("PUT", body);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field } },
  });
});
