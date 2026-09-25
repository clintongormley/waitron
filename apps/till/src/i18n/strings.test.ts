import { describe, expect, it } from "vitest";
import { catalogues } from "./strings.js";

/**
 * The permanent-refusal messages, checked as prose in every language the till ships. `sale.refused`
 * is shown when settling a sale, after the customer's card may already have been charged, so each
 * language must name its card terminal and must not say no money was taken. `place.refused` is the
 * opposite: placing an order takes no tender, so a refund instruction would be wrong there.
 */
describe("the permanent-refusal messages", () => {
  it.each([
    ["en-GB", /terminal/i, /nothing was charged/i],
    ["es-ES", /datáfono/i, /no se ha cobrado nada/i],
  ])(
    "sale.refused (%s) names the card terminal and never claims no money was taken",
    (locale, terminalWord, falseMoneyClaim) => {
      const message = catalogues[locale]?.["sale.refused"];
      expect(message).toBeDefined();
      expect(message!).toMatch(terminalWord);
      expect(message!).not.toMatch(falseMoneyClaim);
    },
  );

  it.each([
    ["en-GB", /terminal|refund/i],
    ["es-ES", /datáfono|devuelve/i],
  ])(
    "place.refused (%s) says nothing about money — placing takes no tender",
    (locale, moneyWords) => {
      const message = catalogues[locale]?.["place.refused"];
      expect(message).toBeDefined();
      expect(message!).not.toMatch(moneyWords);
    },
  );

  it("keeps the two apart — a permanent refusal on placing is not the settle message", () => {
    expect(catalogues["en-GB"]?.["place.refused"]).not.toBe(catalogues["en-GB"]?.["sale.refused"]);
  });
});

describe("the suspended-account message matches the dashboard's wording", () => {
  // Owner decision: the same words as the dashboard's `person.suspended`
  // (apps/dashboard/src/i18n/codes.ts). Weaker than its name: this pins a HARDCODED copy and never
  // reads the dashboard's file, so a dashboard-side change leaves it green.
  it("uses the dashboard's English and Spanish text", () => {
    expect(catalogues["en-GB"]?.["person.suspended"]).toBe(
      "This account is disabled — ask a manager",
    );
    expect(catalogues["es-ES"]?.["person.suspended"]).toBe(
      "Esta cuenta está desactivada. Avisa a un responsable",
    );
  });
});
