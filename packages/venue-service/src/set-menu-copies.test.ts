import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  kitchenCourses,
  products,
  setMenuDishCourses,
  setMenuLineCourses,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createExtraList,
  createMenu,
  listMembers,
  removeMember,
  requireMenuRoot,
  updateMenuDetails,
  updateProduct,
  writeProductModifiers,
} from "@waitron/menu";
import {
  expandDietaryDeclarations,
  type DietaryLabel,
  type ProductAllergens,
} from "@waitron/shared";
import { listZoneOffers } from "./operations.js";
import { serveRecordedSetMenus } from "./set-menu-copies.js";
import { setMenuFixture } from "./testing/set-menu-fixtures.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
type Fixture = Awaited<ReturnType<typeof setMenuFixture>>;
const scenario = (test: (tx: Transaction, f: Fixture) => Promise<void>) =>
  withTransaction(suite.db, async (tx) => test(tx, await setMenuFixture(tx)));

it("reads recorded versions in the requested order after the full menu is republished", () =>
  scenario(async (tx, f) => {
    const old = await f.publish();
    const before = (await listZoneOffers(tx, f.zoneId, { at: f.midday })).setMenus[0]!;
    await updateMenuDetails(tx, f.daily, { setPrice: "15.00" });
    const live = await f.publish();
    const current = (await listZoneOffers(tx, f.zoneId, { at: f.midday })).setMenus[0]!;
    const ask = (versionId: string) => ({ versionId, menuId: f.daily });
    const copies = await serveRecordedSetMenus(tx, [
      ask(live.versionId),
      ask(old.versionId),
      ask(live.versionId),
    ]);
    expect(copies.map(({ key, terms }) => [key, terms.price])).toEqual([
      [current.key, "15.00"],
      [before.key, "14.00"],
      [current.key, "15.00"],
    ]);
    expect(copies[1]).toEqual({
      key: before.key,
      menuId: before.menuId,
      name: before.name,
      terms: before.terms,
      changedAt: before.changedAt,
      structure: before.structure,
      offers: before.offers,
    });
  }));

it("serves a recorded copy at its own price with the allergens and diets published since", () =>
  scenario(async (tx, f) => {
    const list = await createExtraList(
      tx,
      { name: "Sauces", minPicks: 0, maxPicks: 1, items: [{ productId: f.soup, price: "1.00" }] },
      "en",
    );
    await writeProductModifiers(tx, f.bravas, [{ kind: "extras", id: list.id }]);
    const declare = async (allergens: ProductAllergens, diet: DietaryLabel) => {
      for (const id of [f.bravas, f.largeBravas, f.soup])
        await updateProduct(tx, id, {
          allergens: id === f.bravas ? allergens : { ...allergens, sulphites: {} },
          dietaryDeclarations: id === f.bravas ? [diet] : [diet, "kosher"],
          dietOverride: { vegan: diet === "vegan" ? "yes" : "no" },
        });
    };
    await declare({ milk: {} }, "vegetarian");
    const { versionId } = await f.publish();
    const recorded = async () => {
      const [copy] = await serveRecordedSetMenus(tx, [{ versionId, menuId: f.daily }], "published");
      const offer = copy!.offers.find(({ id }) => id === f.bravasItem)!;
      const [variant] = offer.variants;
      const extras = offer.offeredModifiers.find(({ id }) => id === list.id)!;
      const [item] = extras.kind === "extras" ? extras.items : [];
      return {
        price: copy!.terms.price,
        dish: [offer.allergens, offer.dietaryDeclarations, offer.dietOverride, offer.diet!.vegan],
        variant: [
          variant!.allergens,
          variant!.dietaryDeclarations,
          variant!.dietOverride,
          variant!.diet!.vegan,
        ],
        extra: [item!.addAllergens, item!.suitableFor],
      };
    };
    const served = (allergens: ProductAllergens, diet: DietaryLabel) => {
      const vegan = diet === "vegan" ? "yes" : "no";
      return {
        price: "14.00",
        dish: [allergens, [diet], { vegan }, vegan],
        variant: [{ ...allergens, sulphites: {} }, [diet, "kosher"], { vegan }, vegan],
        extra: [{ ...allergens, sulphites: {} }, expandDietaryDeclarations([diet, "kosher"])],
      };
    };

    await declare({ fish: {} }, "vegan");
    expect(await recorded()).toEqual(served({ milk: {} }, "vegetarian"));

    await updateMenuDetails(tx, f.daily, { setPrice: "15.00" });
    await f.publish();
    expect(await recorded()).toEqual(served({ fish: {} }, "vegan"));

    const root = await requireMenuRoot(tx, f.lunch);
    for (const { id, ref } of await listMembers(tx, root))
      if (ref.kind === "set_menu") await removeMember(tx, root, id);
    await declare({ eggs: {} }, "vegetarian");
    await f.publish();
    expect(await recorded()).toEqual(served({ fish: {} }, "vegan"));
  }));

it("applies the same live availability and course rule to a recorded copy", () =>
  scenario(async (tx, f) => {
    const [{ id: override }] = await tx
      .insert(kitchenCourses)
      .values({ name: "Special course", displayOrder: 4 })
      .returning({ id: kitchenCourses.id });
    await tx.insert(setMenuDishCourses).values({ menuItemId: f.bravasItem, courseId: override });
    await tx
      .update(setMenuLineCourses)
      .set({ courseId: override })
      .where(eq(setMenuLineCourses.courseId, f.drinks));
    const { versionId } = await f.publish();
    await tx.update(products).set({ available: false }).where(eq(products.id, f.bravas));
    const requested = [{ versionId, menuId: f.daily }];
    const recordedDish = async () =>
      (await serveRecordedSetMenus(tx, requested))[0]?.offers.find(({ id }) => id === f.bravasItem);
    expect(await recordedDish()).toMatchObject({
      available: false,
      courseId: override,
      countsAsCourseId: override,
    });
    await tx.update(kitchenCourses).set({ active: false }).where(eq(kitchenCourses.id, override));
    expect(await recordedDish()).toMatchObject({
      available: false,
      courseId: f.sharing,
      countsAsCourseId: override,
    });
  }));

it.each(["without copies", "with another copy", "missing altogether"] as const)(
  "refuses a set menu missing from a version %s",
  (fixture) =>
    scenario(async (tx, f) => {
      const versionId =
        fixture === "missing altogether"
          ? crypto.randomUUID()
          : (await f.publish(fixture === "without copies" ? f.dinner : f.lunch)).versionId;
      const menuId =
        fixture === "with another copy"
          ? (
              await createMenu(tx, {
                kind: "set_menu",
                name: "Special",
                setPrice: "20.00",
              })
            ).id
          : f.daily;
      await expect(serveRecordedSetMenus(tx, [{ versionId, menuId }])).rejects.toMatchObject({
        code: "set_menu.not_found",
        params: { menuId },
      });
    }),
);
