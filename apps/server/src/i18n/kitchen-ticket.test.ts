import { describe, expect, it } from "vitest";
import {
  KITCHEN_TICKET_WORDS,
  kitchenLanguageFor,
  kitchenTicketWords,
  wordingLanguage,
  type KitchenLanguage,
  type KitchenTicketWords,
} from "./kitchen-ticket.js";

describe("A964 frame catalogue", () => {
  it.each(["es", "es-ES", "es-MX", "ES-mx"])("selects Spanish for %s", (locale) => {
    expect(kitchenLanguageFor(locale)).toBe("es");
    expect(kitchenTicketWords(locale)).toBe(KITCHEN_TICKET_WORDS.es);
  });
  it.each(["en", "en-GB", "de-DE", "ca-ES-valencia", "", "esperanto"])(
    "falls back to English for %s",
    (locale) => {
      expect(kitchenLanguageFor(locale)).toBe("en");
      expect(kitchenTicketWords(locale)).toBe(KITCHEN_TICKET_WORDS.en);
    },
  );
  it.each(
    (Object.keys(KITCHEN_TICKET_WORDS) as KitchenLanguage[]).filter(
      (language) => language !== "en",
    ),
  )("provides every frame word in %s, with translated operational markers", (language) => {
    const words = KITCHEN_TICKET_WORDS[language];
    expect(Object.keys(words).sort()).toEqual(Object.keys(KITCHEN_TICKET_WORDS.en).sort());
    for (const key of [
      "group",
      "hold",
      "fire",
      "void",
      "recalled",
      "holdChanged",
      "holdCancelled",
      "reprint",
    ] as const) {
      expect(words[key]).not.toBe(KITCHEN_TICKET_WORDS.en[key]);
      expect(words[key].trim()).not.toBe("");
    }
  });
  it("chooses a language added to the ticket words without any other change", () => {
    const catalogue = KITCHEN_TICKET_WORDS as Record<string, KitchenTicketWords>;
    const catalan = { ...KITCHEN_TICKET_WORDS.en, order: "Comanda" };
    catalogue.ca = catalan;
    try {
      expect(kitchenLanguageFor("ca-ES")).toBe("ca");
      expect(kitchenTicketWords("ca-ES-valencia")).toBe(catalan);
      expect(kitchenLanguageFor("es-ES")).toBe("es");
      expect(kitchenLanguageFor("fr-FR")).toBe("en");
    } finally {
      delete catalogue.ca;
    }
  });
});

describe("wording language chooser", () => {
  const available = ["en", "es", "ca"] as const;
  it.each([
    ["ca-ES", "ca"],
    ["ca-ES-valencia", "ca"],
    ["CA", "ca"],
    ["fr-FR", "en"],
    ["es-MX", "es"],
    ["", "en"],
  ])("chooses %s as %s from an injected list", (locale, expected) => {
    expect(wordingLanguage(available, locale, "en")).toBe(expected);
  });
  it.each([
    ["pt-BR", "pt-BR"],
    ["pt-br", "pt-BR"],
    ["pt-PT", "pt"],
  ])("prefers a regional wording over its bare language: %s as %s", (locale, expected) => {
    expect(wordingLanguage(["en", "pt", "pt-BR"], locale, "en")).toBe(expected);
  });
});
