import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { seedPhotoMetadata } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTaxpayer, seedVenue } from "@waitron/db/testing/seed.js";
import { startManagementSession } from "@waitron/identity";
import type { LiveMenu, MenuPatchResult, MenuPreview, PatchDraftAnswer } from "@waitron/menu";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mountMenuApi } from "./menu-api.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import "./errors.js";

const PHOTO = `${"b".repeat(64)}.jpg`;

let managerCookie: string;
let staffCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTaxpayer(db);
    await seedVenue(db, {});
    await seedLegacySellingUnits(db);
    await seedPhotoMetadata(db, { filename: PHOTO, names: { es: "Sopa" } });
    const { managerSid, staffSid } = await withTransaction(db, async (tx) => {
      const [manager] = await seedPersons(tx, {
        displayName: "Anna Manager",
        pinHash: fixturePinHash("1234"),
        role: "manager",
      });
      const [staff] = await seedPersons(tx, {
        displayName: "The Clerk",
        pinHash: fixturePinHash("1234"),
        role: "staff",
      });
      const managerSession = await startManagementSession(tx, {
        method: "password",
        personId: manager!.id,
      });
      const staffSession = await startManagementSession(tx, {
        method: "password",
        personId: staff!.id,
      });
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
    sql`update menus set name = 'earlier test ' || id where name <> 'earlier test ' || id`,
  );
});

const noopLog: Logger = () => {};

function mountApp(): Hono {
  const app = new Hono();
  mountMenuApi(app, { db: suite.db, venueLocale: "es" }, noopLog);
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
  const menuId = await created(app, "/management-api/menus", { name: "Lunch" });
  const productId = await created(app, "/management-api/products", {
    categoryId: null,
    name: "Soup",
    pricingUnit: "each",
    unitPrice: "4.00",
  });
  const structure = await json<{ rootSectionId: string }>(
    await send(app, "GET", `/management-api/menus/${menuId}/structure`),
    200,
  );
  await json(
    await send(app, "POST", `/management-api/sections/${structure.rootSectionId}/members`, {
      body: { ref: { kind: "product", productId } },
    }),
    201,
  );
  const prices = await json<{ menuItemId: string; productId: string }[]>(
    await send(app, "GET", `/management-api/menus/${menuId}/prices`),
    200,
  );
  return { menuId, itemId: prices.find((row) => row.productId === productId)!.menuItemId };
}

async function publish(app: Hono, menuId: string): Promise<void> {
  const preview = await json<MenuPreview>(
    await send(app, "GET", `/management-api/menus/${menuId}/preview`),
    200,
  );
  await json(
    await send(app, "POST", `/management-api/menus/${menuId}/publish`, {
      body: { expectedHash: preview.hash },
    }),
    200,
  );
}

async function live(app: Hono, menuId: string, cookie?: string): Promise<Response> {
  return send(app, "GET", `/management-api/menus/${menuId}/live`, {
    ...(cookie === undefined ? {} : { cookie }),
  });
}

async function patch(app: Hono, menuId: string, body: unknown, cookie?: string): Promise<Response> {
  return send(app, "POST", `/management-api/menus/${menuId}/patch`, {
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
    publications: await suite.db.all(sql`select * from menu_releases order by menu_id`),
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

  it("lists the queued versions whose allergens differ, and corrects the one a patch names", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const target = { kind: "offer", menuItemId: itemId };
    const declarations = { target, field: "declarations", value: "product" };
    const rows = await suite.db.all<{ id: string }>(
      sql`select id from products where name = 'Soup'`,
    );
    const queue = async (name: string, day: string) => {
      await suite.db.execute(
        sql`update products set kitchen_name = ${name} where id = ${rows[0]!.id}`,
      );
      const preview = await json<MenuPreview>(
        await send(app, "GET", `/management-api/menus/${menuId}/preview`),
        200,
      );
      return (
        await json<{ versionId: string }>(
          await send(app, "POST", `/management-api/menus/${menuId}/publications`, {
            body: { expectedHash: preview.hash, activatesAt: { date: day, time: "09:00" } },
          }),
          201,
        )
      ).versionId;
    };
    const queued = [await queue("SOPA 1", "2099-01-05"), await queue("SOPA 2", "2099-01-06")];
    await suite.db.execute(
      sql`update products set allergens = '{"milk":{}}' where id = ${rows[0]!.id}`,
    );
    const base = await json<PatchDraftAnswer>(await live(app, menuId), 200);
    const local = (date: string) => ({ date, time: "09:00", offset: "+01:00", repeated: false });
    expect(base.queued).toEqual(
      queued.map((versionId, index) => ({
        versionId,
        activatesAt: expect.any(String),
        local: local(`2099-01-0${index + 5}`),
        targets: [{ target, stillOld: true }],
      })),
    );
    const { revision: reviewed } = base;
    const invalid = { code: "management.request_invalid", params: { field: "queued" } };
    const badId = {
      code: "shared.invalid_id",
      params: { kind: "MenuVersionId", value: "not-a-uuid" },
    };
    for (const [bad, error] of [
      [null, invalid],
      ["x", invalid],
      [[7], invalid],
      [["not-a-uuid"], badId],
    ])
      expect(
        await json(
          await patch(app, menuId, {
            baseVersionId: base.versionId,
            changes: [declarations],
            queued: bad,
            reviewed,
          }),
          400,
        ),
      ).toMatchObject({ error });
    const result = await json<MenuPatchResult>(
      await patch(app, menuId, {
        baseVersionId: base.versionId,
        changes: [declarations],
        queued: [queued[1]],
        reviewed,
      }),
      200,
    );
    const after = await json<PatchDraftAnswer>(await live(app, menuId), 200);
    expect(after.document.offers[itemId]!.allergens).toEqual({ milk: {} });
    expect(after.queued).toEqual([
      {
        versionId: result.requeued[0]!.versionId,
        activatesAt: base.queued[0]!.activatesAt,
        local: local("2099-01-05"),
        targets: [
          {
            target,
            stillOld: false,
            replaces: [
              {
                productId: rows[0]!.id,
                name: "Soup",
                values: expect.objectContaining({ allergens: null, dietaryDeclarations: [] }),
              },
            ],
          },
        ],
      },
    ]);
  });

  it("reads the live version whatever the venue's zone while it lists no scheduled version", async () => {
    const app = mountApp();
    const { menuId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const setSoup = (column: "kitchen_name" | "allergens", value: string) =>
      suite.db.execute(
        sql`update products set ${sql.identifier(column)} = ${value} where name = 'Soup'`,
      );
    await setSoup("kitchen_name", "SOPA");
    const preview = await json<MenuPreview>(
      await send(app, "GET", `/management-api/menus/${menuId}/preview`),
      200,
    );
    await json(
      await send(app, "POST", `/management-api/menus/${menuId}/publications`, {
        body: { expectedHash: preview.hash, activatesAt: { date: "2099-01-05", time: "09:00" } },
      }),
      201,
    );
    const setVenueZone = (timeZone: string) =>
      suite.db.execute(
        sql`update settings set doc = json_set(doc, '$.timeZone', ${timeZone}) where module = 'business_day'`,
      );
    await setVenueZone("Mars/Olympus");
    try {
      expect(await json<PatchDraftAnswer>(await live(app, menuId), 200)).toMatchObject({
        queued: [],
      });
      await setSoup("allergens", '{"milk":{}}');
      expect(await json(await live(app, menuId), 500)).toEqual({
        error: { code: "time_zone.unreadable", params: {} },
      });
    } finally {
      await setVenueZone("Europe/Madrid");
    }
  });

  it("refuses allergens other than those reviewed, and asks no other patch what was", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const setAllergens = (allergens: string) =>
      suite.db.execute(
        sql`update products set allergens = ${allergens} where name = 'Soup' and id in
          (select product_id from menu_items where menu_id = ${menuId})`,
      );
    await setAllergens('{"milk":{}}');
    const base = await json<PatchDraftAnswer>(await live(app, menuId), 200);
    const declarations = {
      target: { kind: "offer", menuItemId: itemId },
      field: "declarations",
      value: "product",
    };
    const body = {
      baseVersionId: base.versionId,
      changes: [price(itemId, "4.50"), declarations],
    };
    const before = await publicationTables();
    for (const reviewed of [undefined, null, 7, {}])
      expect(await json(await patch(app, menuId, { ...body, reviewed }), 400)).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "reviewed" } },
      });
    await setAllergens('{"celery":{}}');
    const stale = await patch(app, menuId, { ...body, reviewed: base.revision });
    expect(await json(stale, 409)).toEqual({
      error: { code: "menu_patch.declarations_changed", params: { menuId } },
    });
    expect(await publicationTables()).toEqual(before);

    const { revision: reviewed } = await json<PatchDraftAnswer>(await live(app, menuId), 200);
    expect(reviewed).not.toBe(base.revision);
    const { versionId } = await json<MenuPatchResult>(
      await patch(app, menuId, { ...body, reviewed }),
      200,
    );
    const after = await json<PatchDraftAnswer>(await live(app, menuId), 200);
    expect(after.document.offers[itemId]).toMatchObject({
      unitPrice: "4.50",
      allergens: { celery: {} },
    });

    await setAllergens('{"eggs":{}}');
    const priced = { baseVersionId: versionId, changes: [price(itemId, "4.60")] };
    expect(await json<MenuPatchResult>(await patch(app, menuId, priced), 200)).toMatchObject({
      number: 3,
    });
  });

  it("refuses a malformed change beside no reviewed one as the patch does", async () => {
    const app = mountApp();
    const { menuId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const base = await json<LiveMenu>(await live(app, menuId), 200);
    for (const change of [null, 7, "declarations"])
      expect(
        await json(
          await patch(app, menuId, { baseVersionId: base.versionId, changes: [change] }),
          400,
        ),
      ).toMatchObject({ error: { code: "menu_patch.invalid" } });
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
    await seedPhotoMetadata(suite.db, { filename: deleted, names: { es: "Borrada" } });
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

  it("refuses a session without the menu permission, writing nothing", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await publish(app, menuId);
    const base = await json<LiveMenu>(await live(app, menuId), 200);
    const before = await publicationTables();
    const refused = [
      await send(app, "POST", `/management-api/menus/${menuId}/publish`, {
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
        error: { code: "menu.not_found", params: { menuId: missing } },
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
