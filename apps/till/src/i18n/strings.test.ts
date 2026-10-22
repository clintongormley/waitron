import { describe, expect, it } from "vitest";
import { catalogues, en, es } from "./strings.js";

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
      "A bill on this table owes nothing but still holds money. Refund it before finishing the table",
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
    ["en-GB", "This order still holds money from a payment. Refund it before discarding the order"],
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

describe("the floor's held chip, the Waiting chip's own word, and no retenido in the catalogue", () => {
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

  it("the Waiting chip does not use held's word", () => {
    const waiting = es["signal.wait_warm"].toLowerCase();
    expect(waiting).not.toContain(es["table.group_held"].toLowerCase());
    expect(es["signal.wait_warm"]).not.toBe(en["signal.wait_warm"]);
  });
});

describe("the words for an order's item counts", () => {
  const counts = ["items", "unsent", "held", "waiting", "ready"] as const;

  it.each(counts)(
    "order_counts.%s has a plural with {n} and a singular in both languages",
    (name) => {
      for (const strings of [en, es]) {
        expect(strings[`order_counts.${name}`]).toContain("{n}");
        expect(strings[`order_counts.${name}_one`]).toMatch(/^1 \S/);
        expect(strings[`order_counts.${name}_one`]).not.toContain("{n}");
      }
    },
  );

  it("says held with the order screen's word", () => {
    const held = es["table.group_held"].toLowerCase();
    expect(es["order_counts.held"]).toBe(`{n} ${held}`);
    expect(es["order_counts.held_one"]).toBe(`1 ${held}`);
  });

  it("says waiting with the Waiting chip's word, not held's", () => {
    const waiting = es["signal.wait_warm"].toLowerCase();
    expect(es["order_counts.waiting"]).toContain(waiting);
    expect(es["order_counts.waiting_one"]).toContain(waiting);
    expect(es["order_counts.waiting"]).not.toContain(es["table.group_held"].toLowerCase());
    expect(es["order_counts.waiting_one"]).not.toContain(es["table.group_held"].toLowerCase());
  });

  it("says items with the floor's unsent-order word", () => {
    expect(es["order_counts.items"]).toBe(es["floor.unsent"].split(": ")[1]);
    expect(es["order_counts.items_one"]).toBe(es["floor.unsent_one"].split(": ")[1]);
  });

  it("says unsent with the floor's Unsent mark", () => {
    const unsent = es["floor.unsent_mark"].toLowerCase();
    expect(es["order_counts.unsent"]).toBe(`{n} ${unsent}`);
    expect(es["order_counts.unsent_one"]).toBe(`1 ${unsent}`);
  });

  it("says ready with the order screen's ready flash", () => {
    expect(es["order_counts.ready"]).toBe(es["table.flash_ready"]);
    expect(es["order_counts.ready_one"]).toBe(es["table.flash_ready_one"]);
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

  it.each(["en-GB", "es-ES"])(
    "bill_pay.unconfirmed_elsewhere_handheld (%s) names a handheld's Pay button, then Check again",
    (locale) => {
      const strings = catalogues[locale]!;
      const message = strings["bill_pay.unconfirmed_elsewhere_handheld"]!;
      expect(message).toContain(strings["action.pay"]!);
      expect(message).not.toContain(strings["bill_pay.way_items"]!);
      expect(message.indexOf(strings["action.pay"]!)).toBeLessThan(
        message.indexOf(strings["bill_pay.recheck"]!),
      );
    },
  );

  it.each(["bill_pay.unconfirmed_elsewhere", "bill_pay.unconfirmed_elsewhere_handheld"] as const)(
    "%s calls it a payment in Spanish, as bill_pay.unconfirmed does",
    (key) => {
      expect(catalogues["es-ES"]![key]).toMatch(/^Un pago de esta cuenta/);
    },
  );
});

describe("a service step's Done", () => {
  it("says Done, and names the step for the button's accessible name, in both languages", () => {
    expect(en["floor.step_done"]).toBe("Done");
    expect(es["floor.step_done"]).toBe("Hecho");
    expect(en["floor.step_done_label"]).toBe("Done: {step}");
    expect(es["floor.step_done_label"]).toBe("Hecho: {step}");
  });

  it("says Done with the till's other Done in Spanish", () => {
    expect(es["floor.step_done"]).toBe(es["make_now.dismiss"]);
  });
});

describe("the till's comp words follow the Comp window's (design D10)", () => {
  // Weaker than its name: it reads only the keys starting comp. or adjust., and table.discount_bill,
  // of the catalogue in strings.ts, so a till string inviting someone to an account is not refused;
  // codes.ts's messages are pinned in codes.test.ts.
  const compKeys = (strings: Record<string, string>) =>
    Object.entries(strings).filter(
      ([key]) =>
        key.startsWith("comp.") || key.startsWith("adjust.") || key === "table.discount_bill",
    );

  it.each([
    ["en", en],
    ["es", es],
  ])("titles a comp with the Comp window's word (%s)", (_, strings) => {
    const word = strings["comp.title"].replace(/…$/, "");
    expect(strings["adjust.comp_title"].startsWith(word)).toBe(true);
    expect(strings["adjust.comp_extra_title"].startsWith(word)).toBe(true);
  });

  it.each([
    ["en", en],
    ["es", es],
  ])("names a free comp with the Free choice's word (%s)", (_, strings) => {
    const free = strings["comp.free"].toLowerCase();
    expect(strings["comp.make_free"].toLowerCase()).toContain(free);
    expect(strings["adjust.do_comp"].toLowerCase()).toContain(free);
  });

  it("has no Spanish comp string that says invitar", () => {
    expect(compKeys(es).filter(([, text]) => /invit/i.test(text))).toEqual([]);
  });

  it("has no English comp string that says give … away", () => {
    expect(compKeys(en).filter(([, text]) => /\bgiv(e|en|ing)\b[^.]*\baway\b/i.test(text))).toEqual(
      [],
    );
  });
});
