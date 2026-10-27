import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture, offerOf, type MenusFixture } from "../test/menus-fixture.js";
import {
  liveVersions,
  patchLiveMenu,
  previewMenu,
  publishMenu,
  readLiveMenu,
} from "./menu-publication.js";
import {
  activateDueMenuPublications,
  listMenuPublications,
  queueMenuPublication,
} from "./menu-schedule.js";
import { updateProduct } from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import {
  menuPublications,
  menuScheduledPublications,
  menuVersionImages,
  menuVersions,
} from "./schema/publication.js";

const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

const NOW = new Date("2026-10-07T08:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const day = (date: number) => new Date(`2026-10-${String(date).padStart(2, "0")}T06:00:00.000Z`);
const ANA = "manager-ana";

let f: MenusFixture;
let v1: string;

async function hashOf(menuId: string): Promise<string> {
  return (await app((tx) => previewMenu(tx, menuId))).hash;
}

async function setSoup(unitPrice: string): Promise<void> {
  await app((tx) => updateProduct(tx, f.soup, { unitPrice }));
}

async function queue(activatesAt: Date) {
  const hash = await hashOf(f.lunch);
  return app((tx) => queueMenuPublication(tx, f.lunch, hash, activatesAt, ANA, { at: NOW }));
}

async function publish(menuId: string, at = NOW) {
  const hash = await hashOf(menuId);
  return app((tx) => publishMenu(tx, menuId, hash, "person-1", { at }));
}

async function lemonadeItem(menuId = f.lunch): Promise<string> {
  return app((tx) => offerOf(tx, menuId, f.lemonade));
}

async function priceChange(price: string) {
  return [
    { target: { kind: "offer", menuItemId: await lemonadeItem() }, field: "price", value: price },
  ];
}

function patch(baseVersionId: string, changes: unknown, at = NOW, menuId = f.lunch) {
  return app((tx) => patchLiveMenu(tx, menuId, baseVersionId, changes, ANA, { at }));
}

/** Every row of the four publication tables, in a stable order. */
async function publicationTables() {
  return {
    versions: await fx.db.select().from(menuVersions).orderBy(asc(menuVersions.id)),
    images: await fx.db
      .select()
      .from(menuVersionImages)
      .orderBy(asc(menuVersionImages.versionId), asc(menuVersionImages.filename)),
    publications: await fx.db.select().from(menuPublications).orderBy(asc(menuPublications.menuId)),
    schedule: await fx.db
      .select()
      .from(menuScheduledPublications)
      .orderBy(asc(menuScheduledPublications.versionId)),
  };
}

/** Runs `fn` in one transaction and answers the SQL of every statement it prepared. */
async function statements<T>(fn: (tx: Transaction) => Promise<T>) {
  return app(async (tx) => {
    const session = (
      tx as unknown as { session: { prepareQuery: (q: { sql: string }) => unknown } }
    ).session;
    const prepared = vi.spyOn(session, "prepareQuery");
    await fn(tx);
    const sql = prepared.mock.calls.map(([query]) => query.sql);
    prepared.mockRestore();
    return sql;
  });
}

const writtenTables = (statements: readonly string[]) =>
  statements.flatMap((text) => {
    const match = /^\s*(?:insert into|update|delete from)\s+"(\w+)"/i.exec(text);
    return match === null ? [] : [match[1]!];
  });

async function refuses(attempt: () => Promise<unknown>, expected: object) {
  const before = await publicationTables();
  await expect(attempt()).rejects.toMatchObject(expected);
  expect(await publicationTables()).toEqual(before);
}

async function versionRow(versionId: string) {
  const [row] = await fx.db.select().from(menuVersions).where(eq(menuVersions.id, versionId));
  return row!;
}

async function scheduleRow(versionId: string) {
  const [row] = await fx.db
    .select()
    .from(menuScheduledPublications)
    .where(eq(menuScheduledPublications.versionId, versionId));
  return row!;
}

beforeEach(async () => {
  f = await menusFixture(fx.db);
  v1 = (await publish(f.lunch)).versionId;
});

describe("patchLiveMenu", () => {
  it("puts the patch live at once under the next number", async () => {
    const item = await lemonadeItem();
    const later = new Date(NOW.getTime() + 60_000);
    const result = await patch(v1, await priceChange("5.5"), later);
    expect(result).toEqual({ versionId: expect.any(String), number: 2, requeued: [] });

    const live = await app((tx) => readLiveMenu(tx, f.lunch, later));
    expect(live).toMatchObject({
      versionId: result.versionId,
      number: 2,
      since: later.toISOString(),
    });
    expect(live!.document.offers[item]).toMatchObject({ unitPrice: "5.50", grossPrice: "5.50" });
    const row = await versionRow(result.versionId);
    expect(row).toMatchObject({ menuId: f.lunch, publishedAt: later, publishedBy: ANA });
    expect(row.document).toEqual(live!.document);
    const [pointer] = await fx.db
      .select()
      .from(menuPublications)
      .where(eq(menuPublications.menuId, f.lunch));
    expect(pointer).toMatchObject({ versionId: result.versionId, publishedAt: later });
  });

  it("readLiveMenu answers nothing for a menu never published, and the clock's live version", async () => {
    expect(await app((tx) => readLiveMenu(tx, f.dinner))).toBeNull();
    expect(await app((tx) => readLiveMenu(tx, f.lunch))).toMatchObject({
      versionId: v1,
      number: 1,
      since: NOW.toISOString(),
    });
  });

  it("readLiveMenu refuses an id that names no menu", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(app((tx) => readLiveMenu(tx, missing))).rejects.toMatchObject({
      code: "catalogue.not_found",
      params: { catalogueId: missing },
    });
  });

  it("leaves the products and the working menu untouched", async () => {
    const before = await hashOf(f.lunch);
    await patch(v1, await priceChange("5.5"));
    expect(await hashOf(f.lunch)).toBe(before);
  });

  it("leaves every other menu's live version untouched", async () => {
    await publish(f.dinner);
    const dinnerBefore = (await app((tx) => liveVersions(tx, [f.dinner], "document"))).get(
      f.dinner,
    )!;
    await patch(v1, await priceChange("5.5"));
    const dinnerAfter = (await app((tx) => liveVersions(tx, [f.dinner], "document"))).get(
      f.dinner,
    )!;
    expect(dinnerAfter.versionId).toBe(dinnerBefore.versionId);
    expect(dinnerAfter.contentHash).toBe(dinnerBefore.contentHash);
    expect(dinnerAfter.document).toEqual(dinnerBefore.document);
  });

  it("moves every queued version after the patch with the same date and content", async () => {
    await setSoup("5.50");
    const first = await queue(day(8));
    await setSoup("6.00");
    const second = await queue(day(9));
    const originals = [await versionRow(first.versionId), await versionRow(second.versionId)];
    const originalSchedules = [
      await scheduleRow(first.versionId),
      await scheduleRow(second.versionId),
    ];

    const later = new Date(NOW.getTime() + 60_000);
    const result = await patch(v1, await priceChange("5.5"), later);
    expect(result.number).toBe(4);
    expect(result.requeued).toEqual([
      { versionId: expect.any(String), number: 5, activatesAt: day(8).toISOString() },
      { versionId: expect.any(String), number: 6, activatesAt: day(9).toISOString() },
    ]);

    const listed = await app((tx) => listMenuPublications(tx, f.lunch, later));
    expect(listed.live).toMatchObject({ versionId: result.versionId, number: 4 });
    const queued = listed.editions.filter((edition) => edition.state === "queued");
    expect(queued).toEqual([
      expect.objectContaining({
        versionId: result.requeued[0]!.versionId,
        number: 5,
        activatesAt: day(8).toISOString(),
        queuedAt: NOW.toISOString(),
        contentHash: originals[0]!.contentHash,
      }),
      expect.objectContaining({
        versionId: result.requeued[1]!.versionId,
        number: 6,
        activatesAt: day(9).toISOString(),
        queuedAt: NOW.toISOString(),
        contentHash: originals[1]!.contentHash,
      }),
    ]);

    for (const [index, original] of originals.entries()) {
      const copy = await versionRow(result.requeued[index]!.versionId);
      expect(copy).toMatchObject({
        menuId: f.lunch,
        document: original.document,
        contentHash: original.contentHash,
        publishedAt: original.publishedAt,
        publishedBy: original.publishedBy,
      });
      expect(await scheduleRow(copy.id)).toMatchObject({
        menuId: f.lunch,
        state: "queued",
        activatesAt: originalSchedules[index]!.activatesAt,
        queuedAt: originalSchedules[index]!.queuedAt,
        queuedBy: originalSchedules[index]!.queuedBy,
        cancelledAt: null,
        cancelledBy: null,
      });
      expect(await scheduleRow(original.id)).toMatchObject({
        state: "cancelled",
        cancelledAt: later,
        cancelledBy: ANA,
      });
    }
  });

  it("a re-queued version still goes live at its date", async () => {
    await setSoup("5.50");
    const first = await queue(day(8));
    const original = await versionRow(first.versionId);
    const result = await patch(v1, await priceChange("5.5"));

    const { activated } = await app((tx) => activateDueMenuPublications(tx, day(8)));
    expect(activated).toEqual([
      { menuId: f.lunch, versionId: result.requeued[0]!.versionId, number: 4 },
    ]);
    const live = await app((tx) => readLiveMenu(tx, f.lunch, day(8)));
    expect(live).toMatchObject({ number: 4, since: day(8).toISOString() });
    expect(live!.document).toEqual(original.document);
  });

  describe("refuses, writing nothing", () => {
    it("a stale base", async () => {
      await setSoup("5.50");
      const v2 = await publish(f.lunch);
      await refuses(async () => patch(v1, await priceChange("5.5")), {
        code: "menu_patch.base_changed",
        params: { menuId: f.lunch, baseVersionId: v1, liveVersionId: v2.versionId, liveNumber: 2 },
      });
    });

    it("a base a queued version replaced when its date passed before the save", async () => {
      await setSoup("5.50");
      const queued = await queue(day(8));
      const changes = await priceChange("5.5");
      await refuses(() => patch(v1, changes, day(8)), {
        code: "menu_patch.base_changed",
        params: {
          menuId: f.lunch,
          baseVersionId: v1,
          liveVersionId: queued.versionId,
          liveNumber: 2,
        },
      });
    });

    it("an unpublished menu and a patch that changes nothing", async () => {
      await refuses(async () => patch(v1, await priceChange("5.5"), NOW, f.dinner), {
        code: "menu_patch.not_published",
        params: { menuId: f.dinner },
      });
      const item = await lemonadeItem();
      const live = await app((tx) => readLiveMenu(tx, f.lunch));
      await refuses(
        () =>
          patch(v1, [
            {
              target: { kind: "offer", menuItemId: item },
              field: "name",
              value: live!.document.offers[item]!.name,
            },
          ]),
        { code: "menu_patch.unchanged", params: { menuId: f.lunch } },
      );
    });

    it("a menu id that names no menu", async () => {
      const missing = "00000000-0000-4000-8000-000000000000";
      await refuses(async () => patch(v1, await priceChange("5.5"), NOW, missing), {
        code: "catalogue.not_found",
        params: { catalogueId: missing },
      });
    });

    it("a malformed patch", async () => {
      await refuses(() => patch(v1, "not a list"), {
        code: "menu_patch.invalid",
        params: { change: -1, field: "changes" },
      });
    });

    it("a picture the library does not hold, under the picture field", async () => {
      // The catalogue's test database has no media tables, so the library holds no picture.
      const media = await fx.db.all(
        sql`select name from sqlite_master where type = 'table' and name = 'media_images'`,
      );
      expect(media).toEqual([]);
      const item = await lemonadeItem();
      const target = { kind: "offer", menuItemId: item };
      await refuses(
        () =>
          patch(v1, [
            { target, field: "price", value: "5.5" },
            { target, field: "image", value: "lemon.jpg" },
          ]),
        { code: "menu_patch.invalid", params: { change: 1, field: "image" } },
      );
    });
  });

  it("takes a picture away without asking the library", async () => {
    const item = await lemonadeItem();
    const target = { kind: "offer", menuItemId: item };
    const result = await patch(v1, [
      { target, field: "image", value: null },
      { target, field: "price", value: "5.5" },
    ]);
    expect(result.number).toBe(2);
    const live = await app((tx) => readLiveMenu(tx, f.lunch));
    expect(live!.document.offers[item]).toMatchObject({ image: null, unitPrice: "5.50" });
  });

  it("merges translations against the venue's saved content languages", async () => {
    const target = { kind: "offer", menuItemId: await lemonadeItem() };
    await app((tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es", "fr"] }),
    );
    const named = await patch(v1, [
      {
        target,
        field: "customerName",
        value: { en: "Lemonade", es: "Limonada", fr: "Citronnade" },
      },
    ]);
    await app((tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }),
    );
    await patch(named.versionId, [
      { target, field: "customerName", value: { en: "Fresh lemonade", es: "" } },
    ]);
    const live = await app((tx) => readLiveMenu(tx, f.lunch));
    expect(live!.document.offers[target.menuItemId]!.customerName).toEqual({
      en: "Fresh lemonade",
      fr: "Citronnade",
    });
  });

  it("merges against the fallback language when no content languages are saved", async () => {
    const target = { kind: "offer", menuItemId: await lemonadeItem() };
    const changes = [{ target, field: "customerName", value: { es: "Limonada" } }];
    await refuses(() => patch(v1, changes), {
      code: "menu_patch.invalid",
      params: { change: 0, field: "customerName" },
    });
    await app((tx) =>
      patchLiveMenu(tx, f.lunch, v1, changes, ANA, { at: NOW, fallbackLanguage: "es" }),
    );
    const live = await app((tx) => readLiveMenu(tx, f.lunch));
    expect(live!.document.offers[target.menuItemId]!.customerName).toEqual({
      en: "Lemonade for guests",
      es: "Limonada",
    });
  });

  it("writes only the publication tables", async () => {
    await setSoup("5.50");
    await queue(day(8));
    const changes = await priceChange("5.5");
    const written = await statements((tx) => patchLiveMenu(tx, f.lunch, v1, changes, ANA));
    const tables = new Set(writtenTables(written));
    expect(tables.has("menu_versions")).toBe(true);
    expect(tables.has("menu_scheduled_publications")).toBe(true);
    for (const table of tables)
      expect([
        "menu_versions",
        "menu_version_images",
        "menu_publications",
        "menu_scheduled_publications",
      ]).toContain(table);
  });
});
