import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { products, withTransaction, type Transaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import type { ProductAllergens } from "@waitron/shared";
import { useMenuDb } from "../test/fixtures.js";
import { menusFixture, offerOf, product, type MenusFixture } from "../test/menus-fixture.js";
import {
  declarationChanges,
  findDeclarationDrift,
  waitingDeclarationMenus,
} from "./declaration-correction.js";
import { documentSetMenuOffers } from "./menu-document.js";
import { patchLiveMenu, previewMenu, publishMenu, readLiveDocuments } from "./menu-publication.js";
import { queueMenuPublication } from "./menu-schedule.js";
import { createMenu, updateProduct } from "./operations.js";
import { readProductDeclarationValues } from "./product-declarations.js";
import { addMember } from "./sections.js";
import { addSetMenuDishes } from "./set-menus.js";

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

  it("names a live menu not sold at this hour", async () => {
    // No service period names Dinner, so it is sold nowhere at any hour.
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
