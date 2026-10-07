import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import type { DocumentMember, MenuPreview, MenuStructureNode } from "@waitron/catalogue";
import { MEDIA_MIGRATIONS, mediaImages } from "@waitron/media";
import { locationId as brandLocationId, nodeId as brandNodeId, seriesId } from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import "./errors.js";

const PHOTO = `${"a".repeat(64)}.jpg`;
const NOT_IN_LIBRARY = `${"b".repeat(64)}.jpg`;

let locationId: string;
let managerCookie: string;
let staffCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS, MEDIA_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Main",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta",
        timeZone: "Europe/Madrid",
      })
      .returning({ id: locations.id });
    locationId = loc!.id;
    await db.insert(mediaImages).values({ filename: PHOTO, names: { es: "Copas" } });
    const { managerSid, staffSid } = await withTransaction(db, async (tx) => {
      const [manager] = await tx
        .insert(persons)
        .values({ displayName: "manager-ana", pinHash: hashPin("1234"), role: "manager" })
        .returning({ id: persons.id });
      const [staff] = await tx
        .insert(persons)
        .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
        .returning({ id: persons.id });
      const managerSession = await startManagementSession(tx, { personId: manager!.id });
      const staffSession = await startManagementSession(tx, { personId: staff!.id });
      return { managerSid: managerSession.token, staffSid: staffSession.token };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
  },
});

const noopLog: Logger = () => {};

function mountApp(): Hono {
  const app = new Hono();
  mountCatalogueApi(
    app,
    {
      db: suite.db,
      venueCfg: {
        nodeId: brandNodeId("11111111-1111-4111-8111-111111111111"),
        seriesId: seriesId(crypto.randomUUID()),
        locationId: brandLocationId(locationId),
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        tipsEnabled: false,
        simplifiedInvoiceLimit: null,
      },
      venueLocale: "es-ES",
    },
    noopLog,
  );
  return app;
}

async function send(
  app: Hono,
  method: "POST" | "PUT" | "GET",
  path: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { cookie: opts.cookie ?? managerCookie };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

async function json<T>(response: Response, status: number): Promise<T> {
  expect(response.status).toBe(status);
  return (await response.json()) as T;
}

async function created(app: Hono, path: string, body: unknown): Promise<{ id: string }> {
  return json<{ id: string }>(await send(app, "POST", path, { body }), 201);
}

async function structureOf(
  app: Hono,
  menuId: string,
): Promise<{ rootSectionId: string; nodes: MenuStructureNode[] }> {
  return json(await send(app, "GET", `/management-api/catalogues/${menuId}/structure`), 200);
}

interface Fixture {
  lunchId: string;
  lunchRoot: string;
  drinksId: string;
  /** The member of Lunch's top level that includes Drinks. */
  include: string;
  /** A member of Lunch's top level that is a product. */
  productMember: string;
}

/**
 * Lunch includes Drinks. Drinks' staff name, its customer names and every folder name a case
 * fixes are three different texts, so a read of the wrong one fails.
 */
async function lunchIncludingDrinks(app: Hono): Promise<Fixture> {
  const tag = crypto.randomUUID();
  const lunchId = (await created(app, "/management-api/catalogues", { name: `Lunch ${tag}` })).id;
  const drinksId = (
    await created(app, "/management-api/catalogues", {
      name: `Drinks staff ${tag}`,
      names: { es: "Bebidas de la carta", en: "Drinks list" },
    })
  ).id;
  const lunchRoot = (await structureOf(app, lunchId)).rootSectionId;
  const drinksRoot = (await structureOf(app, drinksId)).rootSectionId;
  const members = `/management-api/sections/${lunchRoot}/members`;
  const include = (await created(app, members, { ref: { kind: "section", sectionId: drinksRoot } }))
    .id;
  const productId = (
    await created(app, "/management-api/products", {
      catalogueId: (await created(app, "/management-api/catalogues", { name: `Kitchen ${tag}` }))
        .id,
      categoryId: null,
      name: `Soup ${tag}`,
      pricingUnit: "each",
      unitPrice: "4.00",
      vatClass: "general",
    })
  ).id;
  const productMember = (await created(app, members, { ref: { kind: "product", productId } })).id;
  return { lunchId, lunchRoot, drinksId, include, productMember };
}

const folderPath = (f: Fixture, member = f.include) =>
  `/management-api/sections/${f.lunchRoot}/members/${member}/folder`;

async function folderOf(app: Hono, f: Fixture): Promise<MenuStructureNode["folder"]> {
  const { nodes } = await structureOf(app, f.lunchId);
  return nodes.find((node) => node.memberId === f.include)!.folder;
}

describe("PUT /management-api/sections/:id/members/:memberId/folder", () => {
  it("a manager sets the switch and the overrides; the structure read answers them", async () => {
    const app = mountApp();
    const f = await lunchIncludingDrinks(app);
    const direct = await send(app, "PUT", folderPath(f), { body: { showAsFolder: false } });
    expect(await json(direct, 200)).toEqual({ showAsFolder: false, overrides: {} });
    expect(await folderOf(app, f)).toEqual({ showAsFolder: false, overrides: {} });

    const overrides = { names: { es: "Copas y refrescos" }, color: "#aabbcc", image: null };
    const folder = await send(app, "PUT", folderPath(f), {
      body: { showAsFolder: true, overrides },
    });
    expect(await json(folder, 200)).toEqual({ showAsFolder: true, overrides });
    expect(await folderOf(app, f)).toEqual({ showAsFolder: true, overrides });
  });

  it("a staff-role session is refused 403 authorization.not_permitted, and nothing is written", async () => {
    const app = mountApp();
    const f = await lunchIncludingDrinks(app);
    const refused = await send(app, "PUT", folderPath(f), {
      cookie: staffCookie,
      body: { showAsFolder: false, overrides: { color: "#aabbcc" } },
    });
    expect(await json(refused, 403)).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });
    const signedOut = await send(app, "PUT", folderPath(f), {
      cookie: "",
      body: { showAsFolder: false },
    });
    expect(await json(signedOut, 401)).toMatchObject({
      error: { code: "management_session.required" },
    });
    expect(await folderOf(app, f)).toEqual({ showAsFolder: true, overrides: {} });
  });

  it("refuses a body of the wrong shape with management.request_invalid naming the field", async () => {
    const app = mountApp();
    const f = await lunchIncludingDrinks(app);
    const cases: [body: unknown, field: string][] = [
      [{}, "showAsFolder"],
      [{ showAsFolder: "false" }, "showAsFolder"],
      [null, "showAsFolder"],
      [[], "showAsFolder"],
      [3, "showAsFolder"],
      [{ showAsFolder: true, overrides: [] }, "overrides"],
      [{ showAsFolder: true, overrides: null }, "overrides"],
      [{ showAsFolder: true, overrides: { shown: true } }, "overrides"],
      [{ showAsFolder: true, overrides: { names: "x" } }, "names"],
      [{ showAsFolder: true, overrides: { names: { es: 5 } } }, "names"],
      [{ showAsFolder: true, overrides: { image: 3 } }, "image"],
      [{ showAsFolder: true, overrides: { color: false } }, "color"],
      [{ showAsFolder: true, overrides: { internalName: "Bar" } }, "overrides"],
      [{ showAsFolder: true, overrides: { names: null } }, "names"],
      [{ showAsFolder: true, overrides: { names: 5, image: 3 } }, "names"],
      [{ showAsFolder: true, overrides: { image: 3, color: false } }, "image"],
    ];
    for (const [body, field] of cases) {
      const response = await send(app, "PUT", folderPath(f), { body });
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json(), JSON.stringify(body)).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    expect(await folderOf(app, f)).toEqual({ showAsFolder: true, overrides: {} });
  });

  it("answers the domain refusals with their codes", async () => {
    const app = mountApp();
    const f = await lunchIncludingDrinks(app);
    const unknown = await send(app, "PUT", folderPath(f, crypto.randomUUID()), {
      body: { showAsFolder: false },
    });
    expect(await json(unknown, 404)).toMatchObject({ error: { code: "menu_section.not_found" } });
    const product = await send(app, "PUT", folderPath(f, f.productMember), {
      body: { showAsFolder: false },
    });
    expect(await json(product, 400)).toMatchObject({
      error: { code: "menu_section.membership_invalid" },
    });
    // Blanking the default language leaves the folder only an English name.
    const gap = await send(app, "PUT", folderPath(f), {
      body: { showAsFolder: true, overrides: { names: { es: " " } } },
    });
    expect(await json(gap, 400)).toEqual({
      error: {
        code: "menu_section.translation_required",
        params: { field: "names", language: "es" },
      },
    });
    const colour = await send(app, "PUT", folderPath(f), {
      body: { showAsFolder: true, overrides: { color: "#AABBCC" } },
    });
    expect(await json(colour, 400)).toEqual({
      error: { code: "menu_section.invalid", params: { field: "color" } },
    });
    const photo = await send(app, "PUT", folderPath(f), {
      body: { showAsFolder: true, overrides: { image: NOT_IN_LIBRARY } },
    });
    expect(await json(photo, 400)).toEqual({
      error: { code: "menu_section.invalid", params: { field: "image" } },
    });
    expect(await folderOf(app, f)).toEqual({ showAsFolder: true, overrides: {} });
  });

  it("refuses a member holding a sub-section of the menu with 409 menu_section.wrong_role", async () => {
    const app = mountApp();
    const f = await lunchIncludingDrinks(app);
    const starters = await created(app, `/management-api/sections/${f.lunchRoot}/sections`, {
      internalName: `Starters ${crypto.randomUUID()}`,
      names: { es: "Entrantes de la casa" },
    });
    const { nodes } = await structureOf(app, f.lunchId);
    const member = nodes.find(
      (node) => node.ref.kind === "section" && node.ref.sectionId === starters.id,
    )!.memberId;

    const refused = await send(app, "PUT", folderPath(f, member), {
      body: { showAsFolder: false },
    });

    expect(await json(refused, 409)).toEqual({
      error: {
        code: "menu_section.wrong_role",
        params: { sectionId: starters.id, role: "section" },
      },
    });
  });

  it("a malformed member id is refused before the transaction", async () => {
    const app = mountApp();
    const f = await lunchIncludingDrinks(app);
    // A staff session would be refused 403 inside the transaction; the id is refused first.
    for (const cookie of [managerCookie, staffCookie]) {
      const response = await send(app, "PUT", folderPath(f, "nope"), {
        cookie,
        body: { showAsFolder: false },
      });
      expect(await json(response, 400)).toMatchObject({
        error: { code: "shared.invalid_id", params: { kind: "SectionMemberId", value: "nope" } },
      });
    }
    const badList = await send(
      app,
      "PUT",
      `/management-api/sections/nope/members/${f.include}/folder`,
      { cookie: staffCookie, body: { showAsFolder: false } },
    );
    expect(await json(badList, 400)).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "SectionId", value: "nope" } },
    });
  });

  it("a photo in the library is accepted as the folder's image, and the published document shows it", async () => {
    const app = mountApp();
    const f = await lunchIncludingDrinks(app);
    const set = await send(app, "PUT", folderPath(f), {
      body: { showAsFolder: true, overrides: { image: PHOTO } },
    });
    expect(await json(set, 200)).toEqual({ showAsFolder: true, overrides: { image: PHOTO } });
    const preview = await json<MenuPreview>(
      await send(app, "GET", `/management-api/catalogues/${f.lunchId}/preview`),
      200,
    );
    const include = preview.document.root.members.find(
      (member): member is Extract<DocumentMember, { kind: "section" }> =>
        member.kind === "section" && member.includedMenu?.id === f.drinksId,
    )!;
    expect(include).toMatchObject({
      image: PHOTO,
      fixed: { image: PHOTO },
      names: { es: "Bebidas de la carta", en: "Drinks list" },
    });
    expect(include.direct).toBeUndefined();
  });
});
