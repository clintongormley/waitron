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

describe("the Spanish strings call a restaurant menu a carta", () => {
  // Every "menu" the till's catalogue strings mean is a restaurant menu: no string here calls a
  // popover a menu, which in the dashboard keeps "menú". Weaker than its name: only the catalogue in
  // strings.ts is read, not the Spanish in codes.ts or allergen-names.ts, so a code message saying
  // menú passes.
  it("has no Spanish catalogue string that says menú", () => {
    const menuWord = /(?<!\p{L})men[úu]s?(?!\p{L})/iu;
    const saysMenu = Object.entries(catalogues["es-ES"] ?? {}).filter(([, text]) =>
      menuWord.test(text.replace(/\{[^}]*\}/g, "")),
    );
    expect(saysMenu).toEqual([]);
  });

  it("names the menu switcher and the zone's menus with carta", () => {
    expect(catalogues["es-ES"]?.["menu.switcher"]).toBe("Carta");
    expect(catalogues["es-ES"]?.["service_zone.refresh"]).toBe("Actualizar cartas");
    expect(catalogues["es-ES"]?.["service_zone.load_error"]).toBe(
      "No se pudieron cargar las cartas de esta zona",
    );
  });
});

describe("the till's Spanish Clear snooze label, and no aplazar in the catalogue", () => {
  // Owner decision (2026-09-29): "Cancelar" or "Cancelar posponer", because nobody uses
  // posposición. A bare "Cancelar" would not say what the reminder row's button cancels. Weaker
  // than its name: only the catalogue in strings.ts is read, not the Spanish in codes.ts.
  it("labels Clear snooze Cancelar posponer", () => {
    expect(catalogues["es-ES"]?.["table.reminder_clear_snooze"]).toBe("Cancelar posponer");
  });

  it("has no Spanish catalogue string that says aplazar", () => {
    const aplaza = Object.entries(catalogues["es-ES"] ?? {}).filter(([, text]) =>
      /aplaz/i.test(text),
    );
    expect(aplaza).toEqual([]);
  });
});

describe("the Finish table refusal for a bill that owes nothing but holds money", () => {
  it.each([
    [
      "en-GB",
      "A bill on this table owes nothing but still holds money. Give it back before finishing the table",
    ],
    [
      "es-ES",
      "Una cuenta de esta mesa no debe nada pero aún tiene dinero. Devuélvelo antes de cerrar la mesa",
    ],
  ])("says what to do in %s", (locale, message) => {
    expect(catalogues[locale]?.["table.finish_bill_holds_money"]).toBe(message);
  });
});
