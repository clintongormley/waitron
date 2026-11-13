import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  madridWithVatClassChanges,
  type MadridVatClassChange,
} from "./madrid-vat-class-changes.js";
import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";

const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const product = '@products:["beer.webp"]';
const bread = '@products:["bread.webp"]';
const drinks = {
  menuId: '@catalogues:["Drinks"]',
  offers: {
    beer: {
      productId: product,
      vatClass: "general",
      variants: [{ name: "Pint", vatClass: "general" }],
    },
    bread: { productId: bread, vatClass: "reduced", variants: [] },
  },
};
const drinksHash = digest(drinks);
const restaurant = { menuId: '@catalogues:["Casa"]', includedMenuHashes: { drinks: drinksHash } };
const restaurantHash = digest(restaurant);
const original: CanonicalMadridSemantics = {
  tables: {
    products: {
      columns: [],
      foreignKeys: [],
      rows: {
        [product]: { id: product, name: "Beer", vat_class: "general" },
        [bread]: { id: bread, name: "Bread", vat_class: "reduced" },
      },
    },
    menu_versions: {
      columns: [],
      foreignKeys: [],
      rows: {
        drinks: { content_hash: drinksHash, document: drinks },
        restaurant: { content_hash: restaurantHash, document: restaurant },
      },
    },
  },
};
const change: MadridVatClassChange = { product, old: "general", new: "reduced" };

it("moves a product, its offers and their variants to the new class and recomputes every fingerprint", () => {
  const updated = madridWithVatClassChanges(original, [change]);
  expect(updated.tables.products!.rows[product]).toEqual({
    id: product,
    name: "Beer",
    vat_class: "reduced",
  });
  const changedDrinks = {
    ...drinks,
    offers: {
      ...drinks.offers,
      beer: {
        productId: product,
        vatClass: "reduced",
        variants: [{ name: "Pint", vatClass: "reduced" }],
      },
    },
  };
  const changedRestaurant = {
    ...restaurant,
    includedMenuHashes: { drinks: digest(changedDrinks) },
  };
  expect(Object.values(updated.tables.menu_versions!.rows)).toEqual(
    expect.arrayContaining([
      { content_hash: digest(changedDrinks), document: changedDrinks },
      { content_hash: digest(changedRestaurant), document: changedRestaurant },
    ]),
  );
  expect(original.tables.products!.rows[product]!.vat_class).toBe("general");
  expect(original.tables.menu_versions!.rows.drinks!.content_hash).toBe(drinksHash);
});

it.each([
  [{ ...change, product: '@products:["missing.webp"]' }],
  [{ ...change, old: "super_reduced" }],
  [{ ...change, new: "general" }],
  [change, change],
])("refuses an unused, stale or repeated VAT class change %#", (...changes) => {
  expect(() => madridWithVatClassChanges(original, changes)).toThrow(
    "unused or invalid Madrid VAT class change",
  );
});
