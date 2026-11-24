import { CORE_MIGRATIONS, menuPeriods, withTransaction } from "@waitron/db";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { registerModulePermissions } from "@waitron/identity";
import {
  addMember,
  createMenu,
  createProduct,
  createSectionIn,
  requireMenuRoot,
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
  const response = await send("GET", "/delete-impact");
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: { code: "authorization.not_permitted", params: { permission: "venue.view" } },
  });
});

it("reports distinct products placed in the menu’s own sections in the delete impact", async () => {
  const { send, old, next } = await fixture();
  await withTransaction(suite.db, async (tx) => {
    const oldRoot = await requireMenuRoot(tx, old.id);
    const nextRoot = await requireMenuRoot(tx, next.id);
    const own = await createProduct(tx, {
      categoryId: null,
      name: "Soup",
      pricingUnit: "each",
      unitPrice: "6.00",
      vatClass: "reduced",
    });
    const included = await createProduct(tx, {
      categoryId: null,
      name: "Bread",
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
    });
    const ownSection = await createSectionIn(tx, oldRoot, { internalName: "Specials" });
    await addMember(tx, oldRoot, { kind: "product", productId: own.id });
    await addMember(tx, ownSection.id, { kind: "product", productId: own.id });
    await addMember(tx, nextRoot, { kind: "product", productId: included.id });
    await addMember(tx, oldRoot, { kind: "section", sectionId: nextRoot });
  });
  const impact = await send("GET", "/delete-impact");
  expect(impact.status).toBe(200);
  expect(await impact.json()).toMatchObject({ productCount: 1 });
});

it("requires permission to change an affected period", async () => {
  const { send, next, period } = await fixture(["menu.manage", "venue.view"]);
  const response = await send("POST", "/delete", {
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
  const impact = await send("GET", "/delete-impact");
  expect(impact.status).toBe(200);
  expect(await impact.json()).toMatchObject({ defaultChoices: [] });
  for (const defaultMenuId of [old.id, next.id]) {
    const response = await send("POST", "/delete", {
      replacements: { [period.id]: next.id },
      defaultMenuId,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "menu.delete_default" } });
  }
  const [stored] = await suite.db.select().from(menuPeriods).where(eq(menuPeriods.id, period.id));
  expect(stored?.menuId).toBe(old.id);
  expect(await withTransaction(suite.db, readDefaultMenuId)).toBe(old.id);
});

it("deletes alongside the period and default changes", async () => {
  const { send, old, next, period, publish } = await fixture();
  await publish(old.id);
  await publish(next.id);
  const impact = await send("GET", "/delete-impact");
  expect(impact.status).toBe(200);
  expect(await impact.json()).toMatchObject({
    periods: [{ id: period.id, name: "Evening", replacement: "starting", requiresSellable: false }],
    defaultChoices: [{ id: next.id, name: next.name }],
  });
  const self = await send("POST", "/delete", {
    replacements: { [period.id]: next.id },
    defaultMenuId: old.id,
  });
  expect(self.status).toBe(409);
  expect(await self.json()).toMatchObject({ error: { code: "menu.delete_default" } });
  expect(
    (
      await send("POST", "/delete", {
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
  expect(await edited.json()).toMatchObject({ error: { code: "menu.deleted" } });
  const published = await send("POST", "/publish", { expectedHash: "irrelevant" });
  expect(published.status).toBe(409);
  expect(await published.json()).toMatchObject({ error: { code: "menu.deleted" } });
});

it("hides a deleted set menu’s saved terms without reopening its write routes", async () => {
  const { send, set } = await fixture();
  expect((await send("GET", "/set-menu", undefined, set.id)).status).toBe(200);
  expect((await send("POST", "/delete", { replacements: {} }, set.id)).status).toBe(204);
  expect((await send("GET", "/set-menu", undefined, set.id)).status).toBe(404);
  expect((await send("PUT", "/set-menu/lines", { lines: [] }, set.id)).status).toBe(404);
});
