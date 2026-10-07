import { afterEach, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { CellAddress, ExtraExplanation, RouteExplanation } from "../routing-types.js";
import {
  decisionSentence,
  extraSentence,
  fallbackSentences,
  type ExplanationNames,
} from "./routing-explanation.js";

afterEach(() => setLocale("en"));

const lookup = (rows: Record<string, string>) => (id: string) => rows[id] ?? id;
const names: ExplanationNames = {
  station: lookup({
    terrace: "Terrace bar",
    bar: "Bar",
    upstairs: "Upstairs bar",
    fryer: "Fryer",
  }),
  product: lookup({ lager: "Lager", chips: "Chips" }),
  category: lookup({ drinks: "Drinks", cocktails: "Drinks › Cocktails" }),
  zone: lookup({ terrace: "Terrace" }),
};
const station = (stationId: string) => ({ kind: "station" as const, stationId });
const cell = (address: CellAddress) => ({ kind: "cell" as const, address });
function explanation(overrides: Partial<RouteExplanation>): RouteExplanation {
  return {
    route: null,
    decidedBy: null,
    fallbacks: [],
    noReplacement: false,
    clockReadable: true,
    stations: [],
    extras: [],
    extrasWaitOnDish: false,
    ...overrides,
  };
}

it.each([
  [
    "en",
    "a category's zone cell",
    { row: { kind: "category", categoryId: "drinks" }, zoneId: "terrace" },
    station("terrace"),
    "Terrace bar: Drinks, on the Terrace",
  ],
  [
    "es",
    "a category's zone cell",
    { row: { kind: "category", categoryId: "drinks" }, zoneId: "terrace" },
    station("terrace"),
    "Terrace bar: Drinks, en la zona Terrace",
  ],
  [
    "en",
    "a subcategory's Every zone cell, by its path",
    { row: { kind: "category", categoryId: "cocktails" }, zoneId: null },
    station("bar"),
    "Bar: Drinks › Cocktails, in every zone",
  ],
  [
    "es",
    "a subcategory's Every zone cell, by its path",
    { row: { kind: "category", categoryId: "cocktails" }, zoneId: null },
    station("bar"),
    "Bar: Drinks › Cocktails, en todas las zonas",
  ],
  [
    "en",
    "a product's cell",
    { row: { kind: "product", productId: "lager" }, zoneId: "terrace" },
    station("terrace"),
    "Terrace bar: Lager, on the Terrace",
  ],
  [
    "es",
    "a product's cell",
    { row: { kind: "product", productId: "lager" }, zoneId: "terrace" },
    station("terrace"),
    "Terrace bar: Lager, en la zona Terrace",
  ],
  [
    "en",
    "an All categories zone cell",
    { row: { kind: "all" }, zoneId: "terrace" },
    station("bar"),
    "Bar: All categories, on the Terrace",
  ],
  [
    "es",
    "an All categories zone cell",
    { row: { kind: "all" }, zoneId: "terrace" },
    station("bar"),
    "Bar: Todas las categorías, en la zona Terrace",
  ],
  [
    "en",
    "a No preparation cell",
    { row: { kind: "category", categoryId: "drinks" }, zoneId: null },
    { kind: "no_preparation" as const },
    "No preparation: Drinks, in every zone",
  ],
  [
    "es",
    "a No preparation cell",
    { row: { kind: "category", categoryId: "drinks" }, zoneId: null },
    { kind: "no_preparation" as const },
    "Sin preparación: Drinks, en todas las zonas",
  ],
  [
    "en",
    "a No category zone cell",
    { row: { kind: "no_category" }, zoneId: "terrace" },
    station("bar"),
    "Bar: No category, on the Terrace",
  ],
  [
    "es",
    "a No category zone cell",
    { row: { kind: "no_category" }, zoneId: "terrace" },
    station("bar"),
    "Bar: Sin categoría, en la zona Terrace",
  ],
  [
    "en",
    "a No category Every zone cell",
    { row: { kind: "no_category" }, zoneId: null },
    { kind: "no_preparation" as const },
    "No preparation: No category, in every zone",
  ],
  [
    "es",
    "a No category Every zone cell",
    { row: { kind: "no_category" }, zoneId: null },
    { kind: "no_preparation" as const },
    "Sin preparación: Sin categoría, en todas las zonas",
  ],
] as const)("names %s: %s", (locale, _kind, address, route, sentence) => {
  setLocale(locale);
  expect(decisionSentence(explanation({ route, decidedBy: cell(address) }), names)).toBe(sentence);
});

it.each([
  ["en", "Bar: All categories, in every zone — the default station"],
  ["es", "Bar: Todas las categorías, en todas las zonas — la estación predeterminada"],
])("names the default station as All categories in every zone in %s", (locale, sentence) => {
  setLocale(locale);
  expect(
    decisionSentence(explanation({ route: station("bar"), decidedBy: { kind: "default" } }), names),
  ).toBe(sentence);
});

it.each([
  [
    "en",
    "Upstairs bar: Drinks, on the Terrace",
    [
      "Upstairs bar is closed outside its opening hours, so its work goes to Fryer.",
      "Fryer is disabled, so its work goes to Bar.",
    ],
  ],
  [
    "es",
    "Upstairs bar: Drinks, en la zona Terrace",
    [
      "Upstairs bar está cerrada fuera de su horario de apertura, por lo que su trabajo va a Fryer.",
      "Fryer está deshabilitada, por lo que su trabajo va a Bar.",
    ],
  ],
])(
  "names the cell's own station and each hop to the receiving station in %s",
  (locale, decision, hops) => {
    setLocale(locale);
    const answer = explanation({
      route: station("bar"),
      decidedBy: cell({ row: { kind: "category", categoryId: "drinks" }, zoneId: "terrace" }),
      fallbacks: [
        { stationId: "upstairs", why: "out_of_hours" },
        { stationId: "fryer", why: "switched_off" },
      ],
    });
    expect(decisionSentence(answer, names)).toBe(decision);
    expect(fallbackSentences(answer, names)).toEqual(hops);
  },
);

it.each([
  [
    "en",
    [
      "Upstairs bar is closed by hand today, so its work goes to Fryer.",
      "Fryer is closed outside its opening hours, and it has no replacement, so the till asks the waiter where to make this.",
    ],
  ],
  [
    "es",
    [
      "Upstairs bar se ha cerrado a mano hoy, por lo que su trabajo va a Fryer.",
      "Fryer está cerrada fuera de su horario de apertura, y no tiene sustituta, por lo que la caja pregunta al camarero dónde preparar esto.",
    ],
  ],
])("ends a fallback walk with no replacement in %s", (locale, hops) => {
  setLocale(locale);
  const answer = explanation({
    route: null,
    decidedBy: cell({ row: { kind: "product", productId: "lager" }, zoneId: null }),
    fallbacks: [
      { stationId: "upstairs", why: "closed_by_hand" },
      { stationId: "fryer", why: "out_of_hours" },
    ],
    noReplacement: true,
  });
  expect(decisionSentence(answer, names)).toBe(
    locale === "en"
      ? "Upstairs bar: Lager, in every zone"
      : "Upstairs bar: Lager, en todas las zonas",
  );
  expect(fallbackSentences(answer, names)).toEqual(hops);
});

const dish = explanation({ route: station("fryer"), decidedBy: { kind: "default" } });
const extra = (overrides: Partial<ExtraExplanation>): ExtraExplanation => ({
  productId: "chips",
  outcome: { kind: "follows_dish", why: "no_rule" },
  decidedBy: null,
  fallbacks: [],
  ...overrides,
});

it.each([
  ["en", "Chips: follows the dish — only the default station covers it"],
  ["es", "Chips: sigue al plato — solo lo cubre la estación predeterminada"],
])("says an extra of default origin follows the dish in %s", (locale, sentence) => {
  setLocale(locale);
  expect(extraSentence(extra({ decidedBy: { kind: "default" } }), dish, names)).toBe(sentence);
});

it.each([
  ["en", "Chips: follows the dish — nothing covers it and no default station is active"],
  ["es", "Chips: sigue al plato — nada lo cubre y no hay ninguna estación predeterminada activa"],
])(
  "says an extra no cell covers follows the dish when no default station is active in %s",
  (locale, sentence) => {
    setLocale(locale);
    expect(extraSentence(extra({ decidedBy: null }), dish, names)).toBe(sentence);
  },
);

it.each([
  ["en", "Chips: made separately at Bar, as set for All categories, on the Terrace"],
  [
    "es",
    "Chips: se prepara aparte en Bar, como está indicado para Todas las categorías, en la zona Terrace",
  ],
])(
  "says an extra an All categories zone cell sends to the default station is made separately in %s",
  (locale, sentence) => {
    setLocale(locale);
    const madeAtDefault = extra({
      outcome: { kind: "made", stationId: "bar" },
      decidedBy: cell({ row: { kind: "all" }, zoneId: "terrace" }),
    });
    expect(extraSentence(madeAtDefault, dish, names)).toBe(sentence);
  },
);

it.each([
  [
    "en",
    "Upstairs bar is closed by hand today, so its work goes to Terrace bar. Chips: made separately at Terrace bar — Chips, in every zone, sends it to Upstairs bar",
  ],
  [
    "es",
    "Upstairs bar se ha cerrado a mano hoy, por lo que su trabajo va a Terrace bar. Chips: se prepara aparte en Terrace bar — Chips, en todas las zonas, lo envía a Upstairs bar",
  ],
])("puts an extra's fallback hops before where it is made in %s", (locale, sentence) => {
  setLocale(locale);
  const moved = extra({
    outcome: { kind: "made", stationId: "terrace" },
    decidedBy: cell({ row: { kind: "product", productId: "chips" }, zoneId: null }),
    fallbacks: [{ stationId: "upstairs", why: "closed_by_hand" }],
  });
  expect(extraSentence(moved, dish, names)).toBe(sentence);
});

it.each([
  [
    "en",
    [
      "Chips: follows the dish — what covers it needs no preparation, so it stays on the dish's ticket, as set for Drinks, in every zone",
      "Chips: follows the dish — Drinks, in every zone, sends it to Upstairs bar, which is closed, and nothing can replace it",
      "Chips: follows the dish — it is made at Fryer, where the dish is, as set for Drinks, in every zone",
    ],
  ],
  [
    "es",
    [
      "Chips: sigue al plato — lo que lo cubre no necesita preparación, así que queda en el pedido del plato, como está indicado para Drinks, en todas las zonas",
      "Chips: sigue al plato — Drinks, en todas las zonas, lo envía a Upstairs bar, que está cerrada, y nada puede sustituirla",
      "Chips: sigue al plato — se prepara en Fryer, donde se prepara el plato, como está indicado para Drinks, en todas las zonas",
    ],
  ],
])("keeps the other follows-the-dish reasons and names their cell in %s", (locale, sentences) => {
  setLocale(locale);
  const decidedBy = cell({ row: { kind: "category", categoryId: "drinks" }, zoneId: null });
  expect([
    extraSentence(
      extra({ outcome: { kind: "follows_dish", why: "no_preparation" }, decidedBy }),
      dish,
      names,
    ),
    extraSentence(
      extra({
        outcome: { kind: "follows_dish", why: "no_replacement" },
        decidedBy,
        fallbacks: [{ stationId: "upstairs", why: "closed_by_hand" }],
      }),
      dish,
      names,
    ),
    extraSentence(
      extra({ outcome: { kind: "follows_dish", why: "same_station" }, decidedBy }),
      dish,
      names,
    ),
  ]).toEqual(sentences);
});

it.each([
  [
    "en",
    "Upstairs bar is closed by hand today, so its work goes to Fryer. Chips: follows the dish — it is made at Fryer, where the dish is — Drinks › Cocktails, on the Terrace, sends it to Upstairs bar",
  ],
  [
    "es",
    "Upstairs bar se ha cerrado a mano hoy, por lo que su trabajo va a Fryer. Chips: sigue al plato — se prepara en Fryer, donde se prepara el plato — Drinks › Cocktails, en la zona Terrace, lo envía a Upstairs bar",
  ],
])(
  "says an extra moved onto the dish's station follows the dish and names its cell's own station in %s",
  (locale, sentence) => {
    setLocale(locale);
    const moved = extra({
      outcome: { kind: "follows_dish", why: "same_station" },
      decidedBy: cell({ row: { kind: "category", categoryId: "cocktails" }, zoneId: "terrace" }),
      fallbacks: [{ stationId: "upstairs", why: "closed_by_hand" }],
    });
    expect(extraSentence(moved, dish, names)).toBe(sentence);
  },
);

it.each([
  [
    "en",
    [
      "Chips: follows the dish — what covers it needs no preparation, so it stays on the dish's ticket",
      "Chips: follows the dish — Upstairs bar is closed and nothing can replace it",
      "Upstairs bar is closed by hand today, so its work goes to Fryer. Chips: follows the dish — it is made at Fryer, where the dish is",
      "Chips: made separately at Bar",
    ],
  ],
  [
    "es",
    [
      "Chips: sigue al plato — lo que lo cubre no necesita preparación, así que queda en el pedido del plato",
      "Chips: sigue al plato — Upstairs bar está cerrada y nada puede sustituirla",
      "Upstairs bar se ha cerrado a mano hoy, por lo que su trabajo va a Fryer. Chips: sigue al plato — se prepara en Fryer, donde se prepara el plato",
      "Chips: se prepara aparte en Bar",
    ],
  ],
])("names no cell for an extra whose answer carries none in %s", (locale, sentences) => {
  setLocale(locale);
  const closed = [{ stationId: "upstairs", why: "closed_by_hand" as const }];
  expect([
    extraSentence(extra({ outcome: { kind: "follows_dish", why: "no_preparation" } }), dish, names),
    extraSentence(
      extra({ outcome: { kind: "follows_dish", why: "no_replacement" }, fallbacks: closed }),
      dish,
      names,
    ),
    extraSentence(
      extra({ outcome: { kind: "follows_dish", why: "same_station" }, fallbacks: closed }),
      dish,
      names,
    ),
    extraSentence(extra({ outcome: { kind: "made", stationId: "bar" } }), dish, names),
  ]).toEqual(sentences);
});
