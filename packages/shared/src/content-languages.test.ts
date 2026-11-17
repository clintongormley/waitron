import { describe, expect, it, vi } from "vitest";
import { capitaliseFirst } from "./capitalise.js";
import {
  contentLanguageCode,
  contentLanguageChoices,
  contentLanguageTag,
  contentLanguageDisplayName,
  isRegionalContentLanguage,
  languageDisplayName,
  resolveContentText,
  resolveEnabledContentText,
  resolveSnapshotText,
} from "./content-languages.js";

describe("content languages", () => {
  it("offers named languages beyond the interface menu without duplicate aliases", () => {
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
      expect(choice.name).toBe(capitaliseFirst(names.of(choice.code)!, "en-GB"));
      expect(["und", "mul", "zxx", "zz"]).not.toContain(choice.code);
    }
    expect(choices.map(({ name }) => name)).toEqual(
      choices.map(({ name }) => name).sort((a, b) => a.localeCompare(b, "en-GB")),
    );
    expect(contentLanguageChoices("es-ES").find(({ code }) => code === "fr")?.name).toBe("Francés");
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

  it("answers a repeated request from its cache instead of deriving the names again", () => {
    // Deriving the list again has to build a DisplayNames; a cached answer never touches one.
    // The length assertion below stops a both-empty pass. The mock implementation must be a
    // `function` expression: an arrow is not a constructor, so `new Intl.DisplayNames(...)` throws.
    const locale = "pt-PT";
    const expected = contentLanguageChoices(locale);
    expect(expected.length).toBeGreaterThan(0);
    const spy = vi.spyOn(Intl, "DisplayNames").mockImplementation(function (): Intl.DisplayNames {
      return { of: () => undefined } as unknown as Intl.DisplayNames;
    } as unknown as typeof Intl.DisplayNames);
    try {
      expect(contentLanguageChoices(locale)).toEqual(expected);
    } finally {
      spy.mockRestore();
    }
  });

  it.each(["es", "en", "ca", "gl", "eu", "fr", "de", "it", "ar", "ja"])(
    "accepts %s independently of shipped interface translations",
    (language) => expect(contentLanguageCode(language)).toBe(language),
  );

  it("matches full browser and receipt tags to menu languages", () => {
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

  it("for a regional request, takes the exact tag, then the bare language, then a default in another language", () => {
    const text = { "en-US": "US", "en-AU": "AU", english: "Unrelated", fr: "French" };
    expect(resolveContentText(text, "en-CA", "fr")).toBe("French");
    expect(resolveContentText(text, "en-US", "fr")).toBe("US");
    expect(resolveContentText({ ...text, en: "Bare" }, "en-CA", "fr")).toBe("Bare");
  });

  it("falls back to the default rather than another region of the requested language", () => {
    const text = { "es-MX": "MX", fr: "FR" };
    expect(resolveContentText(text, "es-ES", "fr")).toBe("FR");
    expect(resolveSnapshotText(text, "es-ES", "fr")).toBe("FR");
  });

  it("still takes a region of the language for a bare request or a bare default", () => {
    expect(resolveContentText({ "en-AU": "AU", fr: "French" }, "en", "fr")).toBe("AU");
    expect(resolveContentText({ "en-AU": "AU", fr: "French" }, "EN", "fr")).toBe("AU");
    expect(resolveContentText({ "es-MX": "MX", fr: "FR" }, "es-ES", "es")).toBe("MX");
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

describe("language display name", () => {
  it("names a tag's language in the display language, capitalised to stand alone", () => {
    expect(languageDisplayName("ca-ES", "es-ES")).toBe("Catalán");
    expect(languageDisplayName("ca-ES", "en-GB")).toBe("Catalan");
  });

  it("leaves the name as it reads inside a sentence when it does not stand alone", () => {
    expect(languageDisplayName("ca-ES", "es-ES", false)).toBe("catalán");
  });

  it.each(["not-a-language", "zz", ""])("returns %j, which is not a language, as it is", (tag) =>
    expect(languageDisplayName(tag, "es-ES")).toBe(tag),
  );

  it("returns the tag as it is when the display language has no name for it", () => {
    expect(languageDisplayName("aeb-TN", "en-GB")).toBe("Tunisian Arabic");
    expect(languageDisplayName("aeb-TN", "es-ES")).toBe("aeb-TN");
  });

  it("builds the names for a display language once, and again only for another language", () => {
    // A plain spy's call-through loses the instance's `of`, so the mock builds a real one.
    expect(languageDisplayName("fr", "de-DE")).toBe("Französisch");
    const RealDisplayNames = Intl.DisplayNames;
    const spy = vi.spyOn(Intl, "DisplayNames").mockImplementation(function (
      ...args: ConstructorParameters<typeof Intl.DisplayNames>
    ): Intl.DisplayNames {
      return new RealDisplayNames(...args);
    } as unknown as typeof Intl.DisplayNames);
    try {
      expect(languageDisplayName("ca-ES", "de-DE")).toBe("Katalanisch");
      expect(spy).not.toHaveBeenCalled();
      expect(languageDisplayName("ca-ES", "nl-NL")).toBe("Catalaans");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(languageDisplayName("fr", "nl-NL")).toBe("Frans");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

const presentation = {
  officialLocales: ["ca-ES-valencia"],
  names: { "ca-ES-valencia": { en: "Valencian", es: "valenciano" } },
};

describe("Valencian content language", () => {
  const valencian = "ca-ES-valencia";
  it("keeps the canonical Valencian variant apart from Catalan", () => {
    expect(contentLanguageCode(valencian)).toBe(valencian);
    expect(contentLanguageCode("CA-es-VALENCIA-u-nu-latn")).toBe(valencian);
    expect(contentLanguageCode("ca-ES")).toBe("ca");
  });
  it.each([
    ["en", "Valencian"],
    ["es", "Valenciano"],
  ])("offers and names Valencian in %s", (locale, name) => {
    expect(contentLanguageChoices(locale, presentation)).toContainEqual({ code: valencian, name });
    expect(languageDisplayName(valencian, locale, true, presentation)).toBe(name);
    expect(languageDisplayName(valencian, locale, false, presentation)).toBe(
      locale === "es" ? "valenciano" : "Valencian",
    );
  });
  it("does not borrow Catalan text for Valencian or Valencian text for Catalan", () => {
    expect(resolveContentText({ ca: "Catalan", es: "Spanish" }, valencian, "es")).toBe("Spanish");
    expect(resolveContentText({ [valencian]: "Valencian", es: "Spanish" }, "ca", "es")).toBe(
      "Spanish",
    );
    expect(resolveContentText({ "ca-ES": "Catalan" }, valencian, valencian)).toBe("");
    expect(resolveContentText({ [valencian]: "Valencian" }, "ca-ES", "ca")).toBe("");
  });
  it("selects enabled Valencian without enabling Catalan", () => {
    const map = { ca: "Catalan", [valencian]: "Valencian", es: "Spanish" };
    const config = { defaultLanguage: "es", languages: ["es", valencian] };
    expect(resolveEnabledContentText(map, valencian, config)).toBe("Valencian");
    expect(resolveEnabledContentText(map, "CA-es-VALENCIA-u-nu-latn", config)).toBe("Valencian");
    expect(resolveEnabledContentText(map, "ca", config)).toBe("Spanish");
    expect(
      resolveEnabledContentText(map, valencian, { defaultLanguage: "es", languages: ["es", "ca"] }),
    ).toBe("Spanish");
    expect(map).toEqual({ ca: "Catalan", [valencian]: "Valencian", es: "Spanish" });
  });
  it("selects a stored Valencian snapshot and an explicit Catalan default separately", () => {
    expect(resolveSnapshotText({ ca: "Catalan", [valencian]: "Valencian" }, valencian, "ca")).toBe(
      "Valencian",
    );
    expect(resolveContentText({ ca: "Catalan" }, valencian, "ca")).toBe("Catalan");
  });
});

it("uses the runtime name for Valencian outside English and Spanish", () => {
  expect(languageDisplayName("ca-ES-valencia", "ca", false)).toBe(
    new Intl.DisplayNames(["ca"], { type: "language", fallback: "none" }).of("ca-ES-valencia"),
  );
});

it("retains matching of a legacy malformed regional key", () => {
  expect(resolveContentText({ "en-invalid!": "Legacy", fr: "French" }, "en", "fr")).toBe("Legacy");
});

it.each(["ca-valencia", "ca-Latn-ES-valencia", "ca-AD-valencia", "ca-ES-fonipa-valencia"])(
  "keeps %s as its own independent variant",
  (tag) => {
    expect(contentLanguageCode(tag)).toBe(tag);
    expect(
      resolveContentText(
        { ca: "Catalan", "ca-ES-valencia": "Valencian", es: "Spanish" },
        tag,
        "es",
      ),
    ).toBe("Spanish");
    expect(
      resolveEnabledContentText(
        { ca: "Catalan", "ca-ES-valencia": "Valencian", es: "Spanish" },
        tag,
        { defaultLanguage: "es", languages: ["ca", "ca-ES-valencia", "es"] },
      ),
    ).toBe("Spanish");
  },
);
it("keeps alternate variant maps independent", () => {
  expect(
    resolveContentText(
      { "ca-valencia": "Valencian", ca: "Catalan", es: "Spanish" },
      "ca-ES-valencia",
      "es",
    ),
  ).toBe("Spanish");
  expect(resolveContentText({ "ca-valencia": "Valencian", es: "Spanish" }, "ca", "es")).toBe(
    "Spanish",
  );
});

it("keeps regional overrides out of live main/default fallback and removed-region requests", () => {
  const config = { defaultLanguage: "en", languages: ["en", "en-US", "es"] };
  const map = { "en-US": "fries" };
  expect(resolveEnabledContentText(map, "en-US", config)).toBe("fries");
  for (const language of ["en", "en-GB", "es", "en-CA"]) {
    expect(resolveEnabledContentText(map, language, config)).toBe("");
  }
  expect(resolveEnabledContentText(map, "en-US", { ...config, languages: ["en", "es"] })).toBe("");
  expect(resolveSnapshotText(map, "en", "en")).toBe("fries");
  expect(resolveContentText(map, "en", "en")).toBe("fries");
});

it.each([
  ["sl-rozaj", "sl-rozaj"],
  ["de-1901", "de-1901"],
  ["CA-latn-es-VALENCIA-u-nu-latn", "ca-Latn-ES-valencia"],
  ["en-Latn-US-u-nu-latn", "en"],
])("derives main-language identity for %s", (tag, expected) => {
  expect(contentLanguageCode(tag)).toBe(expected);
});
it("keeps canonical variants and strips extensions from content tags", () => {
  expect(contentLanguageTag("sl-ROZAJ-u-nu-latn")).toBe("sl-rozaj");
  for (const tag of ["en-US-t-es", "en-US-x-guest", "en-US-9-demo"]) {
    expect(contentLanguageTag(tag)).toBe("en-US");
  }
  expect(contentLanguageTag("ca-AD-valencia")).toBe("ca-AD-valencia");
});
it("adds pack variants with short names without caching another pack's labels", () => {
  const data = {
    officialLocales: ["sl-rozaj", "sl-rozaj", "en-US"],
    names: { "sl-rozaj": { en: "Pack variant", es: "short variant" } },
  };
  const choices = contentLanguageChoices("en-GB", data);
  expect(choices.filter(({ code }) => code === "sl-rozaj")).toEqual([
    { code: "sl-rozaj", name: "Pack variant" },
  ]);
  const names = choices.map(({ name }) => name);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en-GB")));
  expect(languageDisplayName("sl-rozaj", "es-ES", false, data)).toBe("short variant");
  expect(contentLanguageDisplayName("sl-rozaj", "es-ES", data)).toBe("Short variant");
  expect(contentLanguageChoices("en-GB").some(({ code }) => code === "sl-rozaj")).toBe(false);
  expect(
    contentLanguageChoices("en-GB", {
      ...data,
      names: { "sl-rozaj": { en: "Another name" } },
    }).find(({ code }) => code === "sl-rozaj")?.name,
  ).toBe("Another name");
  expect(contentLanguageChoices("en-GB", data).some(({ code }) => code === "en-US")).toBe(false);
  expect(languageDisplayName("sl-rozaj", "fr", false, data)).toBe(
    new Intl.DisplayNames(["fr"], { type: "language", fallback: "none" }).of("sl-rozaj"),
  );
});

it("keeps aliases that canonicalize to extensions out of main variant identity", () => {
  expect(contentLanguageCode("en-US-posix")).toBe("en");
  expect(contentLanguageTag("en-US-posix")).toBe("en-US");
  expect(isRegionalContentLanguage("en-US-posix")).toBe(true);
  expect(contentLanguageCode("en-US-u-va-posix")).toBe("en");
});
