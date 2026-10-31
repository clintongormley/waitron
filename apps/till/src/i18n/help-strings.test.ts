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
    const tiqueWord = /(?<!\p{L})tiques?(?!\p{L})/iu;
    const saysTique = Object.entries(helpEs).filter(([, text]) =>
      tiqueWord.test(text.replace(/\{[^}]*\}/g, "")),
    );
    expect(saysTique).toEqual([]);
  });

  it("no Spanish help text says retenido", () => {
    const saysRetenido = Object.entries(helpEs).filter(([, text]) => /retenid/i.test(text));
    expect(saysRetenido).toEqual([]);
  });
});

describe("the order screen's help", () => {
  it("the order screen's Send help calls a held group by the same word", () => {
    expect(helpEs["help.order.send"]).toContain(es["table.group_held"].toLowerCase());
  });
});

describe("the order lists' help", () => {
  const states = ["items", "unsent", "held", "waiting", "ready"] as const;
  // \b is ASCII-only in JS, so a boundary here is "no letter on either side", accents included.
  const wholeWord = (word: string) =>
    new RegExp(`(?<!\\p{L})${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "u");
  for (const [language, help, words] of [
    ["English", helpEn, en],
    ["Spanish", helpEs, es],
  ] as const) {
    for (const key of [
      "help.counter.parked_orders",
      "help.counter.waiting_orders",
      "help.more.transfers",
    ] as const) {
      it(`${key} in ${language} names the five counts by their chips' words`, () => {
        for (const state of states)
          expect(help[key]).toMatch(wholeWord(words[`order_counts.${state}`].replace("{n} ", "")));
      });
    }
  }

  it("help.more.transfers says which tabs show the counts", () => {
    expect(helpEn["help.more.transfers"]).toContain(
      "A tab offered to your department, or still yours in the zones this device serves, shows how many items it has, then how many are unsent, held, waiting or ready.",
    );
    const sentences = (text: string) => text.split(/(?<=\.)\s+/).length;
    expect(sentences(helpEs["help.more.transfers"])).toBe(sentences(helpEn["help.more.transfers"]));
    expect(sentences(helpEn["help.more.transfers"])).toBe(3);
  });
});

describe("the floor's help on service steps", () => {
  const sentences = (text: string) => text.split(/(?<=\.)\s+/).length;
  const doneWord = (word: string) => new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, "u");

  it("the list says where Done is, by the button's word, and only where it shows", () => {
    expect(helpEn["help.floor.tables_list"]).toContain(
      `A card with a service step has ${en["floor.step_done"]}, if you may take orders: tap it when the guests want nothing.`,
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
  for (const [language, help, words] of [
    ["English", helpEn, en],
    ["Spanish", helpEs, es],
  ] as const) {
    it(`the kitchen help texts name the board's buttons and flags by their own words (${language})`, () => {
      expect(help["help.kitchen.card"]).toContain(words["station.whole_ticket"]);
      expect(help["help.kitchen.notices"]).toContain(words["station.notice.acknowledge"]);
      expect(help["help.kitchen.columns"]).toContain(words["station.columns"]);
    });
  }
});
