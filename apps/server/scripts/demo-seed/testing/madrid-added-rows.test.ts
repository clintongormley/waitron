import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { madridWithAddedRows, type MadridAddedCategory } from "./madrid-added-rows.js";
import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";

const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const table = (rows: Record<string, Record<string, unknown>>) => ({
  columns: [],
  foreignKeys: [],
  rows,
});

const menu = '@catalogues:["Deli"]';
const ham = '@products:["ham.webp"]';
const hamItem = `@menu_items:${stable([menu, ham])}`;
const cheeses = `@sections:${stable([menu, "section", "Cheeses"])}`;
const cola = '@products:["cola.webp"]';
const colaItem = `@menu_items:${stable([menu, cola])}`;
const drinks = `@sections:${stable([menu, "section", "Drinks"])}`;
const drinksCategory = '@categories:["Drinks"]';
const colaImage = '@media_images:["cola.webp"]';
const deliVersion = `@menu_versions:${stable([menu, 1])}`;
const restaurantVersion = `@menu_versions:${stable(['@catalogues:["Casa"]', 1])}`;

const deliDocument = {
  menuId: menu,
  offers: { [hamItem]: { productId: ham, name: "Ham", unitPrice: "4.00", vatClass: "reduced" } },
  root: { members: [{ kind: "section", sectionId: cheeses, members: [] }] },
};
const restaurantDocument = { menuId: '@catalogues:["Casa"]', includedMenuHashes: {} as object };
function capture(deli: object): CanonicalMadridSemantics {
  const restaurant = { ...restaurantDocument, includedMenuHashes: { deli: digest(deli) } };
  return {
    tables: {
      products: table({
        [ham]: { id: ham, name: "Ham", vat_class: "reduced", unit_price: 400 },
      }),
      categories: table({}),
      sections: table({ [cheeses]: { id: cheeses, owner_menu_id: menu, role: "section" } }),
      menu_items: table({ [hamItem]: { id: hamItem, menu_id: menu, product_id: ham } }),
      media_images: table({}),
      persons: table({}),
      menu_versions: table({
        [deliVersion]: {
          id: deliVersion,
          menu_id: menu,
          content_hash: digest(deli),
          document: deli,
        },
        [restaurantVersion]: {
          id: restaurantVersion,
          menu_id: restaurantDocument.menuId,
          content_hash: digest(restaurant),
          document: restaurant,
        },
      }),
    },
  };
}
const original = capture(deliDocument);

const colaOffer = {
  productId: cola,
  name: "Cola",
  customerName: { en: "Cola can", es: "Cola en lata" },
  kitchenName: "COLA · DELI",
  image: "cola.webp",
  unitPrice: "1.80",
  pricingUnit: "each",
  vatClass: "general",
};
const seededDeli = {
  ...deliDocument,
  offers: { ...deliDocument.offers, [colaItem]: colaOffer },
  root: {
    members: [
      ...deliDocument.root.members,
      { kind: "section", sectionId: drinks, members: [{ kind: "product", productId: cola }] },
    ],
  },
};
function seededWith(edit: (seeded: CanonicalMadridSemantics) => void = () => {}) {
  const seeded = capture(seededDeli);
  seeded.tables.products!.rows[cola] = {
    id: cola,
    name: "Cola",
    customer_name: { en: "Cola can", es: "Cola en lata" },
    kitchen_name: "COLA · DELI",
    vat_class: "general",
    unit_price: 180,
    pricing_unit: "each",
    category_id: drinksCategory,
    catalogue_id: menu,
    image: "cola.webp",
    parent_id: null,
  };
  seeded.tables.categories!.rows[drinksCategory] = { id: drinksCategory, name: "Drinks" };
  seeded.tables.sections!.rows[drinks] = {
    id: drinks,
    owner_menu_id: menu,
    role: "section",
    internal_name: "Drinks",
    names: { en: "Drinks", es: "Bebidas" },
  };
  seeded.tables.menu_items!.rows[colaItem] = { id: colaItem, menu_id: menu, product_id: cola };
  seeded.tables.media_images!.rows[colaImage] = { id: colaImage, filename: "cola.webp" };
  edit(seeded);
  return seeded;
}
const declared: MadridAddedCategory = {
  menu: "Deli",
  name: "Drinks",
  names: { en: "Drinks", es: "Bebidas" },
  products: [
    {
      image: "cola.webp",
      name: "Cola",
      customerName: { en: "Cola can", es: "Cola en lata" },
      kitchenName: "COLA · DELI",
      vatClass: "general",
      unitPrice: 180,
      pricingUnit: "each",
    },
  ],
};

it("adds the declared rows, the deli document's new section and offer, and recomputes every fingerprint", () => {
  const seeded = seededWith();
  const { semantics, added } = madridWithAddedRows(original, seeded, [declared]);
  expect(semantics).toEqual(seeded);
  expect(added).toEqual({
    products: 1,
    categories: 1,
    sections: 1,
    menu_items: 1,
    media_images: 1,
  });
  expect(original.tables.products!.rows[cola]).toBeUndefined();
  expect(original.tables.menu_versions!.rows[deliVersion]!.content_hash).toBe(digest(deliDocument));
});

it.each([
  [
    "an undeclared product",
    (seeded: CanonicalMadridSemantics) => {
      seeded.tables.products!.rows['@products:["tonic.webp"]'] = {
        id: '@products:["tonic.webp"]',
        name: "Tonic",
      };
    },
    /not tied to a declared addition: products/,
  ],
  [
    "a row in a table outside the list",
    (seeded: CanonicalMadridSemantics) => {
      seeded.tables.persons!.rows.someone = { id: "someone", email: "x@example.test" };
    },
    /not tied to a declared addition: persons/,
  ],
  [
    "a changed existing row",
    (seeded: CanonicalMadridSemantics) => {
      seeded.tables.products!.rows[ham]!.unit_price = 450;
    },
    /changed or removed: products/,
  ],
  [
    "a removed existing row",
    (seeded: CanonicalMadridSemantics) => {
      delete seeded.tables.menu_items!.rows[hamItem];
    },
    /changed or removed: menu_items/,
  ],
  [
    "a changed version of another menu",
    (seeded: CanonicalMadridSemantics) => {
      seeded.tables.menu_versions!.rows[restaurantVersion]!.published_by = "someone";
    },
    /changed or removed: menu_versions/,
  ],
])("refuses %s", (_, edit, message) => {
  expect(() => madridWithAddedRows(original, seededWith(edit), [declared])).toThrow(message);
});

it("refuses a deli document that changed beyond the added section and offers", () => {
  const seeded = seededWith();
  const deli = seeded.tables.menu_versions!.rows[deliVersion]!;
  const document = structuredClone(seededDeli);
  document.offers[hamItem]!.unitPrice = "4.50";
  deli.document = document;
  expect(() => madridWithAddedRows(original, seeded, [declared])).toThrow(
    /published document changed beyond the addition/,
  );
});

it("refuses a declared product the seed did not add", () => {
  const missing = {
    ...declared,
    products: [...declared.products, { ...declared.products[0]!, image: "tonic.webp" }],
  };
  expect(() => madridWithAddedRows(original, seededWith(), [missing])).toThrow(
    /declared product not added: tonic.webp/,
  );
});

it.each([
  ["vatClass", { vatClass: "reduced" }],
  ["unitPrice", { unitPrice: 160 }],
  ["pricingUnit", { pricingUnit: "weight" }],
  ["name", { name: "Coke" }],
  ["kitchenName", { kitchenName: "COLA" }],
  ["customerName", { customerName: { en: "Cola can", es: "Cola" } }],
])("refuses a wrong declared %s", (field, change) => {
  const wrong = { ...declared, products: [{ ...declared.products[0]!, ...change }] };
  expect(() => madridWithAddedRows(original, seededWith(), [wrong])).toThrow(
    `declared ${field} differs: cola.webp`,
  );
});

it.each([
  [
    "category name",
    { name: "Soft drinks" },
    /not tied to a declared addition: categories @categories:\["Drinks"\]/,
  ],
  [
    "section names",
    { names: { en: "Drinks", es: "Refrescos" } },
    /declared section names differ: Drinks/,
  ],
])("refuses wrong declared %s", (_, change, message) => {
  expect(() => madridWithAddedRows(original, seededWith(), [{ ...declared, ...change }])).toThrow(
    message,
  );
});

it("refuses a declared category the seed did not add", () => {
  const seeded = seededWith((seeded) => {
    delete seeded.tables.categories!.rows[drinksCategory];
  });
  expect(() => madridWithAddedRows(original, seeded, [declared])).toThrow(
    /declared category not added: Drinks/,
  );
});
