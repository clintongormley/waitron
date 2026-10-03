import { expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useCatalogueDb } from "../test/fixtures.js";
import { menusFixture } from "../test/menus-fixture.js";
import { createExtraList } from "./extras.js";
import { extraOfferUsage, extraOfferUsageForUnitPrecisionChange } from "./extra-usage.js";
import { writeProductModifiers } from "./product-modifiers.js";
import { assignProductUnit, createUnit } from "./units.js";

const fx = useCatalogueDb();
const run = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

it("names a product's extras lists and only menus whose working offers carry them", async () => {
  const f = await menusFixture(fx.db);
  const idle = await run((tx) =>
    createExtraList(tx, { name: "Idle lemon", items: [{ productId: f.extraLemon }] }, "en"),
  );
  await run((tx) => writeProductModifiers(tx, f.extraLemon, [{ kind: "extras", id: idle.id }]));

  const usage = await run((tx) => extraOfferUsage(tx, [f.extraLemon, f.soup]));
  expect(usage).toEqual([
    {
      productId: f.extraLemon,
      productName: "Extra lemon",
      lists: [
        {
          id: f.extrasList,
          name: "Extras",
          menus: [
            { id: f.dinner, name: "Dinner Menu" },
            { id: f.drinksMenu, name: "Drinks" },
            { id: f.lunch, name: "Lunch Menu" },
          ],
        },
        { id: idle.id, name: "Idle lemon", menus: [] },
      ],
    },
  ]);
});

it("includes a unit's direct extra and an inheriting variant with their offered menus", async () => {
  const f = await menusFixture(fx.db);
  const { unitId, variantListId } = await run(async (tx) => {
    const unit = await createUnit(
      tx,
      { name: { en: "kilogram" }, abbreviation: { en: "kg" }, precision: 3 },
      "en",
    );
    await assignProductUnit(tx, f.extraLemon, unit.id);
    await assignProductUnit(tx, f.lemonade, unit.id);
    const list = await createExtraList(
      tx,
      { name: "Sizes", items: [{ productId: f.large, portion: "0.055", price: "0.01" }] },
      "en",
    );
    await writeProductModifiers(tx, f.soup, [{ kind: "extras", id: list.id }]);
    return { unitId: unit.id, variantListId: list.id };
  });

  const usage = await run((tx) => extraOfferUsageForUnitPrecisionChange(tx, unitId));
  expect(usage.sort((left, right) => left.productName.localeCompare(right.productName))).toEqual([
    {
      productId: f.extraLemon,
      productName: "Extra lemon",
      lists: [
        {
          id: f.extrasList,
          name: "Extras",
          menus: [
            { id: f.dinner, name: "Dinner Menu" },
            { id: f.drinksMenu, name: "Drinks" },
            { id: f.lunch, name: "Lunch Menu" },
          ],
        },
      ],
    },
    {
      productId: f.large,
      productName: "Large",
      lists: [{ id: variantListId, name: "Sizes", menus: [{ id: f.lunch, name: "Lunch Menu" }] }],
    },
  ]);
});
