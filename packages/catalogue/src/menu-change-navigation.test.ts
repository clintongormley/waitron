import { describe, expect, it } from "vitest";
import type {
  DocumentMember,
  FrozenOffer,
  FrozenOfferVariant,
  FrozenOfferedModifier,
  MenuChangeBody,
  MenuDocument,
  MenuField,
  MenuTarget,
} from "./menu-document-types.js";
import { navigateMenuChanges as navigate } from "./menu-navigation.js";

function navigateMenuChanges(
  live: MenuDocument | null,
  proposed: MenuDocument,
  changes: readonly MenuChangeBody[],
) {
  const result = navigate(live, proposed, changes);
  for (const change of result)
    for (const side of ["before", "after"] as const)
      for (const target of change.targets[side]) {
        const doc = side === "before" ? live : proposed;
        expect(doc).not.toBeNull();
        if (doc === null) throw new Error("before target on first publication");
        if (target.kind === "title") {
          expect(target.menuId).toBe(doc.menuId);
          continue;
        }
        if (target.kind === "home") {
          expect(doc.home[target.device]).toHaveProperty(
            target.field === "shortcuts" ? "columns" : target.field,
          );
          continue;
        }
        let members = doc.root.members;
        let node: Extract<DocumentMember, { kind: "section" }> | undefined;
        for (const id of target.sectionIds) {
          node = members.find(
            (m): m is Extract<DocumentMember, { kind: "section" }> =>
              m.kind === "section" && m.sectionId === id,
          );
          expect(node).toBeDefined();
          members = node!.members;
        }
        if (target.kind === "list" || target.kind === "section") continue;
        expect(members).toContainEqual({
          kind: "product",
          menuItemId: target.menuItemId,
          productId: target.productId,
        });
        const dish = doc.offers[target.menuItemId]!;
        expect(dish.productId).toBe(target.productId);
        expect(target.variantId === undefined || target.listId === undefined).toBe(true);
        if (target.variantId !== undefined)
          expect(dish.variants.map((v) => v.id)).toContain(target.variantId);
        if (target.listId !== undefined) {
          const list = dish.offeredModifiers.find((m) => m.id === target.listId);
          expect(list).toBeDefined();
          if (target.extraProductId !== undefined) {
            expect(list!.kind).toBe("extras");
            if (list!.kind === "extras")
              expect(list!.items.map((i) => i.productId)).toContain(target.extraProductId);
          }
          if (target.optionLabelId !== undefined) {
            expect(list!.kind).toBe("options");
            if (list!.kind === "options")
              expect(list!.labels.map((l) => l.id)).toContain(target.optionLabelId);
          }
        }
      }
  return result;
}

const unit = {
  id: "each",
  name: { en: "Each" },
  abbreviation: { en: "ea" },
  precision: 0,
  hardwareUnit: null,
} as const;
function offer(id = "soup"): FrozenOffer {
  return {
    id: `mi-${id}`,
    menuId: "lunch",
    productId: id,
    menuName: "Lunch",
    grossPrice: null,
    unitPrice: "2.00",
    name: "Staff soup",
    customerName: { en: "Guest soup", es: "Sopa" },
    kitchenName: "SOUP HOT",
    image: null,
    description: { en: "Warm", es: "Caliente" },
    color: null,
    unit,
    vatClass: "general",
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
    ordering: "public",
    placements: [["drinks"], ["favourites", "drinks"]],
    variants: [],
    offeredModifiers: [],
  };
}
function section(
  id: string,
  members: DocumentMember[] = [],
): Extract<DocumentMember, { kind: "section" }> {
  return {
    kind: "section",
    sectionId: id,
    internalName: "Same",
    names: { en: "Guest", es: "Invitado" },
    image: null,
    color: null,
    members,
  };
}
function document(): MenuDocument {
  const drinks = section("drinks", [{ kind: "product", menuItemId: "mi-soup", productId: "soup" }]);
  return {
    format: 3,
    menuId: "lunch",
    menuName: "Lunch",
    root: { members: [drinks, section("favourites", [drinks])] },
    offers: { "mi-soup": offer() },
    home: {
      shortcuts: [],
      handheld: { columns: 3, tiles: "colours", order: "home_first" },
      till: { columns: 4, tiles: "thumbnails", order: "menu_first" },
    },
  };
}
function target(
  field: MenuField = { kind: "summary" },
  ids: Partial<Extract<MenuTarget, { kind: "product" }>> = {},
): Extract<MenuTarget, { kind: "product" }> {
  return {
    kind: "product",
    sectionIds: ["drinks"],
    menuItemId: "mi-soup",
    productId: "soup",
    field,
    ...ids,
  };
}
const repeated = (
  field: MenuField = { kind: "summary" },
  ids: Partial<Extract<MenuTarget, { kind: "product" }>> = {},
): MenuTarget[] => [
  target(field, ids),
  target(field, { ...ids, sectionIds: ["favourites", "drinks"] }),
];
function atOccurrences(
  entries: { field: MenuField; ids?: Partial<Extract<MenuTarget, { kind: "product" }>> }[],
): MenuTarget[] {
  return [["drinks"], ["favourites", "drinks"]].flatMap((sectionIds) =>
    entries.map(({ field, ids }) => target(field, { ...ids, sectionIds })),
  );
}
type BodyWithoutSource<T = MenuChangeBody> = T extends unknown ? Omit<T, "source"> : never;
function change(body: BodyWithoutSource): MenuChangeBody {
  return { ...body, source: "this_menu" };
}
function soup(doc: MenuDocument): FrozenOffer {
  return doc.offers["mi-soup"]!;
}

// Dropping occurrence paths or inferring addresses from display names must fail these exact targets.
describe("navigateMenuChanges", () => {
  it("addresses additions, removals and moves on their actual sides without inventing a first publication's before view", () => {
    const live = document(),
      proposed = document();
    const bodies = [
      change({ kind: "product_added", productId: "soup", name: "Same", under: [] }),
      change({ kind: "product_removed", productId: "soup", name: "Same", under: [] }),
      change({ kind: "product_deleted", productId: "soup", name: "Same" }),
      change({ kind: "product_moved", productId: "soup", name: "Same", from: [], to: [] }),
    ];
    expect(navigateMenuChanges(live, proposed, bodies).map((c) => c.targets)).toEqual([
      { before: [], after: repeated() },
      { before: repeated(), after: [] },
      { before: repeated(), after: [] },
      { before: repeated(), after: repeated() },
    ]);
    expect(
      navigateMenuChanges(null, proposed, bodies).every((c) => c.targets.before.length === 0),
    ).toBe(true);
    expect(new Set(navigateMenuChanges(live, proposed, bodies).map((c) => c.id)).size).toBe(4);
  });

  it("addresses exact section paths, every repeated order list, root order, Home subfields and title", () => {
    const live = document(),
      proposed = document();
    proposed.home.handheld.columns = 5;
    proposed.home.handheld.order = "menu_first";
    const bodies = [
      change({
        kind: "section_added",
        sectionId: "drinks",
        parentSectionIds: ["favourites"],
        name: "Same",
        under: [],
      }),
      change({
        kind: "section_removed",
        sectionId: "drinks",
        parentSectionIds: [],
        name: "Same",
        under: [],
      }),
      change({ kind: "order_changed", listSectionId: "drinks", list: [] }),
      change({ kind: "order_changed", listSectionId: null, list: [] }),
      change({ kind: "home_shortcuts_changed" }),
      change({ kind: "home_display_changed", device: "handheld" }),
      change({ kind: "menu_renamed", from: "Old", to: "New" }),
    ];
    const lists: MenuTarget[] = [
      { kind: "list", sectionIds: ["drinks"] },
      { kind: "list", sectionIds: ["favourites", "drinks"] },
    ];
    const home: MenuTarget[] = [
      { kind: "home", device: "handheld", field: "shortcuts" },
      { kind: "home", device: "till", field: "shortcuts" },
    ];
    expect(navigateMenuChanges(live, proposed, bodies).map((c) => c.targets)).toEqual([
      {
        before: [],
        after: [
          { kind: "section", sectionIds: ["favourites", "drinks"], field: { kind: "summary" } },
        ],
      },
      {
        before: [{ kind: "section", sectionIds: ["drinks"], field: { kind: "summary" } }],
        after: [],
      },
      { before: lists, after: lists },
      { before: [{ kind: "list", sectionIds: [] }], after: [{ kind: "list", sectionIds: [] }] },
      { before: home, after: home },
      {
        before: [
          { kind: "home", device: "handheld", field: "columns" },
          { kind: "home", device: "handheld", field: "order" },
        ],
        after: [
          { kind: "home", device: "handheld", field: "columns" },
          { kind: "home", device: "handheld", field: "order" },
        ],
      },
      { before: [{ kind: "title", menuId: "lunch" }], after: [{ kind: "title", menuId: "lunch" }] },
    ]);
  });

  it("targets only the changed section name audience/language, image and colour", () => {
    const live = document(),
      proposed = structuredClone(live);
    const node = proposed.root.members[0]!;
    if (node.kind !== "section") throw new Error("section fixture");
    node.internalName = "New staff";
    node.names.es = "Nuevo";
    node.image = "new.webp";
    node.color = "red";
    const [result] = navigateMenuChanges(live, proposed, [
      change({
        kind: "section_changed",
        sectionId: "drinks",
        name: "New",
        fields: ["names", "image", "color"],
      }),
    ]);
    const fields: MenuField[] = [
      { kind: "name", audience: "staff" },
      { kind: "name", audience: "customer", language: "es" },
      { kind: "image" },
      { kind: "color" },
    ];
    const expected = [["drinks"], ["favourites", "drinks"]].flatMap((sectionIds) =>
      fields.map((field) => ({ kind: "section" as const, sectionIds, field })),
    );
    expect(result!.targets).toEqual({ before: expected, after: expected });
  });

  it("distinguishes effective price from a raw override even when the effective amounts are equal", () => {
    const live = document(),
      proposed = document();
    soup(proposed).grossPrice = "2.00";
    const body = change({
      kind: "price_changed",
      productId: "soup",
      name: "Same",
      from: "2.00",
      to: "2.00",
    });
    expect(navigateMenuChanges(live, proposed, [body])[0]!.targets).toEqual({
      before: repeated({ kind: "override" }),
      after: repeated({ kind: "override" }),
    });
    soup(proposed).unitPrice = "3.00";
    expect(navigateMenuChanges(live, proposed, [body])[0]!.targets).toEqual({
      before: atOccurrences([{ field: { kind: "price" } }, { field: { kind: "override" } }]),
      after: atOccurrences([{ field: { kind: "price" } }, { field: { kind: "override" } }]),
    });
  });

  it.each([
    [
      "names",
      (o: FrozenOffer) => {
        o.name = "New staff";
        o.kitchenName = "NEW KITCHEN";
        o.customerName = { en: "Guest soup", de: "Stored DE" };
      },
      [
        { kind: "name", audience: "staff" },
        { kind: "name", audience: "customer", language: "de" },
        { kind: "name", audience: "customer", language: "es" },
        { kind: "name", audience: "kitchen" },
      ],
    ],
    [
      "description",
      (o: FrozenOffer) => {
        o.description = { en: "Warm", es: "Nuevo" };
      },
      [{ kind: "description", language: "es" }],
    ],
    [
      "image",
      (o: FrozenOffer) => {
        o.image = "new.webp";
      },
      [{ kind: "image" }],
    ],
    [
      "color",
      (o: FrozenOffer) => {
        o.color = "blue";
      },
      [{ kind: "color" }],
    ],
    [
      "unit",
      (o: FrozenOffer) => {
        o.unit = { ...unit, id: "kg" };
      },
      [{ kind: "unit" }],
    ],
    [
      "allergens",
      (o: FrozenOffer) => {
        o.allergens = { milk: { presence: "contains", source: "cream" } };
      },
      [{ kind: "allergens" }],
    ],
    [
      "diet",
      (o: FrozenOffer) => {
        o.dietaryDeclarations = ["vegan"];
      },
      [{ kind: "diet" }],
    ],
    [
      "vat",
      (o: FrozenOffer) => {
        o.vatClass = "reduced";
      },
      [{ kind: "vat" }],
    ],
    [
      "ordering",
      (o: FrozenOffer) => {
        o.ordering = "staff_only";
      },
      [{ kind: "ordering" }],
    ],
  ] as const)(
    "addresses changed product %s without targeting unchanged languages",
    (field, edit, fields) => {
      const live = document(),
        proposed = document();
      edit(soup(proposed));
      const [result] = navigateMenuChanges(live, proposed, [
        change({ kind: "product_changed", productId: "soup", name: "Same", fields: [field] }),
      ]);
      const before = fields
        .filter((f) => !(f.kind === "name" && "language" in f && f.language === "de"))
        .flatMap((f) => [{ field: f }]);
      const after = fields
        .filter((f) => !(f.kind === "name" && "language" in f && f.language === "es"))
        .flatMap((f) => [{ field: f }]);
      expect(result!.targets).toEqual({
        before: atOccurrences(before),
        after: atOccurrences(after),
      });
    },
  );

  it("keeps row identity independent of wording, values, alsoOn and document order", () => {
    const live = document(),
      proposed = document();
    soup(proposed).image = "first.webp";
    const body = change({
      kind: "product_changed",
      productId: "soup",
      name: "Old wording",
      fields: ["image"],
    });
    const first = navigateMenuChanges(live, proposed, [body])[0]!;
    proposed.root.members.reverse();
    soup(proposed).image = "second.webp";
    const second = navigateMenuChanges(live, proposed, [
      { ...body, name: "New wording", alsoOn: ["Other"] } as MenuChangeBody,
    ])[0]!;
    expect(second.id).toBe(first.id);
    expect(first.targets.after).toEqual(repeated({ kind: "image" }));
    expect(second.targets.after).toEqual([...repeated({ kind: "image" })].reverse());
    expect(live).toEqual(document());
  });
});

function variant(id: string): FrozenOfferVariant {
  const base = offer();
  return {
    id,
    name: `Staff ${id}`,
    customerName: { en: `Guest ${id}`, es: `Invitado ${id}` },
    kitchenName: `KITCHEN ${id}`,
    image: null,
    unitPrice: base.unitPrice,
    menuPrice: null,
    unit,
    pricingUnit: "each",
    vatClass: "general",
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
  };
}
function extras(id: string): Extract<FrozenOfferedModifier, { kind: "extras" }> {
  return {
    kind: "extras",
    id,
    name: `Staff ${id}`,
    customerName: { en: `Guest ${id}` },
    kitchenName: `KITCHEN ${id}`,
    minPicks: 0,
    maxPicks: null,
    items: [
      {
        productId: "lemon",
        name: "Staff lemon",
        customerName: { en: "Guest lemon", es: "Limón" },
        kitchenName: "LEMON",
        image: null,
        portion: "1.000",
        unit,
        price: "0.50",
        vatClass: "general",
        maxQuantity: null,
        preselected: false,
        addAllergens: null,
        suitableFor: [],
      },
    ],
  };
}
function options(): Extract<FrozenOfferedModifier, { kind: "options" }> {
  return {
    kind: "options",
    id: "ice",
    name: "Staff ice",
    customerName: { en: "Guest ice" },
    kitchenName: "ICE",
    defaultLabelId: "yes",
    labels: [
      {
        id: "yes",
        name: "Staff yes",
        customerName: { en: "Guest yes", es: "Sí" },
        kitchenName: "YES",
      },
      { id: "no", name: "Staff no", customerName: { en: "Guest no" }, kitchenName: "NO" },
    ],
  };
}

describe("nested change subjects", () => {
  it("targets one changed variant field and override, retaining before-only removed and after-only added variants", () => {
    const live = document(),
      proposed = document();
    soup(live).variants = [variant("small"), variant("large"), variant("removed")];
    soup(proposed).variants = [variant("small"), variant("large"), variant("added")];
    soup(proposed).variants[1]!.image = "large.webp";
    soup(proposed).variants[1]!.menuPrice = "2.00";
    const [result] = navigateMenuChanges(live, proposed, [
      change({ kind: "product_changed", productId: "soup", name: "Same", fields: ["variants"] }),
    ]);
    expect(result!.targets).toEqual({
      before: atOccurrences([
        { field: { kind: "variants" } },
        { field: { kind: "image" }, ids: { variantId: "large" } },
        { field: { kind: "override" }, ids: { variantId: "large" } },
        { field: { kind: "summary" }, ids: { variantId: "removed" } },
      ]),
      after: atOccurrences([
        { field: { kind: "variants" } },
        { field: { kind: "image" }, ids: { variantId: "large" } },
        { field: { kind: "override" }, ids: { variantId: "large" } },
        { field: { kind: "summary" }, ids: { variantId: "added" } },
      ]),
    });
  });
  it("addresses only the changed option label language and default, not an unchanged label", () => {
    const live = document(),
      proposed = document();
    const old = options(),
      next = options();
    next.labels[0]!.customerName!.es = "Nuevo";
    next.defaultLabelId = "no";
    soup(live).offeredModifiers = [old];
    soup(proposed).offeredModifiers = [next];
    const [result] = navigateMenuChanges(live, proposed, [
      change({ kind: "product_changed", productId: "soup", name: "Same", fields: ["options"] }),
    ]);
    const expected = atOccurrences([
      { field: { kind: "default" }, ids: { listId: "ice" } },
      {
        field: { kind: "name", audience: "customer", language: "es" },
        ids: { listId: "ice", optionLabelId: "yes" },
      },
    ]);
    expect(result!.targets).toEqual({ before: expected, after: expected });
  });
  it("addresses extras limits, item price and preselection without highlighting another list's identical product", () => {
    const live = document(),
      proposed = document();
    const old = extras("citrus"),
      next = extras("citrus");
    next.maxPicks = 2;
    next.items[0]!.price = "0.75";
    next.items[0]!.preselected = true;
    soup(live).offeredModifiers = [old, extras("second")];
    soup(proposed).offeredModifiers = [next, extras("second")];
    const [result] = navigateMenuChanges(live, proposed, [
      change({ kind: "product_changed", productId: "soup", name: "Same", fields: ["extras"] }),
    ]);
    const expected = atOccurrences([
      { field: { kind: "limits" }, ids: { listId: "citrus" } },
      { field: { kind: "price" }, ids: { listId: "citrus", extraProductId: "lemon" } },
      { field: { kind: "default" }, ids: { listId: "citrus", extraProductId: "lemon" } },
    ]);
    expect(result!.targets).toEqual({ before: expected, after: expected });
  });
  it.each([
    ["extra_unit_changed", "unit"],
    ["extra_portion_changed", "portion"],
    ["extra_max_quantity_changed", "maxQuantity"],
  ] as const)("addresses %s through every parent occurrence on the named list", (kind, field) => {
    const live = document(),
      proposed = document();
    for (const doc of [live, proposed]) {
      soup(doc).offeredModifiers = [extras("citrus"), extras("second")];
      doc.root.members.push({ kind: "product", menuItemId: "mi-water", productId: "water" });
      doc.offers["mi-water"] = {
        ...offer("water"),
        placements: [[]],
        offeredModifiers: [extras("citrus")],
      };
    }
    const identity = {
      productId: "lemon",
      name: "Same",
      listId: "citrus",
      listName: "Same",
      source: "shared_product" as const,
    };
    const body: MenuChangeBody =
      kind === "extra_unit_changed"
        ? {
            ...identity,
            kind,
            from: { abbreviation: { en: "ea" }, precision: 0 },
            to: { abbreviation: { en: "kg" }, precision: 3 },
          }
        : kind === "extra_portion_changed"
          ? {
              ...identity,
              kind,
              from: { portion: "1.000", abbreviation: { en: "ea" } },
              to: { portion: "2.000", abbreviation: { en: "ea" } },
            }
          : { ...identity, kind, from: null, to: 1 };
    for (const dish of Object.values(proposed.offers))
      for (const list of dish.offeredModifiers) {
        if (list.kind !== "extras" || list.id !== "citrus") continue;
        const item = list.items[0]!;
        if (kind === "extra_unit_changed")
          item.unit = {
            ...unit,
            id: "kg",
            abbreviation: { en: "kg" },
            precision: 3,
            hardwareUnit: "kg",
          };
        else if (kind === "extra_portion_changed") item.portion = "2.000";
        else item.maxQuantity = 1;
      }
    const [result] = navigateMenuChanges(live, proposed, [body]);
    const expected = [
      ...repeated({ kind: field }, { listId: "citrus", extraProductId: "lemon" }),
      {
        kind: "product",
        sectionIds: [],
        menuItemId: "mi-water",
        productId: "water",
        listId: "citrus",
        extraProductId: "lemon",
        field: { kind: field },
      },
    ];
    expect(result!.targets).toEqual({ before: expected, after: expected });
  });
  it("deletion includes standalone and every extra context on two parent dishes and two lists", () => {
    const live = document(),
      proposed = document();
    soup(live).offeredModifiers = [extras("citrus"), extras("second")];
    live.root.members.push(
      { kind: "product", menuItemId: "mi-water", productId: "water" },
      { kind: "product", menuItemId: "mi-lemon", productId: "lemon" },
    );
    live.offers["mi-water"] = {
      ...offer("water"),
      placements: [[]],
      offeredModifiers: [extras("citrus")],
    };
    live.offers["mi-lemon"] = { ...offer("lemon"), placements: [[]] };
    const [result] = navigateMenuChanges(live, proposed, [
      { kind: "product_deleted", productId: "lemon", name: "Same", source: "shared_product" },
    ]);
    expect(result!.targets).toEqual({
      before: [
        target({ kind: "summary" }, { listId: "citrus", extraProductId: "lemon" }),
        target({ kind: "summary" }, { listId: "second", extraProductId: "lemon" }),
        target(
          { kind: "summary" },
          { sectionIds: ["favourites", "drinks"], listId: "citrus", extraProductId: "lemon" },
        ),
        target(
          { kind: "summary" },
          { sectionIds: ["favourites", "drinks"], listId: "second", extraProductId: "lemon" },
        ),
        {
          kind: "product",
          sectionIds: [],
          menuItemId: "mi-water",
          productId: "water",
          listId: "citrus",
          extraProductId: "lemon",
          field: { kind: "summary" },
        },
        {
          kind: "product",
          sectionIds: [],
          menuItemId: "mi-lemon",
          productId: "lemon",
          field: { kind: "summary" },
        },
      ],
      after: [],
    });
  });
  it("addresses an extra-only translated name edit at its parent, never as a phantom dish", () => {
    const live = document(),
      proposed = document();
    const old = extras("citrus"),
      next = extras("citrus");
    next.items[0]!.customerName!.es = "Nuevo";
    soup(live).offeredModifiers = [old];
    soup(proposed).offeredModifiers = [next];
    const [result] = navigateMenuChanges(live, proposed, [
      {
        kind: "product_changed",
        productId: "lemon",
        name: "Same",
        fields: ["names"],
        source: "shared_product",
      },
    ]);
    const expected = repeated(
      { kind: "name", audience: "customer", language: "es" },
      { listId: "citrus", extraProductId: "lemon" },
    );
    expect(result!.targets).toEqual({ before: expected, after: expected });
  });
});

describe("public diff navigation", () => {
  it("enriches the public diff without changing its frozen document hash input", async () => {
    const { diffMenuDocuments, menuDocumentHash } = await import("./menu-document.js");
    const live = document(),
      proposed = document();
    soup(proposed).grossPrice = "2.00";
    const original = structuredClone(proposed),
      hash = menuDocumentHash(proposed);
    const [result] = diffMenuDocuments(live, proposed);
    expect(result!.targets).toEqual({
      before: repeated({ kind: "override" }),
      after: repeated({ kind: "override" }),
    });
    expect(JSON.parse(result!.id)).toEqual([
      "lunch",
      "price_changed",
      "this_menu",
      null,
      "soup",
      null,
      null,
      null,
      null,
      null,
      null,
      [
        '["product",["drinks"],"mi-soup","soup",null,null,null,null,["override"]]',
        '["product",["favourites","drinks"],"mi-soup","soup",null,null,null,null,["override"]]',
      ],
      [
        '["product",["drinks"],"mi-soup","soup",null,null,null,null,["override"]]',
        '["product",["favourites","drinks"],"mi-soup","soup",null,null,null,null,["override"]]',
      ],
    ]);
    expect(proposed).toEqual(original);
    expect(menuDocumentHash(proposed)).toBe(hash);
  });
});

it("keeps removal rows distinct under identical-name parents and stable after display renaming", () => {
  const live = document(),
    proposed = document();
  const rows: MenuChangeBody[] = [
    {
      kind: "section_removed",
      sectionId: "drinks",
      parentSectionIds: [],
      name: "Same",
      under: [],
      source: "this_menu",
    },
    {
      kind: "section_removed",
      sectionId: "drinks",
      parentSectionIds: ["favourites"],
      name: "Same",
      under: ["Same"],
      source: "this_menu",
    },
  ];
  const result = navigateMenuChanges(live, proposed, rows);
  expect(result[0]!.id).not.toBe(result[1]!.id);
  expect(result[0]!.targets.before).toEqual([
    { kind: "section", sectionIds: ["drinks"], field: { kind: "summary" } },
  ]);
  expect(result[1]!.targets.before).toEqual([
    { kind: "section", sectionIds: ["favourites", "drinks"], field: { kind: "summary" } },
  ]);
  expect(
    navigateMenuChanges(
      live,
      proposed,
      rows.map((c) => ({ ...c, name: "Renamed", under: ["Renamed"] })),
    ).map((c) => c.id),
  ).toEqual(result.map((c) => c.id));
});

it("targets only present sides of added/removed extras and option labels, retaining group order targets", () => {
  const live = document(),
    proposed = document();
  const old = extras("citrus"),
    next = extras("citrus");
  next.items = [];
  const oldOptions = options(),
    nextOptions = options();
  nextOptions.defaultLabelId = null;
  nextOptions.labels = [
    oldOptions.labels[1]!,
    { id: "new", name: "New", customerName: null, kitchenName: null },
  ];
  soup(live).offeredModifiers = [old, extras("removed"), oldOptions];
  soup(proposed).offeredModifiers = [next, nextOptions, extras("added")];
  const [result] = navigateMenuChanges(live, proposed, [
    {
      kind: "product_changed",
      productId: "soup",
      name: "Same",
      fields: ["extras", "options"],
      source: "shared_product",
    },
  ]);
  expect(result!.targets).toEqual({
    before: atOccurrences([
      { field: { kind: "extras" } },
      { field: { kind: "members" }, ids: { listId: "citrus" } },
      { field: { kind: "summary" }, ids: { listId: "citrus", extraProductId: "lemon" } },
      { field: { kind: "extras" }, ids: { listId: "removed" } },
      { field: { kind: "default" }, ids: { listId: "ice" } },
      { field: { kind: "members" }, ids: { listId: "ice" } },
      { field: { kind: "summary" }, ids: { listId: "ice", optionLabelId: "yes" } },
    ]),
    after: atOccurrences([
      { field: { kind: "extras" } },
      { field: { kind: "members" }, ids: { listId: "citrus" } },
      { field: { kind: "extras" }, ids: { listId: "added" } },
      { field: { kind: "default" }, ids: { listId: "ice" } },
      { field: { kind: "members" }, ids: { listId: "ice" } },
      { field: { kind: "summary" }, ids: { listId: "ice", optionLabelId: "new" } },
    ]),
  });
});

it("targets changed extras-list names and explicit zero limits while unchanged fields have no targets", () => {
  const live = document(),
    proposed = document();
  const old = extras("citrus"),
    next = extras("citrus");
  next.name = "New staff";
  next.customerName = { en: "New guest" };
  next.kitchenName = "NEW";
  next.minPicks = 1;
  next.maxPicks = 0;
  soup(live).offeredModifiers = [old];
  soup(proposed).offeredModifiers = [next];
  const [result] = navigateMenuChanges(live, proposed, [
    {
      kind: "product_changed",
      productId: "soup",
      name: "Same",
      fields: ["extras", "variants", "options", "image"],
      source: "shared_product",
    },
  ]);
  const expected = atOccurrences([
    { field: { kind: "name", audience: "staff" }, ids: { listId: "citrus" } },
    { field: { kind: "name", audience: "customer", language: "en" }, ids: { listId: "citrus" } },
    { field: { kind: "name", audience: "kitchen" }, ids: { listId: "citrus" } },
    { field: { kind: "limits" }, ids: { listId: "citrus" } },
  ]);
  expect(result!.targets).toEqual({ before: expected, after: expected });
});

it("keeps unresolved change rows distinct by their subject and fields without using display wording", () => {
  const doc = document();
  const bodies: MenuChangeBody[] = [
    change({ kind: "product_changed", productId: "alpha", name: "Same", fields: ["names"] }),
    change({ kind: "product_changed", productId: "beta", name: "Same", fields: ["names"] }),
    change({ kind: "product_changed", productId: "alpha", name: "Same", fields: ["image"] }),
    change({
      kind: "section_added",
      sectionId: "absent",
      parentSectionIds: ["one"],
      name: "Same",
      under: [],
    }),
    change({
      kind: "section_added",
      sectionId: "absent",
      parentSectionIds: ["two"],
      name: "Same",
      under: [],
    }),
  ];
  const rows = navigateMenuChanges(doc, doc, bodies);
  expect(rows.map((row) => row.targets)).toEqual(bodies.map(() => ({ before: [], after: [] })));
  expect(new Set(rows.map((row) => row.id)).size).toBe(5);
  expect(
    navigateMenuChanges(
      doc,
      doc,
      bodies.map((body) => ("name" in body ? { ...body, name: "Renamed" } : body)),
    ).map((row) => row.id),
  ).toEqual(rows.map((row) => row.id));
});
