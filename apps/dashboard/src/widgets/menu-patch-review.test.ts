import { afterEach, beforeEach, expect, it } from "vitest";
import type {
  FrozenExtraItem,
  FrozenOffer,
  FrozenOfferVariant,
  MenuDocument,
  PublishedSetMenu,
} from "@waitron/shared";
import {
  productDeclarationValues,
  type DeclarationValues,
} from "@waitron/menu/src/declaration-values.js";
import type { MenuPatchTarget } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import { changeLines, placeRefusal, refusalWords, reviewNotes } from "./menu-patch-review.js";
import { documentProduct, documentSection, menuDocument } from "./test-helpers.js";

const languages = { defaultLanguage: "en", languages: ["en", "es"] };

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("es-ES"));

function lunch(): MenuDocument {
  const document = menuDocument(
    [
      documentSection("sec-starters", "Starters", [documentProduct("mi-soup", "p-soup")]),
      documentProduct("mi-lemonade", "p-lemonade"),
    ],
    { "p-soup": "Soup", "p-lemonade": "Lemonade" },
  );
  document.offers["mi-lemonade"]!.variants = [
    {
      id: "v-large",
      name: "Large",
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: "2.00",
      menuPrice: null,
      vatClass: "reduced",
    } as FrozenOfferVariant,
  ];
  document.offers["mi-soup"]!.image = "media:old";
  document.offers["mi-soup"]!.offeredModifiers = [
    {
      kind: "extras",
      id: "l-toppings",
      name: "Toppings",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: null,
      items: [
        {
          productId: "p-bread",
          name: "Bread",
          customerName: null,
          kitchenName: null,
          price: "1.00",
          vatClass: "reduced",
          image: null,
        } as FrozenExtraItem,
      ],
    },
  ];
  return document;
}

const soup = { kind: "offer", menuItemId: "mi-soup" } as const;

it("words each change as its item, field, old value and new value", () => {
  expect(
    changeLines(
      lunch(),
      [
        { target: soup, field: "name", value: "Broth" },
        { target: soup, field: "price", value: "3.50" },
        { target: soup, field: "kitchenName", value: null },
        {
          target: { kind: "section", sectionId: "sec-starters" },
          field: "internalName",
          value: "First",
        },
      ],
      languages,
    ),
  ).toEqual([
    "Soup: Name Soup → Broth",
    "Soup: Price €3.00 → €3.50",
    "Soup: Prep station name SOUP KITCHEN → (empty)",
    "Starters: Internal name Starters → First",
  ]);
});

const reviewed = (
  allergens: DeclarationValues["allergens"],
  dietaryDeclarations: DeclarationValues["dietaryDeclarations"] = [],
  dietOverride: DeclarationValues["dietOverride"] = null,
) => productDeclarationValues({ allergens, dietaryDeclarations, dietOverride });

/** {@link lunch}, its lemonade, Large and soup holding milk, its bread gluten from wheat. */
function declaredLunch(): MenuDocument {
  const document = lunch();
  const { "mi-soup": soup, "mi-lemonade": lemonade } = document.offers;
  for (const dish of [soup!, lemonade!, lemonade!.variants[0]!])
    Object.assign(dish, reviewed({ milk: {} }));
  const [toppings] = soup!.offeredModifiers;
  if (toppings!.kind !== "extras") throw new Error("not the extras list");
  Object.assign(toppings!.items[0]!, {
    addAllergens: { gluten: { kinds: ["wheat"] } },
    suitableFor: ["halal"],
  });
  return document;
}

const lemonade = { kind: "offer", menuItemId: "mi-lemonade" } as const;
const large = { kind: "variant", menuItemId: "mi-lemonade", variantId: "v-large" } as const;
const bread = { kind: "extra", listId: "l-toppings", productId: "p-bread" } as const;

const declarationLines = (
  target: MenuPatchTarget,
  current: Record<string, DeclarationValues>,
  document = declaredLunch(),
) =>
  changeLines(document, [{ target, field: "declarations", value: "product" }], languages, current);

it("words a dish's old and new allergens and diets, in the screen language", () => {
  const current = { "p-soup": reviewed({ milk: {}, gluten: { kinds: ["rye"] } }, ["vegetarian"]) };
  expect(declarationLines(soup, current)).toEqual([
    "Soup: Allergens Milk → Milk, Cereals containing gluten (Rye)",
    "Soup: Dietary info (empty) → Vegetarian, No meat, No fish",
  ]);
  setLocale("es");
  expect(declarationLines(soup, current)).toEqual([
    "Soup: Alérgenos Leche → Leche, Cereales con gluten (Centeno)",
    "Soup: Info dietética (vacío) → Vegetariano, Sin carne, Sin pescado",
  ]);
});

it("words only what changes", () => {
  expect(declarationLines(soup, { "p-soup": reviewed({}) })).toEqual([
    "Soup: Allergens Milk → None",
  ]);
  expect(declarationLines(soup, { "p-soup": reviewed({ milk: {} }, ["halal"]) })).toEqual([
    "Soup: Dietary info (empty) → Halal",
  ]);
});

it("words a diet answered for a dish itself", () => {
  const current = {
    "p-soup": reviewed({ milk: {} }, ["halal"], { vegan: "no", addContains: ["meat"] }),
  };
  expect(declarationLines(soup, current)).toEqual([
    "Soup: Dietary info (empty) → Halal, Vegan: No, Contains meat",
  ]);
});

it("says when the product's allergens and diets are already live", () => {
  const current = { "p-soup": reviewed({ milk: {} }) };
  expect(declarationLines(soup, current)).toEqual(["Soup: Allergens and diets: no change"]);
  setLocale("es");
  expect(declarationLines(soup, current)).toEqual(["Soup: Alérgenos y dietas: sin cambios"]);
});

it("says when the product's allergens are not yet reviewed, whether or not that changes", () => {
  const current = { "p-soup": reviewed(null) };
  expect(declarationLines(soup, current)).toEqual(["Soup: Allergens Milk → Not yet reviewed"]);
  const unreviewed = declaredLunch();
  Object.assign(unreviewed.offers["mi-soup"]!, reviewed(null));
  expect(declarationLines(soup, current, unreviewed)).toEqual([
    "Soup: Allergens not yet reviewed: no change",
  ]);
  expect(declarationLines(soup, { "p-soup": reviewed(null, ["halal"]) }, unreviewed)).toEqual([
    "Soup: Allergens not yet reviewed: no change",
    "Soup: Dietary info (empty) → Halal",
  ]);
  setLocale("es");
  expect(declarationLines(soup, current)).toEqual(["Soup: Alérgenos Leche → Sin revisar todavía"]);
});

it("words a dish's variants with it, and lists one only where its own result differs", () => {
  const eggs = reviewed({ eggs: {} });
  const withEggs = "Lemonade, variants included: Allergens Milk → Eggs";
  expect(declarationLines(lemonade, { "p-lemonade": eggs, "v-large": eggs })).toEqual([withEggs]);
  expect(
    declarationLines(lemonade, { "p-lemonade": eggs, "v-large": reviewed({ milk: {} }) }),
  ).toEqual([withEggs, "Lemonade › Large: Allergens and diets: no change"]);
  // The same values after, from other ones before.
  const fish = declaredLunch();
  Object.assign(fish.offers["mi-lemonade"]!.variants[0]!, reviewed({ fish: {} }));
  expect(declarationLines(lemonade, { "p-lemonade": eggs, "v-large": eggs }, fish)).toEqual([
    withEggs,
    "Lemonade › Large: Allergens Fish → Eggs",
  ]);
  setLocale("es");
  expect(declarationLines(lemonade, { "p-lemonade": eggs, "v-large": eggs })).toEqual([
    "Lemonade, variantes incluidas: Alérgenos Leche → Huevos",
  ]);
});

/** A set menu holding `dishes`, whose copies hold their own declarations. */
function withSetMenu(document: MenuDocument, ...dishes: FrozenOffer[]): MenuDocument {
  const offers = Object.fromEntries(dishes.map((offer) => [offer.id, offer]));
  document.setMenus = { "sm-day": { offers } as unknown as PublishedSetMenu };
  return document;
}

it("words every copy a dish's change corrects, a set menu's and the variants only it holds included", () => {
  const document = declaredLunch();
  const { "mi-soup": ordinary, "mi-lemonade": drink } = document.offers;
  Object.assign(ordinary!, reviewed(null));
  const jug = { ...structuredClone(drink!.variants[0]!), id: "v-jug", name: "Jug" };
  withSetMenu(
    document,
    { ...structuredClone(ordinary!), ...reviewed({ milk: {} }) },
    { ...structuredClone(drink!), variants: [{ ...jug, ...reviewed({ fish: {} }) }] },
  );
  expect(declarationLines(soup, { "p-soup": reviewed(null) }, document)).toEqual([
    "Soup: Allergens Milk → Not yet reviewed",
  ]);
  const eggs = reviewed({ eggs: {} });
  const current = { "p-lemonade": eggs, "v-large": eggs, "v-jug": eggs };
  expect(declarationLines(lemonade, current, document)).toEqual([
    "Lemonade, variants included: Allergens Milk → Eggs",
    "Lemonade › Jug: Allergens Fish → Eggs",
  ]);
  Object.assign(document.setMenus!["sm-day"]!.offers["mi-lemonade"]!, reviewed({ nuts: {} }));
  expect(declarationLines(lemonade, current, document)).toEqual([
    "Lemonade, variants included: Allergens Milk → Eggs",
    "Lemonade, variants included: Allergens Nuts → Eggs",
    "Lemonade › Large: Allergens Milk → Eggs",
    "Lemonade › Jug: Allergens Fish → Eggs",
  ]);
});

it("words a variant's and an extra's own allergens and diets", () => {
  expect(declarationLines(large, { "v-large": reviewed({ eggs: {} }) })).toEqual([
    "Lemonade › Large: Allergens Milk → Eggs",
  ]);
  expect(declarationLines(bread, { "p-bread": reviewed({}, ["vegan"]) })).toEqual([
    "Toppings › Bread: Allergens Cereals containing gluten (Wheat) → None",
    "Toppings › Bread: Dietary info Halal → Vegan, Vegetarian, No meat, No fish",
  ]);
  const same = reviewed({ gluten: { kinds: ["wheat"] } }, ["halal"]);
  expect(declarationLines(bread, { "p-bread": same })).toEqual([
    "Toppings › Bread: Allergens and diets: no change",
  ]);
});

it("names a variant, an extras item and a list with what holds them", () => {
  expect(
    changeLines(
      lunch(),
      [
        {
          target: { kind: "variant", menuItemId: "mi-lemonade", variantId: "v-large" },
          field: "price",
          value: "2.50",
        },
        {
          target: { kind: "extra", listId: "l-toppings", productId: "p-bread" },
          field: "name",
          value: "Toast",
        },
        {
          target: { kind: "list", listKind: "extras", listId: "l-toppings" },
          field: "name",
          value: "Add-ons",
        },
      ],
      languages,
    ),
  ).toEqual([
    "Lemonade › Large: Price €2.00 → €2.50",
    "Toppings › Bread: Name Bread → Toast",
    "Toppings: Name Toppings → Add-ons",
  ]);
});

it("words a translated field once per language whose text changed", () => {
  expect(
    changeLines(
      lunch(),
      [
        {
          target: soup,
          field: "customerName",
          value: { en: "Daily soup", es: "Soup para clientes" },
        },
        {
          target: { kind: "section", sectionId: "sec-starters" },
          field: "names",
          value: { en: "", es: "Entrantes" },
        },
        { target: soup, field: "description", value: { en: "Hot", es: "" } },
      ],
      languages,
    ),
  ).toEqual([
    "Soup: Customer-facing name (EN) (empty) → Daily soup",
    "Starters: Customer-facing name (ES) Starters para clientes → Entrantes",
    "Soup: Description (EN) (empty) → Hot",
  ]);
});

it("reads a content language a change holds no text in as blank", () => {
  expect(
    changeLines(lunch(), [{ target: soup, field: "description", value: { en: "Hot" } }], languages),
  ).toEqual(["Soup: Description (EN) (empty) → Hot"]);
  const stored = lunch();
  stored.offers["mi-soup"]!.description = { en: "Old", es: "Vieja" };
  expect(
    changeLines(stored, [{ target: soup, field: "description", value: { en: "Hot" } }], languages),
  ).toEqual(["Soup: Description (EN) Old → Hot", "Soup: Description (ES) Vieja → (empty)"]);
});

it("never words a change to a name language every copy's folder fixes", () => {
  const document = lunch();
  const starters = document.root.members[0] as Extract<
    MenuDocument["root"]["members"][number],
    { kind: "section" }
  >;
  starters.names = { en: "Fixed English", es: "Entrantes" };
  starters.fixed = { names: { en: "Fixed English" } };
  expect(
    changeLines(
      document,
      [
        {
          target: { kind: "section", sectionId: "sec-starters" },
          field: "names",
          value: { en: "New English", es: "Para empezar" },
        },
      ],
      languages,
    ),
  ).toEqual(["Starters: Customer-facing name (ES) Entrantes → Para empezar"]);
});

it("words a picture as added, replaced or removed", () => {
  const bread = { kind: "extra", listId: "l-toppings", productId: "p-bread" } as const;
  expect(
    changeLines(
      lunch(),
      [
        { target: soup, field: "image", value: "media:new" },
        { target: bread, field: "image", value: "media:bread" },
      ],
      languages,
    ),
  ).toEqual([
    "Soup: Image current image → new image",
    "Toppings › Bread: Image no image → new image",
  ]);
  expect(changeLines(lunch(), [{ target: soup, field: "image", value: null }], languages)).toEqual([
    "Soup: Image current image → no image",
  ]);
});

it("writes money in the screen language", () => {
  setLocale("es");
  expect(
    changeLines(lunch(), [{ target: soup, field: "price", value: "3.50" }], languages),
  ).toEqual(["Soup: Precio 3,00\u00a0€ → 3,50\u00a0€"]);
});

it("notes open orders and the products for a price, and names each queued version by its date", () => {
  const openOrders = "Lines already on open orders keep their old price.";
  const products =
    "The next normal publish from the products puts the old values back unless you fix the products too.";
  expect(reviewNotes([price], [])).toEqual([openOrders, products]);
  expect(reviewNotes([price], ["3 Nov 2026, 08:00"])).toEqual([
    openOrders,
    "The version going live on 3 Nov 2026, 08:00 does not include these changes.",
    products,
  ]);
  expect(reviewNotes([price], ["3 Nov 2026, 08:00", "10 Nov 2026, 08:00"])).toEqual([
    openOrders,
    "The versions going live on 3 Nov 2026, 08:00 and 10 Nov 2026, 08:00 do not include these changes.",
    products,
  ]);
});

const price = { target: soup, field: "price", value: "4.00" };
const kitchen = { target: soup, field: "kitchenName", value: "SOUP" };
const declared = { target: soup, field: "declarations", value: "product" };

function refused(code: string, params: Record<string, unknown>): Error {
  return Object.assign(new Error(code), { code, params });
}

it("says which scheduled versions get the allergens and diets, apart from those that get nothing", () => {
  expect(
    reviewNotes([price, declared], ["10 Nov 2026, 08:00"], ["3 Nov 2026, 08:00"]).slice(1, 3),
  ).toEqual([
    "The version going live on 3 Nov 2026, 08:00 also gets these allergens and diets, but no other change.",
    "The version going live on 10 Nov 2026, 08:00 does not include these changes.",
  ]);
  const both = ["3 Nov 2026, 08:00", "10 Nov 2026, 08:00"];
  expect(reviewNotes([price, declared], [], both).slice(1, -1)).toEqual([
    "The versions going live on 3 Nov 2026, 08:00 and 10 Nov 2026, 08:00 also get these allergens and diets, but no other change.",
  ]);
  setLocale("es");
  expect(reviewNotes([price, declared], [], both.slice(0, 1)).slice(1, -1)).toEqual([
    "La versión que se publica el 3 Nov 2026, 08:00 también recibe estos alérgenos y dietas, pero ninguna otra corrección.",
  ]);
  expect(reviewNotes([price, declared], [], both).slice(1, -1)).toEqual([
    "Las versiones que se publican en estas fechas (3 Nov 2026, 08:00 y 10 Nov 2026, 08:00) también reciben estos alérgenos y dietas, pero ninguna otra corrección.",
  ]);
});

it("says allergens and diets stay when the products' next publish puts other values back", () => {
  expect(reviewNotes([declared, price], []).at(-1)).toBe(
    "The next normal publish from the products puts the old values back, except allergens and diets, unless you fix the products too.",
  );
  setLocale("es");
  expect(reviewNotes([kitchen, declared], []).at(-1)).toBe(
    "La próxima publicación normal desde los productos vuelve a poner los valores anteriores, menos los alérgenos y dietas, salvo que corrijas también los productos.",
  );
});

it("says nothing of old prices unless a price changes, nor of old values when every value is the products' own", () => {
  const openOrders = "Lines already on open orders keep their old price.";
  expect(reviewNotes([declared], [])).toEqual([]);
  expect(reviewNotes([kitchen], [])).not.toContain(openOrders);
  expect(reviewNotes([declared, price], [])).toContain(openOrders);
});

it("places a refused value under the field of the change it names", () => {
  expect(
    placeRefusal(refused("menu_patch.invalid", { change: 1, field: "kitchenName" }), [
      price,
      kitchen,
    ]),
  ).toEqual({ change: kitchen, message: "Check this value." });
  expect(
    placeRefusal(
      refused("menu_patch.invalid", {
        change: 0,
        field: "price",
        reason: "content.translation_invalid",
      }),
      [price],
    ),
  ).toEqual({ change: price, message: codeMessage("content.translation_invalid") });
});

it("says a refused picture is no longer in the image library and what to do, in English and Spanish", () => {
  const picture = { target: soup, field: "image", value: "gone.jpg" };
  const gone = refused("menu_patch.invalid", {
    change: 0,
    field: "image",
    reason: "image.not_found",
  });
  expect(placeRefusal(gone, [picture])).toEqual({
    change: picture,
    message: "This image is no longer in the image library. Choose another, or remove it.",
  });
  setLocale("es");
  expect(placeRefusal(gone, [picture])).toEqual({
    change: picture,
    message: "Esta imagen ya no está en la biblioteca de imágenes. Elige otra o quítala.",
  });
});

it("leaves at the bottom a refusal that names no change the form shows", () => {
  for (const params of [
    { change: 0, field: "target" },
    { change: 5, field: "price" },
  ])
    expect(placeRefusal(refused("menu_patch.invalid", params), [price])).toEqual({
      refusal: { code: "menu_patch.invalid", params },
    });
  expect(placeRefusal(refused("menu_patch.unchanged", { menuId: "m" }), [price])).toEqual({
    refusal: { code: "menu_patch.unchanged", params: { menuId: "m" } },
  });
  expect(placeRefusal(new Error("unreachable"), [price])).toEqual({
    refusal: { code: "server.internal", params: {} },
  });
});

it("words a bottom refusal, naming the version that went live and saying when a change no longer fits", () => {
  expect(refusalWords({ code: "menu_patch.base_changed", params: { liveNumber: 4 } })).toBe(
    "Version 4 went live while you were patching. Reload to patch it instead; changes that still fit are kept.",
  );
  expect(refusalWords({ code: "menu_patch.base_changed", params: {} })).toBe(
    "Another version went live while you were patching. Reload to patch it instead; changes that still fit are kept.",
  );
  expect(refusalWords({ code: "menu_patch.invalid", params: { change: 0, field: "target" } })).toBe(
    "One of these changes no longer fits the live menu, for example because the venue's content languages changed while you were editing. Nothing was put live. Reload reads the live menu and content languages again and checks each change: it drops each one that does not fit, says how many, and keeps the rest.",
  );
});
