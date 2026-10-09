import { afterEach, describe, expect, it } from "vitest";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import { refusalText } from "./archive-refusal.js";

afterEach(() => setLocale("es"));

describe.each([
  ["en", "Menus", "Products"],
  ["es", "Menús", "Productos"],
])("archive refusal (%s)", (locale, menusLabel, productsLabel) => {
  it("names menus, adding products only for a bulk refusal", () => {
    setLocale(locale!);
    const menus = [
      { id: "d", name: "Dinner" },
      { id: "l", name: "Lunch Menu" },
    ];
    expect(refusalText("product.on_live_menu", { menus, products: [{ id: "a", name: "A" }] })).toBe(
      `${codeMessage("product.on_live_menu")} ${menusLabel}: Dinner, Lunch Menu.`,
    );
    expect(
      refusalText("product.on_live_menu", {
        menus,
        products: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      }),
    ).toBe(
      `${codeMessage("product.on_live_menu")} ${productsLabel}: A, B. ${menusLabel}: Dinner, Lunch Menu.`,
    );
  });

  it("keeps the extras-list refusal and leaves unrelated codes alone", () => {
    setLocale(locale!);
    const params = {
      extraLists: [
        { id: "s", name: "Salsas" },
        { id: "t", name: "Toppings" },
      ],
    };
    expect(refusalText("product.offered_as_extra", params)).toBe(
      `${codeMessage("product.offered_as_extra")} Salsas, Toppings`,
    );
    expect(refusalText("product.archived", params)).toBe(codeMessage("product.archived"));
  });

  it.each([
    undefined,
    null,
    {},
    { menus: null, products: false },
    { menus: [null, {}, { name: 42 }] },
  ])("ignores absent or malformed names (%j)", (params) => {
    setLocale(locale!);
    expect(refusalText("product.on_live_menu", params)).toBe(codeMessage("product.on_live_menu"));
    expect(refusalText("product.offered_as_extra", params)).toBe(
      codeMessage("product.offered_as_extra"),
    );
  });
});
