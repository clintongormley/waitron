import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { RouteException } from "../routing.js";
import { exceptionSentence } from "./exception-sentence.js";

const names = {
  categories: [{ id: "cocktails", name: "Drinks › Cocktails" }],
  products: [{ id: "lager", name: "Lager" }],
  zones: [{ id: "terrace", name: "Terrace" }],
  stations: [
    { id: "bar", name: "Main bar", active: false },
    { id: "terrace-bar", name: "Terrace bar", active: true },
  ],
};
const base: RouteException = {
  id: "e",
  position: 1,
  zoneId: null,
  categoryId: null,
  productId: null,
  target: { kind: "station", stationId: "bar" },
};
afterEach(() => setLocale("en"));
for (const [locale, shape, exception, expected] of [
  [
    "en",
    "folder",
    { categoryId: "cocktails", zoneId: "terrace" },
    "Cocktails from Terrace → Main bar",
  ],
  [
    "en",
    "product",
    { productId: "lager", target: { kind: "no_preparation" } },
    "Lager → No preparation",
  ],
  [
    "en",
    "zone",
    { zoneId: "terrace", target: { kind: "station", stationId: "terrace-bar" } },
    "Everything from Terrace → Terrace bar",
  ],
  [
    "es",
    "folder",
    { categoryId: "cocktails", zoneId: "terrace" },
    "Cocktails desde Terrace → Main bar",
  ],
  [
    "es",
    "product",
    { productId: "lager", target: { kind: "no_preparation" } },
    "Lager → Sin preparación",
  ],
  [
    "es",
    "zone",
    { zoneId: "terrace", target: { kind: "station", stationId: "terrace-bar" } },
    "Todo desde Terrace → Terrace bar",
  ],
] as const) {
  it(`writes a ${shape} exception in ${locale}`, () => {
    setLocale(locale);
    expect(exceptionSentence({ ...base, ...exception } as RouteException, names)).toBe(expected);
  });
}
