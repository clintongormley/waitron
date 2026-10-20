import { describe, expect, it } from "vitest";
import type {
  TranslationCell,
  TranslationItemPage,
} from "@waitron/catalogue/src/content-translation-types.js";
import { DashboardApi } from "./client.js";

const emptyPage: TranslationItemPage = {
  config: { defaultLanguage: "en", languages: ["en", "es", "fr", "ca-ES-valencia"] },
  required: ["es"],
  configuration: "configuration-1",
  rows: [],
  total: 0,
  next: null,
};

describe("multilingual translation transport", () => {
  it("encodes the projected languages and every independent listing filter on one read", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const response = {
      config: { defaultLanguage: "en", languages: ["en", "es", "ca-ES-valencia"] },
      required: ["es"],
      configuration: "configuration-1",
      rows: [],
      total: 0,
      next: null,
    };
    const api = new DashboardApi("", async (path, init) => {
      calls.push({ path, init: init! });
      return new Response(JSON.stringify(response));
    });
    expect(
      await api.background.getContentTranslationTargets({
        languages: ["es", "ca-ES-valencia"],
        missing: { mode: "language", language: "en" },
        kind: "included_menu",
        search: "Bread & oil / €",
        after: '{"id":"a&b"}',
        waitingFixes: true,
      }),
    ).toEqual(response);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(
      "/management-api/content-translations?language=es&language=ca-ES-valencia&missing=language&missingLanguage=en&kind=included_menu&search=Bread+%26+oil+%2F+%E2%82%AC&after=%7B%22id%22%3A%22a%26b%22%7D&waitingFixes=1",
    );
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.body).toBeUndefined();
    expect(new Headers(calls[0]!.init.headers).get("x-waitron-live")).toBe("1");
  });

  it.each(["any", "all"] as const)(
    "sends Missing in %s without inventing a missing-language restriction",
    async (mode) => {
      const calls: string[] = [];
      const api = new DashboardApi("", async (path) => {
        calls.push(path);
        return new Response(JSON.stringify(emptyPage));
      });
      await api.getContentTranslationTargets({ languages: ["en"], missing: { mode } });
      expect(calls).toEqual([`/management-api/content-translations?language=en&missing=${mode}`]);
    },
  );

  it("reads exact retained items with repeated references and no discovery filters", async () => {
    const calls: string[] = [];
    const api = new DashboardApi("", async (path) => {
      calls.push(path);
      return new Response(JSON.stringify(emptyPage));
    });
    await api.getContentTranslationTargets({
      languages: ["en", "fr"],
      targets: [
        { kind: "included_menu", id: "include:a&b" },
        { kind: "unit", id: "c d/€" },
      ],
    });
    expect(calls).toEqual([
      "/management-api/content-translations?language=en&language=fr&target=included_menu%3Ainclude%3Aa%26b&target=unit%3Ac+d%2F%E2%82%AC",
    ]);
  });

  it("sends one complete multilingual batch including an abbreviation clear and keeps writes active", async () => {
    const calls: { path: string; init: RequestInit }[] = [];
    const input = {
      edits: [
        {
          kind: "product" as const,
          id: "p",
          language: "es",
          field: "name" as const,
          expected: "es-v1",
          text: " Nombre ",
        },
        {
          kind: "product" as const,
          id: "p",
          language: "fr",
          field: "name" as const,
          expected: "fr-v1",
          text: "Nom",
        },
        {
          kind: "unit" as const,
          id: "u",
          language: "en",
          field: "abbreviation" as const,
          expected: "unit-v1",
          text: null,
        },
      ],
    };
    const canonical: TranslationCell = {
      kind: "product",
      id: "p",
      language: "es",
      field: "name",
      text: "Nombre",
      owners: { kind: "product", parentId: null },
      inheritedText: null,
      effectiveText: "Nombre",
      defaultText: null,
      inheritedDefaultText: null,
      effectiveDefaultText: null,
      expected: "es-v2",
      staffText: "STAFF croquette",
      eligible: true,
      unavailableReason: null,
    };
    const saved = { saved: [canonical] };
    const api = new DashboardApi("", async (path, init) => {
      calls.push({ path, init: init! });
      return new Response(JSON.stringify(saved));
    });
    expect(await api.background.saveContentTranslations(input)).toEqual(saved);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/management-api/content-translations");
    expect(calls[0]!.init.method).toBe("PUT");
    expect(calls[0]!.init.body).toBe(JSON.stringify(input));
    expect(new Headers(calls[0]!.init.headers).has("x-waitron-live")).toBe(false);
  });

  it("preserves all four cell identifiers and the precise cause from a refused save", async () => {
    const params = {
      kind: "unit",
      id: "u",
      language: "fr",
      field: "abbreviation",
      causeCode: "unit.invalid",
      causeParams: { field: "abbreviation" },
    };
    const api = new DashboardApi(
      "",
      async () =>
        new Response(JSON.stringify({ error: { code: "content.translation_refused", params } }), {
          status: 400,
        }),
    );
    await expect(api.saveContentTranslations({ edits: [] })).rejects.toMatchObject({
      code: "content.translation_refused",
      params,
    });
  });
});
