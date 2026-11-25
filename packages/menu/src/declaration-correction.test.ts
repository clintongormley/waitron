import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  menuReleases,
  menuVersions,
  products,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import type { ProductAllergens } from "@waitron/shared";
import { useMenuDb } from "../test/fixtures.js";
import { libraryImageName } from "../test/library-images.js";
import { menusFixture, offerOf, product, type MenusFixture } from "../test/menus-fixture.js";
import {
  correctMenuDeclarations,
  declarationChanges,
  findDeclarationDrift,
  waitingDeclarationMenus,
} from "./declaration-correction.js";
import { documentSetMenuOffers } from "./menu-document.js";
import * as publication from "./menu-publication.js";
import { patchLiveMenu, previewMenu, publishMenu, readLiveDocuments } from "./menu-publication.js";
import { readMenuStructure } from "./menu-structure.js";
import { queueMenuPublication } from "./menu-schedule.js";
import { createMenu, updateProduct } from "./operations.js";
import { readProductDeclarationValues } from "./product-declarations.js";
import { addMember } from "./sections.js";
import { addSetMenuDishes } from "./set-menus.js";
import { setProductVariants } from "./variants.js";

const fx = useMenuDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);
const PERSON = "person-1";

let f: MenusFixture;
beforeEach(async () => {
  await seedPerson(fx.db, { id: PERSON, displayName: "Test person-1" });
  f = await menusFixture(fx.db);
});

const HOUR = 3_600_000;
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR);

const publish = (menuId: string) =>
  app(async (tx) => {
    const { hash } = await previewMenu(tx, menuId);
    return (await publishMenu(tx, menuId, hash, PERSON)).versionId;
  });
const queue = (menuId: string, activatesAt: Date) =>
  app(async (tx) => {
    const { hash } = await previewMenu(tx, menuId);
    return (await queueMenuPublication(tx, menuId, hash, activatesAt, PERSON)).versionId;
  });
const declare = (productId: string, allergens: ProductAllergens) =>
  app((tx) => updateProduct(tx, productId, { allergens }));
const valuesOf = (...productIds: string[]) =>
  app((tx) => readProductDeclarationValues(tx, productIds));
const drift = (productIds: string[], before: Awaited<ReturnType<typeof valuesOf>>) =>
  app((tx) => findDeclarationDrift(tx, productIds, before));
const waiting = (productIds: string[], before: Awaited<ReturnType<typeof valuesOf>>) =>
  app((tx) => waitingDeclarationMenus(tx, productIds, before));
const correct = (target: object) => ({ target, field: "declarations", value: "product" });
const offer = async (menuId: string, productId: string) => ({
  kind: "offer" as const,
  menuItemId: await app((tx) => offerOf(tx, menuId, productId)),
});

describe("findDeclarationDrift", () => {
  it("names a live menu holding the dish, its variant, or it as an extra", async () => {
    const v1 = await publish(f.lunch);
    const lemonade = await offer(f.lunch, f.lemonade);
    const lunch = { menuId: f.lunch, name: "Lunch Menu", liveVersionId: v1, queued: [] };

    const extraBefore = await valuesOf(f.extraLemon);
    await declare(f.extraLemon, { celery: {} });
    expect(await drift([f.extraLemon], extraBefore)).toEqual([
      {
        ...lunch,
        live: [correct({ kind: "extra", listId: f.extrasList, productId: f.extraLemon })],
      },
    ]);

    const variantBefore = await valuesOf(f.large);
    await declare(f.large, { fish: {} });
    expect(await drift([f.large], variantBefore)).toEqual([
      { ...lunch, live: [correct({ ...lemonade, kind: "variant", variantId: f.large })] },
    ]);

    const dishBefore = await valuesOf(f.lemonade, f.large);
    await declare(f.lemonade, { milk: {} });
    expect(await drift([f.lemonade, f.large], dishBefore)).toEqual([
      { ...lunch, live: [correct(lemonade)] },
    ]);
  });

  it("names a set-menu's holding menu", async () => {
    await app(async (tx) => {
      const { id } = await createMenu(tx, {
        name: "Daily menu",
        names: { en: "Daily menu" },
        kind: "set_menu",
        setPrice: "14.00",
      });
      await tx.update(products).set({ courseId: f.course }).where(eq(products.id, f.burger));
      await addSetMenuDishes(tx, id, [{ productId: f.burger, excludedVariantIds: [] }]);
      await addMember(tx, f.lunchRoot, { kind: "set_menu", menuId: id });
    });
    const v1 = await publish(f.lunch);
    const live = (await app((tx) => readLiveDocuments(tx, [f.lunch]))).get(f.lunch)!.document;
    const copy = documentSetMenuOffers(live).find(({ productId }) => productId === f.burger)!;
    const before = await valuesOf(f.burger);
    await declare(f.burger, { eggs: {} });
    expect(await drift([f.burger], before)).toEqual([
      {
        menuId: f.lunch,
        name: "Lunch Menu",
        liveVersionId: v1,
        live: [correct({ kind: "offer", menuItemId: copy.id })],
        queued: [],
      },
    ]);
  });

  it("names a menu whose live version lacks the dish but a queued version holds it, and a menu with only a scheduled first version, with live: false and the dates they start", async () => {
    const v1 = await publish(f.lunch);
    await app((tx) => addMember(tx, f.lunchRoot, product(f.burger)));
    const lunchAt = hoursFromNow(24);
    const dinnerAt = hoursFromNow(48);
    const lunchQueued = await queue(f.lunch, lunchAt);
    const dinnerQueued = await queue(f.dinner, dinnerAt);
    const before = await valuesOf(f.burger);
    await declare(f.burger, { sesame: {} });

    expect(await waiting([f.burger], before)).toEqual([
      {
        menuId: f.dinner,
        name: "Dinner Menu",
        live: false,
        queued: [{ versionId: dinnerQueued, activatesAt: dinnerAt.toISOString(), stillOld: true }],
      },
      {
        menuId: f.lunch,
        name: "Lunch Menu",
        live: false,
        queued: [{ versionId: lunchQueued, activatesAt: lunchAt.toISOString(), stillOld: true }],
      },
    ]);
    expect(await drift([f.burger], before)).toEqual([
      {
        menuId: f.dinner,
        name: "Dinner Menu",
        liveVersionId: null,
        live: [],
        queued: [
          {
            versionId: dinnerQueued,
            activatesAt: dinnerAt.toISOString(),
            changes: [correct(await offer(f.dinner, f.burger))],
            stillOld: true,
          },
        ],
      },
      {
        menuId: f.lunch,
        name: "Lunch Menu",
        liveVersionId: v1,
        live: [],
        queued: [
          {
            versionId: lunchQueued,
            activatesAt: lunchAt.toISOString(),
            changes: [correct(await offer(f.lunch, f.burger))],
            stillOld: true,
          },
        ],
      },
    ]);
  });

  it("stillOld is true while a queued copy holds the value before the save, and false once it holds a third value", async () => {
    await publish(f.lunch);
    await app((tx) => updateProduct(tx, f.soup, { unitPrice: "5.50" }));
    const queued = await queue(f.lunch, hoursFromNow(24));
    const first = await valuesOf(f.soup);
    await declare(f.soup, { milk: {} });
    const [once] = await drift([f.soup], first);
    expect(once!.queued).toEqual([expect.objectContaining({ versionId: queued, stillOld: true })]);

    const second = await valuesOf(f.soup);
    await declare(f.soup, { fish: {} });
    const [twice] = await drift([f.soup], second);
    expect(twice!.queued).toEqual([
      expect.objectContaining({ versionId: queued, stillOld: false }),
    ]);
  });

  it("lists two queued versions of one menu earliest first", async () => {
    await publish(f.lunch);
    await app((tx) => addMember(tx, f.lunchRoot, product(f.burger)));
    const soonerAt = hoursFromNow(24);
    const sooner = await queue(f.lunch, soonerAt);
    await app((tx) => updateProduct(tx, f.soup, { unitPrice: "5.50" }));
    const laterAt = hoursFromNow(48);
    const later = await queue(f.lunch, laterAt);
    const before = await valuesOf(f.burger);
    await declare(f.burger, { sesame: {} });
    const [lunch] = await drift([f.burger], before);
    expect(lunch!.queued.map(({ versionId, activatesAt }) => ({ versionId, activatesAt }))).toEqual(
      [
        { versionId: sooner, activatesAt: soonerAt.toISOString() },
        { versionId: later, activatesAt: laterAt.toISOString() },
      ],
    );
  });

  it("names a live menu not sold at this hour", async () => {
    // The fixture sets up no service periods, so Dinner is sold nowhere at any hour.
    const v1 = await publish(f.dinner);
    const before = await valuesOf(f.burger);
    await declare(f.burger, { milk: {} });
    expect(await drift([f.burger], before)).toEqual([
      {
        menuId: f.dinner,
        name: "Dinner Menu",
        liveVersionId: v1,
        live: [correct(await offer(f.dinner, f.burger))],
        queued: [],
      },
    ]);
  });

  it("a variant inheriting the parent's allergens drifts when the parent is saved", async () => {
    await publish(f.lunch);
    const before = await valuesOf(f.lemonade, f.large);
    await declare(f.lemonade, { milk: {} });
    const current = await valuesOf(f.lemonade, f.large);
    expect(current.get(f.large)!.allergens).toEqual({ milk: {} });
    const live = (await app((tx) => readLiveDocuments(tx, [f.lunch]))).get(f.lunch)!.document;
    const lemonade = await offer(f.lunch, f.lemonade);
    expect(declarationChanges(live, new Set([f.large]), current)).toEqual([
      correct({ ...lemonade, kind: "variant", variantId: f.large }),
    ]);
    expect(await drift([f.lemonade, f.large], before)).toEqual([
      expect.objectContaining({ menuId: f.lunch, live: [correct(lemonade)] }),
    ]);
  });

  it("names nothing once the menus agree", async () => {
    await publish(f.lunch);
    await app((tx) => updateProduct(tx, f.soup, { unitPrice: "5.50" }));
    await queue(f.lunch, hoursFromNow(24));
    const before = await valuesOf(f.soup);
    await declare(f.soup, { milk: {} });
    const [found] = await drift([f.soup], before);
    await app((tx) =>
      patchLiveMenu(tx, f.lunch, found!.liveVersionId!, found!.live, PERSON, {
        queued: found!.queued.map(({ versionId }) => versionId),
      }),
    );
    expect(await drift([f.soup], before)).toEqual([]);
  });
});

describe("waitingDeclarationMenus", () => {
  it("answers [] when the save did not change declarations although menus still drift", async () => {
    await publish(f.lunch);
    await declare(f.soup, { milk: {} });
    const before = await valuesOf(f.soup);
    expect(await drift([f.soup], before)).toHaveLength(1);
    expect(await waiting([f.soup], before)).toEqual([]);
  });
});

describe("correctMenuDeclarations", () => {
  const corrections = (productId: string, queued?: string[]) =>
    app((tx) => correctMenuDeclarations(tx, productId, PERSON, queued ? { queued } : {}));
  const documentOf = async (versionId: string) =>
    (await fx.db.select().from(menuVersions).where(eq(menuVersions.id, versionId)))[0]!;
  const liveOf = async (menuId: string) =>
    (await app((tx) => readLiveDocuments(tx, [menuId]))).get(menuId);
  const queuedOf = async (menuId: string) =>
    fx.db
      .select({ versionId: menuReleases.versionId, activatesAt: menuReleases.activatesAt })
      .from(menuReleases)
      .where(and(eq(menuReleases.menuId, menuId), eq(menuReleases.state, "queued")))
      .orderBy(asc(menuReleases.activatesAt));
  const menuWith = (name: string, ref: Parameters<typeof addMember>[2]) =>
    app(async (tx) => {
      const { id } = await createMenu(tx, { name });
      await addMember(tx, (await readMenuStructure(tx, id)).rootSectionId, ref);
      return id;
    });
  const setMenuWithLemonade = () =>
    app(async (tx) => {
      const { id } = await createMenu(tx, {
        name: "Daily set",
        names: { en: "Daily set" },
        kind: "set_menu",
        setPrice: "14.00",
      });
      await tx.update(products).set({ courseId: f.course }).where(eq(products.id, f.lemonade));
      await addSetMenuDishes(tx, id, [{ productId: f.lemonade, excludedVariantIds: [] }]);
      return id;
    });

  it("corrects every drifting live version and each named queued version in one call, and leaves an unnamed queued version unchanged", async () => {
    // Bar holds Extra lemon as a dish; Set lunch holds it only as an extra of a set menu's
    // Lemonade; Lunch holds it as Lemonade's extra and has two queued versions; Dinner has only a
    // scheduled first version.
    const bar = await menuWith("Bar", product(f.extraLemon));
    const setLunch = await menuWith("Set lunch", {
      kind: "set_menu",
      menuId: await setMenuWithLemonade(),
    });
    const barLive = await publish(bar);
    const setLive = await publish(setLunch);
    const lunchLive = await publish(f.lunch);
    await app((tx) => updateProduct(tx, f.lager, { unitPrice: "4.50" }));
    const named = await queue(f.lunch, hoursFromNow(24));
    await app((tx) => updateProduct(tx, f.soup, { unitPrice: "5.50" }));
    const unnamed = await queue(f.lunch, hoursFromNow(48));
    const unnamedHash = (await documentOf(unnamed)).contentHash;
    const dinnerAt = hoursFromNow(24);
    const dinnerFirst = await queue(f.dinner, dinnerAt);
    const before = await valuesOf(f.extraLemon);
    await declare(f.extraLemon, { celery: {} });
    const found = await drift([f.extraLemon], before);
    expect(found.map(({ name }) => name)).toEqual([
      "Bar",
      "Dinner Menu",
      "Lunch Menu",
      "Set lunch",
    ]);

    expect(await corrections(f.extraLemon, [named, dinnerFirst])).toEqual({
      menus: [
        { menuId: bar, name: "Bar" },
        { menuId: f.dinner, name: "Dinner Menu" },
        { menuId: f.lunch, name: "Lunch Menu" },
        { menuId: setLunch, name: "Set lunch" },
      ],
      productIds: [f.extraLemon],
    });

    for (const [menuId, old] of [
      [bar, barLive],
      [setLunch, setLive],
      [f.lunch, lunchLive],
    ] as const) {
      const live = await liveOf(menuId);
      expect(live!.versionId).not.toBe(old);
      expect((await documentOf(live!.versionId)).createdBy).toBe(PERSON);
    }
    expect(await liveOf(f.dinner)).toBeUndefined();
    const [dinnerQueued] = await queuedOf(f.dinner);
    expect(dinnerQueued!.versionId).not.toBe(dinnerFirst);
    expect(dinnerQueued!.activatesAt).toEqual(dinnerAt);
    const lunchQueued = await queuedOf(f.lunch);
    expect(lunchQueued).toHaveLength(2);
    // Before: live and two queued. After: one new live version and each queued one requeued once.
    expect(
      await fx.db.select().from(menuVersions).where(eq(menuVersions.menuId, f.lunch)),
    ).toHaveLength(6);
    expect((await documentOf(lunchQueued[1]!.versionId)).contentHash).toBe(unnamedHash);
    // Only Lunch's unnamed queued version still shows the old value.
    expect(await drift([f.extraLemon], before)).toEqual([
      {
        menuId: f.lunch,
        name: "Lunch Menu",
        liveVersionId: (await liveOf(f.lunch))!.versionId,
        live: [],
        queued: [expect.objectContaining({ versionId: lunchQueued[1]!.versionId })],
      },
    ]);
  });

  it("corrects a named queued version's copies at places the drifting live version lacks", async () => {
    await publish(f.lunch);
    await app((tx) => addMember(tx, f.lunchRoot, product(f.extraLemon)));
    const queued = await queue(f.lunch, hoursFromNow(24));
    await declare(f.extraLemon, { celery: {} });
    const [found] = await drift([f.extraLemon], new Map());
    expect(found!.live).toHaveLength(1);
    expect(found!.queued[0]!.changes).toHaveLength(2);
    await corrections(f.extraLemon, [queued]);
    expect(await drift([f.extraLemon], new Map())).toEqual([]);
  });

  it("corrects a named queued version whose live version already agrees, making no new live version", async () => {
    const v1 = await publish(f.lunch);
    await app((tx) => addMember(tx, f.lunchRoot, product(f.burger)));
    const queued = await queue(f.lunch, hoursFromNow(24));
    await app((tx) => updateProduct(tx, f.lager, { unitPrice: "4.50" }));
    const unnamedAt = hoursFromNow(48);
    const unnamed = await queue(f.lunch, unnamedAt);
    const unnamedHash = (await documentOf(unnamed)).contentHash;
    await declare(f.burger, { sesame: {} });
    expect(await corrections(f.burger, [queued])).toEqual({
      menus: [{ menuId: f.lunch, name: "Lunch Menu" }],
      productIds: [f.burger],
    });
    expect((await liveOf(f.lunch))!.versionId).toBe(v1);
    const [requeued, requeuedUnnamed] = await queuedOf(f.lunch);
    expect(requeued!.versionId).not.toBe(queued);
    expect(requeuedUnnamed!.activatesAt).toEqual(unnamedAt);
    expect((await documentOf(requeuedUnnamed!.versionId)).contentHash).toBe(unnamedHash);
    expect(await drift([f.burger], new Map())).toEqual([
      expect.objectContaining({
        live: [],
        queued: [expect.objectContaining({ versionId: requeuedUnnamed!.versionId })],
      }),
    ]);
  });

  it("a second call corrects nothing and answers menus: []", async () => {
    await publish(f.lunch);
    await app((tx) => updateProduct(tx, f.lager, { unitPrice: "4.50" }));
    const queued = await queue(f.lunch, hoursFromNow(24));
    await declare(f.soup, { milk: {} });
    expect((await corrections(f.soup, [queued])).menus).toHaveLength(1);
    const [requeued] = await queuedOf(f.lunch);
    const live = (await liveOf(f.lunch))!.versionId;
    expect(await corrections(f.soup, [queued, requeued!.versionId])).toEqual({
      menus: [],
      productIds: [f.soup],
    });
    expect((await liveOf(f.lunch))!.versionId).toBe(live);
    expect((await queuedOf(f.lunch))[0]!.versionId).toBe(requeued!.versionId);
  });

  const lemonadeWithJugScheduled = async () => {
    await publish(f.lunch);
    const jug = await app(async (tx) => {
      const [, made] = await setProductVariants(
        tx,
        f.lemonade,
        [
          {
            id: f.large,
            name: "Large",
            customerName: { en: "A big glass" },
            kitchenName: "LRG",
            image: libraryImageName("large.jpg"),
            unitPrice: "3.50",
            available: true,
          },
          {
            name: "Jug",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "9.00",
            available: true,
          },
        ],
        "en",
      );
      return made!.id;
    });
    const scheduled = await queue(f.lunch, hoursFromNow(24));
    await declare(f.lemonade, { milk: {} });
    return { jug, scheduled, hash: (await documentOf(scheduled)).contentHash };
  };

  it("a ticked scheduled version holding a variant the live version lacks has that copy corrected, and names it", async () => {
    const { jug, scheduled } = await lemonadeWithJugScheduled();
    expect(await corrections(f.lemonade, [scheduled])).toEqual({
      menus: [{ menuId: f.lunch, name: "Lunch Menu" }],
      productIds: [f.lemonade, f.large, jug],
    });
    expect(await drift([f.lemonade, f.large, jug], new Map())).toEqual([]);
  });

  it("an unticked scheduled version holding a variant the live version lacks keeps its document", async () => {
    const { jug, hash } = await lemonadeWithJugScheduled();
    expect(await corrections(f.lemonade)).toEqual({
      menus: [{ menuId: f.lunch, name: "Lunch Menu" }],
      productIds: [f.lemonade, f.large],
    });
    const [requeued] = await queuedOf(f.lunch);
    expect((await documentOf(requeued!.versionId)).contentHash).toBe(hash);
    expect(await drift([f.lemonade, f.large, jug], new Map())).toEqual([
      expect.objectContaining({
        live: [],
        queued: [expect.objectContaining({ versionId: requeued!.versionId })],
      }),
    ]);
  });

  it("leaves a menu whose live version agrees and whose out-of-date scheduled version is unticked", async () => {
    const v1 = await publish(f.lunch);
    await app((tx) => addMember(tx, f.lunchRoot, product(f.burger)));
    const scheduled = await queue(f.lunch, hoursFromNow(24));
    await declare(f.burger, { sesame: {} });
    expect(await corrections(f.burger)).toEqual({ menus: [], productIds: [f.burger] });
    expect((await liveOf(f.lunch))!.versionId).toBe(v1);
    expect((await queuedOf(f.lunch)).map(({ versionId }) => versionId)).toEqual([scheduled]);
  });

  it("a throw on the second menu leaves the first unpatched", async () => {
    const bar = await menuWith("Bar", product(f.extraLemon));
    const barLive = await publish(bar);
    const lunchLive = await publish(f.lunch);
    await declare(f.extraLemon, { celery: {} });
    const patch = vi
      .spyOn(publication, "patchLiveMenu")
      .mockImplementationOnce(publication.patchLiveMenu)
      .mockImplementationOnce(() => Promise.reject(new Error("second menu fails")));
    try {
      await expect(corrections(f.extraLemon)).rejects.toThrow("second menu fails");
      expect(patch).toHaveBeenCalledTimes(2);
    } finally {
      patch.mockRestore();
    }
    expect((await liveOf(bar))!.versionId).toBe(barLive);
    expect((await liveOf(f.lunch))!.versionId).toBe(lunchLive);
  });
});
