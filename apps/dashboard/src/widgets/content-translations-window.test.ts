import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type {
  TranslationCell,
  TranslationItem,
} from "@waitron/catalogue/src/content-translation-types.js";
import { TranslationDrafts } from "./content-translations-model.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { languageWindow, ContentTranslationWindow } from "./content-translations-window.js";

const languages = [
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
const config = { defaultLanguage: "es", languages };
const cell = (overrides: Partial<TranslationCell> = {}): TranslationCell => ({
  kind: "product",
  id: "one",
  language: "es",
  field: "name",
  owners: { kind: "product", parentId: null },
  text: null,
  inheritedText: null,
  effectiveText: null,
  defaultText: null,
  inheritedDefaultText: null,
  effectiveDefaultText: null,
  expected: "original",
  staffText: "STAFF croquette",
  eligible: true,
  unavailableReason: null,
  ...overrides,
});
const item = (id = "one", kind: "product" | "unit" = "product"): TranslationItem => ({
  kind,
  id,
  name: `STAFF ${id}`,
  owners: kind === "unit" ? { kind } : { kind, parentId: null },
  cells: languages.flatMap((language) =>
    (kind === "unit" ? (["name", "abbreviation"] as const) : (["name"] as const)).map((field) =>
      cell({
        kind,
        id,
        language,
        field,
        owners: kind === "unit" ? { kind } : { kind, parentId: null },
        staffText:
          field === "abbreviation" ? "kg" : kind === "unit" ? "STAFF kilogram" : "STAFF croquette",
      }),
    ),
  ),
});
async function mount(rows = [item()], width: "phone" | "desktop" = "desktop") {
  const drafts = new TranslationDrafts(
    config,
    rows.flatMap((row) => row.cells),
  );
  const mounted = await mountWidget<ContentTranslationWindow>(
    "dashboard-content-translation-window",
    { rows, languages, anchor: "es", width, drafts },
  );
  await fieldsReady(mounted.el);
  return { ...mounted, drafts };
}
function fields(el: ContentTranslationWindow) {
  return [...el.shadowRoot!.querySelectorAll("wt-input")];
}
async function fieldsReady(el: ContentTranslationWindow) {
  await el.updateComplete;
  await Promise.all(fields(el).map((field) => field.updateComplete));
}
function field(el: ContentTranslationWindow, language = "es", id = "one", part = "name") {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="translation-product-${id}-${language}-${part}"]`,
  )!;
}
const originalViewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  await page.viewport(originalViewport.width, originalViewport.height);
});

describe("bounded translation language projection", () => {
  it("reaches languages 1, 100 and 200 with a bounded neighbor buffer", () => {
    expect(Intl.getCanonicalLocales(languages)).toEqual(languages);
    expect(new Set(languages).size).toBe(200);
    expect(languageWindow(languages, "es", "desktop", null)).toEqual([
      "es",
      languages[1]!,
      languages[2]!,
      languages[3]!,
      languages[4]!,
    ]);
    expect(languageWindow(languages, languages[99]!, "desktop", "es")).toEqual([
      "es",
      languages[98]!,
      languages[99]!,
      languages[100]!,
      languages[101]!,
      languages[102]!,
      languages[103]!,
    ]);
    expect(languageWindow(languages, languages[199]!, "desktop", "es")).toEqual([
      "es",
      languages[195]!,
      languages[196]!,
      languages[197]!,
      languages[198]!,
      languages[199]!,
    ]);
    expect(languageWindow(languages, languages[99]!, "phone", "es")).toEqual([
      "es",
      languages[98]!,
      languages[99]!,
      languages[100]!,
    ]);
    expect(languageWindow(languages, languages[199]!, "phone", null)).toEqual([
      languages[198]!,
      languages[199]!,
    ]);
  });
  it("handles a removed anchor or focus without introducing disabled languages", () => {
    expect(languageWindow([], "es", "desktop", "es")).toEqual([]);
    expect(languageWindow(["es"], "gone", "desktop", "gone")).toEqual(["es"]);
    expect(languageWindow(["es", "fr"], "gone", "phone", "gone")).toEqual(["es", "fr"]);
  });
});

describe("bounded translation field view", () => {
  it("reports the exact focused cell and releases its projection when focus leaves", async () => {
    const { el } = await mount();
    const observations: unknown[] = [];
    el.addEventListener("translation-focus", (event) =>
      observations.push((event as CustomEvent).detail),
    );
    const native = field(el).shadowRoot!.querySelector("input")!;
    await userEvent.click(native);
    await fieldsReady(el);
    native.blur();
    await Promise.resolve();
    await fieldsReady(el);
    expect(observations).toEqual([
      { cell: { kind: "product", id: "one", language: "es", field: "name" } },
      { cell: null },
    ]);
  });
  it("shows no editable fields until the draft session has loaded", async () => {
    const { el } = await mountWidget<ContentTranslationWindow>(
      "dashboard-content-translation-window",
      { rows: [item()], languages, anchor: "es" },
    );
    expect(fields(el)).toHaveLength(0);
    el.drafts = new TranslationDrafts(config, item().cells);
    await fieldsReady(el);
    expect(fields(el)).toHaveLength(5);
    expect(field(el).value).toBe("");
  });
  it("names a child by its staff parent and leaves an unavailable missing cell without invented text", async () => {
    const row: TranslationItem = {
      ...item("child"),
      kind: "variant",
      parent: { id: "parent", name: "STAFF parent" },
      owners: { kind: "variant", parentId: "parent" },
    };
    row.cells = row.cells.map((value) => ({
      ...value,
      kind: "variant",
      owners: null,
      eligible: false,
      unavailableReason: "missing",
      staffText: null,
    }));
    const { el, drafts } = await mount([row]);
    expect(el.shadowRoot!.querySelector(".name")!.textContent).toBe("STAFF parent › STAFF child");
    const group = el.shadowRoot!.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute("aria-label")).toBe("STAFF parent › STAFF child");
    const input = fields(el)[0]!;
    expect(input.placeholder).toBe("");
    expect(input.value).toBe("");
    expect(input.shadowRoot!.querySelector("input")!.disabled).toBe(true);
    expect(drafts.submission()).toEqual({ edits: [] });
  });
  it("retains the 101st personal value and prevents a second pristine field until it is resolved", async () => {
    const rows = [item(), item("two")];
    const { el, drafts } = await mount(rows);
    const retained = Array.from({ length: 100 }, (_, n) => cell({ id: `held-${n}` }));
    drafts.receive({
      config,
      required: [],
      configuration: "config",
      cells: [...rows.flatMap((row) => row.cells), ...retained],
    });
    for (const target of retained) drafts.edit(target, "Retained personal");
    el.requestUpdate();
    await fieldsReady(el);
    expect(field(el).disabled).toBe(false);
    await userEvent.fill(field(el).shadowRoot!.querySelector("input")!, "101st personal");
    await fieldsReady(el);
    expect(field(el).value).toBe("101st personal");
    expect(drafts.staged()).toHaveLength(101);
    expect(drafts.validate()).toContainEqual({
      cell: { kind: "product", id: "one", language: "es", field: "name" },
      message: "capacity",
    });
    expect(field(el, "es", "two").disabled).toBe(true);
    expect(field(el).disabled).toBe(false);
    await userEvent.fill(field(el).shadowRoot!.querySelector("input")!, "");
    await fieldsReady(el);
    expect(field(el, "es", "two").disabled).toBe(false);
    expect(drafts.staged()).toHaveLength(100);
    expect(drafts.submission().edits.some((edit) => edit.id === "one")).toBe(false);
  });
  it("keeps seven languages and both unit fields when the focused abbreviation is outside the window", async () => {
    const { el } = await mount([item("unit", "unit")]);
    const input = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      '[name="translation-unit-unit-es-abbreviation"]',
    )!;
    const native = input.shadowRoot!.querySelector("input")!;
    await userEvent.fill(native, "kilo");
    native.setSelectionRange(1, 3);
    el.anchor = languages[99]!;
    await fieldsReady(el);
    expect(fields(el)).toHaveLength(14);
    expect(input.shadowRoot!.activeElement).toBe(native);
    expect([native.selectionStart, native.selectionEnd]).toEqual([1, 3]);
    expect(fields(el).filter((field) => field.lang === "es")).toHaveLength(2);
  });
  it("gives every edited unit field its own visible localized error", async () => {
    const row = item("unit", "unit");
    const { el } = await mount([row]);
    el.errors = [
      { cell: row.cells[0]!, message: "Name is too long" },
      { cell: row.cells[1]!, message: "Review this abbreviation" },
    ];
    await fieldsReady(el);
    const es = fields(el).filter((field) => field.lang === "es");
    expect(es.map((field) => field.error)).toEqual([
      "Name is too long",
      "Review this abbreviation",
    ]);
    expect(
      es.map((field) => field.shadowRoot!.querySelector("[data-error]")?.textContent?.trim()),
    ).toEqual(["Name is too long", "Review this abbreviation"]);
  });
  it("keeps an explicit rejected edit visible across another accepted edit", async () => {
    const { el, drafts } = await mount();
    const all = Array.from({ length: 101 }, (_, n) => cell({ id: `staged-${n}` }));
    drafts.receive({
      config,
      required: [],
      configuration: "config",
      cells: [...item().cells, ...all],
    });
    for (const target of all) drafts.edit(target, "Personal");
    drafts.edit(cell(), "");
    el.requestUpdate();
    await fieldsReady(el);
    const results: { accepted: boolean; value: string }[] = [];
    el.addEventListener("translation-change", (event) =>
      results.push((event as CustomEvent).detail),
    );
    await userEvent.fill(field(el).shadowRoot!.querySelector("input")!, "Unaccepted personal text");
    await fieldsReady(el);
    expect(results[0]).toMatchObject({ accepted: false, value: "Unaccepted personal text" });
    expect(field(el).error).not.toBe("");
    const target = all[0]!;
    const shown = item("staged-0");
    el.rows = [item(), shown];
    await fieldsReady(el);
    await userEvent.fill(
      field(el, "es", target.id).shadowRoot!.querySelector("input")!,
      "Changed personal",
    );
    await fieldsReady(el);
    expect(field(el)).not.toBeNull();
    expect(field(el).shadowRoot!.querySelector("input")!.value).toBe("Unaccepted personal text");
    expect(field(el).error).not.toBe("");
    expect(drafts.submission().edits).not.toContainEqual(expect.objectContaining({ id: "one" }));
    expect(el.hasRejectedEdits).toBe(true);
    await userEvent.fill(field(el).shadowRoot!.querySelector("input")!, "");
    await fieldsReady(el);
    expect(el.hasRejectedEdits).toBe(false);
    expect(field(el).error).toBe("");
  });
  it("does not carry a rejected edit or focused row into a replacement draft session", async () => {
    const { el } = await mount();
    el.drafts = new TranslationDrafts(config, []);
    await fieldsReady(el);
    await userEvent.fill(field(el).shadowRoot!.querySelector("input")!, "Not accepted");
    await fieldsReady(el);
    expect(field(el).error).not.toBe("");
    el.drafts = new TranslationDrafts(config, item().cells);
    el.anchor = languages[99]!;
    await fieldsReady(el);
    expect(field(el)).toBeNull();
    el.anchor = "es";
    await fieldsReady(el);
    expect(field(el).value).toBe("");
    expect(field(el).error).toBe("");
    expect(el.hasRejectedEdits).toBe(false);
  });
  it("mounts only the projected language fields of at most 50 rows", async () => {
    const { el } = await mount(Array.from({ length: 51 }, (_, n) => item(String(n))));
    expect(el.shadowRoot!.querySelectorAll("[data-translation-row]")).toHaveLength(50);
    expect(fields(el)).toHaveLength(250);
    el.anchor = languages[99]!;
    await fieldsReady(el);
    expect(fields(el)).toHaveLength(300);
    expect(field(el, languages[99]!, "0").lang).toBe(languages[99]!);
    expect(field(el, languages[199]!, "0")).toBeNull();
  });
  it("keeps the focused native field and caret when the window jumps and rows reorder", async () => {
    const rows = [item(), item("two")];
    const { el, drafts } = await mount(rows);
    await userEvent.fill(field(el).shadowRoot!.querySelector("input")!, "Croqueta personal");
    const native = field(el).shadowRoot!.querySelector("input")!;
    native.setSelectionRange(3, 8, "backward");
    el.anchor = languages[99]!;
    el.rows = [...rows].reverse();
    await fieldsReady(el);
    expect(field(el)).not.toBeNull();
    expect(field(el).shadowRoot!.querySelector("input")).toBe(native);
    expect(native.getRootNode()).toBe(field(el).shadowRoot);
    expect(field(el)).not.toBeNull();
    expect(field(el).shadowRoot!.activeElement).toBe(native);
    expect([native.selectionStart, native.selectionEnd, native.selectionDirection]).toEqual([
      3,
      8,
      "backward",
    ]);
    expect(native.value).toBe("Croqueta personal");
    expect(fields(el)).toHaveLength(14);
    expect(drafts.submission()).toEqual({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "original",
          text: "Croqueta personal",
        },
      ],
    });
    await userEvent.click(field(el, languages[99]!, "two").shadowRoot!.querySelector("input")!);
    await fieldsReady(el);
    expect(field(el)).toBeNull();
    expect(fields(el)).toHaveLength(12);
    expect(drafts.value(cell())).toBe("Croqueta personal");
  });
  it("restores the cursor when the focused row itself moves to the end", async () => {
    const rows = [item(), item("two"), item("three")];
    const { el } = await mount(rows);
    const native = field(el).shadowRoot!.querySelector("input")!;
    await userEvent.fill(native, "Move this native input");
    native.setSelectionRange(5, 9, "backward");
    el.rows = [rows[1]!, rows[2]!, rows[0]!];
    await fieldsReady(el);
    expect(field(el)).not.toBeNull();
    expect(field(el).shadowRoot!.querySelector("input")).toBe(native);
    expect(field(el)).not.toBeNull();
    expect(field(el).shadowRoot!.activeElement).toBe(native);
    expect([native.selectionStart, native.selectionEnd, native.selectionDirection]).toEqual([
      5,
      9,
      "backward",
    ]);
  });
  it("retains a focused row during page replacement and releases it after focus moves", async () => {
    const { el } = await mount();
    await userEvent.fill(field(el).shadowRoot!.querySelector("input")!, "Keep this input");
    const native = field(el).shadowRoot!.querySelector("input");
    const next = Array.from({ length: 50 }, (_, n) => item(`new-${n}`));
    el.rows = next;
    await fieldsReady(el);
    expect(el.shadowRoot!.querySelectorAll("[data-translation-row]")).toHaveLength(50);
    expect(field(el)).not.toBeNull();
    expect(field(el).shadowRoot!.querySelector("input")).toBe(native);
    await userEvent.click(field(el, "es", "new-0").shadowRoot!.querySelector("input")!);
    await fieldsReady(el);
    expect(field(el)).toBeNull();
    expect(el.shadowRoot!.querySelectorAll("[data-translation-row]")).toHaveLength(50);
    expect(field(el, "es", "new-49")).not.toBeNull();
  });
  it("preserves a language-200 draft after its field is unmounted and returns", async () => {
    const { el, drafts } = await mount();
    el.anchor = languages[199]!;
    await fieldsReady(el);
    await userEvent.fill(
      field(el, languages[199]!).shadowRoot!.querySelector("input")!,
      "Last language",
    );
    field(el, languages[199]!).shadowRoot!.querySelector("input")!.blur();
    await Promise.resolve();
    el.anchor = "es";
    await fieldsReady(el);
    expect(field(el, languages[199]!)).toBeNull();
    el.anchor = languages[199]!;
    await fieldsReady(el);
    expect(field(el, languages[199]!).value).toBe("Last language");
    expect(drafts.submission().edits).toEqual([
      {
        kind: "product",
        id: "one",
        language: languages[199]!,
        field: "name",
        expected: "original",
        text: "Last language",
      },
    ]);
  });
  it("exposes two optional unit fields per language, with distinct display-only placeholders", async () => {
    const row = item("unit", "unit");
    const { el, drafts } = await mount([row]);
    const unitFields = fields(el);
    expect(unitFields).toHaveLength(10);
    const name = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      '[name="translation-unit-unit-es-name"]',
    )!;
    const abbreviation = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      '[name="translation-unit-unit-es-abbreviation"]',
    )!;
    expect([name.placeholder, abbreviation.placeholder]).toEqual(["STAFF kilogram", "kg"]);
    expect([name.value, abbreviation.value]).toEqual(["", ""]);
    expect([name.required, abbreviation.required]).toEqual([false, false]);
    expect(name.label).not.toBe(abbreviation.label);
    expect(drafts.submission()).toEqual({ edits: [] });
    await userEvent.fill(abbreviation.shadowRoot!.querySelector("input")!, "kilo");
    expect(drafts.submission()).toEqual({
      edits: [
        {
          kind: "unit",
          id: "unit",
          language: "es",
          field: "abbreviation",
          expected: "original",
          text: "kilo",
        },
      ],
    });
  });
  it("uses effective requested, default and staff placeholders independently from entered text", async () => {
    const rows = [item("inherited"), item("default"), item("staff")];
    rows[0]!.cells[0] = cell({
      id: "inherited",
      inheritedText: "Inherited customer",
      effectiveText: "Inherited customer",
      effectiveDefaultText: "Default customer",
    });
    rows[1]!.cells[0] = cell({ id: "default", effectiveDefaultText: "Default customer" });
    const { el, drafts } = await mount(rows);
    expect([
      field(el, "es", "inherited").placeholder,
      field(el, "es", "default").placeholder,
      field(el, "es", "staff").placeholder,
    ]).toEqual(["Inherited customer", "Default customer", "STAFF croquette"]);
    expect([field(el, "es", "inherited").value, field(el, "es", "default").value]).toEqual([
      "",
      "",
    ]);
    expect(drafts.submission()).toEqual({ edits: [] });
  });
});
