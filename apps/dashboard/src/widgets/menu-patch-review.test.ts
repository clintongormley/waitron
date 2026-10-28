import { afterEach, beforeEach, expect, it } from "vitest";
import type {
  FrozenExtraItem,
  FrozenOfferVariant,
  MenuDocument,
} from "@waitron/catalogue/src/menu-document-types.js";
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
        { target: soup, field: "vatClass", value: "general" },
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
    "Soup: VAT Reduced → General",
    "Soup: Kitchen name SOUP COCINA → (empty)",
    "Starters: Internal name Starters → First",
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

it("writes money and VAT in the screen language", () => {
  setLocale("es");
  expect(
    changeLines(
      lunch(),
      [
        { target: soup, field: "price", value: "3.50" },
        { target: soup, field: "vatClass", value: "general" },
      ],
      languages,
    ),
  ).toEqual(["Soup: Precio 3,00\u00a0€ → 3,50\u00a0€", "Soup: IVA Reducido → General"]);
});

it("always notes open orders and the products, and names each queued version by its date", () => {
  const openOrders = "Lines already on open orders keep their old price and VAT class.";
  const products =
    "The next normal publish from the products puts the old values back unless you fix the products too.";
  expect(reviewNotes([])).toEqual([openOrders, products]);
  expect(reviewNotes(["3 Nov 2026, 08:00"])).toEqual([
    openOrders,
    "The version going live on 3 Nov 2026, 08:00 does not include these changes.",
    products,
  ]);
  expect(reviewNotes(["3 Nov 2026, 08:00", "10 Nov 2026, 08:00"])).toEqual([
    openOrders,
    "The versions going live on 3 Nov 2026, 08:00 and 10 Nov 2026, 08:00 do not include these changes.",
    products,
  ]);
});

const price = { target: soup, field: "price", value: "4.00" };
const kitchen = { target: soup, field: "kitchenName", value: "SOUP" };

function refused(code: string, params: Record<string, unknown>): Error {
  return Object.assign(new Error(code), { code, params });
}

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
    "One of these changes no longer fits the live menu, for example because the venue's content languages changed while you were editing. Nothing was put live. Reload reads the live menu again and checks each change against it with the content languages this page has: it drops each one that does not fit, says how many, and keeps the rest.",
  );
});
