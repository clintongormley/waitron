import { describe, expect, it, vi } from "vitest";
import type {
  TranslationCell,
  TranslationCellPage,
  TranslationItem,
  TranslationItemPage,
  TranslationQuery,
} from "@waitron/catalogue/src/content-translation-types.js";
import type { ContentSuggestionRead } from "@waitron/catalogue/src/content-suggestion-types.js";
import { TranslationPages, type TranslationPageApi } from "./content-translations-pages.js";

const config = { defaultLanguage: "en", languages: ["en", "es", "fr"] };
const cell = (id: string, language = "es", text: string | null = null): TranslationCell => ({
  kind: "product",
  id,
  language,
  field: "name",
  text,
  owners: { kind: "product", parentId: null },
  inheritedText: null,
  effectiveText: text,
  defaultText: null,
  inheritedDefaultText: null,
  effectiveDefaultText: null,
  expected: `v1-${id}-${language}`,
  staffText: `STAFF ${id}`,
  eligible: true,
  unavailableReason: null,
});
const row = (id: string): TranslationItem => ({
  kind: "product",
  id,
  name: `STAFF ${id}`,
  owners: { kind: "product", parentId: null },
  cells: [cell(id)],
});
const items = (rows = [row("001")], next: string | null = null): TranslationItemPage => ({
  config,
  required: [],
  configuration: "configuration-one",
  rows,
  next,
  total: 101,
});
const cells = (values: TranslationCell[]): TranslationCellPage => ({
  config,
  required: [],
  configuration: "configuration-one",
  cells: values,
});
const suggestions = (next: string | null = null): ContentSuggestionRead => ({
  config,
  required: [],
  configuration: "configuration-one",
  waitingFixes: 2,
  run: null,
  suggestions: [],
  next,
  service: "on",
  cloudOrigin: "https://cloud.example",
});
const cursor = (id: string): string =>
  JSON.stringify({
    configuration: "configuration-one",
    filter: {
      languages: ["en", "es", "fr"],
      missing: { mode: "language", language: "es" },
      kind: null,
      search: "",
      waitingFixes: false,
    },
    last: { kind: "product", id },
  });
function setup() {
  const api = {
    items: vi.fn<TranslationPageApi["items"]>().mockResolvedValue(items()),
    cells: vi
      .fn<TranslationPageApi["cells"]>()
      .mockImplementation(async (refs) =>
        cells(refs.map((ref) => ({ ...cell(ref.id, ref.language), ...ref }))),
      ),
    suggestions: vi.fn<TranslationPageApi["suggestions"]>().mockResolvedValue(suggestions()),
  };
  const reader = new TranslationPages(api, config, "es");
  return { reader, api };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("bounded multilingual translation reads", () => {
  it("opens one item page and one suggestion page without following either cursor", async () => {
    const { reader, api } = setup();
    api.items.mockResolvedValue(items([row("001")], cursor("001")));
    api.suggestions.mockResolvedValue(suggestions("suggestion-100"));
    await reader.open();
    expect(api.items).toHaveBeenCalledExactlyOnceWith({
      languages: ["en", "es", "fr"],
      missing: { mode: "language", language: "es" },
    });
    expect(api.suggestions).toHaveBeenCalledExactlyOnceWith({});
    expect(api.cells).not.toHaveBeenCalled();
    expect(reader.page?.rows.map((value) => value.id)).toEqual(["001"]);
    expect(reader.suggestions?.next).toBe("suggestion-100");
  });

  it("fetches one next page, discards old display rows and uses cursor-only previous navigation", async () => {
    const { reader, api } = setup();
    api.items
      .mockResolvedValueOnce(items([row("001")], cursor("001")))
      .mockResolvedValueOnce(items([row("051")], cursor("051")))
      .mockResolvedValueOnce(items([row("001")], cursor("001")));
    await reader.open();
    await reader.next();
    expect(api.items).toHaveBeenNthCalledWith(2, {
      languages: ["en", "es", "fr"],
      missing: { mode: "language", language: "es" },
      after: cursor("001"),
    });
    expect(reader.page?.rows.map((value) => value.id)).toEqual(["051"]);
    expect(reader.drafts.current(cell("001"))).toBeUndefined();
    await reader.previous();
    expect(api.items).toHaveBeenCalledTimes(3);
    expect(reader.page?.rows.map((value) => value.id)).toEqual(["001"]);
    expect(api.suggestions).toHaveBeenCalledTimes(1);
  });

  it("does not fetch next or previous when there is no available page", async () => {
    const { reader, api } = setup();
    await reader.open();
    await reader.next();
    await reader.previous();
    await reader.nextSuggestions();
    expect(api.items).toHaveBeenCalledTimes(1);
    expect(api.suggestions).toHaveBeenCalledTimes(1);
  });

  it("retains exact hidden personal text but refreshes its current facts", async () => {
    const { reader, api } = setup();
    api.items
      .mockResolvedValueOnce(items([row("001")], cursor("001")))
      .mockResolvedValueOnce(items([row("051")], null));
    await reader.open();
    reader.drafts.edit(cell("001"), "  Mi croqueta  ");
    api.cells.mockResolvedValue(cells([{ ...cell("001", "es", "Otra"), expected: "v2" }]));
    await reader.next();
    expect(api.cells).toHaveBeenCalledExactlyOnceWith([
      { kind: "product", id: "001", language: "es", field: "name" },
    ]);
    expect(reader.drafts.value(cell("001"))).toBe("  Mi croqueta  ");
    expect(reader.drafts.validate()).toContainEqual({
      cell: { kind: "product", id: "001", language: "es", field: "name" },
      message: "review",
    });
    expect(reader.hiddenCount).toBe(1);
    expect(reader.page?.rows[0]?.id).toBe("051");
  });

  it("does not accept an older filter response after a newer response has published", async () => {
    const { reader, api } = setup();
    await reader.open();
    const old = deferred<TranslationItemPage>();
    api.items.mockReturnValueOnce(old.promise).mockResolvedValueOnce(items([row("new")]));
    const first = reader.select({ search: "old" });
    await reader.select({ search: "new" });
    old.resolve(items([row("old")]));
    await first;
    expect(reader.page?.rows.map((value) => value.id)).toEqual(["new"]);
    expect(reader.readError).toBeNull();
  });

  it("ignores late success and failure after close and after reopening the same reader", async () => {
    const { reader, api } = setup();
    const old = deferred<TranslationItemPage>();
    api.items.mockReturnValueOnce(old.promise).mockResolvedValueOnce(items([row("new")]));
    const first = reader.open();
    reader.close();
    await reader.open();
    old.resolve(items([row("closed")]));
    await first;
    expect(reader.page?.rows[0]?.id).toBe("new");
    const failed = deferred<TranslationItemPage>();
    api.items.mockReturnValueOnce(failed.promise);
    const pending = reader.select({ search: "late" });
    reader.close();
    failed.reject(new Error("closed"));
    await pending;
    expect(reader.readError).toBeNull();
  });

  it.each(["001", "000"])(
    "refuses a nonadvancing item cursor %s without publishing its rows",
    async (id) => {
      const { reader, api } = setup();
      api.items
        .mockResolvedValueOnce(items([row("001")], cursor("001")))
        .mockResolvedValueOnce(items([row("bad")], cursor(id)));
      await reader.open();
      await reader.next();
      expect(reader.page?.rows[0]?.id).toBe("001");
      expect(reader.readError).toBeInstanceOf(Error);
      expect(api.items).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps personal drafts when retained reads disagree with the page configuration", async () => {
    const { reader, api } = setup();
    await reader.open();
    reader.drafts.edit(cell("001"), "Personal");
    api.items.mockResolvedValue(items([row("new")]));
    api.cells.mockResolvedValue({ ...cells([cell("001")]), configuration: "other" });
    await reader.select({ search: "new" });
    expect(reader.page?.rows[0]?.id).toBe("001");
    expect(reader.drafts.value(cell("001"))).toBe("Personal");
    expect(reader.readError).toBeInstanceOf(Error);
  });

  it("replaces the suggestion page only on explicit next and binds continuation to its configuration", async () => {
    const { reader, api } = setup();
    const first = {
      ...suggestions("s-100"),
      suggestions: [
        {
          id: "s-001",
          kind: "product" as const,
          itemId: "001",
          language: "es",
          text: "Sugerida",
          placeholder: false,
          fix: null,
          stale: false,
          cell: { kind: "product" as const, id: "001", language: "es", field: "name" as const },
          expected: "v1-001-es",
        },
      ],
    };
    api.suggestions.mockResolvedValueOnce(first).mockResolvedValueOnce(suggestions("s-200"));
    await reader.open();
    expect(reader.drafts.value(cell("001"))).toBe("Sugerida");
    await reader.nextSuggestions();
    expect(api.suggestions).toHaveBeenNthCalledWith(2, {
      after: "s-100",
      configuration: "configuration-one",
    });
    expect(reader.suggestions?.suggestions).toEqual([]);
    expect(reader.drafts.value(cell("001"))).toBe("Sugerida");
  });

  it.each(["s-100", "s-099"])(
    "rejects repeated or backward suggestion cursors %s",
    async (next) => {
      const { reader, api } = setup();
      api.suggestions
        .mockResolvedValueOnce(suggestions("s-100"))
        .mockResolvedValueOnce(suggestions(next));
      await reader.open();
      await reader.nextSuggestions();
      expect(reader.suggestions?.next).toBe("s-100");
      expect(reader.suggestionError).toBeInstanceOf(Error);
    },
  );

  it("keeps translations usable when the suggestion service read fails", async () => {
    const { reader, api } = setup();
    api.suggestions.mockRejectedValue(new Error("offline"));
    await reader.open();
    expect(reader.page?.rows[0]?.id).toBe("001");
    expect(reader.readError).toBeNull();
    expect(reader.suggestionError).toEqual(new Error("offline"));
  });

  it("rejects suggestion content from a different configuration without losing the item page", async () => {
    const { reader, api } = setup();
    api.suggestions.mockResolvedValue({ ...suggestions(), configuration: "other" });
    await reader.open();
    expect(reader.page?.rows[0]?.id).toBe("001");
    expect(reader.suggestions).toBeNull();
    expect(reader.suggestionError).toBeInstanceOf(Error);
  });

  it("changes Missing in, kind and search on the server instead of filtering a full local scan", async () => {
    const { reader, api } = setup();
    await reader.open();
    await reader.select({ missing: { mode: "any" }, kind: "unit", search: "kilo" });
    expect(api.items).toHaveBeenLastCalledWith({
      languages: ["en", "es", "fr"],
      missing: { mode: "any" },
      kind: "unit",
      search: "kilo",
    });
    await reader.select({ missing: { mode: "all" }, waitingFixes: true });
    expect(api.items).toHaveBeenLastCalledWith({
      languages: ["en", "es", "fr"],
      missing: { mode: "all" },
      kind: "unit",
      search: "kilo",
      waitingFixes: true,
    });
    expect(api.items).toHaveBeenCalledTimes(3);
  });

  it("resolves Show staged as at most fifty distinct items without forgetting off-page edits", async () => {
    const { reader, api } = setup();
    await reader.open();
    const all = Array.from({ length: 51 }, (_, index) => cell(String(index).padStart(3, "0")));
    reader.drafts.receive(cells(all));
    for (const target of all) reader.drafts.edit(target, `Personal ${target.id}`);
    api.items.mockImplementation(async (query: TranslationQuery) => {
      if (!("targets" in query)) throw new Error("expected staged query");
      return {
        ...items(query.targets.map((target) => row(target.id))),
        total: query.targets.length,
      };
    });
    await reader.select({ staged: true });
    const query = api.items.mock.calls[1]![0];
    expect(api.items).toHaveBeenCalledTimes(2);
    expect("targets" in query && query.targets.length).toBe(50);
    expect(reader.page?.rows).toHaveLength(50);
    expect(reader.hiddenCount).toBe(1);
    await reader.next();
    expect(api.items).toHaveBeenLastCalledWith({
      languages: ["en", "es", "fr"],
      targets: [{ kind: "product", id: "050" }],
    });
    expect(reader.drafts.staged()).toHaveLength(51);
    expect(reader.hiddenCount).toBe(50);
  });
  it("stages a suggestion outside the displayed page using a bounded fresh cell read", async () => {
    const { reader, api } = setup();
    api.suggestions.mockResolvedValue({
      ...suggestions(),
      suggestions: [
        {
          id: "s-hidden",
          kind: "product",
          itemId: "hidden",
          language: "fr",
          text: "Croquette",
          placeholder: false,
          fix: null,
          stale: false,
          cell: { kind: "product", id: "hidden", language: "fr", field: "name" },
          expected: "v1-hidden-fr",
        },
      ],
    });
    await reader.open();
    expect(reader.drafts.value(cell("hidden", "fr"))).toBe("Croquette");
    expect(reader.hiddenCount).toBe(1);
    expect(reader.page?.rows[0]?.id).toBe("001");
    expect(api.cells).toHaveBeenCalledExactlyOnceWith([
      { kind: "product", id: "hidden", language: "fr", field: "name" },
    ]);
    expect(reader.drafts.current(cell("001"))?.staffText).toBe("STAFF 001");
  });

  it("never refreshes more than one hundred retained cells in a request, including the pending overflow", async () => {
    const { reader, api } = setup();
    await reader.open();
    const values = Array.from({ length: 101 }, (_, index) => cell(String(index)));
    reader.drafts.receive(cells(values));
    for (const target of values) reader.drafts.edit(target, "Personal");
    await reader.select({ missing: { mode: "all" } });
    expect(api.cells.mock.calls.map(([refs]) => refs.length)).toEqual([100, 1]);
    expect(reader.drafts.staged()).toHaveLength(101);
    expect(reader.drafts.validate().filter((fault) => fault.message === "capacity")).toHaveLength(
      1,
    );
  });

  it("projects only seven languages even with two hundred enabled and keeps a focused distant language", async () => {
    const { reader, api } = setup();
    const many = [
      "es",
      "aa",
      "ab",
      "ace",
      "ach",
      "ada",
      "ady",
      "ae",
      "aeb",
      "af",
      "afh",
      "agq",
      "ain",
      "ak",
      "akk",
      "akz",
      "ale",
      "aln",
      "alt",
      "am",
      "an",
      "ang",
      "ann",
      "anp",
      "ar",
      "arc",
      "arn",
      "aro",
      "arp",
      "arq",
      "ars",
      "arw",
      "ary",
      "arz",
      "as",
      "asa",
      "ase",
      "ast",
      "atj",
      "av",
      "avk",
      "awa",
      "ay",
      "az",
      "ba",
      "bal",
      "ban",
      "bar",
      "bas",
      "bax",
      "bbc",
      "bbj",
      "be",
      "bej",
      "bem",
      "bew",
      "bez",
      "bfd",
      "bfq",
      "bg",
      "bgc",
      "bgn",
      "bho",
      "bi",
      "bik",
      "bin",
      "bjn",
      "bkm",
      "bla",
      "blo",
      "blt",
      "bm",
      "bn",
      "bo",
      "bpy",
      "bqi",
      "br",
      "bra",
      "brh",
      "brx",
      "bs",
      "bss",
      "bua",
      "bug",
      "bum",
      "byn",
      "byv",
      "ca",
      "cad",
      "car",
      "cay",
      "cch",
      "ccp",
      "ce",
      "ceb",
      "cgg",
      "ch",
      "chb",
      "chg",
      "chk",
      "chm",
      "chn",
      "cho",
      "chp",
      "chr",
      "chy",
      "cic",
      "ckb",
      "clc",
      "co",
      "cop",
      "cps",
      "cr",
      "crg",
      "crh",
      "crj",
      "crk",
      "crl",
      "crm",
      "crr",
      "crs",
      "cs",
      "csb",
      "csw",
      "cu",
      "cv",
      "cy",
      "da",
      "dak",
      "dar",
      "dav",
      "de",
      "del",
      "den",
      "dgr",
      "din",
      "dje",
      "doi",
      "dsb",
      "dtp",
      "dua",
      "dum",
      "dv",
      "dyo",
      "dyu",
      "dz",
      "dzg",
      "ebu",
      "ee",
      "efi",
      "egl",
      "egy",
      "eka",
      "el",
      "elx",
      "en",
      "enm",
      "eo",
      "esu",
      "et",
      "eu",
      "ewo",
      "ext",
      "fa",
      "fan",
      "ff",
      "fi",
      "fil",
      "fit",
      "fj",
      "fo",
      "fon",
      "fr",
      "frc",
      "frm",
      "fro",
      "frp",
      "frr",
      "frs",
      "fur",
      "fy",
      "ga",
      "gaa",
      "gag",
      "gan",
      "gay",
      "gba",
      "gbz",
      "gd",
      "gez",
      "gil",
      "gl",
      "glk",
      "gmh",
      "gn",
      "goh",
      "gon",
      "gor",
      "got",
      "grb",
    ];
    expect(many).toHaveLength(200);
    expect(Intl.getCanonicalLocales(many)).toEqual(many);
    const settings = { defaultLanguage: "es", languages: many };
    const bounded = new TranslationPages(api, settings, "chk");
    api.items.mockResolvedValue({ ...items(), config: settings });
    api.suggestions.mockResolvedValue({ ...suggestions(), config: settings });
    await bounded.open();
    expect(api.items.mock.calls[0]?.[0].languages).toEqual([
      "chg",
      "chk",
      "chm",
      "chn",
      "cho",
      "chp",
    ]);
    await bounded.select({
      anchor: "grb",
      focused: { kind: "product", id: "001", language: "es", field: "name" },
    });
    expect(api.items.mock.calls[1]?.[0].languages).toEqual([
      "es",
      "goh",
      "gon",
      "gor",
      "got",
      "grb",
    ]);
    await bounded.select({ anchor: "chk", width: "phone", focused: null });
    expect(api.items.mock.calls[2]?.[0].languages).toEqual(["chg", "chk", "chm"]);
    expect(reader.page).toBeNull();
  });

  it.each(["success", "failure"])(
    "does not publish a late off-page cell %s from a closed opening",
    async (outcome) => {
      const { reader, api } = setup();
      const late = deferred<TranslationCellPage>();
      api.cells.mockReturnValueOnce(late.promise);
      api.suggestions
        .mockResolvedValueOnce({
          ...suggestions(),
          suggestions: [
            {
              id: "s-hidden",
              kind: "product",
              itemId: "hidden",
              language: "fr",
              text: "Croquette",
              placeholder: false,
              fix: null,
              stale: false,
              cell: { kind: "product", id: "hidden", language: "fr", field: "name" },
              expected: "v1-hidden-fr",
            },
          ],
        })
        .mockResolvedValueOnce(suggestions());
      const first = reader.open();
      await vi.waitFor(() => expect(api.cells).toHaveBeenCalledOnce());
      reader.close();
      await reader.open();
      if (outcome === "success") late.resolve(cells([cell("hidden", "fr")]));
      else late.reject(new Error("old cells"));
      await first;
      expect(reader.drafts.staged()).toEqual([]);
      expect(reader.suggestions?.suggestions).toEqual([]);
      expect(reader.suggestionError).toBeNull();
    },
  );

  it("does not merge an off-page suggestion when its fresh facts use a changed configuration", async () => {
    const { reader, api } = setup();
    api.cells.mockResolvedValue({ ...cells([cell("hidden", "fr")]), configuration: "other" });
    api.suggestions.mockResolvedValue({
      ...suggestions(),
      suggestions: [
        {
          id: "s-hidden",
          kind: "product",
          itemId: "hidden",
          language: "fr",
          text: "Croquette",
          placeholder: false,
          fix: null,
          stale: false,
          cell: { kind: "product", id: "hidden", language: "fr", field: "name" },
          expected: "v1-hidden-fr",
        },
      ],
    });
    await reader.open();
    expect(reader.suggestionError).toBeInstanceOf(Error);
    expect(reader.drafts.staged()).toEqual([]);
    expect(reader.page?.rows[0]?.id).toBe("001");
  });

  it("refuses a continuation carrying another configuration or filter before using it", async () => {
    const { reader, api } = setup();
    const next = JSON.parse(cursor("001")) as { configuration: string };
    next.configuration = "other";
    api.items.mockResolvedValue(items([row("wrong")], JSON.stringify(next)));
    await reader.open();
    expect(reader.page).toBeNull();
    expect(reader.readError).toBeInstanceOf(Error);
    expect(api.items).toHaveBeenCalledOnce();
  });
  it("removes waiting-fix restriction when Missing in changes away from All names", async () => {
    const { reader, api } = setup();
    await reader.open();
    await reader.select({ missing: { mode: "all" }, waitingFixes: true });
    await reader.select({ missing: { mode: "language", language: "fr" } });
    expect(api.items).toHaveBeenLastCalledWith({
      languages: ["en", "es", "fr"],
      missing: { mode: "language", language: "fr" },
    });
  });

  it("retries the failed selection's first page, rather than reusing the old page position", async () => {
    const { reader, api } = setup();
    api.items
      .mockResolvedValueOnce(items([row("001")], cursor("001")))
      .mockResolvedValueOnce(items([row("051")], cursor("051")))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(items([row("fresh")]));
    await reader.open();
    await reader.next();
    await reader.select({ search: "fresh" });
    await reader.refresh();
    expect(api.items).toHaveBeenLastCalledWith({
      languages: ["en", "es", "fr"],
      missing: { mode: "language", language: "es" },
      search: "fresh",
    });
    expect(reader.page?.rows[0]?.id).toBe("fresh");
    expect(reader.readError).toBeNull();
    await reader.previous();
    expect(api.items).toHaveBeenCalledTimes(4);
  });

  it("does not navigate using old rows' cursor after a failed filter change", async () => {
    const { reader, api } = setup();
    api.items
      .mockResolvedValueOnce(items([row("001")], cursor("001")))
      .mockRejectedValueOnce(new Error("offline"));
    await reader.open();
    await reader.select({ search: "fresh" });
    await reader.next();
    expect(api.items).toHaveBeenCalledTimes(2);
    expect(reader.readError).toEqual(new Error("offline"));
  });

  it("keeps a deliberate clear when a hidden suggestion page is loaded", async () => {
    const { reader, api } = setup();
    api.suggestions.mockResolvedValueOnce(suggestions("s-100")).mockResolvedValueOnce({
      ...suggestions(),
      suggestions: [
        {
          id: "s-hidden",
          kind: "product",
          itemId: "hidden",
          language: "fr",
          text: "Croquette",
          placeholder: false,
          fix: null,
          stale: false,
          cell: { kind: "product", id: "hidden", language: "fr", field: "name" },
          expected: "v1-hidden-fr",
        },
      ],
    });
    await reader.open();
    reader.drafts.receive(cells([cell("hidden", "fr", "Original")]));
    reader.drafts.edit(cell("hidden", "fr"), "");
    await reader.nextSuggestions();
    expect(reader.drafts.value(cell("hidden", "fr"))).toBe("");
    expect(reader.drafts.submission().edits).toContainEqual({
      kind: "product",
      id: "hidden",
      language: "fr",
      field: "name",
      expected: "v1-hidden-fr",
      text: null,
    });
  });

  it("does not publish a late suggestion continuation or its error after reopening", async () => {
    const { reader, api } = setup();
    api.suggestions.mockResolvedValueOnce(suggestions("s-100"));
    await reader.open();
    const late = deferred<ContentSuggestionRead>();
    api.suggestions.mockReturnValueOnce(late.promise).mockResolvedValueOnce(suggestions());
    const pending = reader.nextSuggestions();
    reader.close();
    await reader.open();
    late.reject(new Error("old opening"));
    await pending;
    expect(reader.suggestionError).toBeNull();
    expect(reader.suggestions?.next).toBeNull();
  });
  it("keeps an unedited focused field available to the model while its row leaves the page", async () => {
    const { reader, api } = setup();
    api.items
      .mockResolvedValueOnce(items([row("001")], cursor("001")))
      .mockResolvedValue(items([row("051")]));
    await reader.open();
    reader.focus({ kind: "product", id: "001", language: "es", field: "name" });
    await reader.next();
    expect(reader.drafts.edit(cell("001"), "Still typing")).toBe(true);
    expect(reader.drafts.submission().edits).toContainEqual({
      kind: "product",
      id: "001",
      language: "es",
      field: "name",
      expected: "v1-001-es",
      text: "Still typing",
    });
    reader.drafts.unstage(cell("001"));
    reader.focus(null);
    await reader.refresh();
    expect(reader.drafts.current(cell("001"))).toBeUndefined();
  });

  it("rejects a cursor for the wrong filter even when its item id advances", async () => {
    const { reader, api } = setup();
    const next = JSON.parse(cursor("001")) as { filter: { search: string } };
    next.filter.search = "other";
    api.items.mockResolvedValue(items([row("wrong")], JSON.stringify(next)));
    await reader.open();
    expect(reader.page).toBeNull();
    expect(reader.readError).toBeInstanceOf(Error);
  });

  it("rechecks a currently displayed name if a suggestion carries newer saved facts", async () => {
    const { reader, api } = setup();
    api.items.mockResolvedValue(items([row("001")]));
    api.cells.mockResolvedValue(cells([{ ...cell("001"), expected: "v2" }]));
    api.suggestions.mockResolvedValue({
      ...suggestions(),
      suggestions: [
        {
          id: "s-new",
          kind: "product",
          itemId: "001",
          language: "es",
          text: "Nueva",
          placeholder: false,
          fix: null,
          stale: false,
          cell: { kind: "product", id: "001", language: "es", field: "name" },
          expected: "v2",
        },
      ],
    });
    await reader.open();
    expect(reader.drafts.submission().edits).toEqual([
      {
        kind: "product",
        id: "001",
        language: "es",
        field: "name",
        text: "Nueva",
        expected: "v2",
      },
    ]);
  });
  it("does not read after close and falls back to the default for a removed initial language", async () => {
    const { api } = setup();
    const reader = new TranslationPages(api, config, "de");
    expect(reader.hiddenCount).toBe(0);
    await reader.select({ search: "closed" });
    await reader.next();
    await reader.previous();
    await reader.refresh();
    expect(api.items).not.toHaveBeenCalled();
    await reader.open();
    expect(api.items).toHaveBeenCalledExactlyOnceWith({
      languages: ["en", "es", "fr"],
      missing: { mode: "language", language: "en" },
    });
    reader.close();
    await reader.refresh();
    await reader.nextSuggestions();
    expect(api.items).toHaveBeenCalledTimes(1);
  });

  it("shows an empty staged selection without requesting an unbounded empty target query", async () => {
    const { reader, api } = setup();
    await reader.open();
    await reader.select({ staged: true });
    await reader.next();
    expect(reader.page?.rows).toEqual([]);
    expect(reader.page?.total).toBe(0);
    expect(reader.hiddenCount).toBe(0);
    expect(api.items).toHaveBeenCalledTimes(1);
    expect(api.cells).not.toHaveBeenCalled();
  });

  it("rejects an item response over fifty rows without truncating it into a partial page", async () => {
    const { reader, api } = setup();
    api.items.mockResolvedValue(items(Array.from({ length: 51 }, (_, n) => row(String(n)))));
    await reader.open();
    expect(reader.page).toBeNull();
    expect(reader.readError).toBeInstanceOf(Error);
  });

  it("rejects a suggestion response over one hundred entries without staging a partial batch", async () => {
    const { reader, api } = setup();
    api.suggestions.mockResolvedValue({
      ...suggestions(),
      suggestions: Array.from({ length: 101 }, (_, n) => ({
        id: String(n),
        kind: "product",
        itemId: String(n),
        language: "fr",
        text: "Croquette",
        placeholder: false,
        fix: null,
        stale: false,
        cell: { kind: "product", id: String(n), language: "fr", field: "name" },
        expected: "v1",
      })),
    });
    await reader.open();
    expect(reader.suggestions).toBeNull();
    expect(reader.suggestionError).toBeInstanceOf(Error);
    expect(reader.drafts.staged()).toEqual([]);
    expect(api.cells).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { kind: "unknown", id: "one" },
    { kind: "product", id: null },
    { kind: "product", id: "" },
  ])("rejects malformed cursor positions without publishing their rows: %j", async (last) => {
    const { reader, api } = setup();
    const next = { ...(JSON.parse(cursor("001")) as object), last };
    api.items.mockResolvedValue(items([row("wrong")], JSON.stringify(next)));
    await reader.open();
    expect(reader.page).toBeNull();
    expect(reader.readError).toBeInstanceOf(Error);
  });

  it("accepts a continuation to a later kind even when its id sorts before the previous id", async () => {
    const { reader, api } = setup();
    const next = { ...(JSON.parse(cursor("001")) as object), last: { kind: "unit", id: "000" } };
    api.items
      .mockResolvedValueOnce(items([row("001")], cursor("001")))
      .mockResolvedValueOnce(items([row("later-kind")], JSON.stringify(next)));
    await reader.open();
    await reader.next();
    expect(reader.page?.rows[0]?.id).toBe("later-kind");
    expect(reader.readError).toBeNull();
  });

  it("refuses a changed configuration during item continuation", async () => {
    const { reader, api } = setup();
    api.items
      .mockResolvedValueOnce(items([row("001")], cursor("001")))
      .mockResolvedValueOnce({ ...items([row("changed")]), configuration: "other" });
    await reader.open();
    await reader.next();
    expect(reader.page?.rows[0]?.id).toBe("001");
    expect(reader.readError).toBeInstanceOf(Error);
  });

  it("retains hidden personal edits while resolving another page's fresh suggestions", async () => {
    const { reader, api } = setup();
    api.suggestions.mockResolvedValueOnce(suggestions("s-100")).mockResolvedValueOnce({
      ...suggestions(),
      suggestions: [
        {
          id: "s-hidden",
          kind: "product",
          itemId: "hidden",
          language: "fr",
          text: "Croquette",
          placeholder: false,
          fix: null,
          stale: false,
          cell: { kind: "product", id: "hidden", language: "fr", field: "name" },
          expected: "v1-hidden-fr",
        },
      ],
    });
    await reader.open();
    reader.drafts.edit(cell("001"), "My personal name");
    await reader.nextSuggestions();
    expect(reader.drafts.value(cell("001"))).toBe("My personal name");
    expect(reader.drafts.value(cell("hidden", "fr"))).toBe("Croquette");
    expect(reader.drafts.validate()).toEqual([]);
  });

  it("keeps a current suggestion error after an independent item read recovers", async () => {
    const { reader, api } = setup();
    api.suggestions
      .mockResolvedValueOnce(suggestions("s-100"))
      .mockRejectedValueOnce(new Error("unavailable"));
    await reader.open();
    await reader.nextSuggestions();
    await reader.refresh();
    expect(reader.suggestionError).toEqual(new Error("unavailable"));
    expect(reader.readError).toBeNull();
    expect(reader.suggestions?.next).toBe("s-100");
  });
  it("ignores a successful suggestion continuation answered after the editor reopens", async () => {
    const { reader, api } = setup();
    api.suggestions.mockResolvedValueOnce(suggestions("s-100"));
    await reader.open();
    const late = deferred<ContentSuggestionRead>();
    api.suggestions.mockReturnValueOnce(late.promise).mockResolvedValueOnce(suggestions());
    const pending = reader.nextSuggestions();
    reader.close();
    await reader.open();
    late.resolve({ ...suggestions("s-old"), service: "off" });
    await pending;
    expect(reader.suggestions?.next).toBeNull();
    expect(reader.suggestions?.service).toBe("on");
    expect(reader.suggestionError).toBeNull();
  });
  it("publishes the fresh placeholder facts together with a staged suggestion's current token", async () => {
    const { reader, api } = setup();
    api.cells.mockResolvedValue(
      cells([{ ...cell("001"), staffText: "New staff placeholder", expected: "v2" }]),
    );
    api.suggestions.mockResolvedValue({
      ...suggestions(),
      suggestions: [
        {
          id: "s-new",
          kind: "product",
          itemId: "001",
          language: "es",
          text: "Nueva",
          placeholder: false,
          fix: null,
          stale: false,
          cell: { kind: "product", id: "001", language: "es", field: "name" },
          expected: "v2",
        },
      ],
    });
    await reader.open();
    expect(reader.page?.rows[0]?.cells[0]?.staffText).toBe("New staff placeholder");
    expect(reader.page?.rows[0]?.cells[0]?.expected).toBe("v2");
    expect(reader.drafts.value(cell("001"))).toBe("Nueva");
  });

  it("shows the same current facts that were used to review a retained visible draft", async () => {
    const { reader, api } = setup();
    await reader.open();
    reader.drafts.edit(cell("001"), "Personal");
    api.cells.mockResolvedValue(
      cells([{ ...cell("001", "es", "Another writer"), expected: "v2" }]),
    );
    await reader.refresh();
    expect(reader.page?.rows[0]?.cells[0]?.text).toBe("Another writer");
    expect(reader.page?.rows[0]?.cells[0]?.expected).toBe("v2");
    expect(reader.drafts.value(cell("001"))).toBe("Personal");
    expect(reader.drafts.validate()[0]?.message).toBe("review");
  });
});
