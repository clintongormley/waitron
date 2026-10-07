import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import type { MenuPreview, MenuPublicationsAnswer, MenuStatus } from "@waitron/catalogue";
import { locationId as brandLocationId, nodeId as brandNodeId, seriesId } from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { seedLegacySellingUnits } from "./testing/seed-units.js";
import "./errors.js";

// The fixed "now" of every case: 2026-10-07 10:00 in Madrid.
const NOW = new Date("2026-10-07T08:00:00Z");
const TOMORROW = { date: "2026-10-08", time: "08:00" };
const TOMORROW_AT = "2026-10-08T06:00:00.000Z";

let locationId: string;
let managerCookie: string;
let staffCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
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

afterAll(() => {
  vi.useRealTimers();
});

// Every case shares one database and names its product "Soup"; an active product's name is unique
// across the venue, so the products earlier cases left are renamed first.
beforeEach(async () => {
  vi.setSystemTime(NOW);
  await suite.db.execute(
    sql`update products set name = 'earlier test ' || id where name <> 'earlier test ' || id`,
  );
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

/** A menu "Lunch" offering a product "Soup" at a menu price of 5.00, with v1 live. */
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
  const itemId = prices.find((row) => row.productId === productId)!.menuItemId;
  await setSoupPrice(app, menuId, itemId, "5.00");
  const published = await send(app, "POST", `/management-api/catalogues/${menuId}/publish`, {
    body: { expectedHash: await previewHash(app, menuId) },
  });
  expect(await json(published, 200)).toMatchObject({ number: 1 });
  return { menuId, itemId };
}

async function setSoupPrice(app: Hono, menuId: string, itemId: string, grossPrice: string) {
  const res = await send(app, "PATCH", `/management-api/catalogues/${menuId}/items/${itemId}`, {
    body: { grossPrice },
  });
  expect(res.status).toBe(204);
}

async function previewHash(app: Hono, menuId: string): Promise<string> {
  return (
    await json<MenuPreview>(
      await send(app, "GET", `/management-api/catalogues/${menuId}/preview`),
      200,
    )
  ).hash;
}

async function queue(app: Hono, menuId: string, activatesAt: unknown, expectedHash?: string) {
  return send(app, "POST", `/management-api/catalogues/${menuId}/publications`, {
    body: { expectedHash: expectedHash ?? (await previewHash(app, menuId)), activatesAt },
  });
}

async function publications(app: Hono, menuId: string): Promise<MenuPublicationsAnswer> {
  return json(await send(app, "GET", `/management-api/catalogues/${menuId}/publications`), 200);
}

async function status(app: Hono, menuId: string): Promise<MenuStatus> {
  return json(await send(app, "GET", `/management-api/catalogues/${menuId}/status`), 200);
}

async function setVenueZone(timeZone: string): Promise<void> {
  await suite.db.execute(
    sql`update locations set time_zone = ${timeZone} where id = ${locationId}`,
  );
}

const cancelPath = (menuId: string, versionId: string) =>
  `/management-api/catalogues/${menuId}/publications/${versionId}/cancel`;

/** Every row of the four publication tables, in a fixed order. */
async function publicationTables(): Promise<Record<string, string[]>> {
  const tables: Record<string, string[]> = {};
  for (const table of [
    "menu_versions",
    "menu_version_images",
    "menu_scheduled_publications",
    "menu_publications",
  ]) {
    const { rows } = await suite.db.execute(sql.raw(`select * from ${table}`));
    tables[table] = rows.map((row) => JSON.stringify(row)).sort();
  }
  return tables;
}

describe("queuing, listing and cancelling menu editions through the routes", () => {
  it("queues an edition at a venue-local time and lists it in venue time", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await setSoupPrice(app, menuId, itemId, "5.50");
    const queued = await json<{ versionId: string }>(await queue(app, menuId, TOMORROW), 201);
    expect(queued).toEqual({ versionId: expect.any(String), number: 2, activatesAt: TOMORROW_AT });
    const answer = await publications(app, menuId);
    expect(answer.timeZone).toBe("Europe/Madrid");
    expect(answer.live).toMatchObject({
      number: 1,
      since: NOW.toISOString(),
      local: { date: "2026-10-07", time: "10:00", offset: "+02:00", repeated: false },
    });
    expect(answer.editions).toEqual([
      expect.objectContaining({
        versionId: queued.versionId,
        number: 2,
        state: "queued",
        activatesAt: TOMORROW_AT,
        local: { date: "2026-10-08", time: "08:00", offset: "+02:00", repeated: false },
      }),
    ]);
  });

  it("places and lists times in the venue's own time zone", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await setSoupPrice(app, menuId, itemId, "5.50");
    await setVenueZone("Atlantic/Canary");
    try {
      const queued = await json<{ versionId: string }>(await queue(app, menuId, TOMORROW), 201);
      expect(queued).toMatchObject({ activatesAt: "2026-10-08T07:00:00.000Z" });
      const answer = await publications(app, menuId);
      expect(answer.timeZone).toBe("Atlantic/Canary");
      expect(answer.editions).toEqual([
        expect.objectContaining({
          versionId: queued.versionId,
          local: { date: "2026-10-08", time: "08:00", offset: "+01:00", repeated: false },
        }),
      ]);
    } finally {
      await setVenueZone("Europe/Madrid");
    }
  });

  it("refuses to queue or list while the venue's stored zone is not a named zone, writing nothing", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await setSoupPrice(app, menuId, itemId, "5.50");
    const tables = await publicationTables();
    await setVenueZone("Mars/Olympus");
    try {
      const refusal = { error: { code: "menu_publication.clock_unreadable", params: {} } };
      expect(await json(await queue(app, menuId, TOMORROW), 409)).toEqual(refusal);
      const listed = await send(app, "GET", `/management-api/catalogues/${menuId}/publications`);
      expect(await json(listed, 409)).toEqual(refusal);
      expect(await publicationTables()).toEqual(tables);
    } finally {
      await setVenueZone("Europe/Madrid");
    }
  });

  it("lists a menu never published as having no live version and no editions", async () => {
    const app = mountApp();
    const menuId = await created(app, "/management-api/catalogues", { name: "Lunch" });
    expect(await publications(app, menuId)).toEqual({
      timeZone: "Europe/Madrid",
      live: null,
      editions: [],
    });
  });

  it("answers 404 for the editions of a menu that does not exist", async () => {
    const missing = crypto.randomUUID();
    const res = await send(mountApp(), "GET", `/management-api/catalogues/${missing}/publications`);
    expect(await json(res, 404)).toEqual({
      error: { code: "catalogue.not_found", params: { catalogueId: missing } },
    });
  });

  it("asks which occurrence of a repeated minute, and refuses a skipped or past one", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await setSoupPrice(app, menuId, itemId, "5.50");
    const autumn = { date: "2026-10-25", time: "02:30" };
    const before = await publicationTables();
    expect(await json(await queue(app, menuId, autumn), 400)).toEqual({
      error: {
        code: "menu_publication.time_repeated",
        params: {
          ...autumn,
          occurrences: [
            { at: "2026-10-25T00:30:00.000Z", offset: "+02:00" },
            { at: "2026-10-25T01:30:00.000Z", offset: "+01:00" },
          ],
        },
      },
    });
    expect(await publicationTables()).toEqual(before);

    const later = await json<{ versionId: string }>(
      await queue(app, menuId, { ...autumn, occurrence: "later" }),
      201,
    );
    expect(later).toMatchObject({ number: 2, activatesAt: "2026-10-25T01:30:00.000Z" });
    expect((await publications(app, menuId)).editions).toEqual([
      expect.objectContaining({
        versionId: later.versionId,
        local: { ...autumn, offset: "+01:00", repeated: true },
      }),
    ]);

    await setSoupPrice(app, menuId, itemId, "6.00");
    const afterQueue = await publicationTables();
    expect(
      await json(await queue(app, menuId, { date: "2027-03-28", time: "02:30" }), 400),
    ).toEqual({
      error: {
        code: "menu_publication.time_skipped",
        params: { date: "2027-03-28", time: "02:30" },
      },
    });
    expect(
      await json(await queue(app, menuId, { date: "2026-10-07", time: "09:59" }), 400),
    ).toEqual({
      error: {
        code: "menu_publication.time_past",
        params: { activatesAt: "2026-10-07T07:59:00.000Z" },
      },
    });
    expect(await publicationTables()).toEqual(afterQueue);
  });

  it("refuses a malformed activation time as a request fault", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await setSoupPrice(app, menuId, itemId, "5.50");
    expect(
      await json(await queue(app, menuId, { date: "2026-02-30", time: "08:00" }), 400),
    ).toEqual({
      error: { code: "management.request_invalid", params: { field: "activatesAt.date" } },
    });
  });

  it("cancels a queued edition once, and refuses another menu's version and a malformed id", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await setSoupPrice(app, menuId, itemId, "5.50");
    const { versionId } = await json<{ versionId: string }>(
      await queue(app, menuId, TOMORROW),
      201,
    );
    expect((await send(app, "POST", cancelPath(menuId, versionId))).status).toBe(204);
    expect((await publications(app, menuId)).editions).toEqual([
      expect.objectContaining({ versionId, state: "cancelled", cancelledAt: NOW.toISOString() }),
    ]);
    expect(await json(await send(app, "POST", cancelPath(menuId, versionId)), 409)).toEqual({
      error: {
        code: "menu_publication.not_queued",
        params: { menuId, versionId, state: "cancelled" },
      },
    });

    const other = await created(app, "/management-api/catalogues", { name: "Dinner" });
    const elsewhere = await send(app, "POST", cancelPath(other, versionId));
    expect(await json(elsewhere, 404)).toEqual({
      error: { code: "menu_publication.not_found", params: { menuId: other, versionId } },
    });
    expect(await json(await send(app, "POST", cancelPath(menuId, "not-a-uuid")), 400)).toEqual({
      error: { code: "shared.invalid_id", params: { kind: "MenuVersionId", value: "not-a-uuid" } },
    });
  });

  it("refuses an immediate publish while an earlier edition is queued, until that edition is cancelled", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await setSoupPrice(app, menuId, itemId, "5.50");
    const v2 = await json<{ versionId: string }>(await queue(app, menuId, TOMORROW), 201);
    await setSoupPrice(app, menuId, itemId, "6.00");
    const hash = await previewHash(app, menuId);
    const publish = () =>
      send(app, "POST", `/management-api/catalogues/${menuId}/publish`, {
        body: { expectedHash: hash },
      });
    const listed = await publications(app, menuId);
    const shown = await status(app, menuId);
    const tables = await publicationTables();

    expect(await json(await publish(), 409)).toEqual({
      error: {
        code: "menu_publication.overtakes_queued",
        params: {
          menuId,
          overtaken: [{ versionId: v2.versionId, number: 2, activatesAt: TOMORROW_AT }],
        },
      },
    });
    expect(await publications(app, menuId)).toEqual(listed);
    expect(await status(app, menuId)).toEqual(shown);
    expect(await publicationTables()).toEqual(tables);

    expect((await send(app, "POST", cancelPath(menuId, v2.versionId))).status).toBe(204);
    const three = await json<{ versionId: string }>(await publish(), 200);
    expect(three).toEqual({ versionId: expect.any(String), number: 3 });
    expect(await status(app, menuId)).toMatchObject({ state: "current", version: 3 });
    expect((await publications(app, menuId)).live).toMatchObject({
      versionId: three.versionId,
      number: 3,
    });
  });

  it("refuses a queue from a stale preview and one identical to the live version", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    const unchanged = await queue(app, menuId, TOMORROW);
    expect(await json(unchanged, 409)).toEqual({
      error: { code: "menu_publication.unchanged", params: { menuId, number: 1 } },
    });
    const stale = await previewHash(app, menuId);
    await setSoupPrice(app, menuId, itemId, "5.50");
    expect(await json(await queue(app, menuId, TOMORROW, stale), 409)).toEqual({
      error: { code: "menu.changed_since_preview", params: { menuId } },
    });
  });

  it("refuses every new route to a session without the catalogue permission, writing nothing", async () => {
    const app = mountApp();
    const { menuId, itemId } = await lunchWithSoup(app);
    await setSoupPrice(app, menuId, itemId, "5.50");
    const { versionId } = await json<{ versionId: string }>(
      await queue(app, menuId, TOMORROW),
      201,
    );
    await setSoupPrice(app, menuId, itemId, "6.00");
    const hash = await previewHash(app, menuId);
    const tables = await publicationTables();
    const refused = [
      await send(app, "POST", `/management-api/catalogues/${menuId}/publications`, {
        body: { expectedHash: hash, activatesAt: { date: "2026-10-09", time: "08:00" } },
        cookie: staffCookie,
      }),
      await send(app, "GET", `/management-api/catalogues/${menuId}/publications`, {
        cookie: staffCookie,
      }),
      await send(app, "POST", cancelPath(menuId, versionId), { cookie: staffCookie }),
    ];
    for (const res of refused) {
      expect(await json(res, 403)).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    }
    expect(await publicationTables()).toEqual(tables);
  });
});
