import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { madridWithSharedOffers, type MadridSharedOffers } from "./madrid-shared-offers.js";
import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";

type Row = Record<string, unknown>;
const digest = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const table = (rows: Record<string, Row>) => ({ columns: [], foreignKeys: [], rows });

const drinksMenu = '@catalogues:["Drinks"]';
const deliMenu = '@catalogues:["Deli"]';
const deli = '@departments:["Deli"]';
const soft = '@categories:["Soft"]';
const softSection = `@sections:${stable([drinksMenu, "section", "Soft"])}`;
const deliRoot = `@sections:${stable([deliMenu, "menu_root", "Deli"])}`;
const deliDrinks = `@sections:${stable([deliMenu, "section", "Drinks"])}`;
const cola = '@products:["cola.webp"]';
const zero = '@products:["zero.webp"]';
const item = (menu: string, product: string) => `@menu_items:${stable([menu, product])}`;
const member = (section: string, position: number) =>
  `@section_members:${stable([section, position])}`;
const drinksVersion = `@menu_versions:${stable([drinksMenu, 1])}`;
const deliVersion = `@menu_versions:${stable([deliMenu, 1])}`;

const offer = (menu: string, product: string, fields: Row) => ({
  productId: product,
  menuId: menu,
  ...fields,
});
const colaFields = {
  name: "Cola",
  vatClass: "reduced",
  takeawayVatClass: "reduced",
  unitPrice: "2.50",
};
const zeroFields = {
  name: "Zero",
  customerName: { en: "Zero can" },
  kitchenName: "ZERO",
  vatClass: "reduced",
  takeawayVatClass: "general",
  unitPrice: "1.80",
  pricingUnit: "each",
  image: "zero.webp",
};
const productMember = (menu: string, product: string) => ({
  kind: "product",
  menuItemId: item(menu, product),
  productId: product,
});

function semantics(seeded: boolean, edit: (tables: Record<string, Row>) => void = () => {}) {
  const drinks = {
    offers: {
      [item(drinksMenu, cola)]: offer(drinksMenu, cola, {
        ...colaFields,
        takeawayVatClass: seeded ? "general" : "reduced",
      }),
      ...(seeded ? { [item(drinksMenu, zero)]: offer(drinksMenu, zero, zeroFields) } : {}),
    } as Record<string, Row>,
    root: {
      members: [
        {
          kind: "section",
          sectionId: softSection,
          members: [
            productMember(drinksMenu, cola),
            ...(seeded ? [productMember(drinksMenu, zero)] : []),
          ],
        },
      ],
    },
  };
  const deliDocument = {
    offers: (seeded
      ? {
          [item(deliMenu, cola)]: offer(deliMenu, cola, {
            ...colaFields,
            takeawayVatClass: "general",
          }),
          [item(deliMenu, zero)]: offer(deliMenu, zero, zeroFields),
        }
      : {}) as Record<string, Row>,
    root: {
      members: seeded
        ? [
            {
              kind: "section",
              sectionId: deliDrinks,
              members: [productMember(deliMenu, cola), productMember(deliMenu, zero)],
            },
          ]
        : [],
    },
  };
  const rows: Record<string, Record<string, Row>> = {
    departments: { [deli]: { id: deli, dining: seeded ? "takeaway" : "eat_in" } },
    products: {
      [cola]: { id: cola, category_id: soft, takeaway_vat_class: seeded ? "general" : null },
      ...(seeded
        ? {
            [zero]: {
              id: zero,
              category_id: soft,
              course_id: null,
              name: "Zero",
              customer_name: { en: "Zero can" },
              kitchen_name: "ZERO",
              vat_class: "reduced",
              takeaway_vat_class: "general",
              unit_price: 180,
              pricing_unit: "each",
              image: "zero.webp",
            },
          }
        : {}),
    },
    sections: {
      [softSection]: { id: softSection },
      [deliRoot]: { id: deliRoot },
      ...(seeded ? { [deliDrinks]: { id: deliDrinks } } : {}),
    },
    section_members: {
      [member(softSection, 0)]: {
        section_id: softSection,
        product_id: cola,
        child_section_id: null,
      },
      ...(seeded
        ? {
            [member(softSection, 1)]: {
              section_id: softSection,
              product_id: zero,
              child_section_id: null,
            },
            [member(deliRoot, 0)]: {
              section_id: deliRoot,
              product_id: null,
              child_section_id: deliDrinks,
            },
            [member(deliDrinks, 0)]: {
              section_id: deliDrinks,
              product_id: cola,
              child_section_id: null,
            },
            [member(deliDrinks, 1)]: {
              section_id: deliDrinks,
              product_id: zero,
              child_section_id: null,
            },
          }
        : {}),
    },
    menu_items: {
      [item(drinksMenu, cola)]: { menu_id: drinksMenu, product_id: cola },
      ...(seeded
        ? {
            [item(drinksMenu, zero)]: { menu_id: drinksMenu, product_id: zero },
            [item(deliMenu, cola)]: { menu_id: deliMenu, product_id: cola },
            [item(deliMenu, zero)]: { menu_id: deliMenu, product_id: zero },
          }
        : {}),
    },
  };
  for (const value of Object.values(rows))
    for (const [key, row] of Object.entries(value)) row.id ??= key;
  edit(rows as Record<string, Row>);
  const documents = { [drinksVersion]: drinks, [deliVersion]: deliDocument };
  const result: CanonicalMadridSemantics = {
    tables: Object.fromEntries(Object.entries(rows).map(([name, value]) => [name, table(value)])),
  };
  result.tables.menu_versions = table(
    Object.fromEntries(
      Object.entries(documents).map(([id, document]) => [
        id,
        { id, content_hash: digest(document), document },
      ]),
    ),
  );
  return result;
}

const declared: MadridSharedOffers = {
  changed: [
    { table: "departments", row: deli, column: "dining", from: "eat_in", to: "takeaway" },
    { table: "products", row: cola, column: "takeaway_vat_class", from: null, to: "general" },
  ],
  products: [
    {
      image: "zero.webp",
      name: "Zero",
      customerName: { en: "Zero can" },
      kitchenName: "ZERO",
      category: "Soft",
      courseId: null,
      vatClass: "reduced",
      takeawayVatClass: "general",
      unitPrice: 180,
      pricingUnit: "each",
    },
  ],
  added: {
    products: [[zero]],
    sections: [[deliDrinks]],
    section_members: [
      [softSection, zero, null],
      [deliRoot, null, deliDrinks],
      [deliDrinks, cola, null],
      [deliDrinks, zero, null],
    ],
    menu_items: [
      [drinksMenu, zero],
      [deliMenu, cola],
      [deliMenu, zero],
    ],
  },
  changedOffers: [
    { menuItem: item(drinksMenu, cola), field: "takeawayVatClass", from: "reduced", to: "general" },
  ],
};

it("takes the declared changes and additions, and counts the added rows", () => {
  const seeded = semantics(true);
  const { semantics: result, added } = madridWithSharedOffers(semantics(false), seeded, declared);
  expect(result).toEqual(seeded);
  expect(added).toEqual({ products: 1, sections: 1, section_members: 4, menu_items: 3 });
});

it("compares the declared course and its department firing policy", () => {
  const before = semantics(false);
  before.tables.kitchen_courses = table({});
  before.tables.department_courses = table({});
  const after = semantics(true);
  const drinks = '@kitchen_courses:["Drinks"]';
  after.tables.kitchen_courses = table({
    [drinks]: { id: drinks, name: "Drinks", display_order: 5 },
  });
  const firePolicy = {
    department_id: deli,
    course_id: drinks,
    held_until_fired: 0,
    reminder_minutes: 10,
  };
  after.tables.department_courses = table({ [stable(firePolicy)]: firePolicy });
  const changes = {
    ...declared,
    added: {
      ...declared.added,
      kitchen_courses: [[drinks, 5]],
      department_courses: [[deli, drinks, 0, 10]],
    },
  };
  expect(madridWithSharedOffers(before, after, changes).semantics).toEqual(after);
  firePolicy.reminder_minutes = 99;
  expect(() => madridWithSharedOffers(before, after, changes)).toThrow(
    "Madrid added rows differ: department_courses",
  );
  firePolicy.reminder_minutes = 10;
  firePolicy.held_until_fired = 1;
  expect(() => madridWithSharedOffers(before, after, changes)).toThrow(
    "Madrid added rows differ: department_courses",
  );
});

it("compares a published holder after declaring its removed section and added set menu", () => {
  const before = semantics(false);
  const after = semantics(true);
  const old = '@sections:["old-lunch"]';
  before.tables.sections!.rows[old] = { id: old };
  const captured = before.tables.menu_versions!.rows[deliVersion]!.document as {
    root: { members: Row[] };
  };
  captured.root.members.push({ kind: "section", sectionId: old, members: [] });
  const version = after.tables.menu_versions!.rows[deliVersion]!;
  const document = version.document as { root: { members: Row[] }; setMenus?: Row };
  const setId = '@catalogues:["Lunch set"]';
  document.setMenus = { [setId]: { name: "Lunch set" } };
  const member = { kind: "set_menu", menuId: setId, name: "Lunch set" };
  document.root.members.push(member);
  version.content_hash = digest(document);
  const changes: MadridSharedOffers = {
    ...declared,
    removed: { sections: [old] },
    setMenus: { [deliVersion]: [setId] },
  };
  const result = madridWithSharedOffers(before, after, changes);
  expect(result.semantics).toEqual(after);
  expect(result.removed).toEqual({ sections: 1 });

  document.root.members.push(member);
  expect(() => madridWithSharedOffers(before, after, changes)).toThrow(
    "Madrid set-menu members differ",
  );
  document.root.members.pop();
  delete document.setMenus[setId];
  expect(() => madridWithSharedOffers(before, after, changes)).toThrow(
    "Madrid set-menu copies differ",
  );
  const wrong = { ...changes, removed: { sections: [old, softSection] } };
  expect(() => madridWithSharedOffers(before, after, wrong)).toThrow(
    "Madrid declared removal differs",
  );
});

it("refuses an existing cell changed beyond the declaration", () => {
  const seeded = semantics(true, (rows) => {
    (rows.products as Record<string, Row>)[cola]!.category_id = '@categories:["Other"]';
  });
  expect(() => madridWithSharedOffers(semantics(false), seeded, declared)).toThrow(
    `Madrid row changed: products ${cola} category_id`,
  );
});

it("refuses a declared cell change the seed did not make", () => {
  const seeded = semantics(true, (rows) => {
    (rows.departments as Record<string, Row>)[deli]!.dining = "eat_in";
  });
  expect(() => madridWithSharedOffers(semantics(false), seeded, declared)).toThrow(
    `Madrid declared change differs: departments ${deli} dining`,
  );
});

it("refuses an added row nobody declared, and a declared one the seed did not add", () => {
  const extra = semantics(true, (rows) => {
    (rows.menu_items as Record<string, Row>)['@menu_items:["stray"]'] = {
      menu_id: deliMenu,
      product_id: '@products:["stray.webp"]',
    };
  });
  expect(() => madridWithSharedOffers(semantics(false), extra, declared)).toThrow(
    "Madrid added rows differ: menu_items",
  );
  const missing = { ...declared, added: { ...declared.added, products: [[zero], [cola]] } };
  expect(() => madridWithSharedOffers(semantics(false), semantics(true), missing)).toThrow(
    "Madrid added rows differ: products",
  );
});

it("refuses a declared product whose seeded row or published offer differs", () => {
  const wrongRow = {
    ...declared,
    products: [{ ...declared.products[0]!, takeawayVatClass: "reduced" }],
  };
  expect(() => madridWithSharedOffers(semantics(false), semantics(true), wrongRow)).toThrow(
    "Madrid declared takeawayVatClass differs: zero.webp",
  );
});

it("checks the declared course for a newly added product", () => {
  const changes = {
    ...declared,
    products: [{ ...declared.products[0]!, courseId: '@kitchen_courses:["Drinks"]' }],
  };
  expect(() => madridWithSharedOffers(semantics(false), semantics(true), changes)).toThrow(
    "Madrid declared course differs: zero.webp",
  );
});

it("refuses a published document changed beyond the declaration, and an offer change not published", () => {
  const seeded = semantics(true);
  const document = seeded.tables.menu_versions!.rows[drinksVersion]!.document as {
    offers: Record<string, Row>;
  };
  document.offers[item(drinksMenu, cola)]!.unitPrice = "3.00";
  expect(() => madridWithSharedOffers(semantics(false), seeded, declared)).toThrow(
    `Madrid published document changed beyond the declaration: ${drinksVersion}`,
  );
  const unpublished = {
    ...declared,
    changedOffers: [
      ...declared.changedOffers,
      { menuItem: '@menu_items:["nowhere"]', field: "takeawayVatClass", from: "a", to: "b" },
    ],
  };
  expect(() => madridWithSharedOffers(semantics(false), semantics(true), unpublished)).toThrow(
    'Madrid declared offer change not published: @menu_items:["nowhere"]',
  );
});

it("refuses a table or an existing row the seed lost, and a declared change to no cell", () => {
  const extraTable = semantics(true);
  extraTable.tables.stray = table({});
  expect(() => madridWithSharedOffers(semantics(false), extraTable, declared)).toThrow(
    "Madrid table added or removed: stray",
  );
  const lostRow = semantics(true, (rows) => {
    delete (rows.menu_items as Record<string, Row>)[item(drinksMenu, cola)];
  });
  expect(() => madridWithSharedOffers(semantics(false), lostRow, declared)).toThrow(
    `Madrid row removed: menu_items ${item(drinksMenu, cola)}`,
  );
  const nowhere = {
    ...declared,
    changed: [
      ...declared.changed,
      { table: "departments", row: '@departments:["None"]', column: "dining", from: 1, to: 2 },
    ],
  };
  expect(() => madridWithSharedOffers(semantics(false), semantics(true), nowhere)).toThrow(
    "Madrid declared change missing",
  );
});
