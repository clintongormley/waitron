import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import type {
  TranslationCell,
  TranslationCellRef,
  TranslationCellEdit,
  TranslationItem,
  TranslationItemPage,
  TranslationQuery,
} from "@waitron/catalogue/src/content-translation-types.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import "./content-translations-dialog.js";
import type { ContentTranslationsDialog } from "./content-translations-dialog.js";

registerIcons(DASHBOARD_ICONS);

const config = { defaultLanguage: "en", languages: ["en", "es"] };
const cell = (
  id: string,
  language = "es",
  overrides: Partial<TranslationCell> = {},
): TranslationCell => ({
  kind: "product",
  id,
  language,
  field: "name",
  text: null,
  owners: { kind: "product", parentId: null },
  inheritedText: null,
  effectiveText: null,
  defaultText: null,
  inheritedDefaultText: null,
  effectiveDefaultText: null,
  expected: `baseline-${id}-${language}`,
  staffText: `STAFF ${id}`,
  eligible: true,
  unavailableReason: null,
  ...overrides,
});
const target = (id = "one", overrides: Partial<TranslationItem> = {}): TranslationItem => ({
  kind: "product",
  id,
  name: `STAFF ${id}`,
  owners: { kind: "product", parentId: null },
  cells: config.languages.map((language) => cell(id, language)),
  ...overrides,
});
const result = (rows: TranslationItem[], next: string | null = null): TranslationItemPage => ({
  config,
  required: [],
  configuration: "configuration-one",
  rows,
  next,
  total: rows.length,
});
const accepted = async (batch: { edits: TranslationCellEdit[] }) => ({
  saved: batch.edits.map((edit) =>
    cell(edit.id, edit.language, {
      ...edit,
      text: edit.text,
      effectiveText: edit.text,
      expected: `saved-${edit.id}-${edit.language}`,
    }),
  ),
});
const suggestions = () => ({
  config,
  required: [],
  configuration: "configuration-one",
  waitingFixes: 0,
  run: null,
  suggestions: [],
  next: null,
  service: "not_connected" as const,
  cloudOrigin: null,
});
const cursor = (id: string, query?: TranslationQuery) =>
  JSON.stringify({
    configuration: "configuration-one",
    filter: {
      languages: query?.languages ?? ["en", "es"],
      missing: query && "missing" in query ? query.missing : { mode: "language", language: "es" },
      kind: query && "kind" in query ? (query.kind ?? null) : null,
      search: query && "search" in query ? (query.search?.trim() ?? "") : "",
      waitingFixes: false,
    },
    last: { kind: "product", id },
  });
async function mount(
  rows = [target()],
  overrides: Record<string, unknown> = {},
  theme?: "light" | "dark",
) {
  const api = {
    getContentSuggestions: vi.fn(async () => suggestions()),
    getContentTranslationTargets: vi.fn(async () => result(rows)),
    getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => ({
      config,
      required: [],
      configuration: "configuration-one",
      cells: refs.map(
        (ref) =>
          rows
            .flatMap((row) => row.cells)
            .find(
              (c) =>
                c.kind === ref.kind &&
                c.id === ref.id &&
                c.language === ref.language &&
                c.field === ref.field,
            ) ?? cell(ref.id, ref.language, ref),
      ),
    })),
    saveContentTranslations: vi.fn(accepted),
    ...overrides,
  } as unknown as DashboardApi;
  const mounted = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    { open: true, language: "es", config, api },
    theme,
  );
  await vi.waitFor(() => expect(q(mounted.el, "[data-test=loading]")).toBeNull());
  await settled(mounted.el);
  return { ...mounted, api };
}
const windowFor = (el: ContentTranslationsDialog) =>
  el.shadowRoot!.querySelector("dashboard-content-translation-window");
const q = <T extends HTMLElement = HTMLElement>(
  el: ContentTranslationsDialog,
  selector: string,
): T | null =>
  el.shadowRoot!.querySelector<T>(selector) ??
  windowFor(el)?.shadowRoot?.querySelector<T>(selector) ??
  null;
const field = (el: ContentTranslationsDialog, id: string, language = "es", kind = "product") =>
  q<HTMLElementTagNameMap["wt-input"]>(el, `[name="translation-${kind}-${id}-${language}-name"]`)!;
async function settled(el: ContentTranslationsDialog) {
  await el.updateComplete;
  await windowFor(el)?.updateComplete;
  await el.shadowRoot!.querySelector("dashboard-content-suggestions-bar")?.updateComplete;
}
async function edit(el: ContentTranslationsDialog, id: string, text: string, language = "es") {
  const control = field(el, id, language);
  expect(control).not.toBeNull();
  control.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await settled(el);
}
const click = async (el: ContentTranslationsDialog, action: string) => {
  q(el, `[data-test=${action}]`)!.click();
  await settled(el);
};
async function select(el: ContentTranslationsDialog, name: string, value: string) {
  await chooseOption(q<HTMLElementTagNameMap["wt-combobox"]>(el, `[name=${name}]`)!, value);
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(false),
  );
  await settled(el);
}
const review = (el: ContentTranslationsDialog, id = "one", language = "es") =>
  q(el, `[data-review='["product","${id}","${language}","name"]']`);
async function decide(el: ContentTranslationsDialog, choice: string, id = "one") {
  review(el, id)!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await settled(el);
}
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("staged translation dialog", () => {
  it.each([
    ["en-GB", "Valencian", "Every name has a translation in Valencian."],
    ["es-ES", "Valenciano", "Todos los nombres tienen una traducción en valenciano."],
  ])(
    "names Valencian separately in the translation dialog in %s",
    async (locale, name, sentence) => {
      setLocale(locale);
      const language = "ca-ES-valencia";
      const settings = { defaultLanguage: "en", languages: ["en", language] };
      const api = {
        getContentTranslationTargets: vi.fn(async () => ({ ...result([]), config: settings })),
        getContentSuggestions: vi.fn(async () => ({ ...suggestions(), config: settings })),
      } as unknown as DashboardApi;
      const { el } = await mountWidget<ContentTranslationsDialog>(
        "dashboard-content-translations-dialog",
        { api, config: settings, language, open: true },
      );
      await vi.waitFor(() => expect(q(el, "[data-test=complete]")).not.toBeNull());
      expect(q<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.heading).toBe(
        t("content_languages.edit_translations"),
      );
      expect(
        q<HTMLElementTagNameMap["wt-combobox"]>(el, '[name="missing"]')!.options.find(
          (o) => o.value === language,
        )!.label,
      ).toBe(name);
      expect(q(el, "[data-test=complete]")!.textContent!.trim()).toBe(sentence);
    },
  );
  it.each([
    ["en-GB", "en", "Every name has a translation in English."],
    ["en-GB", "es", "Every name has a translation in Spanish."],
    ["es-ES", "en", "Todos los nombres tienen una traducción en inglés."],
    ["es-ES", "es", "Todos los nombres tienen una traducción en español."],
  ])(
    "retains the complete translation sentence in %s for %s",
    async (locale, language, sentence) => {
      setLocale(locale);
      const api = {
        getContentTranslationTargets: vi.fn(async () => result([])),
        getContentSuggestions: vi.fn(async () => suggestions()),
      } as unknown as DashboardApi;
      const { el } = await mountWidget<ContentTranslationsDialog>(
        "dashboard-content-translations-dialog",
        { api, config, language, open: true },
      );
      await vi.waitFor(() => expect(q(el, "[data-test=complete]")).not.toBeNull());
      expect(q(el, "[data-test=complete]")!.textContent!.trim()).toBe(sentence);
    },
  );
  it("puts a name and a language tag holding a replacement pattern in as written", async () => {
    const { el } = await mount([target("one", { name: "Pan $&" })]);
    expect(q<HTMLAnchorElement>(el, "a")!.getAttribute("aria-label")).toBe(
      t("content_gaps.open_named").split("{name}").join("Pan $&"),
    );
    cleanupWidgets();
    const language = "x-$&",
      settings = { defaultLanguage: "en", languages: ["en", language] };
    const api = {
      getContentTranslationTargets: vi.fn(async () => ({ ...result([]), config: settings })),
      getContentSuggestions: vi.fn(async () => ({ ...suggestions(), config: settings })),
    } as unknown as DashboardApi;
    const mounted = await mountWidget<ContentTranslationsDialog>(
      "dashboard-content-translations-dialog",
      { api, config: settings, language, open: true },
    );
    await vi.waitFor(() => expect(q(mounted.el, "[data-test=complete]")).not.toBeNull());
    expect(q(mounted.el, "[data-test=complete]")!.textContent!.trim()).toBe(
      t("content_gaps.complete").split("{language}").join(language),
    );
  });
  it("names language tags holding a replacement pattern as written in both field labels without a required companion", async () => {
    const language = "x-$&",
      defaultLanguage = "y-$&",
      settings = { defaultLanguage, languages: [defaultLanguage, language] };
    const api = {
      getContentTranslationTargets: vi.fn(async () => ({
        ...result([target("one", { cells: settings.languages.map((l) => cell("one", l)) })]),
        config: settings,
      })),
      getContentSuggestions: vi.fn(async () => ({ ...suggestions(), config: settings })),
    } as unknown as DashboardApi;
    const { el } = await mountWidget<ContentTranslationsDialog>(
      "dashboard-content-translations-dialog",
      { api, config: settings, language, open: true },
    );
    await vi.waitFor(() => expect(field(el, "one", language)).not.toBeNull());
    await settled(el);
    expect(field(el, "one", language).label).toBe(language);
    expect(field(el, "one", defaultLanguage).label).toBe(defaultLanguage);
    expect(field(el, "one", defaultLanguage).required).toBe(false);
    expect(field(el, "one", defaultLanguage).placeholder).toBe("STAFF one");
  });
  it("reads one opening page through the passive client and saves through the active client", async () => {
    const passive = {
      getContentSuggestions: vi.fn(async () => suggestions()),
      getContentTranslationTargets: vi.fn(async () => result([target()])),
    };
    const { el, api } = await mount([], { background: passive });
    expect(field(el, "one")).not.toBeNull();
    expect(api.getContentTranslationTargets).not.toHaveBeenCalled();
    expect(passive.getContentTranslationTargets).toHaveBeenCalledExactlyOnceWith({
      languages: ["en", "es"],
      missing: { mode: "language", language: "es" },
    });
    expect(passive.getContentSuggestions).toHaveBeenCalledExactlyOnceWith({});
    expect(api.getContentSuggestions).not.toHaveBeenCalled();
    await edit(el, "one", "Croqueta");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "baseline-one-es",
          text: "Croqueta",
        },
      ],
    });
  });
  it.each([
    ["light", 390],
    ["dark", 390],
    ["light", 1280],
    ["dark", 1280],
  ] as const)(
    "retains native field, text and caret when UI labels change in %s at %s px",
    async (theme, width) => {
      await page.viewport(width, 900);
      const { el, host } = await mount([target()], {}, theme);
      const held = field(el, "one");
      await edit(el, "one", "Croqueta");
      await held.updateComplete;
      const native = held.shadowRoot!.querySelector("input")!;
      await userEvent.click(native);
      native.setSelectionRange(3, 5);
      for (const [locale, language, kind] of [
        ["en-GB", "Spanish", "Product"],
        ["es-ES", "Español", "Producto"],
      ] as const) {
        setLocale(locale);
        await settled(el);
        const bar = el.shadowRoot!.querySelector("dashboard-content-suggestions-bar")!;
        expect(bar.shadowRoot!.textContent).toContain(t("suggestions.about"));
        expect(
          bar
            .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
              "[data-test=translate-all]",
            )!
            .textContent!.trim(),
        ).toBe(t("suggestions.translate_all"));
        expect(window.innerWidth).toBe(width);
        expect(field(el, "one")).toBe(held);
        expect(held.shadowRoot!.querySelector("input")).toBe(native);
        expect(held.shadowRoot!.activeElement).toBe(native);
        expect([native.value, native.selectionStart, native.selectionEnd]).toEqual([
          "Croqueta",
          3,
          5,
        ]);
        expect(held.label).toBe(language);
        await held.updateComplete;
        expect(held.shadowRoot!.textContent).toContain(language);
        expect(
          q<HTMLElementTagNameMap["wt-combobox"]>(el, '[name="kind"]')!.options[1]!.label,
        ).toBe(kind);
        const body = q<HTMLElementTagNameMap["wt-modal"]>(
          el,
          "wt-modal",
        )!.shadowRoot!.querySelector<HTMLElement>(".body")!;
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
        expect(native.getBoundingClientRect().width).toBeGreaterThan(0);
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/look/a682-label-redraw-${locale}-${theme}-${width}.png`,
        });
      }
    },
  );
  it("retains a 101st pending field but prevents Save until another edit is undone", async () => {
    const rows = Array.from({ length: 101 }, (_, n) => target(String(n).padStart(3, "0")));
    const read = vi.fn(async (query: TranslationQuery) => {
      const start =
        "after" in query && query.after ? Number(JSON.parse(query.after).last.id) + 1 : 0;
      return result(
        rows.slice(start, start + 50),
        start + 50 < rows.length ? cursor(rows[start + 49]!.id, query) : null,
      );
    });
    const { el, api } = await mount(rows, { getContentTranslationTargets: read });
    for (let n = 0; n < 50; n++) await edit(el, rows[n]!.id, "Nombre");
    await click(el, "next");
    await vi.waitFor(() => expect(field(el, "050")).not.toBeNull());
    for (let n = 50; n < 100; n++) await edit(el, rows[n]!.id, "Nombre");
    await click(el, "next");
    await vi.waitFor(() => expect(field(el, "100")).not.toBeNull());
    expect(field(el, "100").disabled).toBe(false);
    await edit(el, "100", "Último");
    const saveButton = q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!;
    await saveButton.updateComplete;
    expect(saveButton.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    saveButton.shadowRoot!.querySelector("button")!.click();
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    expect(field(el, "100").value).toBe("Último");
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.disabled).toBe(true);
    expect(q(el, "[data-test=edited-count]")!.textContent).toContain("101");
    await click(el, "previous");
    await vi.waitFor(() => expect(field(el, "099")).not.toBeNull());
    await edit(el, "099", "");
    await click(el, "next");
    await vi.waitFor(() => expect(field(el, "100")).not.toBeNull());
    expect(field(el, "100").disabled).toBe(false);
    await edit(el, "100", "Último");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    const batch = vi.mocked(api.saveContentTranslations).mock.calls[0]![0] as unknown as {
      edits: TranslationCellEdit[];
    };
    expect(batch.edits).toHaveLength(100);
    expect(batch.edits.at(-1)).toEqual({
      kind: "product",
      id: "100",
      language: "es",
      field: "name",
      expected: "baseline-100-es",
      text: "Último",
    });
    expect(batch.edits.some((row) => row.id === "099")).toBe(false);
  });
  it("marks oversized UTF-8 names after submission and disables Save until corrected", async () => {
    const { el, api } = await mount();
    await edit(el, "one", "é".repeat(2049));
    await click(el, "save");
    expect(field(el, "one").error).toBe(t("translations.name_bytes"));
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.disabled).toBe(true);
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    await edit(el, "one", "é".repeat(2048));
    expect(field(el, "one").error).toBe("");
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.disabled).toBe(false);
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
  });
  it("sends once while busy and submits a valid name with native Enter", async () => {
    let finish!: (value: { saved: TranslationCell[] }) => void;
    const save = vi.fn(
      () =>
        new Promise<{ saved: TranslationCell[] }>((resolve) => {
          finish = resolve;
        }),
    );
    const { el } = await mount([target()], { saveContentTranslations: save });
    await edit(el, "one", "Croqueta");
    const input = field(el, "one").shadowRoot!.querySelector("input")!;
    await userEvent.click(input);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    await click(el, "save");
    expect(save).toHaveBeenCalledOnce();
    expect(field(el, "one").disabled).toBe(true);
    finish({
      saved: [
        cell("one", "es", { text: "Croqueta", effectiveText: "Croqueta", expected: "saved" }),
      ],
    });
    await vi.waitFor(() => expect(el.open).toBe(false));
  });
  it("retains every editor address, context label and localized kind option", async () => {
    const rows = [
      target("prod-1", { name: "STAFF Pan" }),
      target("var-1", {
        kind: "variant",
        name: "STAFF Small",
        parent: { id: "prod-1", name: "STAFF Pan" },
      }),
      target("list-1", { kind: "option_list", name: "STAFF Doneness" }),
      target("label-1", {
        kind: "option_label",
        name: "STAFF Rare",
        parent: { id: "list-1", name: "STAFF Doneness" },
      }),
      target("extras-1", { kind: "extra_list", name: "STAFF Sides" }),
      target("root-1", { kind: "menu", name: "Lunch", parent: { id: "menu-1", name: "Lunch" } }),
      target("section-1", {
        kind: "section",
        name: "STAFF Drinks",
        parent: { id: "menu-1", name: "Lunch" },
      }),
      target("member-1", {
        kind: "included_menu",
        name: "STAFF Coffee",
        parent: { id: "menu-1", name: "Lunch" },
      }),
      target("unit-1", { kind: "unit", name: "ración" }),
    ];
    for (const row of rows) row.cells = row.cells.map((c) => ({ ...c, kind: row.kind }));
    const { el } = await mount(rows);
    const links = [...windowFor(el)!.shadowRoot!.querySelectorAll("a")];
    expect(
      links.map((link) => [link.getAttribute("aria-label"), link.getAttribute("href")]),
    ).toEqual([
      ["Abrir STAFF Pan", "/manage/catalogue/product/prod-1"],
      ["Abrir STAFF Pan › STAFF Small", "/manage/catalogue/product/var-1"],
      ["Abrir STAFF Doneness", "/manage/modifiers/view/options/list/list-1"],
      ["Abrir STAFF Doneness › STAFF Rare", "/manage/modifiers/view/options/list/list-1"],
      ["Abrir STAFF Sides", "/manage/modifiers/view/extras/list/extras-1"],
      ["Abrir Lunch", "/manage/menus/menu/menu-1/view/structure"],
      ["Abrir Lunch › STAFF Drinks", "/manage/menus/menu/menu-1/view/structure"],
      ["Abrir Lunch › STAFF Coffee", "/manage/menus/menu/menu-1/view/structure"],
      ["Abrir ración", "/manage/units"],
    ]);
    const kinds = q<HTMLElementTagNameMap["wt-combobox"]>(el, '[name="kind"]')!;
    expect(kinds.options.map(({ value }) => value)).toEqual([
      "",
      "product",
      "variant",
      "option_list",
      "option_label",
      "extra_list",
      "menu",
      "section",
      "included_menu",
      "unit",
    ]);
    expect(kinds.options.find(({ value }) => value === "included_menu")!.label).toBe(
      "Carpeta de carta incluida",
    );
    expect([kinds.searchPlaceholder, kinds.noResultsLabel]).toEqual(["Buscar", "Sin resultados"]);
  });
  it("opens product and variant editors inside the dashboard while modifier and modified links retain browser handling", async () => {
    const { el } = await mount([
      target(),
      target("variant", { kind: "variant" }),
      target("list", { kind: "option_list" }),
    ]);
    const links = [...windowFor(el)!.shadowRoot!.querySelectorAll("a")];
    const asked: string[] = [];
    el.addEventListener("wt-edit-product", (event) =>
      asked.push((event as CustomEvent<{ productId: string }>).detail.productId),
    );
    const prevented = (link: Element, held: MouseEventInit) => {
      let result = false;
      const guard = (event: Event) => {
        result = event.defaultPrevented;
        event.preventDefault();
      };
      window.addEventListener("click", guard);
      try {
        link.dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ...held }),
        );
      } finally {
        window.removeEventListener("click", guard);
      }
      return result;
    };
    expect(prevented(links[0]!, {})).toBe(true);
    expect(prevented(links[1]!, {})).toBe(true);
    expect(prevented(links[2]!, {})).toBe(false);
    expect(prevented(links[0]!, { ctrlKey: true })).toBe(false);
    expect(prevented(links[0]!, { metaKey: true })).toBe(false);
    expect(asked).toEqual(["one", "variant"]);
  });
  it("keeps Missing in and kind before search, sends each selected kind and displays the returned empty page", async () => {
    const read = vi.fn(async (query: TranslationQuery) =>
      result("search" in query && query.search ? [] : [target("unit", { kind: "unit" })]),
    );
    const { el } = await mount([], { getContentTranslationTargets: read });
    expect(
      [...el.shadowRoot!.querySelectorAll(".filters > *")].map((field) =>
        field.getAttribute("name"),
      ),
    ).toEqual(["missing", "kind", "search", "jump"]);
    const kinds = q<HTMLElementTagNameMap["wt-combobox"]>(el, '[name="kind"]')!;
    expect(kinds.multiple).toBe(false);
    for (const kind of ["product", "unit"]) {
      await select(el, "kind", kind);
      expect(read).toHaveBeenLastCalledWith({
        languages: ["en", "es"],
        missing: { mode: "language", language: "es" },
        kind,
      });
    }
    await searchFor(el, "not present");
    expect(windowFor(el)!.rows).toEqual([]);
    expect(q(el, "[data-test=complete]")!.textContent!.trim()).toBe(
      "Nada coincide con tu búsqueda ni con tus filtros.",
    );
  });
  it("sends search words, accents, order and trailing spaces to the bounded reader and renders its returned order", async () => {
    let rows = [
      target("croqueta", { name: "Croquetas de jamón ibérico" }),
      target("serrano", { name: "Jamón serrano" }),
      target("pan", { name: "Pan" }),
    ];
    const read = vi.fn(async () => result(rows));
    const { el } = await mount([], { getContentTranslationTargets: read });
    for (const [value, ids] of [
      ["IBERICO jamon", ["croqueta"]],
      ["jam", ["serrano", "croqueta"]],
      ["jam ", []],
      ["&", []],
      ["   ", ["croqueta", "serrano", "pan"]],
    ] as const) {
      rows = ids.map((id) => target(id));
      await searchFor(el, value);
      expect(read).toHaveBeenLastCalledWith({
        languages: ["en", "es"],
        missing: { mode: "language", language: "es" },
        search: value,
      });
      expect(windowFor(el)!.rows.map((row) => row.id)).toEqual(ids);
    }
  });
  it("refreshes the active search after a live rename without losing a personal field", async () => {
    let current: TranslationItem[] = [];
    const liveData = new LiveData(),
      read = vi.fn(async () => result(current));
    const { el } = await mount([], { liveData, getContentTranslationTargets: read });
    await searchFor(el, "jamon");
    expect(windowFor(el)!.rows).toEqual([]);
    current = [target("pan", { name: "Pan con jamón" })];
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(field(el, "pan")).not.toBeNull());
    await edit(el, "pan", "Mi pan");
    expect(read).toHaveBeenLastCalledWith({
      languages: ["en", "es"],
      missing: { mode: "language", language: "es" },
      search: "jamon",
    });
    expect(windowFor(el)!.rows[0]!.name).toBe("Pan con jamón");
    expect(field(el, "pan").value).toBe("Mi pan");
  });
  it("initializes Missing in and Jump to the selected language, keeps Save quiet and never requires or copies a default companion", async () => {
    const { el, api } = await mount();
    expect(q<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.heading).toBe(
      t("content_languages.edit_translations"),
    );
    expect(q<HTMLElementTagNameMap["wt-combobox"]>(el, '[name="missing"]')!.value).toBe("es");
    expect(q<HTMLElementTagNameMap["wt-combobox"]>(el, '[name="jump"]')!.value).toBe("es");
    expect(field(el, "one").value).toBe("");
    expect(field(el, "one", "en").value).toBe("");
    expect(field(el, "one", "en").required).toBe(false);
    expect(field(el, "one", "en").placeholder).toBe("STAFF one");
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.disabled).toBe(true);
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.variant).toBe(
      "secondary",
    );
    await click(el, "save");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    await edit(el, "one", "Croqueta");
    expect(field(el, "one").getAttribute("lang")).toBe("es");
    expect(field(el, "one", "en").getAttribute("lang")).toBe("en");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "baseline-one-es",
          text: "Croqueta",
        },
      ],
    });
  });
  it("saves independently entered optional Spanish and English cells without copying either value", async () => {
    const { el, api } = await mount();
    await edit(el, "one", "Croqueta");
    await edit(el, "one", " Ham croquette ", "en");
    expect(field(el, "one", "en").required).toBe(false);
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "baseline-one-es",
          text: "Croqueta",
        },
        {
          kind: "product",
          id: "one",
          language: "en",
          field: "name",
          expected: "baseline-one-en",
          text: "Ham croquette",
        },
      ],
    });
  });
  it("loads the next page only on request, keeping first-page edits through the delayed answer", async () => {
    let finish!: (value: TranslationItemPage) => void;
    const first = Array.from({ length: 50 }, (_, n) => target(String(n).padStart(3, "0"))),
      after = cursor("049");
    const read = vi
      .fn()
      .mockResolvedValueOnce(result(first, after))
      .mockImplementationOnce(
        () =>
          new Promise<TranslationItemPage>((resolve) => {
            finish = resolve;
          }),
      );
    const { el, api } = await mount(first, { getContentTranslationTargets: read });
    expect(read).toHaveBeenCalledOnce();
    expect(windowFor(el)!.rows).toHaveLength(50);
    await edit(el, "000", "First");
    await click(el, "next");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(field(el, "000").value).toBe("First");
    finish(result([target("last")]));
    await vi.waitFor(() => expect(field(el, "last")).not.toBeNull());
    expect(read.mock.calls).toEqual([
      [{ languages: ["en", "es"], missing: { mode: "language", language: "es" } }],
      [{ languages: ["en", "es"], missing: { mode: "language", language: "es" }, after }],
    ]);
    expect(field(el, "000")).toBeNull();
    await edit(el, "last", "Last");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "000",
          language: "es",
          field: "name",
          expected: "baseline-000-es",
          text: "First",
        },
        {
          kind: "product",
          id: "last",
          language: "es",
          field: "name",
          expected: "baseline-last-es",
          text: "Last",
        },
      ],
    });
  });
  it("filters kind, Missing in and context before paging without losing hidden edits; Show staged reveals them", async () => {
    const label = target("label", {
      kind: "option_label",
      parent: { id: "list", name: "Sauces" },
      cells: [
        cell("label", "es", {
          kind: "option_label",
          owners: { kind: "option_label", listId: "list" },
        }),
      ],
    });
    const read = vi.fn(async (query: TranslationQuery) =>
      result("kind" in query && query.kind ? [label] : [target(), label]),
    );
    const { el, api } = await mount([target(), label], { getContentTranslationTargets: read });
    await edit(el, "one", "Croqueta");
    await select(el, "kind", "option_label");
    await select(el, "missing", "any");
    await searchFor(el, "Sauces");
    expect(read).toHaveBeenLastCalledWith({
      languages: ["en", "es"],
      missing: { mode: "any" },
      kind: "option_label",
      search: "Sauces",
    });
    expect(windowFor(el)!.rows.map((row) => row.id)).toEqual(["label"]);
    expect(q(el, "[data-test=edited-count]")!.textContent).toContain("1");
    expect(q(el, "[data-test=hidden-count]")!.textContent).toContain("1");
    await click(el, "show-edited");
    await vi.waitFor(() => expect(field(el, "one")).not.toBeNull());
    expect(field(el, "one").value).toBe("Croqueta");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "baseline-one-es",
          text: "Croqueta",
        },
      ],
    });
  });
  it("reveals and focuses a hidden invalid field above the bottom message", async () => {
    const read = vi.fn(async (query: TranslationQuery) =>
      result("search" in query && query.search ? [] : [target()]),
    );
    const { el, api } = await mount([target()], { getContentTranslationTargets: read });
    await edit(el, "one", "é".repeat(2049));
    await searchFor(el, "not present");
    expect(field(el, "one")).toBeNull();
    await click(el, "save");
    await vi.waitFor(() => expect(field(el, "one")?.error).toBe(t("translations.name_bytes")));
    await vi.waitFor(() =>
      expect(field(el, "one").shadowRoot!.activeElement?.tagName).toBe("INPUT"),
    );
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    expect(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error).toBe(
      t("form.fix_fields"),
    );
  });
  it("keeps a field refusal retryable, preserves text and clears only that field's message on edit", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce({
        code: "content.translation_refused",
        params: {
          kind: "product",
          id: "one",
          field: "name",
          language: "es",
          causeCode: "product.invalid",
          causeParams: { field: "customerName" },
        },
      })
      .mockImplementation(accepted);
    const { el } = await mount([target()], { saveContentTranslations: save });
    await edit(el, "one", "Croqueta");
    await click(el, "save");
    await vi.waitFor(() => expect(field(el, "one").error).toBe(codeMessage("product.invalid")));
    expect(el.open).toBe(true);
    expect(field(el, "one").value).toBe("Croqueta");
    await vi.waitFor(() =>
      expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.disabled).toBe(false),
    );
    await edit(el, "one", "Croqueta buena");
    expect(field(el, "one").error).toBe("");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("shows empty, unavailable and failed reads without enabling Save, with a retry", async () => {
    const read = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue(result([]));
    const { el } = await mount([], { getContentTranslationTargets: read });
    expect(q(el, "[data-test=read-error]")).not.toBeNull();
    await click(el, "retry");
    await vi.waitFor(() => expect(q(el, "[data-test=complete]")).not.toBeNull());
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.disabled).toBe(true);
    cleanupWidgets();
    const unavailable = await mount([
      target("one", {
        cells: [cell("one", "es", { eligible: false, unavailableReason: "inactive" })],
      }),
    ]);
    expect(field(unavailable.el, "one").disabled).toBe(true);
    expect(
      q(unavailable.el, `[data-unavailable='["product","one","es","name"]']`)?.textContent?.trim(),
    ).toBe(t("translations.unavailable"));
    expect(q<HTMLAnchorElement>(unavailable.el, "a")!.getAttribute("href")).toBe(
      "/manage/catalogue/product/one",
    );
    expect(
      q<HTMLElementTagNameMap["wt-button"]>(unavailable.el, "[data-test=save]")!.disabled,
    ).toBe(true);
  });
  it("empty reversion makes Save quiet and prevents an accidental request", async () => {
    const { el, api } = await mount();
    await edit(el, "one", "Croqueta");
    await edit(el, "one", "English", "en");
    await edit(el, "one", " ");
    await edit(el, "one", "  ", "en");
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.disabled).toBe(true);
    await click(el, "save");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
  });
  it("trims only at submission, retaining selection during a middle edit", async () => {
    const { el, api } = await mount();
    const control = field(el, "one");
    await control.updateComplete;
    const native = control.shadowRoot!.querySelector("input")!;
    await userEvent.fill(native, "  Croqueta  ");
    native.setSelectionRange(4, 4);
    await userEvent.type(native, "X");
    await settled(el);
    expect(native.value).toBe("  CrXoqueta  ");
    expect(native.selectionStart).toBe(5);
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "baseline-one-es",
          text: "CrXoqueta",
        },
      ],
    });
  });
});

async function searchFor(el: ContentTranslationsDialog, value: string) {
  q(el, '[name="search"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settled(el);
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(false),
  );
  await settled(el);
}
async function frame(el: ContentTranslationsDialog) {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await settled(el);
}
function changed(id: string, text: string, expected: string) {
  return target(id, {
    cells: [cell(id, "es", { text, effectiveText: text, expected }), cell(id, "en")],
  });
}
function liveFixture() {
  let rows = [target()],
    current = cell("one");
  const liveData = new LiveData(),
    read = vi.fn(async () => result(rows));
  const cells = vi.fn(async (refs: readonly TranslationCellRef[]) => ({
    config,
    required: [],
    configuration: "configuration-one",
    cells: refs.map((ref) =>
      ref.id === "one" && ref.language === "es" ? current : cell(ref.id, ref.language),
    ),
  }));
  return {
    liveData,
    read,
    cells,
    get rows() {
      return rows;
    },
    set rows(value) {
      rows = value;
    },
    get current() {
      return current;
    },
    set current(value) {
      current = value;
    },
  };
}
async function mountLive(
  fixture: ReturnType<typeof liveFixture>,
  overrides: Record<string, unknown> = {},
) {
  return mount(fixture.rows, {
    liveData: fixture.liveData,
    getContentTranslationTargets: fixture.read,
    getContentTranslationCells: fixture.cells,
    ...overrides,
  });
}
async function reviewed(el: ContentTranslationsDialog) {
  await click(el, "review");
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(false),
  );
  await settled(el);
}

describe("translation live review", () => {
  it("keeps the focused personal field through live arrivals and requires Keep for a concurrent fill", async () => {
    const f = liveFixture(),
      { el, api } = await mountLive(f);
    await edit(el, "one", "My draft");
    const held = field(el, "one"),
      input = held.shadowRoot!.querySelector("input")!;
    await userEvent.click(input);
    f.rows = [target("arrival")];
    f.current = cell("one", "es", {
      text: "Their name",
      effectiveText: "Their name",
      expected: "current",
    });
    f.liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(review(el)?.textContent).toContain("Their name"));
    expect(field(el, "arrival")).not.toBeNull();
    expect(field(el, "one")).toBe(held);
    expect(held.value).toBe("My draft");
    expect(held.shadowRoot!.activeElement).toBe(input);
    await click(el, "save");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    expect(review(el)!.textContent).toContain("My draft");
    await decide(el, "keep");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "one",
          language: "es",
          field: "name",
          expected: "current",
          text: "My draft",
        },
      ],
    });
  });
  it.each(["replace", "discard"])(
    "requires explicit %s before clearing an edited concurrent fill",
    async (choice) => {
      const f = liveFixture(),
        { el, api } = await mountLive(f);
      await edit(el, "one", "My draft");
      f.current = cell("one", "es", {
        text: "Their name",
        effectiveText: "Their name",
        expected: "current",
      });
      f.rows = [changed("one", "Their name", "current")];
      await reviewed(el);
      expect(review(el)).not.toBeNull();
      expect(field(el, "one").value).toBe("My draft");
      await decide(el, choice);
      expect(field(el, "one").value).toBe("Their name");
      await click(el, "save");
      expect(api.saveContentTranslations).not.toHaveBeenCalled();
    },
  );
  it("rejects a changed configuration on page two without dropping the current page or its draft", async () => {
    const first = [target("000")],
      after = cursor("000");
    let phase = 0;
    let finish!: (value: TranslationItemPage) => void;
    const liveData = new LiveData(),
      read = vi.fn(async (query: TranslationQuery) => {
        if ("targets" in query) return result(query.targets.map((ref) => target(ref.id)));
        if (!query.after) return result(first, after);
        if (!phase) return result([target("last")]);
        return new Promise<TranslationItemPage>((resolve) => {
          finish = resolve;
        });
      });
    const { el } = await mount([...first, target("last")], {
      liveData,
      getContentTranslationTargets: read,
      getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => ({
        config,
        required: [],
        configuration: "configuration-one",
        cells: refs.map((ref) =>
          cell(
            ref.id,
            ref.language,
            phase
              ? {
                  eligible: false,
                  unavailableReason: "missing",
                  owners: null,
                  staffText: null,
                  expected: "removed",
                }
              : {},
          ),
        ),
      })),
    });
    await click(el, "next");
    await vi.waitFor(() => expect(field(el, "last")).not.toBeNull());
    await edit(el, "last", "My last");
    phase = 1;
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(field(el, "last").value).toBe("My last");
    finish({
      ...result([target("arrival")]),
      configuration: "other-config",
      config: { languages: ["en", "es"], defaultLanguage: "es" },
    });
    await vi.waitFor(() => expect(q(el, "[data-test=read-error]")).not.toBeNull());
    expect(field(el, "last").value).toBe("My last");
    expect(review(el, "last")).toBeNull();
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
    finish(result([target("arrival")]));
    await vi.waitFor(() => expect(field(el, "arrival")).not.toBeNull());
    expect(q(el, "[data-test=read-error]")).toBeNull();
    expect(review(el, "last")!.textContent).toContain("My last");
    expect(
      review(el, "last")!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-choice=keep]")!
        .disabled,
    ).toBe(true);
    await click(el, "show-edited");
    await vi.waitFor(() => expect(field(el, "last")).not.toBeNull());
    expect(field(el, "last").value).toBe("My last");
    expect(field(el, "last").disabled).toBe(true);
    expect(q(el, `[data-unavailable='["product","last","es","name"]']`)!.textContent!.trim()).toBe(
      t("translations.unavailable"),
    );
  });
  it("ignores old PUT success after close and reopen", async () => {
    let finish!: (value: { saved: TranslationCell[] }) => void;
    const save = vi.fn(
      () =>
        new Promise<{ saved: TranslationCell[] }>((resolve) => {
          finish = resolve;
        }),
    );
    const { el } = await mount([target()], { saveContentTranslations: save }),
      saved = vi.fn();
    el.addEventListener("translations-saved", saved);
    await edit(el, "one", "Old draft");
    await click(el, "save");
    el.open = false;
    await settled(el);
    el.open = true;
    await settled(el);
    await vi.waitFor(() => expect(field(el, "one")?.disabled).toBe(false));
    await edit(el, "one", "New draft");
    finish({ saved: [] });
    await frame(el);
    expect(field(el, "one").value).toBe("New draft");
    expect(saved).not.toHaveBeenCalled();
    expect(el.open).toBe(true);
  });
});

it("reconnect abandons an old PUT while keeping edited text retryable", async () => {
  let finish!: (value: { saved: TranslationCell[] }) => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<{ saved: TranslationCell[] }>((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementation(accepted);
  const { el, host } = await mount([target()], { saveContentTranslations: save });
  await edit(el, "one", "Draft");
  await click(el, "save");
  el.remove();
  host.append(el);
  await settled(el);
  await vi.waitFor(() => expect(field(el, "one")?.disabled).toBe(false));
  finish({ saved: [] });
  await frame(el);
  expect(el.open).toBe(true);
  expect(field(el, "one").value).toBe("Draft");
  await click(el, "save");
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(save).toHaveBeenCalledTimes(2);
});
it("retained cell review reads 51 filled drafts without dropping any", async () => {
  const rows = Array.from({ length: 51 }, (_, n) => target(String(n).padStart(3, "0")));
  let filled = false;
  const read = vi.fn(async (query: TranslationQuery) =>
    filled
      ? result([])
      : "after" in query && query.after
        ? result(rows.slice(50))
        : result(rows.slice(0, 50), cursor("049")),
  );
  const cells = vi.fn(async (refs: readonly TranslationCellRef[]) => ({
    config,
    required: [],
    configuration: "configuration-one",
    cells: refs.map((ref) =>
      cell(
        ref.id,
        ref.language,
        filled
          ? { text: "Their name", effectiveText: "Their name", expected: `latest-${ref.id}` }
          : {},
      ),
    ),
  }));
  const { el } = await mount(rows, {
    getContentTranslationTargets: read,
    getContentTranslationCells: cells,
  });
  for (let n = 0; n < 50; n++) await edit(el, rows[n]!.id, `Draft ${n}`);
  await click(el, "next");
  await vi.waitFor(() => expect(field(el, "050")).not.toBeNull());
  await edit(el, "050", "Draft 50");
  filled = true;
  cells.mockClear();
  await reviewed(el);
  expect(review(el, "050")).not.toBeNull();
  expect(cells.mock.calls.map(([refs]) => refs.length)).toEqual([51, 51]);
  expect(cells.mock.calls.map(([refs]) => refs.map((ref) => ref.id))).toEqual([
    rows.map((row) => row.id),
    rows.map((row) => row.id),
  ]);
  expect(el.shadowRoot!.querySelectorAll("[data-review]")).toHaveLength(51);
  expect(review(el, "050")!.textContent).toContain("Draft 50");
});
it("a late opening GET and late review GET cannot overwrite a reopened draft", async () => {
  let finish!: (value: TranslationItemPage) => void;
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<TranslationItemPage>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(result([target()]));
  const api = {
    getContentTranslationTargets: read,
    getContentSuggestions: vi.fn(async () => suggestions()),
    getContentTranslationCells: vi.fn(async () => ({
      config,
      required: [],
      configuration: "configuration-one",
      cells: [cell("one")],
    })),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    { open: true, language: "es", config, api },
  );
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  el.open = false;
  await settled(el);
  el.open = true;
  await settled(el);
  await vi.waitFor(() => expect(field(el, "one")).not.toBeNull());
  await edit(el, "one", "New draft");
  finish(result([target("old")]));
  await frame(el);
  expect(field(el, "old")).toBeNull();
  expect(field(el, "one").value).toBe("New draft");
  read.mockImplementationOnce(
    () =>
      new Promise<TranslationItemPage>((resolve) => {
        finish = resolve;
      }),
  );
  await click(el, "review");
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  el.open = false;
  await settled(el);
  el.open = true;
  await settled(el);
  await vi.waitFor(() => expect(field(el, "one")).not.toBeNull());
  await edit(el, "one", "Newest draft");
  finish(result([target("old")]));
  await frame(el);
  expect(q(el, "[data-test=loading]")).toBeNull();
  expect(field(el, "old")).toBeNull();
  expect(field(el, "one").value).toBe("Newest draft");
});
it("live read recovery preserves an action refusal and a retry sends the same draft", async () => {
  const f = liveFixture();
  let failure = false;
  f.read.mockImplementation(async () => {
    if (failure) throw Error("offline");
    return result(f.rows);
  });
  const save = vi
    .fn()
    .mockRejectedValueOnce({ code: "content.translation_stale" })
    .mockImplementation(accepted);
  const { el } = await mountLive(f, { saveContentTranslations: save });
  await edit(el, "one", "Draft");
  await click(el, "save");
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error).toBe(
      codeMessage("content.translation_stale"),
    ),
  );
  failure = true;
  f.liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(q(el, "[data-test=read-error]")).not.toBeNull());
  failure = false;
  f.liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(q(el, "[data-test=read-error]")).toBeNull());
  expect(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error).toBe(
    codeMessage("content.translation_stale"),
  );
  expect(field(el, "one").value).toBe("Draft");
  await click(el, "save");
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(save.mock.calls).toEqual([
    [
      {
        edits: [
          {
            kind: "product",
            id: "one",
            language: "es",
            field: "name",
            expected: "baseline-one-es",
            text: "Draft",
          },
        ],
      },
    ],
    [
      {
        edits: [
          {
            kind: "product",
            id: "one",
            language: "es",
            field: "name",
            expected: "baseline-one-es",
            text: "Draft",
          },
        ],
      },
    ],
  ]);
});
it("a newer live snapshot wins over a delayed explicit review without changing the draft", async () => {
  const f = liveFixture(),
    { el } = await mountLive(f);
  await edit(el, "one", "My draft");
  let finish!: (value: TranslationItemPage) => void;
  f.read.mockImplementationOnce(
    () =>
      new Promise<TranslationItemPage>((resolve) => {
        finish = resolve;
      }),
  );
  await click(el, "review");
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(2));
  f.current = cell("one", "es", {
    text: "New live",
    effectiveText: "New live",
    expected: "new-live",
  });
  f.rows = [changed("one", "New live", "new-live")];
  f.liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(review(el)?.textContent).toContain("New live"));
  finish(result([changed("one", "Old review", "old-review")]));
  await frame(el);
  expect(review(el)!.textContent).toContain("New live");
  expect(review(el)!.textContent).not.toContain("Old review");
  expect(field(el, "one").value).toBe("My draft");
});
it("an obsolete review refusal cannot replace a recovered live read or release a newer review", async () => {
  const f = liveFixture(),
    { el } = await mountLive(f);
  await edit(el, "one", "Draft");
  let refuse!: (error: Error) => void, finish!: (value: TranslationItemPage) => void;
  f.read.mockImplementationOnce(
    () =>
      new Promise<TranslationItemPage>((_resolve, reject) => {
        refuse = reject;
      }),
  );
  await click(el, "review");
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(2));
  f.liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(3));
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(false),
  );
  f.read.mockImplementationOnce(
    () =>
      new Promise<TranslationItemPage>((resolve) => {
        finish = resolve;
      }),
  );
  await click(el, "review");
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(4));
  refuse(Error("old failure"));
  await frame(el);
  expect(q(el, "[data-test=read-error]")).toBeNull();
  expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(true);
  finish(result([target()]));
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(false),
  );
});
it("Review latest reveals a hidden conflict with its old, current and draft text", async () => {
  const f = liveFixture();
  f.read.mockImplementation(async () => result(f.rows));
  const { el } = await mountLive(f);
  await edit(el, "one", "My draft");
  f.rows = [];
  await searchFor(el, "hidden");
  expect(field(el, "one")).toBeNull();
  f.current = cell("one", "es", {
    text: "Their name",
    effectiveText: "Their name",
    expected: "latest",
  });
  await reviewed(el);
  expect(review(el)!.textContent).toContain("Their name");
  expect(review(el)!.textContent).toContain("My draft");
  expect([...review(el)!.querySelectorAll("dd")].map((node) => node.textContent)).toEqual([
    "",
    "Their name",
    "My draft",
  ]);
});
it("an old passive scan refusal cannot replace a newer successful explicit review", async () => {
  const f = liveFixture(),
    { el } = await mountLive(f);
  await edit(el, "one", "Draft");
  let refuse!: (error: Error) => void;
  f.read.mockImplementationOnce(
    () =>
      new Promise<TranslationItemPage>((_resolve, reject) => {
        refuse = reject;
      }),
  );
  f.liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(2));
  await reviewed(el);
  expect(f.read).toHaveBeenCalledTimes(3);
  refuse(Error("old passive failure"));
  await frame(el);
  expect(q(el, "[data-test=read-error]")).toBeNull();
  expect(field(el, "one").value).toBe("Draft");
});
it("returns to a populated page when live departures empty the last bounded page", async () => {
  let rows = Array.from({ length: 60 }, (_, n) => target(String(n).padStart(3, "0")));
  const liveData = new LiveData(),
    read = vi.fn(async (query: TranslationQuery) =>
      "after" in query && query.after
        ? result(rows.slice(50))
        : result(rows.slice(0, 50), rows.length > 50 ? cursor("049", query) : null),
    );
  const { el } = await mount(rows, { liveData, getContentTranslationTargets: read });
  await click(el, "next");
  await vi.waitFor(() => expect(field(el, "050")).not.toBeNull());
  rows = rows.slice(0, 45);
  liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(field(el, "000")).not.toBeNull());
  expect(read).toHaveBeenCalledTimes(4);
  expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=previous]")!.disabled).toBe(true);
  expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=next]")!.disabled).toBe(true);
  expect(windowFor(el)!.rows).toHaveLength(45);
});
it.each(["reopen", "reconnect"] as const)("ignores an old PUT refusal after %s", async (mode) => {
  let refuse!: (value: unknown) => void;
  const save = vi.fn(
    () =>
      new Promise<{ saved: TranslationCell[] }>((_resolve, reject) => {
        refuse = reject;
      }),
  );
  const { el, host } = await mount([target()], { saveContentTranslations: save });
  await edit(el, "one", "Old draft");
  await click(el, "save");
  if (mode === "reopen") {
    el.open = false;
    await settled(el);
    el.open = true;
    await settled(el);
  } else {
    el.remove();
    host.append(el);
    await settled(el);
  }
  await vi.waitFor(() => expect(field(el, "one")?.disabled).toBe(false));
  await edit(el, "one", "New draft");
  refuse({
    code: "content.translation_refused",
    params: {
      kind: "product",
      id: "one",
      field: "name",
      language: "es",
      causeCode: "content.translation_required",
    },
  });
  await frame(el);
  expect(field(el, "one").error).toBe("");
  expect(field(el, "one").value).toBe("New draft");
  expect(el.open).toBe(true);
  expect(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error).toBe("");
});
it("keeps an unresolved review visible with the newest passive values and the held draft", async () => {
  const f = liveFixture(),
    { el, api } = await mountLive(f);
  await edit(el, "one", "My draft");
  f.current = cell("one", "es", {
    text: "Their first name",
    effectiveText: "Their first name",
    expected: "first",
  });
  f.rows = [changed("one", "Their first name", "first")];
  await reviewed(el);
  expect(review(el)!.textContent).toContain("Their first name");
  f.current = cell("one", "es", {
    text: "Their newest name",
    effectiveText: "Their newest name",
    expected: "newest",
  });
  f.rows = [changed("one", "Their newest name", "newest")];
  f.liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(review(el)?.textContent).toContain("Their newest name"));
  expect(field(el, "one").value).toBe("My draft");
  await click(el, "save");
  expect(api.saveContentTranslations).not.toHaveBeenCalled();
  await decide(el, "keep");
  await click(el, "save");
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
    edits: [
      {
        kind: "product",
        id: "one",
        language: "es",
        field: "name",
        expected: "newest",
        text: "My draft",
      },
    ],
  });
});
