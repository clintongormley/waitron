import { describe, expect, it } from "vitest";
import { KITCHEN_TICKET_WORDS, kitchenLanguageFor, kitchenTicketWords } from "./kitchen-ticket.js";

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
  it("provides every frame word in both languages, with translated operational markers", () => {
    expect(Object.keys(KITCHEN_TICKET_WORDS.es).sort()).toEqual(
      Object.keys(KITCHEN_TICKET_WORDS.en).sort(),
    );
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
      expect(KITCHEN_TICKET_WORDS.es[key]).not.toBe(KITCHEN_TICKET_WORDS.en[key]);
      expect(KITCHEN_TICKET_WORDS.es[key].trim()).not.toBe("");
    }
  });
});
