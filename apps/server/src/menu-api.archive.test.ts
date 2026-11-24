import { CORE_MIGRATIONS, menuPeriods, withTransaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registerModulePermissions } from "@waitron/identity";
import {
  createMenu,
  deactivateMenu,
  previewMenu,
  publishMenu,
  readDefaultMenuId,
  setVenueDefaultMenu,
} from "@waitron/menu";
import { createDepartment, VENUE_SERVICE_PERMISSIONS } from "@waitron/venue-service";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { mountMenuApi } from "./menu-api.js";
import { sessionHolding } from "./testing/session-holding.js";

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const fullAccess = ["menu.manage", "venue.view", "venue.configure"];

async function fixture(permissions = fullAccess) {
  await seedVenue(suite.db);
  const { cookie, personId } = await sessionHolding(suite.db, permissions);
  const app = new Hono();
  mountMenuApi(app, { db: suite.db }, () => {});
  const { old, next, period, set } = await withTransaction(suite.db, async (tx) => {
    const department = await createDepartment(tx, { name: "Dining", orderStart: "table" });
    const old = await createMenu(tx, { name: "Winter" });
    const next = await createMenu(tx, { name: "Spring" });
    const set = await createMenu(tx, {
      name: "Daily set",
      kind: "set_menu",
      setPrice: "14.00",
      setVatClass: "general",
    });
    await deactivateMenu(tx, set.id);
    const [period] = await tx
      .insert(menuPeriods)
      .values({
        departmentId: department.id,
        name: "Evening",
        menuId: old.id,
        staffMenuIds: [next.id],
      })
      .returning({ id: menuPeriods.id });
    await setVenueDefaultMenu(tx, old.id);
    return { old, next, period: period!, set };
  });
  const send = (method: string, suffix: string, body?: object, id = old.id) =>
    app.request(`/management-api/menus/${id}${suffix}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const publish = (menuId: string) =>
    withTransaction(suite.db, async (tx) => {
      const { hash } = await previewMenu(tx, menuId);
      await publishMenu(tx, menuId, hash, personId);
    });
  return { send, old, next, period, set, publish };
}

it("withholds period impact from a manager without permission to view periods", async () => {
  const { send } = await fixture(["menu.manage"]);
  const response = await send("GET", "/archive-impact");
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: { code: "authorization.not_permitted", params: { permission: "venue.view" } },
  });
});

it("requires permission to change an affected period", async () => {
  const { send, next, period } = await fixture(["menu.manage", "venue.view"]);
  const response = await send("POST", "/archive", {
    replacements: { [period.id]: next.id },
    defaultMenuId: next.id,
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: "authorization.not_permitted", params: { permission: "venue.configure" } },
  });
});

it("keeps the default and period if there is no valid published replacement", async () => {
  const { send, old, next, period } = await fixture();
  const impact = await send("GET", "/archive-impact");
  expect(impact.status).toBe(200);
  expect(await impact.json()).toMatchObject({ defaultChoices: [] });
  for (const defaultMenuId of [old.id, next.id]) {
    const response = await send("POST", "/archive", {
      replacements: { [period.id]: next.id },
      defaultMenuId,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "menu.archive_default" } });
  }
  const [stored] = await suite.db.select().from(menuPeriods).where(eq(menuPeriods.id, period.id));
  expect(stored?.menuId).toBe(old.id);
  expect(await withTransaction(suite.db, readDefaultMenuId)).toBe(old.id);
});

it("archives alongside the period and default changes and keeps read and copy available", async () => {
  const { send, old, next, period, publish } = await fixture();
  await publish(old.id);
  await publish(next.id);
  const impact = await send("GET", "/archive-impact");
  expect(impact.status).toBe(200);
  expect(await impact.json()).toMatchObject({
    periods: [{ id: period.id, name: "Evening", replacement: "starting", requiresSellable: false }],
    defaultChoices: [{ id: next.id, name: next.name }],
  });
  const self = await send("POST", "/archive", {
    replacements: { [period.id]: next.id },
    defaultMenuId: old.id,
  });
  expect(self.status).toBe(409);
  expect(await self.json()).toMatchObject({ error: { code: "menu.archive_default" } });
  expect(
    (
      await send("POST", "/archive", {
        replacements: { [period.id]: next.id },
        defaultMenuId: next.id,
      })
    ).status,
  ).toBe(204);
  const [stored] = await suite.db.select().from(menuPeriods).where(eq(menuPeriods.id, period.id));
  expect(stored).toMatchObject({ menuId: next.id, staffMenuIds: [] });
  expect(await withTransaction(suite.db, readDefaultMenuId)).toBe(next.id);
  expect((await send("GET", "/structure")).status).toBe(200);
  const edited = await send("PATCH", "", { name: "Back" });
  expect(edited.status).toBe(409);
  expect(await edited.json()).toMatchObject({ error: { code: "menu.archived" } });
  const published = await send("POST", "/publish", { expectedHash: "irrelevant" });
  expect(published.status).toBe(409);
  expect(await published.json()).toMatchObject({ error: { code: "menu.archived" } });
  const copied = await send("POST", "/duplicate", { name: "Next winter" });
  expect(copied.status).toBe(201);
  expect(await copied.json()).toMatchObject({ active: true, name: "Next winter" });
});

it("reads the archived set menu's saved terms without reopening its write routes", async () => {
  const { send, set } = await fixture();
  const response = await send("GET", "/set-menu", undefined, set.id);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: set.id, price: "14.00", vatClass: "general" });
  expect((await send("PUT", "/set-menu/lines", { lines: [] }, set.id)).status).toBe(404);
});
