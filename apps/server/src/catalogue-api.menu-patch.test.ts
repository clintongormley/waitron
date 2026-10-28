import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import type { LiveMenu, MenuPatchResult, MenuPreview } from "@waitron/catalogue";
import { MEDIA_MIGRATIONS, mediaImages } from "@waitron/media";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import "./errors.js";

const PHOTO = `${"b".repeat(64)}.jpg`;

let managerCookie: string;
let staffCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS, MEDIA_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    await seedLegacySellingUnits(db);
    await db.insert(mediaImages).values({ filename: PHOTO, names: { es: "Sopa" } });
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

// Every case shares one database and names its product "Soup"; an active product's name is unique
// across the venue, so the products earlier cases left are renamed first.
beforeEach(async () => {
  await suite.db.execute(
    sql`update products set name = 'earlier test ' || id where name <> 'earlier test ' || id`,
  );
  await suite.db.execute(
    sql`update catalogues set name = 'earlier test ' || id where name <> 'earlier test ' || id`,
  );
  await suite.db.execute(
    sql`update sections set internal_name = 'earlier test ' || owner_menu_id where role = 'menu_root'`,
  );
});

const noopLog: Logger = () => {};

function mountApp(): Hono {
  const app = new Hono();
  mountCatalogueApi(app, { db: suite.db, venueLocale: "es" }, noopLog);
  return app;
}

async function send(
  app: Hono,
  method: "POST" | "PATCH" | "GET",
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

async function created(app: Hono, path: string, body: unknown): Promise<string> {
  return (await json<{ id: string }>(await send(app, "POST", path, { body }), 201)).id;
}

/** A menu "Lunch" offering a product "Soup", not yet published. */
async function lunchWithSoup(app: Hono): Promise<{ menuId: string; itemId: string }> {
  const menuId = await created(app, "/management-api/catalogues", { name: "Lunch" });
  const productId = await created(app, "/management-api/products", {
    catalogueId: await created(app, "/management-api/catalogues", { name: "Kitchen" }),
    categoryId: null,
    name: "Soup",
    pricingUnit: "each",
    unitPrice: "4.00",
    vatClass: "general",
  });
  const structure = await json<{ rootSectionId: string }>(
    await send(app, "GET", `/management-api/catalogues/${menuId}/structure`),
    200,
  );
  await json(
    await send(app, "POST", `/management-api/sections/${structure.rootSectionId}/members`, {
      body: { ref: { kind: "product", productId } },
    }),
    201,
  );
  const prices = await json<{ menuItemId: string; productId: string }[]>(
    await send(app, "GET", `/management-api/catalogues/${menuId}/prices`),
    200,
  );
  return { menuId, itemId: prices.find((row) => row.productId === productId)!.menuItemId };
}

async function publish(app: Hono, menuId: string): Promise<void> {
  const preview = await json<MenuPreview>(
    await send(app, "GET", `/management-api/catalogues/${menuId}/preview`),
    200,
  );
  await json(
    await send(app, "POST", `/management-api/catalogues/${menuId}/publish`, {
      body: { expectedHash: preview.hash },
    }),
    200,
  );
}

async function live(app: Hono, menuId: string, cookie?: string): Promise<Response> {
  return send(app, "GET", `/management-api/catalogues/${menuId}/live`, {
    ...(cookie === undefined ? {} : { cookie }),
  });
}

async function patch(app: Hono, menuId: string, body: unknown, cookie?: string): Promise<Response> {
  return send(app, "POST", `/management-api/catalogues/${menuId}/patch`, {
    body,
    ...(cookie === undefined ? {} : { cookie }),
  });
}

const price = (itemId: string, value: string) => ({
  target: { kind: "offer", menuItemId: itemId },
  field: "price",
  value,
});

function revisionOf(response: Response): { epoch: string; sequence: number } {
  return JSON.parse(response.headers.get("x-waitron-menu-revision")!) as {
    epoch: string;
    sequence: number;
  };
}

async function publicationTables() {
  return {
    versions: await suite.db.all(sql`select * from menu_versions order by id`),
    images: await suite.db.all(sql`select * from menu_version_images order by version_id`),
    publications: await suite.db.all(sql`select * from menu_publications order by menu_id`),
  };
}

describe("reading and patching a menu's live version", () => {
  it("answers null before the first publish and the live document after it", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    expect(await json(await live(app, menuId), 200)).toBeNull();
    await publish(app, menuId);
    const answer = await json<LiveMenu>(await live(app, menuId), 200);
    expect(answer).toMatchObject({ versionId: expect.any(String), number: 1 });
    expect(answer.document.offers[itemId]).toMatchObject({ unitPrice: "4.00" });
  });

  it("puts a patch live and answers the new number", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const read = await live(app, menuId);
    const revisionBefore = revisionOf(read);
    const base = await json<LiveMenu>(read, 200);
    const res = await patch(app, menuId, {
      baseVersionId: base.versionId,
      changes: [price(itemId, "4.50")],
    });
    const revisionAfter = revisionOf(res);
    expect(revisionAfter.epoch).toBe(revisionBefore.epoch);
    expect(revisionAfter.sequence).toBeGreaterThan(revisionBefore.sequence);
    const result = await json<MenuPatchResult>(res, 200);
    expect(result).toEqual({ versionId: expect.any(String), number: 2, requeued: [] });
    const after = await json<LiveMenu>(await live(app, menuId), 200);
    expect(after).toMatchObject({ versionId: result.versionId, number: 2 });
    expect(after.document.offers[itemId]).toMatchObject({ unitPrice: "4.50" });
  });

  it("merges translated text against the venue's language when none are saved", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const base = await json<LiveMenu>(await live(app, menuId), 200);
    const result = await json<MenuPatchResult>(
      await patch(app, menuId, {
        baseVersionId: base.versionId,
        changes: [
          {
            target: { kind: "offer", menuItemId: itemId },
            field: "customerName",
            value: { es: "Sopa del día" },
          },
        ],
      }),
      200,
    );
    expect(result.number).toBe(2);
    const after = await json<LiveMenu>(await live(app, menuId), 200);
    expect(after.document.offers[itemId]!.customerName).toMatchObject({ es: "Sopa del día" });
  });

  it("accepts a picture from the media library and records it for the new version", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const base = await json<LiveMenu>(await live(app, menuId), 200);
    const result = await json<MenuPatchResult>(
      await patch(app, menuId, {
        baseVersionId: base.versionId,
        changes: [{ target: { kind: "offer", menuItemId: itemId }, field: "image", value: PHOTO }],
      }),
      200,
    );
    expect(
      await suite.db.all(
        sql`select filename from menu_version_images where version_id = ${result.versionId}`,
      ),
    ).toEqual([{ filename: PHOTO }]);
  });

  it("refuses a picture deleted from the media library, saying the library no longer holds it", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const base = await json<LiveMenu>(await live(app, menuId), 200);
    const deleted = `${"d".repeat(64)}.jpg`;
    await suite.db.insert(mediaImages).values({ filename: deleted, names: { es: "Borrada" } });
    await suite.db.execute(sql`delete from media_images where filename = ${deleted}`);
    const before = await publicationTables();
    expect(
      await json(
        await patch(app, menuId, {
          baseVersionId: base.versionId,
          changes: [
            price(itemId, "4.50"),
            { target: { kind: "offer", menuItemId: itemId }, field: "image", value: deleted },
          ],
        }),
        400,
      ),
    ).toEqual({
      error: {
        code: "menu_patch.invalid",
        params: { change: 1, field: "image", reason: "image.not_found" },
      },
    });
    expect(await publicationTables()).toEqual(before);
  });

  it("refuses a session without the catalogue permission, writing nothing", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const base = await json<LiveMenu>(await live(app, menuId), 200);
    const before = await publicationTables();
    const refused = [
      await send(app, "POST", `/management-api/catalogues/${menuId}/publish`, {
        body: { expectedHash: "x" },
        cookie: staffCookie,
      }),
      await live(app, menuId, staffCookie),
      await patch(
        app,
        menuId,
        { baseVersionId: base.versionId, changes: [price(itemId, "4.50")] },
        staffCookie,
      ),
    ];
    for (const res of refused)
      expect(await json(res, 403)).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    expect(await publicationTables()).toEqual(before);
  });

  it("refuses an id that names no menu as not found, writing nothing", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const before = await publicationTables();
    const missing = crypto.randomUUID();
    const refused = [
      await live(app, missing),
      await patch(app, missing, {
        baseVersionId: crypto.randomUUID(),
        changes: [price(itemId, "4.50")],
      }),
    ];
    for (const res of refused)
      expect(await json(res, 404)).toMatchObject({
        error: { code: "catalogue.not_found", params: { catalogueId: missing } },
      });
    expect(await publicationTables()).toEqual(before);
  });

  it("refuses a malformed menu id, base version id or body", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    expect(await json(await live(app, "not-a-uuid"), 400)).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "MenuId" } },
    });
    expect(
      await json(
        await patch(app, "not-a-uuid", { baseVersionId: crypto.randomUUID(), changes: [] }),
        400,
      ),
    ).toMatchObject({ error: { code: "shared.invalid_id", params: { kind: "MenuId" } } });
    expect(
      await json(await patch(app, menuId, { changes: [price(itemId, "4.50")] }), 400),
    ).toMatchObject({ error: { params: { field: "baseVersionId" } } });
    expect(
      await json(
        await patch(app, menuId, { baseVersionId: "v1", changes: [price(itemId, "4.50")] }),
        400,
      ),
    ).toMatchObject({
      error: { code: "shared.invalid_id", params: { kind: "MenuVersionId", value: "v1" } },
    });
  });

  it("refuses a body without a list of changes before reading the menu", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    for (const changes of [undefined, null, "changes", price(itemId, "4.50")])
      expect(
        await json(await patch(app, menuId, { baseVersionId: crypto.randomUUID(), changes }), 400),
      ).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "changes" } },
      });
  });

  it("refuses a dish id its menu only inherits, leaving every object's prototype alone", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const base = await json<LiveMenu>(await live(app, menuId), 200);
    const before = await publicationTables();
    const holders = [
      Object.prototype,
      Object,
      Object.prototype.hasOwnProperty,
    ] as unknown as Record<string, unknown>[];
    try {
      for (const inherited of ["__proto__", "constructor", "hasOwnProperty"])
        expect(
          await json(
            await patch(app, menuId, {
              baseVersionId: base.versionId,
              changes: [
                price(itemId, "4.50"),
                {
                  target: { kind: "offer", menuItemId: inherited },
                  field: "kitchenName",
                  value: "Everywhere",
                },
              ],
            }),
            400,
          ),
        ).toMatchObject({
          error: { code: "menu_patch.invalid", params: { change: 1, field: "target" } },
        });
      expect(({} as Record<string, unknown>).kitchenName).toBeUndefined();
      expect(holders.map((holder) => Object.hasOwn(holder, "kitchenName"))).toEqual([
        false,
        false,
        false,
      ]);
      expect(await publicationTables()).toEqual(before);
    } finally {
      for (const holder of holders) delete holder.kitchenName;
    }
  });

  it("gives each refusal from the patch its own status, writing nothing", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    const unpublished = await patch(app, menuId, {
      baseVersionId: crypto.randomUUID(),
      changes: [price(itemId, "4.50")],
    });
    expect(await json(unpublished, 409)).toMatchObject({
      error: { code: "menu_patch.not_published", params: { menuId } },
    });
    await publish(app, menuId);
    const base = await json<LiveMenu>(await live(app, menuId), 200);
    const before = await publicationTables();

    const stale = crypto.randomUUID();
    expect(
      await json(
        await patch(app, menuId, { baseVersionId: stale, changes: [price(itemId, "4.50")] }),
        409,
      ),
    ).toMatchObject({
      error: {
        code: "menu_patch.base_changed",
        params: { menuId, baseVersionId: stale, liveVersionId: base.versionId, liveNumber: 1 },
      },
    });
    expect(
      await json(
        await patch(app, menuId, { baseVersionId: base.versionId, changes: [price(itemId, "4")] }),
        409,
      ),
    ).toMatchObject({ error: { code: "menu_patch.unchanged", params: { menuId } } });
    expect(
      await json(
        await patch(app, menuId, {
          baseVersionId: base.versionId,
          changes: [
            { target: { kind: "offer", menuItemId: itemId }, field: "allergens", value: [] },
          ],
        }),
        400,
      ),
    ).toMatchObject({
      error: { code: "menu_patch.invalid", params: { change: 0, field: "field" } },
    });
    expect(
      await json(
        await patch(app, menuId, {
          baseVersionId: base.versionId,
          changes: [
            {
              target: { kind: "offer", menuItemId: itemId },
              field: "image",
              value: `${"c".repeat(64)}.jpg`,
            },
          ],
        }),
        400,
      ),
    ).toMatchObject({
      error: { code: "menu_patch.invalid", params: { change: 0, field: "image" } },
    });
    expect(await publicationTables()).toEqual(before);
  });
});
