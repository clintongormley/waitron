import { afterEach, expect, it } from "vitest";
import { registerCatalogue, setLocale } from "@waitron/dashboard-kit";
import { VENUE_SERVICE_STRINGS } from "./strings.js";
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
afterEach(() => {
  registerCatalogue(VENUE_SERVICE_STRINGS);
  setLocale("en");
});
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

it("takes the sentence words and structure from the translation catalogue", () => {
  setLocale("en");
  registerCatalogue({
    en: {
      "prep.everything": "All items",
      "prep.exception_from_zone": " in {zone}",
      "prep.no_preparation": "No maker",
      "prep.exception_sentence": "{what}{zone} => {target}",
    },
    es: {},
  });
  expect(
    exceptionSentence({ ...base, zoneId: "terrace", target: { kind: "no_preparation" } }, names),
  ).toBe("All items in Terrace => No maker");
});

it("names a missing referenced station by its id so an old rule remains identifiable", () => {
  setLocale("en");
  expect(
    exceptionSentence(
      { ...base, target: { kind: "station", stationId: "retired-station" } },
      names,
    ),
  ).toBe("Everything → retired-station");
});
