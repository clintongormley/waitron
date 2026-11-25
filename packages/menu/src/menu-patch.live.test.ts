import { seedPerson } from "@waitron/db/testing/seed.js";
import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mediaImages,
  menuReleases,
  menuVersionImages,
  menuVersions,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useMenuDb } from "../test/fixtures.js";
import { libraryImageName } from "../test/library-images.js";
import { menusFixture, offerOf, type MenusFixture } from "../test/menus-fixture.js";
import {
  liveVersions,
  menuStatus,
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
import { menuDocumentHash } from "./menu-document.js";
import { assertPatchReviewed, readPatchDraft } from "./menu-patch-draft.js";
import { updateProduct } from "./operations.js";
import { listProductVariants, setProductVariants } from "./variants.js";
import { writeContentLanguages } from "./content-languages.js";

const fx = useMenuDb();
beforeEach(async () => {
  await seedPerson(fx.db, { id: "manager-ana", displayName: "Test manager-ana" });
  await seedPerson(fx.db, { id: "person-1", displayName: "Test person-1" });
});

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
    publications: await fx.db.select().from(menuReleases).orderBy(asc(menuReleases.menuId)),
    schedule: await fx.db.select().from(menuReleases).orderBy(asc(menuReleases.versionId)),
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
    .select({
      versionId: menuReleases.versionId,
      menuId: menuReleases.menuId,
      state: menuReleases.state,
      activatesAt: menuReleases.activatesAt,
      cancelledAt: menuReleases.cancelledAt,
      cancelledBy: menuReleases.cancelledBy,
      queuedAt: menuVersions.createdAt,
      queuedBy: menuVersions.createdBy,
    })
    .from(menuReleases)
    .innerJoin(menuVersions, eq(menuVersions.id, menuReleases.versionId))
    .where(eq(menuReleases.versionId, versionId));
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
    expect(row).toMatchObject({ menuId: f.lunch, createdAt: later, createdBy: ANA });
    expect(row.document).toEqual(live!.document);
    const [pointer] = await fx.db
      .select()
      .from(menuReleases)
      .where(sql`${menuReleases.menuId} = ${f.lunch} and ${menuReleases.state} = 'live'`);
    expect(pointer).toMatchObject({ versionId: result.versionId, activatesAt: later });
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
      code: "menu.not_found",
      params: { menuId: missing },
    });
  });

  it("leaves the products and the working menu untouched", async () => {
    const before = await hashOf(f.lunch);
    await patch(v1, await priceChange("5.5"));
    expect(await hashOf(f.lunch)).toBe(before);
  });

  it("leaves the menu marked changed under the patch's number when nothing else changed", async () => {
    const statusOf = async () => (await app((tx) => menuStatus(tx, [f.lunch]))).get(f.lunch);
    expect(await statusOf()).toMatchObject({ state: "current", version: 1 });
    const result = await patch(v1, await priceChange("5.5"));
    const live = (await app((tx) => liveVersions(tx, [f.lunch], "format"))).get(f.lunch)!;
    expect(await statusOf()).toEqual({
      state: "changed",
      clashes: 0,
      version: result.number,
      publishedAt: NOW.toISOString(),
      hash: live.contentHash,
    });
    expect(live.contentHash).not.toBe(await hashOf(f.lunch));
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
        createdAt: original.createdAt,
        createdBy: original.createdBy,
      });
      expect(await scheduleRow(copy.id)).toMatchObject({
        menuId: f.lunch,
        state: "queued",
        activatesAt: originalSchedules[index]!.activatesAt,
        queuedAt: originals[index]!.createdAt,
        queuedBy: originals[index]!.createdBy,
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
        code: "menu.not_found",
        params: { menuId: missing },
      });
    });

    it("a malformed patch", async () => {
      await refuses(() => patch(v1, "not a list"), {
        code: "management.request_invalid",
        params: { field: "changes" },
      });
    });

    it("a picture the library does not hold, under the picture field", async () => {
      const picture = libraryImageName("lemon.jpg");
      expect(
        await fx.db.select().from(mediaImages).where(eq(mediaImages.filename, picture)),
      ).toEqual([]);
      const item = await lemonadeItem();
      const target = { kind: "offer", menuItemId: item };
      await refuses(
        () =>
          patch(v1, [
            { target, field: "price", value: "5.5" },
            { target, field: "image", value: picture },
          ]),
        {
          code: "menu_patch.invalid",
          params: { change: 1, field: "image", reason: "image.not_found" },
        },
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
    expect(tables.has("menu_releases")).toBe(true);
    for (const table of tables)
      expect(["menu_versions", "menu_version_images", "menu_releases", "menu_releases"]).toContain(
        table,
      );
  });
});

describe("declarations", () => {
  const offerTarget = async (productId: string) => ({
    kind: "offer" as const,
    menuItemId: await app((tx) => offerOf(tx, f.lunch, productId)),
  });
  const declarations = (target: object) => ({ target, field: "declarations", value: "product" });
  const declareMilk = (productId: string) =>
    app((tx) =>
      updateProduct(tx, productId, {
        allergens: { milk: {} },
        dietaryDeclarations: ["vegetarian"],
        dietOverride: { vegan: "no" },
      }),
    );
  const patchQueued = (changes: unknown, queued: readonly string[], base = v1) =>
    app((tx) => patchLiveMenu(tx, f.lunch, base, changes, ANA, { at: NOW, queued }));
  const draft = (menuId = f.lunch) => app((tx) => readPatchDraft(tx, menuId, NOW));
  const imagesOf = async (versionId: string) =>
    (
      await fx.db
        .select({ filename: menuVersionImages.filename })
        .from(menuVersionImages)
        .where(eq(menuVersionImages.versionId, versionId))
        .orderBy(asc(menuVersionImages.filename))
    ).map(({ filename }) => filename);

  it("patchLiveMenu puts the product's current allergens live", async () => {
    const soup = await offerTarget(f.soup);
    const lemonade = await offerTarget(f.lemonade);
    await declareMilk(f.soup);
    await declareMilk(f.lemonade);
    await patch(v1, [
      declarations(soup),
      declarations({ ...lemonade, kind: "variant", variantId: f.large }),
    ]);
    const live = (await app((tx) => readLiveMenu(tx, f.lunch)))!.document;
    const milk = {
      allergens: { milk: {} },
      dietaryDeclarations: ["vegetarian"],
      dietOverride: { vegan: "no" },
    };
    expect(live.offers[soup.menuItemId]).toMatchObject(milk);
    expect(live.offers[soup.menuItemId]!.diet).toMatchObject({ vegan: "no" });
    expect(live.offers[lemonade.menuItemId]!.variants[0]).toMatchObject(milk);
    expect(live.offers[lemonade.menuItemId]!.allergens).toEqual({});
  });

  it("a queued version named in the request is queued again at its own time with the corrected allergens, and one not named keeps its document", async () => {
    const soup = await offerTarget(f.soup);
    await setSoup("5.50");
    const first = await queue(day(8));
    await setSoup("6.00");
    const second = await queue(day(9));
    const originals = [await versionRow(first.versionId), await versionRow(second.versionId)];
    await declareMilk(f.soup);

    const { requeued } = await patchQueued([declarations(soup)], [first.versionId]);
    expect(requeued).toEqual([
      { versionId: expect.any(String), number: 5, activatesAt: day(8).toISOString() },
      { versionId: expect.any(String), number: 6, activatesAt: day(9).toISOString() },
    ]);
    const [corrected, kept] = await Promise.all(
      requeued.map(({ versionId }) => versionRow(versionId)),
    );
    const expected = structuredClone(originals[0]!.document);
    const { allergens, diet, dietOverride, dietaryDeclarations } = (await app((tx) =>
      readLiveMenu(tx, f.lunch),
    ))!.document.offers[soup.menuItemId]!;
    expect(allergens).toEqual({ milk: {} });
    Object.assign(expected.offers[soup.menuItemId]!, {
      allergens,
      diet,
      dietOverride,
      dietaryDeclarations,
    });
    expect(corrected!.document).toEqual(expected);
    expect(corrected!.contentHash).toBe(menuDocumentHash(expected));
    expect(corrected!.contentHash).not.toBe(originals[0]!.contentHash);
    expect(corrected).toMatchObject({
      createdAt: originals[0]!.createdAt,
      createdBy: originals[0]!.createdBy,
    });
    const photos = await imagesOf(first.versionId);
    expect(photos).toHaveLength(2);
    expect(await imagesOf(corrected!.id)).toEqual(photos);
    expect(await scheduleRow(corrected!.id)).toMatchObject({
      state: "queued",
      activatesAt: day(8),
    });
    expect(await scheduleRow(first.versionId)).toMatchObject({ state: "cancelled" });
    expect(kept!.document).toEqual(originals[1]!.document);
    expect(kept!.contentHash).toBe(originals[1]!.contentHash);
  });

  it("a price in the same patch does not reach the named queued version", async () => {
    const soup = await offerTarget(f.soup);
    await setSoup("5.50");
    const queued = await queue(day(8));
    await declareMilk(f.soup);
    const { versionId, requeued } = await patchQueued(
      [{ target: soup, field: "price", value: "9.00" }, declarations(soup)],
      [queued.versionId],
    );
    expect((await versionRow(versionId)).document.offers[soup.menuItemId]).toMatchObject({
      unitPrice: "9.00",
      allergens: { milk: {} },
    });
    expect(
      (await versionRow(requeued[0]!.versionId)).document.offers[soup.menuItemId],
    ).toMatchObject({ unitPrice: "5.50", allergens: { milk: {} } });
  });

  it("an id that is not queued is ignored", async () => {
    const soup = await offerTarget(f.soup);
    await setSoup("5.50");
    const queued = await queue(day(8));
    const original = await versionRow(queued.versionId);
    await declareMilk(f.soup);
    const { requeued } = await patchQueued(
      [declarations(soup)],
      ["00000000-0000-4000-8000-000000000000", v1],
    );
    expect(requeued).toHaveLength(1);
    expect((await versionRow(requeued[0]!.versionId)).document).toEqual(original.document);
    expect((await versionRow(v1)).document.offers[soup.menuItemId]!.allergens).toEqual({});
  });

  it("corrects a named queued version when the live one already agrees, keeping the live version", async () => {
    const soup = await offerTarget(f.soup);
    await setSoup("5.50");
    const queued = await queue(day(8));
    await declareMilk(f.soup);
    const live = await patchQueued([declarations(soup)], []);
    const waiting = live.requeued[0]!.versionId;
    expect((await versionRow(waiting)).document.offers[soup.menuItemId]!.allergens).toEqual({});

    const result = await patchQueued([declarations(soup)], [waiting], live.versionId);
    expect(result).toEqual({
      versionId: live.versionId,
      number: live.number,
      requeued: [{ versionId: expect.any(String), number: 5, activatesAt: day(8).toISOString() }],
    });
    expect(queued.number).toBe(2);
    expect(await app((tx) => readLiveMenu(tx, f.lunch))).toMatchObject({
      versionId: live.versionId,
    });
    expect(
      (await versionRow(result.requeued[0]!.versionId)).document.offers[soup.menuItemId]!.allergens,
    ).toEqual({ milk: {} });
    expect(await scheduleRow(waiting)).toMatchObject({ state: "cancelled" });
  });

  it("refuses a patch that changes neither the live version nor a named queued one", async () => {
    const soup = await offerTarget(f.soup);
    await setSoup("5.50");
    const queued = await queue(day(8));
    await refuses(() => patchQueued([declarations(soup)], [queued.versionId]), {
      code: "menu_patch.unchanged",
      params: { menuId: f.lunch },
    });
  });

  it("a dish's change corrects its variants, live and in a named queued version holding one more", async () => {
    const lemonade = await offerTarget(f.lemonade);
    await app(async (tx) => {
      const variants = await listProductVariants(tx, f.lemonade);
      const medium = {
        name: "Medium",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "3.25",
        available: true,
      };
      await setProductVariants(tx, f.lemonade, [...variants, medium], "en");
    });
    await queue(day(8));
    await declareMilk(f.lemonade);
    const [listed] = (await draft())!.queued;
    expect(listed!.targets).toEqual([
      { target: lemonade, stillOld: true },
      { target: { ...lemonade, kind: "variant", variantId: f.large }, stillOld: true },
    ]);
    const { versionId, requeued } = await patchQueued(
      [declarations(lemonade)],
      [listed!.versionId],
    );
    const variantAllergens = async (id: string) =>
      (await versionRow(id)).document.offers[lemonade.menuItemId]!.variants.map(
        ({ name, allergens }) => ({ name, allergens }),
      );
    const milk = { milk: {} };
    expect(await variantAllergens(versionId)).toEqual([{ name: "Large", allergens: milk }]);
    expect(await variantAllergens(requeued[0]!.versionId)).toEqual([
      { name: "Large", allergens: milk },
      { name: "Medium", allergens: milk },
    ]);
    expect((await draft())!.queued).toEqual([]);
  });

  it("says what a patch replaces at a scheduled version's added variant once that variant alone loses an allergen", async () => {
    const lemonade = await offerTarget(f.lemonade);
    await declareMilk(f.lemonade);
    const { versionId: base } = await patch(v1, [declarations(lemonade)]);
    await app(async (tx) => {
      const variants = await listProductVariants(tx, f.lemonade);
      const medium = {
        name: "Medium",
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: "3.25",
        available: true,
      };
      await setProductVariants(tx, f.lemonade, [...variants, medium], "en");
    });
    await queue(day(8));
    const { id: medium } = (await app((tx) => listProductVariants(tx, f.lemonade))).find(
      ({ name }) => name === "Medium",
    )!;
    await app((tx) => updateProduct(tx, medium, { allergens: {} }));
    const [listed] = (await draft())!.queued;
    const milk = expect.objectContaining({ allergens: { milk: {} } });
    expect(listed!.targets).toEqual([
      {
        target: lemonade,
        stillOld: true,
        replaces: [
          { productId: f.lemonade, name: "Lemonade", values: milk },
          { productId: f.large, name: "Large", values: milk },
          { productId: medium, name: "Medium", values: milk },
        ],
      },
    ]);
    const { requeued } = await patchQueued([declarations(lemonade)], [listed!.versionId], base);
    const { variants } = (await versionRow(requeued[0]!.versionId)).document.offers[
      lemonade.menuItemId
    ]!;
    expect(variants.map(({ name, allergens }) => ({ name, allergens }))).toEqual([
      { name: "Large", allergens: { milk: {} } },
      { name: "Medium", allergens: {} },
    ]);
  });

  describe("a patch of what was reviewed", () => {
    const patchReviewed = (
      changes: unknown,
      revision: string,
      queued: readonly string[] = [],
      base = v1,
    ) =>
      app(async (tx) => {
        await assertPatchReviewed(tx, f.lunch, base, revision, NOW);
        return patchLiveMenu(tx, f.lunch, base, changes, ANA, { at: NOW, queued });
      });
    const changed = { code: "menu_patch.declarations_changed" };

    it("is saved while nothing it showed has changed", async () => {
      const soup = await offerTarget(f.soup);
      await setSoup("5.50");
      const { versionId } = await queue(day(8));
      await declareMilk(f.soup);
      const { revision } = (await draft())!;
      expect((await draft())!.revision).toBe(revision);
      const result = await patchReviewed([declarations(soup)], revision, [versionId]);
      expect(result.number).toBe(3);
    });

    it("is refused once a product's allergens or diets have changed, writing nothing", async () => {
      const soup = await offerTarget(f.soup);
      await declareMilk(f.soup);
      const { revision } = (await draft())!;
      for (const edit of [
        { allergens: null },
        { allergens: { milk: {} }, dietaryDeclarations: [] },
        { dietaryDeclarations: ["vegetarian" as const], dietOverride: null },
      ]) {
        await app((tx) => updateProduct(tx, f.soup, edit));
        await refuses(() => patchReviewed([declarations(soup)], revision), {
          ...changed,
          params: { menuId: f.lunch },
        });
      }
      await declareMilk(f.soup);
      expect((await draft())!.revision).toBe(revision);
    });

    it("is refused once a scheduled version it corrects was numbered again, writing nothing", async () => {
      const soup = await offerTarget(f.soup);
      await setSoup("5.50");
      await queue(day(8));
      await setSoup("6.00");
      await queue(day(9));
      await declareMilk(f.soup);
      const { versionId: base } = await patch(v1, [declarations(soup)]);
      const { revision, queued } = (await draft())!;
      const [first, second] = queued.map(({ versionId }) => versionId);
      // Corrects a scheduled version alone, so the live version stays.
      await patchQueued([declarations(soup)], [second!], base);
      const now = (await draft())!;
      expect(now.versionId).toBe(base);
      expect(now.queued.map(({ versionId }) => versionId)).not.toContain(first);
      const changes = [declarations(soup), ...(await priceChange("9.00"))];
      await refuses(() => patchReviewed(changes, revision, [first!], base), changed);
      expect((await patchReviewed(changes, now.revision, [], base)).number).toBe(9);
    });

    it("leaves another live version to the patch's own refusal", async () => {
      const soup = await offerTarget(f.soup);
      await declareMilk(f.soup);
      const { revision } = (await draft())!;
      await patch(v1, await priceChange("9.00"));
      await declareMilk(f.lemonade);
      await refuses(() => patchReviewed([declarations(soup)], revision), {
        code: "menu_patch.base_changed",
      });
      await app((tx) => assertPatchReviewed(tx, f.dinner, v1, revision, NOW));
    });
  });

  it("a price patch that changes nothing is refused without reading the waiting versions", async () => {
    await setSoup("5.50");
    const { versionId: queued } = await queue(day(8));
    const readsWaiting = async (price: string) => {
      const changes = await priceChange(price);
      return (
        await statements(async (tx) => {
          await patchLiveMenu(tx, f.lunch, v1, changes, ANA, {
            at: NOW,
            queued: [queued],
          }).catch((error: unknown) => {
            expect(error).toMatchObject({ code: "menu_patch.unchanged" });
          });
        })
      ).some(
        (text) => /"menu_versions"\."document"/.test(text) && /"activates_at" > \?/.test(text),
      );
    };
    expect(await readsWaiting("2.80")).toBe(false);
    expect(await readsWaiting("2.90")).toBe(true);
  });

  it("readPatchDraft lists no queued version that is due but not yet settled", async () => {
    await setSoup("5.50");
    await queue(day(8));
    await setSoup("6.00");
    const later = await queue(day(9));
    await declareMilk(f.soup);
    const due = (await app((tx) => readPatchDraft(tx, f.lunch, day(8))))!;
    expect(due.number).toBe(2);
    expect(due.queued.map(({ versionId }) => versionId)).toEqual([later.versionId]);
  });

  it("readPatchDraft answers the live version and each queued version that differs", async () => {
    const soup = await offerTarget(f.soup);
    expect(await draft(f.dinner)).toBeNull();
    await setSoup("5.50");
    await queue(day(8));
    expect(await draft()).toEqual({
      ...(await app((tx) => readLiveMenu(tx, f.lunch, NOW))),
      revision: expect.any(String),
      queued: [],
      declarations: expect.any(Object),
    });
    await declareMilk(f.soup);
    await setSoup("6.00");
    const second = await queue(day(9));
    const first = (await app((tx) => listMenuPublications(tx, f.lunch, NOW))).editions.find(
      ({ number }) => number === 2,
    )!;
    expect((await draft())!.queued).toEqual([
      {
        versionId: first.versionId,
        activatesAt: day(8).toISOString(),
        targets: [{ target: soup, stillOld: true }],
      },
    ]);
    expect(second.number).toBe(3);
    const { requeued } = await patchQueued([declarations(soup)], [first.versionId]);
    expect(requeued).toHaveLength(2);
    expect((await draft())!.queued).toEqual([]);
  });

  it("readPatchDraft answers the current declarations of the dishes, variants and extras, scheduled version or none", async () => {
    await declareMilk(f.lemonade);
    await app((tx) => updateProduct(tx, f.extraLemon, { allergens: null }));
    const { document, declarations: current } = (await draft())!;
    const { offers } = document;
    const lemonade = offers[await app((tx) => offerOf(tx, f.lunch, f.lemonade))]!;
    expect(lemonade.allergens).toEqual({});
    const milk = {
      allergens: { milk: {} },
      dietOverride: { vegan: "no" },
      diet: { vegan: "no", vegetarian: "unknown", contains: [] },
      dietaryDeclarations: ["vegetarian"],
    };
    expect(current[f.lemonade]).toEqual(milk);
    expect(current[f.large]).toEqual(milk);
    expect(current[f.extraLemon]).toEqual({
      allergens: null,
      dietOverride: null,
      diet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
      dietaryDeclarations: [],
    });
    expect(current[f.soup]).toMatchObject({ allergens: {}, dietaryDeclarations: [] });
  });
});
