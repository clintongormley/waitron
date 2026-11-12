import { describe, expect, it } from "vitest";
import {
  defaultMenu,
  activeFilterCount,
  EMPTY_MENU_FILTERS,
  memoVisibleProducts,
  filterProductsByDiet,
  filterProductsByMenu,
  shownMenu,
  visibleProducts,
} from "./menu-filter.js";
import { ALLERGEN_CODES } from "@waitron/shared";
import type { DietProfile, TillProduct } from "./api/client.js";

function product(id: string, catalogueId?: string): TillProduct {
  return {
    id,
    name: id,
    customerName: { en: `${id} for the customer` },
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
    category: null,
    allergens: null,
    ...(catalogueId === undefined ? {} : { catalogueId }),
  };
}

describe("filterProductsByMenu", () => {
  const food = product("bocadillo", "cat-food");
  const drink = product("cerveza", "cat-drinks");
  const products = [food, drink];

  it("returns only the selected menu's products", () => {
    expect(filterProductsByMenu(products, "cat-food")).toEqual([food]);
    expect(filterProductsByMenu(products, "cat-drinks")).toEqual([drink]);
  });

  it('returns EVERY product when no menu is selected (the "" fallback)', () => {
    expect(filterProductsByMenu(products, "")).toEqual(products);
  });

  it("returns nothing when the selected menu matches no product (incl. untagged products)", () => {
    expect(filterProductsByMenu([product("misc")], "cat-food")).toEqual([]);
    expect(filterProductsByMenu(products, "cat-missing")).toEqual([]);
  });
});

function dietProduct(id: string, diet: DietProfile | null | undefined): TillProduct {
  return { ...product(id), ...(diet === undefined ? {} : { diet }) };
}

describe("filterProductsByDiet", () => {
  const veganProduct = dietProduct("ensalada", {
    vegan: "yes",
    vegetarian: "yes",
    contains: [],
  });
  const vegetarianProduct = dietProduct("tortilla", {
    vegan: "no",
    vegetarian: "yes",
    contains: [],
  });
  const meatProduct = dietProduct("chuleta", {
    vegan: "no",
    vegetarian: "no",
    contains: ["meat"],
  });
  const fishProduct = dietProduct("boquerones", {
    vegan: "no",
    vegetarian: "no",
    contains: ["fish"],
  });
  const unknownProduct = dietProduct("misterio", {
    vegan: "unknown",
    vegetarian: "unknown",
    contains: [],
  });
  const noDietProduct = dietProduct("legacy", null);

  it("filterProductsByDiet('vegan') keeps only vegan-yes products", () => {
    const out = filterProductsByDiet([veganProduct, meatProduct], "vegan");
    expect(out).toEqual([veganProduct]);
  });

  it("filterProductsByDiet('vegetarian') keeps vegetarian-yes (vegan and lacto/ovo) products", () => {
    expect(
      filterProductsByDiet([veganProduct, vegetarianProduct, meatProduct], "vegetarian"),
    ).toEqual([veganProduct, vegetarianProduct]);
  });

  it("filterProductsByDiet('no-meat') drops contains-meat products", () => {
    expect(filterProductsByDiet([veganProduct, meatProduct], "no-meat")).toEqual([veganProduct]);
  });

  it("filterProductsByDiet('no-meat') keeps a contains-fish product (fish is not meat)", () => {
    expect(filterProductsByDiet([fishProduct, meatProduct], "no-meat")).toEqual([fishProduct]);
  });

  it("filterProductsByDiet('no-fish') drops contains-fish products", () => {
    expect(filterProductsByDiet([meatProduct, fishProduct], "no-fish")).toEqual([meatProduct]);
  });

  it("excludes an unknown diet from the cautious vegan/vegetarian filters", () => {
    expect(filterProductsByDiet([unknownProduct], "vegan")).toEqual([]);
    expect(filterProductsByDiet([unknownProduct], "vegetarian")).toEqual([]);
  });

  it("keeps an unknown diet under no-meat/no-fish (contains has not recorded the tag)", () => {
    expect(filterProductsByDiet([unknownProduct], "no-meat")).toEqual([unknownProduct]);
    expect(filterProductsByDiet([unknownProduct], "no-fish")).toEqual([unknownProduct]);
  });

  it("drops a null/absent diet from EVERY filter (nothing to assert)", () => {
    for (const p of ["vegan", "vegetarian", "no-meat", "no-fish"] as const) {
      expect(filterProductsByDiet([noDietProduct], p)).toEqual([]);
    }
  });
});

describe("defaultMenu and shownMenu", () => {
  const breakfast = {
    id: "breakfast",
    isDefault: false,
    orderable: true,
    audience: "customer" as const,
  };
  const lunch = { id: "lunch", isDefault: true, orderable: true, audience: "customer" as const };
  const dinner = { id: "dinner", isDefault: false, orderable: true, audience: "customer" as const };

  it("never chooses a retained ended or future menu, even when selected or marked default", () => {
    const ended = { id: "ended", isDefault: true, orderable: false, audience: "customer" as const };
    const staff = { id: "staff", isDefault: false, orderable: true, audience: "staff" as const };
    const customer = {
      id: "customer",
      isDefault: false,
      orderable: true,
      audience: "customer" as const,
    };
    expect(defaultMenu([ended, staff, customer])).toBe(customer);
    expect(shownMenu([ended, staff, customer], "ended")).toBe(customer);
    expect(shownMenu([ended, staff, customer], "staff")).toBe(staff);
    expect(defaultMenu([ended])).toBeUndefined();
    expect(shownMenu([ended], "ended")).toBeUndefined();
  });

  it("takes the menu marked default, wherever it sits", () => {
    expect(defaultMenu([breakfast, lunch, dinner])).toBe(lunch);
  });

  it("takes the first menu when none is marked default, and nothing from no menus", () => {
    expect(defaultMenu([breakfast, dinner])).toBe(breakfast);
    expect(defaultMenu([])).toBeUndefined();
  });

  it("shows the selected menu over the default", () => {
    expect(shownMenu([breakfast, lunch, dinner], "dinner")).toBe(dinner);
  });

  it("shows the default menu when the selection names none of them", () => {
    expect(shownMenu([breakfast, lunch, dinner], "")).toBe(lunch);
    expect(shownMenu([breakfast, dinner], "gone")).toBe(breakfast);
    expect(shownMenu([], "lunch")).toBeUndefined();
  });
});

describe("A738 menu filters", () => {
  it("A738 intersects included diets and excludes selected allergen kinds", () => {
    const vegan = { vegan: "yes", vegetarian: "yes", contains: [] } as const;
    const dishes: TillProduct[] = [
      {
        ...product("almond"),
        diet: { ...vegan, contains: [] },
        allergens: { nuts: { kinds: ["almonds"] } },
      },
      {
        ...product("walnut"),
        diet: { ...vegan, contains: [] },
        allergens: { nuts: { kinds: ["walnuts"] } },
      },
      { ...product("unspecified"), diet: { ...vegan, contains: [] }, allergens: { nuts: {} } },
      {
        ...product("empty-kinds"),
        diet: { ...vegan, contains: [] },
        allergens: { nuts: { kinds: [] } },
      },
      { ...product("fish"), diet: { ...vegan, contains: ["fish"] }, allergens: {} },
      {
        ...product("unknown"),
        diet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
        allergens: {},
      },
      { ...product("unreviewed-allergens"), diet: { ...vegan, contains: [] }, allergens: null },
    ];
    expect(
      visibleProducts(dishes, "", {
        diets: ["vegan", "no-fish"],
        exclude: { nuts: ["walnuts"] },
      }).map((p) => p.id),
    ).toEqual(["almond"]);
  });
});

describe("A738 filter combinations", () => {
  it.each(ALLERGEN_CODES)(
    "A738 excludes declared %s and unreviewed snapshots while retaining reviewed-empty ones",
    (code) => {
      const declared = { ...product("declared"), allergens: { [code]: {} } };
      const clear = { ...product("clear"), allergens: {} };
      const unknown = product("unknown");
      expect(
        visibleProducts([declared, clear, unknown], "", { diets: [], exclude: { [code]: "all" } }),
      ).toEqual([clear]);
    },
  );

  it("A738 combines cereal kinds with other exclusions on the selected offer", () => {
    const products: TillProduct[] = [
      { ...product("rye", "food"), allergens: { gluten: { kinds: ["rye"] } } },
      { ...product("wheat", "food"), allergens: { gluten: { kinds: ["wheat", "rye"] } } },
      { ...product("unspecified", "food"), allergens: { gluten: {} } },
      { ...product("empty", "food"), allergens: { gluten: { kinds: [] } } },
      { ...product("rye-milk", "food"), allergens: { gluten: { kinds: ["rye"] }, milk: {} } },
      { ...product("rye", "drink"), allergens: {} },
    ];
    expect(
      visibleProducts(products, "food", {
        diets: [],
        exclude: { gluten: ["wheat"], milk: "all" },
      }).map((p) => p.id),
    ).toEqual(["rye"]);
    expect(visibleProducts(products, "", { diets: [], exclude: { gluten: [] } })).toEqual(products);
  });

  it("A1517 keeps an unreviewed dish while no allergen exclusion is active", () => {
    const unreviewed = product("unreviewed");
    const products = [unreviewed, { ...product("clear"), allergens: {} }];
    expect(visibleProducts(products, "", { diets: [], exclude: { gluten: [] } })).toBe(products);
    expect(visibleProducts(products, "", EMPTY_MENU_FILTERS)).toBe(products);
  });

  function withVariants(id: string, ...declarations: TillProduct["allergens"][]): TillProduct {
    return {
      ...product(id),
      variants: declarations.map((allergens, index) => ({
        id: `${id}-${index}`,
        name: `${id}-${index}`,
        pricingUnit: "each" as const,
        vatClass: "general" as const,
        category: null,
        allergens,
        unitPrice: "1.00",
        unitPriceDifference: null,
        available: true,
      })),
    };
  }

  it("A1517 keeps a dish reviewed only on its variants and hides one whose variants are unreviewed too", () => {
    expect(
      visibleProducts(
        [
          withVariants("reviewed-variants", null, { nuts: {} }),
          withVariants("unreviewed-variants", null, null),
        ],
        "",
        { diets: [], exclude: { milk: "all" } },
      ).map((p) => p.id),
    ).toEqual(["reviewed-variants"]);
  });

  it("A1517 hides a dish reviewed only on its variants when every reviewed variant declares an excluded allergen", () => {
    expect(
      visibleProducts([withVariants("nutty", null, { nuts: {} })], "", {
        diets: [],
        exclude: { nuts: "all" },
      }),
    ).toEqual([]);
  });

  it("A1517 keeps a dish reviewed only on its variants while one variant passes every exclusion", () => {
    expect(
      visibleProducts(
        [
          withVariants("one-clear", { nuts: {} }, {}),
          withVariants("other-kind", { nuts: { kinds: ["walnuts"] } }),
          withVariants("excluded-kind", { nuts: { kinds: ["almonds"] } }),
        ],
        "",
        { diets: [], exclude: { nuts: ["almonds"] } },
      ).map((p) => p.id),
    ).toEqual(["one-clear", "other-kind"]);
    expect(
      visibleProducts([withVariants("one-clear", { nuts: {} }, {})], "", {
        diets: [],
        exclude: { nuts: "all" },
      }).map((p) => p.id),
    ).toEqual(["one-clear"]);
  });

  it("offers compatible sizes even when their parent declares the excluded allergen, without changing the menu", () => {
    const dish = { ...withVariants("salad", { nuts: {} }, {}, null), allergens: { nuts: {} } };
    const visible = visibleProducts([dish], "", { diets: [], exclude: { nuts: "all" } });
    expect(visible.map((item) => item.id)).toEqual(["salad"]);
    expect(visible[0]!.variants!.map((variant) => variant.id)).toEqual(["salad-1"]);
    expect(dish.variants!.map((variant) => variant.id)).toEqual(["salad-0", "salad-1", "salad-2"]);
  });

  it("hides a clear parent when every actual size declares the excluded allergen", () => {
    const dish = { ...withVariants("cake", { milk: {} }, { milk: {} }), allergens: {} };
    expect(visibleProducts([dish], "", { diets: [], exclude: { milk: "all" } })).toEqual([]);
  });

  it("keeps a sold-out compatible size visible while removing the incompatible available size", () => {
    const dish = { ...withVariants("soup", {}, { milk: {} }), allergens: {} };
    dish.variants![0]!.available = false;
    const visible = visibleProducts([dish], "", { diets: [], exclude: { milk: "all" } });
    expect(visible).toHaveLength(1);
    expect(visible[0]!.variants!.map((variant) => [variant.id, variant.available])).toEqual([
      ["soup-0", false],
    ]);
    expect(dish.variants![1]!.available).toBe(true);
  });

  it("requires enough compatible extra capacity while keeping optional toppings optional", () => {
    const item = (
      id: string,
      maxQuantity: number | null,
      addAllergens: TillProduct["allergens"],
    ) => ({
      productId: id,
      name: id,
      customerName: { en: `${id} customer` },
      kitchenName: `${id} kitchen`,
      presentation: {
        name: id,
        customerName: { en: `${id} customer` },
        kitchenName: `${id} kitchen`,
        variantName: null,
        variantCustomerName: null,
        variantKitchenName: null,
      },
      portion: "1",
      unit: {
        id: "each",
        staffName: "Each",
        staffAbbreviation: "ea",
        name: { en: "Each" },
        abbreviation: { en: "ea" },
        precision: 0,
        hardwareUnit: null,
      },
      price: "1.00",
      vatClass: "general" as const,
      maxQuantity,
      preselected: false,
      addAllergens,
      suitableFor: [],
    });
    const dish: TillProduct = {
      ...product("salad"),
      allergens: {},
      offeredModifiers: [
        {
          kind: "extras",
          id: "toppings",
          name: "Toppings",
          customerName: { en: "Customer toppings" },
          kitchenName: "Kitchen toppings",
          minPicks: 2,
          maxPicks: 3,
          items: [
            item("seeds", 1, {}),
            item("nuts", null, { nuts: {} }),
            item("unknown", null, null),
          ],
        },
      ],
    };
    const filters = { diets: [], exclude: { nuts: "all" as const } };
    expect(visibleProducts([dish], "", filters)).toEqual([]);
    const group = dish.offeredModifiers![0]!;
    if (group.kind !== "extras") throw new Error("expected extras");
    group.items[0]!.maxQuantity = 2;
    expect(visibleProducts([dish], "", filters)).toEqual([dish]);
    group.items[0]!.maxQuantity = null;
    expect(visibleProducts([dish], "", filters)).toEqual([dish]);
    group.items = [];
    group.minPicks = 0;
    expect(visibleProducts([dish], "", filters)).toEqual([dish]);
    group.minPicks = 1;
    expect(visibleProducts([dish], "", EMPTY_MENU_FILTERS)).toEqual([dish]);
  });

  it("A738 leaves empty filters and unchanged immutable memo inputs stable", () => {
    const products = [product("one", "food"), product("two", "drink")];
    expect(visibleProducts(products, "", EMPTY_MENU_FILTERS)).toBe(products);
    const memo = memoVisibleProducts();
    const first = memo(products, "food", EMPTY_MENU_FILTERS);
    expect(memo(products, "food", EMPTY_MENU_FILTERS)).toBe(first);
    expect(memo(products, "drink", EMPTY_MENU_FILTERS)).toEqual([products[1]]);
    const changed = { diets: [], exclude: { milk: "all" as const } };
    expect(memo(products, "food", changed)).not.toBe(first);
    expect(memo([], "food", EMPTY_MENU_FILTERS)).toEqual([]);
  });
});

it("A738 counts selected allergen groups once and ignores an empty kinds list", () => {
  expect(
    activeFilterCount({
      diets: ["vegan", "no-fish"],
      exclude: { gluten: ["wheat", "barley"], nuts: "all", milk: [] },
    }),
  ).toBe(4);
  expect(activeFilterCount(EMPTY_MENU_FILTERS)).toBe(0);
});
