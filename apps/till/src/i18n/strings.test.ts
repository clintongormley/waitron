import { describe, expect, it } from "vitest";
import { catalogues, es } from "./strings.js";

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

describe("the discard refusal for a held order that still holds money", () => {
  it.each([
    [
      "en-GB",
      "This order still holds money from a payment. Give it back before discarding the order",
    ],
    ["es-ES", "Este pedido aún tiene dinero de un pago. Devuélvelo antes de descartar el pedido"],
  ])("says what to do in %s", (locale, message) => {
    expect(catalogues[locale]?.["held.discard_holds_money"]).toBe(message);
  });
});

it.each([
  ["en-GB", "Search"],
  ["es-ES", "Buscar"],
])("labels the menu search simply in %s", (locale, label) => {
  expect(catalogues[locale]?.["menu.search"]).toBe(label);
});

describe("the floor's held chip, and no retenido in the catalogue", () => {
  // Owner decision (2026-10-20): held dishes are «en espera» everywhere. Weaker than its name:
  // only the catalogue in strings.ts is read, not codes.ts or the dashboard.
  it("has no Spanish catalogue string that says retenido", () => {
    const retenido = Object.entries(catalogues["es-ES"] ?? {}).filter(([, text]) =>
      /retenid/i.test(text),
    );
    expect(retenido).toEqual([]);
  });

  it("the floor's held chip says held with the order screen's word", () => {
    const held = es["table.group_held"].toLowerCase();
    expect(es["floor.held"].replace("{n}", "2")).toBe(`2 ${held}`);
    expect(es["floor.held_one"]).toBe(`1 ${held}`);
    expect(es["floor.held_fire_in"].startsWith(`{n} ${held} · `)).toBe(true);
    expect(es["floor.held_fire_in_one"].startsWith(`1 ${held} · `)).toBe(true);
    const tail = es["floor.held_fire_in"].split(" · ")[1];
    expect(tail).toContain("{m}");
    expect(es["floor.held_fire_in_one"].split(" · ")[1]).toBe(tail);
  });
});

describe("the advice for a whole payment refused while an unanswered bill payment holds the bill", () => {
  it.each(["en-GB", "es-ES"])(
    "bill_pay.unconfirmed_elsewhere (%s) names the button that reopens that payment, then Check again",
    (locale) => {
      const strings = catalogues[locale]!;
      const message = strings["bill_pay.unconfirmed_elsewhere"]!;
      expect(message).toContain(strings["bill_pay.way_items"]!);
      expect(message).toContain(strings["bill_pay.recheck"]!);
      expect(message.indexOf(strings["bill_pay.way_items"]!)).toBeLessThan(
        message.indexOf(strings["bill_pay.recheck"]!),
      );
    },
  );

  it("calls it a payment in Spanish, as bill_pay.unconfirmed does", () => {
    expect(catalogues["es-ES"]!["bill_pay.unconfirmed_elsewhere"]).toMatch(
      /^Un pago de esta cuenta/,
    );
  });
});
