import { expect, it } from "vitest";
import { guestMenuWords } from "./guest-menu.js";
it.each([
  ["es-MX", "en", "es", "Trigo"],
  ["ca-ES-valencia", "en", "ca", "Blat"],
  ["gl", "en", "gl", "Trigo"],
  ["de", "es", "es", "Trigo"],
  ["de", "fr", "en", "Wheat"],
])(
  "selects a complete wording bundle for %s, default %s",
  (requested, fallback, language, wheat) => {
    const result = guestMenuWords(requested, fallback);
    expect(result.language).toBe(language);
    expect(result.text.wheat).toBe(wheat);
    expect(result.text.nuts).toBeTruthy();
    expect(result.text.keyLanguage).toContain(
      language === "en"
        ? "English"
        : language === "es"
          ? "español"
          : language === "ca"
            ? "català"
            : "galego",
    );
    expect(Object.values(result.text).every(Boolean)).toBe(true);
  },
);

it("uses the first phone language with a registered wording bundle", () => {
  expect(guestMenuWords(["fr", "gl-ES"], "es")).toMatchObject({
    language: "gl",
    text: { unavailable: "Carta non dispoñible" },
  });
});

it.each([
  ["en", "No dishes match your search."],
  ["es", "Ningún plato coincide con tu búsqueda."],
  ["ca", "Cap plat coincideix amb la teva cerca."],
  ["gl", "Ningún prato coincide coa túa busca."],
])("gives a one-sentence empty search status in %s", (language, status) => {
  expect(guestMenuWords(language, "en").text.noDishes).toBe(status);
});
