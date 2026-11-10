import { afterEach, describe, expect, it } from "vitest";
import { currentLocale, setLocale } from "./t.js";
import { helpBadgeLabel, helpEn, helpEs, helpText } from "./help-strings.js";
import { en, es } from "./strings.js";

const original = currentLocale();
afterEach(() => setLocale(original));

describe("the till's help strings", () => {
  it("falls back to English for an unknown locale and for a region it does not list", () => {
    expect(helpText("help.label", "fr-FR")).toBe(helpEn["help.label"]);
    expect(helpText("help.label", "es-MX")).toBe(helpEn["help.label"]);
    expect(helpText("help.label", "en-GB")).toBe(helpEn["help.label"]);
  });

  it("reads Spanish for es and es-ES", () => {
    expect(helpText("help.label", "es")).toBe(helpEs["help.label"]);
    expect(helpText("help.label", "es-ES")).toBe(helpEs["help.label"]);
    expect(helpEs["help.label"]).not.toBe(helpEn["help.label"]);
  });

  it("reads the active locale when none is given", () => {
    setLocale("es-ES");
    expect(helpText("help.label")).toBe(helpEs["help.label"]);
    setLocale("en-GB");
    expect(helpText("help.label")).toBe(helpEn["help.label"]);
  });

  it("fills the badge label's part as written, in the active locale", () => {
    setLocale("en-GB");
    expect(helpBadgeLabel("Profile")).toBe(helpEn["help.badge_label"].replace("{part}", "Profile"));
    expect(helpBadgeLabel("$& {part}")).toBe(
      helpEn["help.badge_label"].replace("{part}", () => "$& {part}"),
    );
    setLocale("es-ES");
    expect(helpBadgeLabel("Perfil")).toBe(helpEs["help.badge_label"].replace("{part}", "Perfil"));
  });

  it("no Spanish help text says menú", () => {
    const menuWord = /(?<!\p{L})men[úu]s?(?!\p{L})/iu;
    const saysMenu = Object.entries(helpEs).filter(([, text]) =>
      menuWord.test(text.replace(/\{[^}]*\}/g, "")),
    );
    expect(saysMenu).toEqual([]);
  });

  it("no Spanish help text says tique", () => {
    const ticketWord = /(?<!\p{L})tiques?(?!\p{L})/iu;
    const saysTicket = Object.entries(helpEs).filter(([, text]) =>
      ticketWord.test(text.replace(/\{[^}]*\}/g, "")),
    );
    expect(saysTicket).toEqual([]);
  });

  it("no Spanish help text says retenido", () => {
    const saysHeld = Object.entries(helpEs).filter(([, text]) => /retenid/i.test(text));
    expect(saysHeld).toEqual([]);
  });

  it("no Spanish help text says «pedido del mostrador»", () => {
    const saysCounterOrder = Object.entries(helpEs).filter(([, text]) =>
      /(?<!\p{L})pedidos? del mostrador(?!\p{L})/iu.test(text),
    );
    expect(saysCounterOrder).toEqual([]);
  });
});

describe("the order screen's help", () => {
  it("the order screen's Send help calls a held group by the same word", () => {
    expect(helpEs["help.order.send"]).toContain(es["table.group_held"].toLowerCase());
  });
});

describe("the order lists' help", () => {
  it("the Spanish Waiting orders help calls counter orders by the till's word for the counter", () => {
    expect(helpEs["help.counter.waiting_orders"]).toContain(es["tab.counter"].toLowerCase());
  });

  const states = ["items", "unsent", "held", "waiting", "ready"] as const;
  // \b is ASCII-only in JS, so a boundary here is "no letter on either side", accents included.
  const wholeWord = (word: string) =>
    new RegExp(`(?<!\\p{L})${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "u");
  for (const [language, help, words] of [
    ["English", helpEn, en],
    ["Spanish", helpEs, es],
  ] as const) {
    for (const key of ["help.counter.parked_orders", "help.counter.waiting_orders"] as const) {
      it(`${key} in ${language} names the five counts by their chips' words`, () => {
        for (const state of states)
          expect(help[key]).toMatch(wholeWord(words[`order_counts.${state}`].replace("{n} ", "")));
      });
    }
  }

  it('help.more.transfers drops its third sentence (owner, 2026-11-10: "Drop the third sentence (Rec.)")', () => {
    const sentences = (text: string) => text.split(/(?<=\.)\s+/).length;
    expect(sentences(helpEn["help.more.transfers"])).toBe(2);
    expect(sentences(helpEs["help.more.transfers"])).toBe(sentences(helpEn["help.more.transfers"]));
    expect(helpEn["help.more.transfers"]).not.toContain(
      "A tab offered to your department, or still yours in the zones this device serves, shows how many items it has, then how many are unsent, held, waiting or ready.",
    );
  });
});

describe("the person menu's help", () => {
  it("Fix my hours offers another day, and no place, as its dialog does", () => {
    expect(helpEn["help.person.fix_hours"]).toContain("another day you choose");
    expect(helpEn["help.person.fix_hours"]).not.toMatch(/(?<!\p{L})place(?!\p{L})/u);
    expect(helpEs["help.person.fix_hours"]).toContain("otro día que elijas");
    expect(helpEs["help.person.fix_hours"]).not.toMatch(/(?<!\p{L})lugar(?!\p{L})/u);
  });
});

describe("the floor's help on service steps", () => {
  const sentences = (text: string) => text.split(/(?<=\.)\s+/).length;
  const doneWord = (word: string) => new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, "u");

  it("the list says where Done is, by the button's word", () => {
    expect(helpEn["help.floor.tables_list"]).toContain(
      `Tap ${en["floor.step_done"]} on a service step when the guests want nothing.`,
    );
  });

  it("the map that can change today's floor says the details hold Done", () => {
    expect(helpEn["help.floor.tables_map"]).toContain(
      `Its details list a service step with ${en["floor.step_done"]}.`,
    );
  });

  it("the view-only map shows the step in the details without offering Done", () => {
    expect(helpEn["help.floor.tables_map_view"]).toContain("Its details show a service step.");
    expect(helpEn["help.floor.tables_map_view"]).not.toMatch(doneWord(en["floor.step_done"]));
    expect(helpEs["help.floor.tables_map_view"]).not.toMatch(doneWord(es["floor.step_done"]));
    expect(sentences(helpEs["help.floor.tables_map_view"])).toBe(
      sentences(helpEn["help.floor.tables_map_view"]),
    );
  });

  for (const key of ["help.floor.tables_list", "help.floor.tables_map"] as const) {
    it(`${key} in Spanish names Done by its button's word, sentence for sentence`, () => {
      expect(helpEs[key]).toMatch(doneWord(es["floor.step_done"]));
      expect(sentences(helpEs[key])).toBe(sentences(helpEn[key]));
    });
  }
});

describe("the kitchen board's help", () => {
  for (const [language, help, words, card, columns] of [
    [
      "English",
      helpEn,
      en,
      "Each card is an order from a table or the counter. Tap a dish to move it on a step, or the card's heading to move the whole card to the next column. On a Whole ticket card, the dishes move together. A dashed card is held: it hasn't been sent to cook yet. Cards turn amber, then red, the longer they wait.",
      "Tap a heading to fold its column. Use Columns to choose which columns show, and in what order.",
    ],
    [
      "Spanish",
      helpEs,
      es,
      "Cada tarjeta es un pedido de una mesa o del mostrador. Toca un plato para avanzarlo un paso, o la cabecera de la tarjeta para pasar toda la tarjeta a la siguiente columna. En una tarjeta de Toda la comanda, los platos avanzan juntos. Una tarjeta con borde discontinuo está en espera: aún no se ha mandado a preparar. Las tarjetas pasan a ámbar y luego a rojo cuanto más esperan.",
      "Toca una cabecera para plegar su columna. Con Columnas eliges qué columnas se ven y en qué orden.",
    ],
  ] as const) {
    it(`the kitchen help texts name the board's buttons and flags by their own words (${language})`, () => {
      expect(help["help.kitchen.card"]).toContain(words["station.whole_ticket"]);
      expect(help["help.kitchen.notices"]).toContain(words["station.notice.acknowledge"]);
      expect(help["help.kitchen.columns"]).toContain(words["station.columns"]);
    });

    it(`the station card's help is the owner's text of 2026-11-03 (${language})`, () => {
      expect(help["help.kitchen.card"]).toBe(card);
    });

    it(`the Columns badge's help is the owner's text of 2026-11-03 (${language})`, () => {
      expect(help["help.kitchen.columns"]).toBe(columns);
    });
  }
});

describe("the pass's help", () => {
  for (const [language, help, words] of [
    ["English", helpEn, en],
    ["Spanish", helpEs, es],
  ] as const) {
    it(`the pass card's help names Fire and Waiting for the pass by their own words (${language})`, () => {
      expect(help["help.pass.card"]).toContain(words["pass.fire"]);
      expect(help["help.pass.card"]).toContain(words["pass.waiting_for_pass"]);
    });
  }
});
