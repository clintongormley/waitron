import { describe, expect, it } from "vitest";
import { GUIDE_PAGES } from "../guide-catalogue.js";

describe("guide frame wording", () => {
  it.each([
    [
      "en",
      "Waitron guide",
      "Page not found",
      "There is no guide page at this address.",
      "Page unavailable",
      "This guide page could not be shown.",
    ],
    [
      "es",
      "Guía de Waitron",
      "Página no encontrada",
      "No hay ninguna página de la guía en esta dirección.",
      "Página no disponible",
      "No se ha podido mostrar esta página de la guía.",
    ],
  ] as const)(
    "provides the %s trail and the not-found and broken pages' words",
    async (lang, trail, notFoundTitle, notFound, brokenTitle, broken) => {
      const { GUIDE_FRAME_WORDS } = await import("./guide-pages.js");
      expect(GUIDE_FRAME_WORDS[lang]).toMatchObject({
        trail,
        notFoundTitle,
        notFound,
        brokenTitle,
        broken,
      });
    },
  );

  it("provides the Spanish line saying a page fell back to English", async () => {
    const { GUIDE_FRAME_WORDS } = await import("./guide-pages.js");
    expect(GUIDE_FRAME_WORDS.es.missingTwin).toBe(
      "Esta página aún no está en español. Se muestra en inglés.",
    );
  });

  it.each(["en", "es"] as const)("names every guide page in %s", async (lang) => {
    const { GUIDE_FRAME_WORDS } = await import("./guide-pages.js");
    expect(Object.keys(GUIDE_FRAME_WORDS[lang].names).sort()).toEqual([...GUIDE_PAGES].sort());
    for (const page of GUIDE_PAGES) {
      expect(GUIDE_FRAME_WORDS[lang].names[page]).toMatch(/\S/);
    }
  });
});
