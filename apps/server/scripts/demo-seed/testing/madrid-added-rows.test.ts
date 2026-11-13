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
const rowKey = (row: Record<string, unknown>) =>
  typeof row.id === "string" ? row.id : stable(row);
const member = (sectionId: string, position: number) =>
  `@section_members:${stable([sectionId, position])}`;

const menu = '@catalogues:["Deli"]';
const casa = '@catalogues:["Casa"]';
const root = `@sections:${stable([menu, "menu_root", "Deli"])}`;
const ham = '@products:["ham.webp"]';
const hamItem = `@menu_items:${stable([menu, ham])}`;
const cheeses = `@sections:${stable([menu, "section", "Cheeses"])}`;
const cola = '@products:["cola.webp"]';
const colaItem = `@menu_items:${stable([menu, cola])}`;
const drinks = `@sections:${stable([menu, "section", "Drinks"])}`;
const drinksCategory = '@categories:["Drinks"]';
const colaImage = '@media_images:["cola.webp"]';
const deliVersion = `@menu_versions:${stable([menu, 1])}`;
const restaurantVersion = `@menu_versions:${stable([casa, 1])}`;

const hamMember = { kind: "product", menuItemId: hamItem, productId: ham };
const colaMember = { kind: "product", menuItemId: colaItem, productId: cola };
const deliDocument = {
  menuId: menu,
  offers: {
    [hamItem]: {
      productId: ham,
      menuId: menu,
      placements: [[cheeses]],
      name: "Ham",
      unitPrice: "4.00",
      vatClass: "reduced",
    },
  } as Record<string, Record<string, unknown>>,
  root: {
    members: [{ kind: "section", sectionId: cheeses, members: [hamMember] }] as {
      kind: string;
      sectionId: string;
      names?: Record<string, string>;
      members: Record<string, unknown>[];
    }[],
  },
};
const restaurantDocument = {
  menuId: casa,
  offers: {} as Record<string, Record<string, unknown>>,
  includedMenuHashes: {} as object,
};
function capture(deli: object, restaurantOffers: object = {}): CanonicalMadridSemantics {
  const restaurant = {
    ...restaurantDocument,
    offers: restaurantOffers,
    includedMenuHashes: { deli: digest(deli) },
  };
  return {
    tables: {
      products: table({
        [ham]: { id: ham, name: "Ham", vat_class: "reduced", unit_price: 400 },
      }),
      categories: table({}),
      category_details: table({}),
      sections: table({
        [root]: { id: root, owner_menu_id: menu, role: "menu_root" },
        [cheeses]: { id: cheeses, owner_menu_id: menu, role: "section" },
      }),
      section_members: table({
        [member(root, 0)]: {
          id: member(root, 0),
          section_id: root,
          product_id: null,
          child_section_id: cheeses,
        },
        [member(cheeses, 0)]: {
          id: member(cheeses, 0),
          section_id: cheeses,
          product_id: ham,
          child_section_id: null,
        },
      }),
      menu_items: table({ [hamItem]: { id: hamItem, menu_id: menu, product_id: ham } }),
      routing_cells: table({}),
      media_images: table({}),
      media_image_data: table({}),
      media_image_edits: table({}),
      menu_version_images: table({}),
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
          menu_id: casa,
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
  menuId: menu,
  placements: [[drinks]],
  name: "Cola",
  customerName: { en: "Cola can", es: "Cola en lata" },
  kitchenName: "COLA · DELI",
  image: "cola.webp",
  unitPrice: "1.80",
  pricingUnit: "each",
  vatClass: "general",
  variants: [] as Record<string, unknown>[],
  offeredModifiers: [] as Record<string, unknown>[],
};
const drinksNames = { en: "Drinks", es: "Bebidas" };
const seededDeli = {
  ...deliDocument,
  offers: { ...deliDocument.offers, [colaItem]: colaOffer },
  root: {
    members: [
      ...deliDocument.root.members,
      { kind: "section", sectionId: drinks, names: drinksNames, members: [colaMember] },
    ],
  },
};
type DeliDocument = typeof seededDeli;
function seededWith(
  edit: (seeded: CanonicalMadridSemantics) => void = () => {},
  deli: DeliDocument = seededDeli,
  restaurantOffers: object = {},
) {
  const seeded = capture(deli, restaurantOffers);
  const add = (name: string, row: Record<string, unknown>) => {
    seeded.tables[name]!.rows[rowKey(row)] = row;
  };
  add("products", {
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
  });
  add("categories", { id: drinksCategory, name: "Drinks" });
  add("category_details", { category_id: drinksCategory, parent_id: null, color: "#a8d8e0" });
  add("sections", {
    id: drinks,
    owner_menu_id: menu,
    role: "section",
    internal_name: "Drinks",
    names: drinksNames,
  });
  add("section_members", {
    id: member(root, 1),
    section_id: root,
    product_id: null,
    child_section_id: drinks,
  });
  add("section_members", {
    id: member(drinks, 0),
    section_id: drinks,
    product_id: cola,
    child_section_id: null,
  });
  add("menu_items", { id: colaItem, menu_id: menu, product_id: cola });
  add("routing_cells", {
    category_id: drinksCategory,
    product_id: null,
    zone_id: null,
    station_id: "deli",
  });
  add("media_images", { id: colaImage, filename: "cola.webp" });
  add("media_image_data", { image_id: colaImage, bytes: "sha256:cola" });
  add("media_image_edits", { image_id: colaImage, revision: 1 });
  add("menu_version_images", { version_id: deliVersion, filename: "cola.webp" });
  edit(seeded);
  return seeded;
}
function deliWith(edit: (deli: DeliDocument) => void) {
  const deli = structuredClone(seededDeli);
  edit(deli);
  return deli;
}
const declared: MadridAddedCategory = {
  menu: "Deli",
  name: "Drinks",
  names: drinksNames,
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
    category_details: 1,
    sections: 1,
    section_members: 2,
    menu_items: 1,
    routing_cells: 1,
    media_images: 1,
    media_image_data: 1,
    media_image_edits: 1,
    menu_version_images: 1,
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
  [
    "a menu item for a declared product in another menu",
    (seeded: CanonicalMadridSemantics) => {
      const item = `@menu_items:${stable([casa, cola])}`;
      seeded.tables.menu_items!.rows[item] = { id: item, menu_id: casa, product_id: cola };
    },
    /not tied to a declared addition: menu_items @menu_items:\["@catalogues:\[\\"Casa\\"\]"/,
  ],
  [
    "a section member placing a declared product in an existing section",
    (seeded: CanonicalMadridSemantics) => {
      seeded.tables.section_members!.rows[member(cheeses, 1)] = {
        id: member(cheeses, 1),
        section_id: cheeses,
        product_id: cola,
        child_section_id: null,
      };
    },
    /not tied to a declared addition: section_members @section_members:\["@sections:\[.*Cheeses.*",1\]/,
  ],
  [
    "a second section member for a declared product",
    (seeded: CanonicalMadridSemantics) => {
      seeded.tables.section_members!.rows[member(drinks, 1)] = {
        id: member(drinks, 1),
        section_id: drinks,
        product_id: cola,
        child_section_id: null,
      };
    },
    /declared addition duplicated: section_members @section_members:\["@sections:\[.*Drinks.*",1\]/,
  ],
  [
    "a second routing cell for a declared category",
    (seeded: CanonicalMadridSemantics) => {
      const cell = {
        category_id: drinksCategory,
        product_id: null,
        zone_id: null,
        station_id: "bar",
      };
      seeded.tables.routing_cells!.rows[rowKey(cell)] = cell;
    },
    /declared addition duplicated: routing_cells \{"category_id":"@categories:\[\\"Drinks\\"\]","product_id":null,"station_id":"bar"/,
  ],
  [
    "a routing cell for a declared product",
    (seeded: CanonicalMadridSemantics) => {
      const cell = { category_id: null, product_id: cola, zone_id: null, station_id: "bar" };
      seeded.tables.routing_cells!.rows[rowKey(cell)] = cell;
    },
    /not tied to a declared addition: routing_cells \{"category_id":null,"product_id":"@products:\[\\"cola.webp\\"\]"/,
  ],
  [
    "a missing category detail",
    (seeded: CanonicalMadridSemantics) => {
      seeded.tables.category_details!.rows = {};
    },
    /declared addition missing: category_details \["@categories:\[\\"Drinks\\"\]"\]/,
  ],
  [
    "other names on the seeded section row",
    (seeded: CanonicalMadridSemantics) => {
      seeded.tables.sections!.rows[drinks]!.names = { en: "Drinks", es: "Refrescos" };
    },
    /declared section names differ: Drinks/,
  ],
])("refuses %s", (_, edit, message) => {
  expect(() => madridWithAddedRows(original, seededWith(edit), [declared])).toThrow(message);
});

it.each([
  [
    "without the declared section",
    deliWith((deli) => {
      deli.root.members.pop();
    }),
    /declared section not published once: Drinks/,
  ],
  [
    "with the declared section twice",
    deliWith((deli) => {
      deli.root.members.push(structuredClone(deli.root.members.at(-1)!));
    }),
    /declared section not published once: Drinks/,
  ],
  [
    "with the declared section empty",
    deliWith((deli) => {
      deli.root.members.at(-1)!.members = [];
    }),
    /published section contents differ: Drinks/,
  ],
  [
    "with an existing product in the declared section",
    deliWith((deli) => {
      deli.root.members.at(-1)!.members.push(hamMember);
    }),
    /published section contents differ: Drinks/,
  ],
  [
    "with a declared product listed twice in the declared section",
    deliWith((deli) => {
      deli.root.members.at(-1)!.members.push(colaMember);
    }),
    /published section contents differ: Drinks/,
  ],
  [
    "with other names on the declared section",
    deliWith((deli) => {
      deli.root.members.at(-1)!.names = { en: "Drinks", es: "Refrescos" };
    }),
    /declared section names differ: Drinks/,
  ],
  [
    "without the declared offer",
    deliWith((deli) => {
      delete deli.offers[colaItem];
    }),
    /declared product not published: cola.webp/,
  ],
  [
    "with the declared offer placed in an existing section",
    deliWith((deli) => {
      deli.offers[colaItem]!.placements = [[cheeses]];
    }),
    /declared section differs: cola.webp/,
  ],
  [
    "with the declared offer naming another menu",
    deliWith((deli) => {
      deli.offers[colaItem]!.menuId = casa;
    }),
    /declared menu differs: cola.webp/,
  ],
  [
    "with the declared offer at another name",
    deliWith((deli) => {
      deli.offers[colaItem]!.name = "Coke";
    }),
    /declared name differs: cola.webp/,
  ],
  [
    "with the declared offer at another customer name",
    deliWith((deli) => {
      deli.offers[colaItem]!.customerName = { en: "Cola can", es: "Cola" };
    }),
    /declared customerName differs: cola.webp/,
  ],
  [
    "with the declared offer at another kitchen name",
    deliWith((deli) => {
      deli.offers[colaItem]!.kitchenName = "COLA";
    }),
    /declared kitchenName differs: cola.webp/,
  ],
  [
    "with the declared offer at another VAT class",
    deliWith((deli) => {
      deli.offers[colaItem]!.vatClass = "reduced";
    }),
    /declared vatClass differs: cola.webp/,
  ],
  [
    "with the declared offer at another price",
    deliWith((deli) => {
      deli.offers[colaItem]!.unitPrice = "1.60";
    }),
    /declared unitPrice differs: cola.webp/,
  ],
  [
    "with the declared offer at another pricing unit",
    deliWith((deli) => {
      deli.offers[colaItem]!.pricingUnit = "weight";
    }),
    /declared pricingUnit differs: cola.webp/,
  ],
  [
    "with the declared offer at another image",
    deliWith((deli) => {
      deli.offers[colaItem]!.image = "tonic.webp";
    }),
    /declared image differs: cola.webp/,
  ],
  [
    "with the declared offer at a variant at another VAT class",
    deliWith((deli) => {
      deli.offers[colaItem]!.variants = [
        { id: "large", name: "Large", unitPrice: "2.50", vatClass: "reduced" },
      ];
    }),
    /declared variants differs: cola.webp/,
  ],
  [
    "with the declared offer at an offered modifier",
    deliWith((deli) => {
      deli.offers[colaItem]!.offeredModifiers = [{ kind: "options", listId: "ice", labels: [] }];
    }),
    /declared offeredModifiers differs: cola.webp/,
  ],
  [
    "with a declared product offered twice",
    deliWith((deli) => {
      deli.offers[`@menu_items:${stable([menu, cola, 2])}`] = { ...colaOffer };
    }),
    /declared product offered outside its declared menu item: @products:\["cola.webp"\] in @menu_versions:.*Deli/,
  ],
])("refuses a deli document %s", (_, deli, message) => {
  expect(() => madridWithAddedRows(original, seededWith(undefined, deli), [declared])).toThrow(
    message,
  );
});

it("refuses a declared offer published in another menu", () => {
  const seeded = seededWith(undefined, seededDeli, {
    [`@menu_items:${stable([casa, cola])}`]: { ...colaOffer, menuId: casa },
  });
  expect(() => madridWithAddedRows(original, seeded, [declared])).toThrow(
    /declared product offered outside its declared menu item: @products:\["cola.webp"\] in @menu_versions:.*Casa/,
  );
});

it("refuses a deli document that changed beyond the added section and offers", () => {
  const document = deliWith((deli) => {
    deli.offers[hamItem]!.unitPrice = "4.50";
  });
  expect(() => madridWithAddedRows(original, seededWith(undefined, document), [declared])).toThrow(
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
  ["menu", { menu: "Bar" }, /menu has no single root: Bar/],
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
