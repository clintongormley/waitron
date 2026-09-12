import { describe, expect, it } from "vitest";
import {
  contentLanguageCode,
  contentLanguageChoices,
  resolveContentText,
  resolveEnabledContentText,
  resolveSnapshotText,
} from "./content-languages.js";

describe("content languages", () => {
  it("offers named languages beyond the interface catalogue without duplicate aliases", () => {
    const choices = contentLanguageChoices("en-GB");
    expect(choices).toEqual(
      expect.arrayContaining([
        { code: "fr", name: "French" },
        { code: "ca", name: "Catalan" },
        { code: "ja", name: "Japanese" },
        { code: "fil", name: "Filipino" },
        { code: "zu", name: "Zulu" },
        { code: "az", name: "Azerbaijani" },
        { code: "gez", name: "Geez" },
      ]),
    );
    expect(new Set(choices.map(({ code }) => code)).size).toBe(choices.length);
    const names = new Intl.DisplayNames(["en-GB"], { type: "language", fallback: "none" });
    for (const choice of choices) {
      expect(choice).toEqual({ code: expect.any(String), name: expect.any(String) });
      expect(choice.code).toBe(new Intl.Locale(choice.code).language);
      expect(choice.name).toBe(names.of(choice.code));
      expect(["und", "mul", "zxx", "zz"]).not.toContain(choice.code);
    }
    expect(choices.map(({ name }) => name)).toEqual(
      choices.map(({ name }) => name).sort((a, b) => a.localeCompare(b, "en-GB")),
    );
    expect(contentLanguageChoices("es-ES").find(({ code }) => code === "fr")?.name).toBe("francés");
  });
  it("returns independent choices when another editor changes its copy", () => {
    const first = contentLanguageChoices("fr-FR");
    const saved = first.map((choice) => ({ ...choice }));
    first[0]!.name = "Changed by an editor";
    first.pop();
    const second = contentLanguageChoices("fr-FR");
    expect(second).toEqual(saved);
    second[0]!.code = "invalid";
    second.push({ code: "invalid", name: "Invalid" });
    expect(contentLanguageChoices("fr-FR")).toEqual(saved);
  });

  it.each(["es", "en", "ca", "gl", "eu", "fr", "de", "it", "ar", "ja"])(
    "accepts %s independently of shipped interface translations",
    (language) => expect(contentLanguageCode(language)).toBe(language),
  );

  it("matches full browser and receipt tags to catalogue languages", () => {
    expect(contentLanguageCode("en-GB")).toBe("en");
    expect(contentLanguageCode("ES-es")).toBe("es");
  });

  it.each(["", " ", "not-a-language", "zz", "../../en", "en_GB", "und", "mul", "zxx"])(
    "refuses invalid or unknown language %j",
    (language) =>
      expect(() => contentLanguageCode(language)).toThrowError(
        expect.objectContaining({ code: "content.language_invalid" }),
      ),
  );

  it("uses the configured default, regardless of translation insertion order", () => {
    expect(resolveContentText({ en: "Bread", es: "Pan" }, "fr", "es")).toBe("Pan");
    expect(resolveContentText({ es: "Pan", en: "Bread" }, "fr", "en")).toBe("Bread");
  });

  it("uses the requested translation and treats blank text as missing", () => {
    expect(resolveContentText({ en: "Bread", es: "Pan" }, "en-GB", "es")).toBe("Bread");
    expect(resolveContentText({ en: "  ", es: "Pan" }, "en", "es")).toBe("Pan");
    expect(resolveContentText({ en: "", es: "Pan" }, "en", "es")).toBe("Pan");
  });

  it("does not present an unrelated language as the default or inherit object properties", () => {
    expect(resolveContentText({ en: "Bread" }, "fr", "es")).toBe("");
    expect(resolveContentText({}, "constructor", "toString")).toBe("");
  });

  it("chooses a deterministic regional variant after exact and bare matches", () => {
    const text = { "en-US": "US", "en-AU": "AU", english: "Unrelated", fr: "French" };
    expect(resolveContentText(text, "en-CA", "fr")).toBe("AU");
    expect(resolveContentText(text, "en-US", "fr")).toBe("US");
    expect(resolveContentText({ ...text, en: "Bare" }, "en-CA", "fr")).toBe("Bare");
  });

  it("resolves historical full-tag maps without modifying their snapshot", () => {
    const descriptions = { "es-ES": "Pan", "en-GB": "Bread" };
    expect(resolveContentText(descriptions, "en-GB", "es")).toBe("Bread");
    expect(resolveContentText(descriptions, "fr", "es")).toBe("Pan");
    expect(descriptions).toEqual({ "es-ES": "Pan", "en-GB": "Bread" });
  });
});

describe("enabled content text", () => {
  const config = { defaultLanguage: "fr", languages: ["fr", "en"] };
  const translations = { fr: "Eau", en: "Water", es: "Agua" };

  it("uses an enabled request, matches regional tags and falls back for missing text", () => {
    expect(resolveEnabledContentText(translations, "en-GB", config)).toBe("Water");
    expect(resolveEnabledContentText({ ...translations, en: " " }, "en-GB", config)).toBe("Eau");
    expect(resolveEnabledContentText(translations, "EN-gb", config)).toBe("Water");
  });

  it("retains disabled translations but never selects them for display", () => {
    expect(resolveEnabledContentText(translations, "es", config)).toBe("Eau");
    expect(
      resolveEnabledContentText(translations, "en", { defaultLanguage: "fr", languages: ["fr"] }),
    ).toBe("Eau");
    expect(translations).toEqual({ fr: "Eau", en: "Water", es: "Agua" });
  });

  it("falls back for an invalid request and returns empty when the default is absent", () => {
    expect(resolveEnabledContentText(translations, "not_a_language", config)).toBe("Eau");
    expect(resolveEnabledContentText({ es: "Agua" }, "es", config)).toBe("");
  });
});

describe("receipt snapshot text", () => {
  it("keeps a receipt-only name visible when the content default is absent", () => {
    const snapshot = { "es-ES": "Pan" };
    expect(resolveSnapshotText(snapshot, "en-GB", "ca")).toBe("Pan");
    expect(
      resolveEnabledContentText(snapshot, "en-GB", {
        defaultLanguage: "ca",
        languages: ["ca"],
      }),
    ).toBe("");
    expect(snapshot).toEqual({ "es-ES": "Pan" });
  });

  it("uses a stored requested language before the current content default", () => {
    expect(resolveSnapshotText({ "es-ES": "Pan", "ca-ES": "Pa" }, "ES-es", "ca")).toBe("Pan");
    expect(resolveSnapshotText({ "es-ES": "Pan", "ca-ES": "Pa" }, "en-GB", "ca")).toBe("Pa");
  });

  it("uses a deterministic nonblank snapshot fallback independent of insertion order", () => {
    expect(resolveSnapshotText({ "fr-FR": "Pain", "de-DE": "Brot", ar: " " }, "en", "ca")).toBe(
      "Brot",
    );
    expect(resolveSnapshotText({ "de-DE": "Brot", "fr-FR": "Pain" }, "en", "ca")).toBe("Brot");
    expect(resolveSnapshotText({}, "en", "ca")).toBe("");
    expect(resolveSnapshotText({ "es-ES": " " }, "en", "ca")).toBe("");
  });

  it("uses the configured fallback for an invalid display preference", () => {
    expect(resolveSnapshotText({ "es-ES": "Pan", "ca-ES": "Pa" }, "not_a_locale", "ca")).toBe("Pa");
  });
});
