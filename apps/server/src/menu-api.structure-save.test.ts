import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPhotoMetadata, seedVenue } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
import {
  addMember,
  createMenu,
  createProduct,
  deactivateProduct,
  requireMenuRoot,
  menuPrices,
  setProductVariants,
} from "@waitron/menu";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountMenuApi } from "./menu-api.js";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import "./errors.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
const empty = { rootMembers: [], sections: [], prices: [] };
const route = (id: string) => "/management-api/menus/" + id + "/structure";

async function fixture() {
  await seedVenue(suite.db, { name: "Main" });
  await seedLegacySellingUnits(suite.db);
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
    const lunch = await createMenu(tx, { name: "Lunch" });
    const soup = await createProduct(tx, {
      name: "Soup",
      categoryId: null,
      pricingUnit: "each",
      unitPrice: "4.00",
      vatClass: "general",
    });
    const member = await addMember(tx, await requireMenuRoot(tx, lunch.id), {
      kind: "product",
      productId: soup.id,
    });
    return { lunch, soup, member, managerSession, staffSession };
  });
  const app = new Hono();
  mountMenuApi(app, { db: suite.db, venueLocale: "en" }, () => {});
  const send = (
    method: "GET" | "PUT",
    id: string,
    body?: unknown,
    token = rows.managerSession.token,
  ) =>
    app.request(route(id), {
      method,
      headers: { cookie: MANAGEMENT_COOKIE + "=" + token, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { ...rows, send };
}

it("returns the drops and advances the same revision used by the structure read", async () => {
  const f = await fixture();
  await withTransaction(suite.db, (tx) => deactivateProduct(tx, f.soup.id));
  const before = await f.send("GET", f.lunch.id);
  const response = await f.send("PUT", f.lunch.id, {
    ...empty,
    rootMembers: [{ id: f.member.id, ref: f.member.ref }],
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    dropped: [{ memberId: f.member.id, reason: "deleted" }],
  });
  const revision = JSON.parse(before.headers.get("x-waitron-menu-revision")!);
  const next = JSON.parse(response.headers.get("x-waitron-menu-revision")!);
  expect(next).toEqual({ epoch: revision.epoch, sequence: revision.sequence + 1 });
  const after = await f.send("GET", f.lunch.id);
  expect(after.headers.get("x-waitron-menu-revision")).toBe(
    response.headers.get("x-waitron-menu-revision"),
  );
});

it("saves a complete draft through the HTTP request", async () => {
  const f = await fixture();
  const image = "a".repeat(64) + ".jpg";
  await seedPhotoMetadata(suite.db, { filename: image, names: { en: "Lunch" } });
  const { variant, includedRoot, set } = await withTransaction(suite.db, async (tx) => {
    const [variant] = await setProductVariants(
      tx,
      f.soup.id,
      [
        {
          name: "Small",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: "3",
          available: true,
        },
      ],
      "en",
    );
    const included = await createMenu(tx, { name: "Drinks" });
    return {
      variant: variant!,
      includedRoot: await requireMenuRoot(tx, included.id),
      set: await createMenu(tx, { name: "Lunch Set", kind: "set_menu", setPrice: "20" }),
    };
  });
  const id = crypto.randomUUID();
  const memberId = (last: number) => "abcdef00-0000-4000-8000-00000000000" + last;
  const included = { kind: "section", sectionId: includedRoot };
  const setRef = { kind: "set_menu", menuId: set.id };
  const folder = {
    showAsFolder: false,
    overrides: { names: { en: "Drinks Specials" }, color: null },
  };
  const presentation = {
    internalName: "Mains",
    names: { en: "Main courses" },
    image,
    color: "#334455",
  };
  const response = await f.send("PUT", f.lunch.id, {
    rootMembers: [
      { id: memberId(3).toUpperCase(), ref: { kind: "section", sectionId: id } },
      { id: memberId(2), ref: included, folder },
      { id: memberId(1), ref: setRef },
    ],
    sections: [
      { id: id.toUpperCase(), ...presentation, members: [{ id: f.member.id, ref: f.member.ref }] },
    ],
    prices: [{ productId: f.soup.id, variantId: variant.id, price: "2.50" }],
  });
  expect(response.status).toBe(200);
  const after = await f.send("GET", f.lunch.id.toUpperCase());
  expect(after.status).toBe(200);
  expect(await after.json()).toMatchObject({
    nodes: [
      {
        ...presentation,
        memberId: memberId(3),
        children: [{ memberId: f.member.id, ref: f.member.ref }],
      },
      { ref: included, folder },
      { ref: setRef },
    ],
  });
  const prices = await withTransaction(suite.db, (tx) => menuPrices(tx, f.lunch.id));
  expect(prices).toMatchObject([{ variants: [{ variantId: variant.id, price: "2.50" }] }]);
});

it("requires permission to write the menu", async () => {
  const f = await fixture();
  const response = await f.send("PUT", f.lunch.id, empty, f.staffSession.token);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
});

it("distinguishes an absent menu in the address from an absent section in the draft", async () => {
  const f = await fixture();
  const missing = crypto.randomUUID();
  const absent = await f.send("PUT", missing, empty);
  expect(absent.status).toBe(404);
  expect(await absent.json()).toMatchObject({ error: { code: "menu.not_found" } });
  const badRef = await f.send("PUT", f.lunch.id, {
    ...empty,
    rootMembers: [{ id: crypto.randomUUID(), ref: { kind: "section", sectionId: missing } }],
  });
  expect(badRef.status).toBe(400);
  expect(await badRef.json()).toMatchObject({
    error: { code: "menu_section.not_found", params: { field: "rootMembers.0.ref" } },
  });
});

it("rolls back the arrangement and leaves the revision unchanged when a price is refused", async () => {
  const f = await fixture();
  const before = await f.send("GET", f.lunch.id);
  const response = await f.send("PUT", f.lunch.id, {
    ...empty,
    prices: [{ productId: f.soup.id, price: "not a price" }],
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "product.invalid", params: { field: "prices.0.price" } },
  });
  const after = await f.send("GET", f.lunch.id);
  expect(await after.json()).toEqual(await before.json());
  expect(after.headers.get("x-waitron-menu-revision")).toBe(
    before.headers.get("x-waitron-menu-revision"),
  );
});
