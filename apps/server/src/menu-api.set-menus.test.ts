import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { seedTaxpayer } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { startManagementSession } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import {
  addMember,
  createMenu,
  createProduct,
  createUnit,
  requireMenuRoot,
  setProductVariants,
} from "@waitron/menu";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { createCourse, setProductCourse } from "./kitchen.js";
import { mountMenuApi } from "./menu-api.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";

const menus = "/management-api/menus";
const terms = { kind: "set_menu", setPrice: "14.00", setVatClass: "reduced" } as const;

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: async (db) => {
    await seedTaxpayer(db);
    await seedLegacySellingUnits(db);
  },
});

async function fixture() {
  const { token, staffToken, set, full, root, fullRoot, starter, main, soup, steak } =
    await withTransaction(suite.db, async (tx) => {
      const [manager] = await seedPersons(tx, { displayName: "Manager", role: "manager" });
      const [staff] = await seedPersons(tx, { displayName: "Clerk", role: "staff" });
      const { token } = await startManagementSession(tx, {
        method: "password",
        personId: manager!.id,
      });
      const { token: staffToken } = await startManagementSession(tx, {
        method: "password",
        personId: staff!.id,
      });
      const set = await createMenu(tx, { ...terms, name: "Daily menu" });
      const full = await createMenu(tx, { name: "Lunch" });
      const starter = await createCourse(tx, { name: "Starter" });
      const main = await createCourse(tx, { name: "Main", displayOrder: 1 });
      const product = { categoryId: null, unitPrice: "4.00", vatClass: "general" } as const;
      const soup = await createProduct(tx, { ...product, name: "Soup", pricingUnit: "each" });
      await setProductCourse(tx, soup.id, starter.id);
      const unit = await createUnit(
        tx,
        {
          staffName: "Weight",
          staffAbbreviation: "kg",
          name: { en: "Kilogram" },
          abbreviation: { en: "kg" },
          precision: 3,
          measure: true,
        },
        "en",
      );
      const steak = await createProduct(tx, { ...product, name: "Steak", unitId: unit.id });
      return {
        token,
        staffToken,
        set,
        full,
        starter,
        main,
        soup,
        steak,
        root: await requireMenuRoot(tx, set.id),
        fullRoot: await requireMenuRoot(tx, full.id),
      };
    });
  const app = new Hono();
  mountMenuApi(app, { db: suite.db }, () => {});
  const send = (method: string, path: string, body?: unknown, session: string | null = token) =>
    app.request(path, {
      method,
      headers: {
        ...(session === null ? {} : { cookie: `${MANAGEMENT_COOKIE}=${session}` }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    send,
    set,
    full,
    root,
    fullRoot,
    starter,
    main,
    soup,
    steak,
    staffToken,
    draft: `${menus}/${set.id}/set-menu`,
    ref: { kind: "set_menu", menuId: set.id } as const,
  };
}

async function json<T = unknown>(response: Response, status: number): Promise<T> {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

async function refused(response: Response, status: number, code: string, params: object) {
  expect(await json(response, status)).toEqual({ error: { code, params } });
}

async function addSoup(f: Awaited<ReturnType<typeof fixture>>) {
  const member = await withTransaction(suite.db, (tx) =>
    addMember(tx, f.root, { kind: "product", productId: f.soup.id }),
  );
  return member;
}

it("creates a set-menu draft with its own price and rates", async () => {
  const { send } = await fixture();
  const created = await json<{ id: string }>(
    await send("POST", menus, { ...terms, name: "New set", setTakeawayVatClass: "general" }),
    201,
  );
  expect(created).toEqual({ id: expect.any(String), active: true, name: "New set", ...terms });
  expect(await json(await send("GET", `${menus}/${created.id}/set-menu`), 200)).toMatchObject({
    price: "14.00",
    vatClass: "reduced",
    takeawayVatClass: "general",
  });
});

it("names an invalid takeaway VAT class on creation and update", async () => {
  const { send, set } = await fixture();
  await refused(
    await send("POST", menus, { ...terms, name: "New set", setTakeawayVatClass: ["general"] }),
    400,
    "set_menu.invalid",
    { field: "setTakeawayVatClass" },
  );
  await refused(
    await send("PATCH", `${menus}/${set.id}`, { setTakeawayVatClass: "other" }),
    400,
    "set_menu.invalid",
    { field: "setTakeawayVatClass" },
  );
});

it.each([undefined, "menu"])(
  "refuses set-menu terms when the requested kind is %s",
  async (kind) => {
    const { send } = await fixture();
    await refused(
      await send("POST", menus, { kind, name: "Menu without set-menu kind", setPrice: "14.00" }),
      400,
      "management.request_invalid",
      { field: "kind" },
    );
  },
);

it("updates set-menu terms and clears the takeaway override with null", async () => {
  const { send, draft, set } = await fixture();
  const path = `${menus}/${set.id}`;
  expect(
    (
      await send("PATCH", path, {
        setPrice: "19.50",
        setVatClass: "general",
        setTakeawayVatClass: "reduced",
      })
    ).status,
  ).toBe(204);
  expect(await json(await send("GET", draft), 200)).toMatchObject({
    price: "19.50",
    vatClass: "general",
    takeawayVatClass: "reduced",
  });
  expect((await send("PATCH", path, { setTakeawayVatClass: null })).status).toBe(204);
  expect(await json(await send("GET", draft), 200)).toMatchObject({
    price: "19.50",
    vatClass: "general",
    takeawayVatClass: null,
  });
});

it("reads the draft details and refuses an ordinary menu at the same route", async () => {
  const { send, draft, set, full, starter, main } = await fixture();
  expect(await json(await send("GET", draft), 200)).toMatchObject({
    id: set.id,
    name: "Daily menu",
    names: {},
    price: "14.00",
    vatClass: "reduced",
    takeawayVatClass: null,
    dishes: [],
    lines: [],
    courses: [
      { id: starter.id, name: "Starter" },
      { id: main.id, name: "Main" },
    ],
    problems: [{ kind: "no_dishes" }, { kind: "no_lines" }],
    heldBy: [],
  });
  await refused(await send("GET", `${menus}/${full.id}/set-menu`), 404, "set_menu.not_found", {
    menuId: full.id,
  });
});

it("saves inclusion lines and names an invalid count", async () => {
  const { send, draft, starter } = await fixture();
  const lines = [{ count: 2, courseIds: [starter.id] }];
  expect(await json(await send("PUT", `${draft}/lines`, { lines }), 200)).toEqual({
    lines: [{ id: expect.any(String), ...lines[0] }],
  });
  await refused(
    await send("PUT", `${draft}/lines`, { lines: [{ ...lines[0], count: "2" }] }),
    400,
    "set_menu.invalid",
    { field: "count" },
  );
});

it("returns adjusted lines and the updated draft after changing a dish's course", async () => {
  const f = await fixture();
  await addSoup(f);
  const dish = await json<{ dishes: { menuItemId: string }[] }>(await f.send("GET", f.draft), 200);
  const path = `${f.draft}/items/${dish.dishes[0]!.menuItemId}/course`;
  expect(await json(await f.send("PUT", path, { courseId: f.main.id }), 200)).toMatchObject({
    details: { dishes: [{ productId: f.soup.id, courseOverrideId: f.main.id }] },
    addedLines: [{ id: expect.any(String), count: 1, courseIds: [f.main.id] }],
    removedLines: [{ id: expect.any(String), count: 1, courseIds: [f.starter.id] }],
  });
  await refused(
    await f.send("PUT", path, { courseId: crypto.randomUUID() }),
    400,
    "set_menu.invalid",
    { field: "courseId" },
  );
});

it("reports a missing dish at the course route even though the set menu still exists", async () => {
  const { send, draft, set } = await fixture();
  const menuItemId = crypto.randomUUID();
  await refused(
    await send("PUT", `${draft}/items/${menuItemId}/course`, { courseId: null }),
    404,
    "menu_item.not_found",
    { menuId: set.id, menuItemId },
  );
});

it("returns saved variant choices and refuses an unrecognised variant", async () => {
  const f = await fixture();
  const [cup, bowl] = await withTransaction(suite.db, (tx) =>
    setProductVariants(
      tx,
      f.soup.id,
      ["Cup", "Bowl"].map((name) => ({
        name,
        customerName: null,
        kitchenName: null,
        image: null,
        available: true,
        unitPrice: null,
      })),
      "en",
    ),
  );
  await addSoup(f);
  const dish = await json<{ dishes: { menuItemId: string }[] }>(await f.send("GET", f.draft), 200);
  const path = `${f.draft}/items/${dish.dishes[0]!.menuItemId}/variants`;
  const choices = [
    { variantId: cup!.id, included: false, surcharge: null },
    { variantId: bowl!.id, included: true, surcharge: "1.50" },
  ];
  expect(await json(await f.send("PUT", path, { variants: choices }), 200)).toMatchObject({
    id: f.set.id,
    dishes: [
      {
        productId: f.soup.id,
        variants: expect.arrayContaining([
          { id: cup!.id, name: "Cup", included: false, surcharge: null, courseId: f.starter.id },
          { id: bowl!.id, name: "Bowl", included: true, surcharge: "1.50", courseId: f.starter.id },
        ]),
      },
    ],
  });
  const variantId = crypto.randomUUID();
  await refused(
    await f.send("PUT", path, { variants: [{ variantId, included: true, surcharge: null }] }),
    400,
    "product.variant_not_found",
    { variantId },
  );
});

it("adds dishes with their inclusion lines and refuses dishes sold by measure", async () => {
  const { send, draft, soup, steak, starter } = await fixture();
  const body = (productId: string) => ({ dishes: [{ productId, excludedVariantIds: [] }] });
  expect(await json(await send("POST", `${draft}/dishes`, body(soup.id)), 200)).toMatchObject({
    details: { dishes: [{ productId: soup.id, name: "Soup" }] },
    addedLines: [{ id: expect.any(String), count: 1, courseIds: [starter.id] }],
  });
  await refused(
    await send("POST", `${draft}/dishes`, body(steak.id)),
    409,
    "set_menu.dish_sold_by_measure",
    { productId: steak.id },
  );
});

it("copies dishes into the target set menu and refuses an ordinary source menu", async () => {
  const f = await fixture();
  await addSoup(f);
  const copy = await withTransaction(suite.db, (tx) => createMenu(tx, { ...terms, name: "Copy" }));
  const path = `${menus}/${copy.id}/set-menu/copy-dishes`;
  expect(await json(await f.send("POST", path, { fromMenuId: f.set.id }), 200)).toMatchObject({
    details: { id: copy.id, dishes: [{ productId: f.soup.id }] },
    addedLines: [{ id: expect.any(String), count: 1, courseIds: [f.starter.id] }],
  });
  await refused(await f.send("POST", path, { fromMenuId: f.full.id }), 400, "set_menu.not_found", {
    menuId: f.full.id,
  });
});

it("keeps every set-menu editor route behind menu management permission", async () => {
  const { send, draft, set, staffToken } = await fixture();
  const item = `${draft}/items/${crypto.randomUUID()}`;
  const calls = [
    ["GET", draft, undefined],
    ["PUT", `${draft}/lines`, { lines: [] }],
    ["PUT", `${item}/course`, { courseId: null }],
    ["PUT", `${item}/variants`, { variants: [] }],
    ["POST", `${draft}/dishes`, { dishes: [] }],
    ["POST", `${draft}/copy-dishes`, { fromMenuId: set.id }],
    ["POST", menus, { ...terms, name: "Unapproved draft" }],
    ["PATCH", `${menus}/${set.id}`, { setPrice: "15.00" }],
  ] as const;
  for (const [method, path, body] of calls) {
    expect(await json(await send(method, path, body, null), 401)).toMatchObject({
      error: { code: "management_session.required" },
    });
    expect(await json(await send(method, path, body, staffToken), 403)).toMatchObject({
      error: { code: "authorization.not_permitted", params: { permission: "menu.manage" } },
    });
  }
});

it("places a set menu and can replace a member with a set menu", async () => {
  const { send, fullRoot, ref, soup } = await fixture();
  const path = `/management-api/sections/${fullRoot}/members`;
  const first = await json<{ id: string; ref: unknown }>(await send("POST", path, { ref }), 201);
  expect(first.ref).toEqual(ref);
  const { id } = await withTransaction(suite.db, (tx) =>
    createMenu(tx, { ...terms, name: "Other" }),
  );
  const dish = await json<{ id: string }>(
    await send("POST", path, { ref: { kind: "product", productId: soup.id } }),
    201,
  );
  const replacement = { kind: "set_menu", menuId: id };
  expect(
    await json(await send("POST", `${path}/${dish.id}/replace`, { ref: replacement }), 200),
  ).toMatchObject({ id: dish.id, ref: replacement });
  await refused(
    await send("POST", path, { ref: { kind: "set_menu", menuId: "bad-id" } }),
    400,
    "shared.invalid_id",
    { kind: "MenuId", value: "bad-id" },
  );
});

it("refuses a set-menu reference on both Device Home shortcut routes", async () => {
  const { send, full, fullRoot, ref, soup } = await fixture();
  const productRef = { kind: "product", productId: soup.id };
  await json(
    await send("POST", `/management-api/sections/${fullRoot}/members`, { ref: productRef }),
    201,
  );
  const path = `${menus}/${full.id}/home/shortcuts`;
  const shortcut = await json<{ id: string }>(await send("POST", path, { ref: productRef }), 201);
  for (const route of [path, `${path}/${shortcut.id}/replace`])
    await refused(await send("POST", route, { ref }), 409, "set_menu.wrong_place", {
      menuId: ref.menuId,
    });
});

it("returns added lines when the existing batch member route adds a dish to a set menu", async () => {
  const { send, root, soup, starter } = await fixture();
  expect(
    await json(
      await send("POST", `/management-api/sections/${root}/members/products`, {
        productIds: [soup.id],
      }),
      200,
    ),
  ).toEqual({
    added: 1,
    addedLines: [{ id: expect.any(String), count: 1, courseIds: [starter.id] }],
  });
});

it("refuses to publish a set menu on its own", async () => {
  const { send, set } = await fixture();
  await refused(
    await send("POST", `${menus}/${set.id}/publish`, { expectedHash: "unused" }),
    409,
    "set_menu.wrong_place",
    { menuId: set.id },
  );
});

it("explains why a set menu has no status on both single-menu reads", async () => {
  const { send, set } = await fixture();
  const path = `${menus}/${set.id}`;
  const error = { code: "set_menu.wrong_place", params: { menuId: set.id } };
  expect(await json(await send("GET", `${path}/status`), 409)).toEqual({ error });
  expect(await json(await send("GET", `${path}/read?part=status`), 200)).toMatchObject({
    status: { status: 409, body: { error } },
  });
});

it("reports a full menu as changed after saving one of its set-menu lines", async () => {
  const f = await fixture();
  await addSoup(f);
  await withTransaction(suite.db, (tx) => addMember(tx, f.fullRoot, f.ref));
  const path = `${menus}/${f.full.id}`;
  const { hash } = await json<{ hash: string }>(await f.send("GET", `${path}/preview`), 200);
  await json(await f.send("POST", `${path}/publish`, { expectedHash: hash }), 200);
  const statuses = async () =>
    json<Record<string, { state: string }>>(await f.send("GET", `${menus}/status`), 200);
  const before = await statuses();
  expect(before[f.full.id]?.state).toBe("current");
  await json(
    await f.send("PUT", `${f.draft}/lines`, {
      lines: [{ count: 2, courseIds: [f.starter.id] }],
    }),
    200,
  );
  expect((await statuses())[f.full.id]?.state).toBe("changed");
});
