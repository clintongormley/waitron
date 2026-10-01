import { afterEach, expect, it } from "vitest";
import type { Decimal } from "@waitron/shared";
import type { Setting, ValueSource } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { describeSetting } from "./price-source.js";

afterEach(() => setLocale("es-ES"));
const decided = (
  value: string,
  source: ValueSource,
  otherwise: Setting<Decimal> | null = null,
): Setting<Decimal> => ({ state: "decided", value: value as Decimal, source, otherwise });
const own = { kind: "own" } as const;
const product = { kind: "product" } as const;
const drinks: ValueSource = { kind: "menu", menuId: "drinks", menuName: "Drinks", from: own };
const clash: Setting<Decimal> = {
  state: "clash",
  candidates: [
    { place: { kind: "own_sections" }, value: "3.00" as Decimal, source: product },
    {
      place: { kind: "menu", menuId: "drinks", menuName: "Drinks" },
      value: "3.50" as Decimal,
      source: drinks,
    },
  ],
};
it.each([
  [decided("3.00", product), "The product's own price.", "El precio propio del producto."],
  [
    decided("3.00", { kind: "parent" }),
    "Follows Lager's price on this menu.",
    "Sigue el precio de Lager en esta carta.",
  ],
  [
    decided("3.50", drinks),
    "From Drinks, which sets its own price.",
    "De Drinks, que fija su propio precio.",
  ],
  [
    decided("3.00", {
      ...drinks,
      from: { kind: "menu", menuId: "wines", menuName: "Wines", from: product },
    }),
    "From Drinks, which takes it from Wines, which uses the product's own price.",
    "De Drinks, que lo toma de Wines, que usa el precio propio del producto.",
  ],
  [
    decided("4.00", own, decided("3.50", drinks)),
    "This menu sets €4.00. Without it: €3.50, from Drinks, which sets its own price.",
    "Esta carta fija 4,00 €. Sin él: 3,50 €, de Drinks, que fija su propio precio.",
  ],
  [
    decided("3.50", own, clash),
    "This menu sets €3.50. Without it the places disagree: €3.00 in this menu's sections, €3.50 in Drinks.",
    "Esta carta fija 3,50 €. Sin él los lugares discrepan: 3,00 € en las secciones de esta carta, 3,50 € en Drinks.",
  ],
  [
    clash,
    "The places disagree: €3.00 in this menu's sections, €3.50 in Drinks.",
    "Los lugares discrepan: 3,00 € en las secciones de esta carta, 3,50 € en Drinks.",
  ],
] as const)("describes the full price source chain (%#)", (setting, en, es) => {
  setLocale("en-GB");
  expect(describeSetting(setting, { product: "Lager" }, t)).toBe(en);
  setLocale("es-ES");
  expect(describeSetting(setting, { product: "Lager" }, t)).toBe(es);
});
