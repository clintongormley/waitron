import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, TranslationPage, TranslationTarget } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { chooseOption, chooseOptions } from "@waitron/ui/src/test-helpers.js";
import "./content-translations-dialog.js";
import type { ContentTranslationsDialog } from "./content-translations-dialog.js";

const target = (id = "one", overrides: Partial<TranslationTarget> = {}): TranslationTarget => ({
  kind: "product",
  id,
  name: `STAFF ${id}`,
  reason: "absent",
  selectedText: null,
  defaultText: null,
  effectiveSelectedText: null,
  effectiveDefaultText: null,
  defaultRequired: true,
  eligible: true,
  unavailableReason: null,
  owners: { kind: "product", parentId: null },
  expected: `baseline-${id}`,
  ...overrides,
});
const result = (rows: TranslationTarget[], next: string | null = null): TranslationPage => ({
  language: "es",
  config: { defaultLanguage: "en", languages: ["en", "es"] },
  required: [],
  rows,
  next,
  total: rows.length,
});
async function mount(rows = [target()], overrides: Record<string, unknown> = {}) {
  const api = {
    getContentTranslationTargets: vi.fn().mockResolvedValue(result(rows)),
    saveContentTranslations: vi.fn().mockResolvedValue({ saved: rows }),
    ...overrides,
  } as unknown as DashboardApi;
  const mounted = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    { open: true, language: "es", api },
  );
  await vi.waitFor(() => expect(q(mounted.el, "[data-test=loading]")).toBeNull());
  await mounted.el.updateComplete;
  return { ...mounted, api };
}
const q = <T extends HTMLElement = HTMLElement>(
  el: ContentTranslationsDialog,
  selector: string,
): T | null =>
  el.shadowRoot!.querySelector<T>(selector) ??
  el.shadowRoot!.querySelector("wt-data-table")?.shadowRoot?.querySelector<T>(selector) ??
  null;
const field = (el: ContentTranslationsDialog, id: string, name = "text") =>
  q<HTMLElementTagNameMap["wt-input"]>(el, `[name="translation-${name}-product-${id}"]`)!;
async function edit(el: ContentTranslationsDialog, id: string, text: string, name = "text") {
  const control = field(el, id, name);
  expect(control).not.toBeNull();
  control.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: text }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  await q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")?.updateComplete;
}
const click = async (el: ContentTranslationsDialog, action: string) => {
  q(el, `[data-test=${action}]`)!.click();
  await el.updateComplete;
  await q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")?.updateComplete;
};
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("staged translation dialog", () => {
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
        getContentTranslationTargets: vi.fn().mockResolvedValue({ ...result([]), language }),
      } as unknown as DashboardApi;
      const { el } = await mountWidget<ContentTranslationsDialog>(
        "dashboard-content-translations-dialog",
        { api, language, open: true },
      );
      await vi.waitFor(() => expect(q(el, "[data-test=complete]")).not.toBeNull());
      expect(q(el, "[data-test=complete]")!.textContent!.trim()).toBe(sentence);
    },
  );
  it("reads every opening page through the passive client and saves through the active client", async () => {
    const passive = {
      getContentTranslationTargets: vi
        .fn()
        .mockResolvedValue(result([target("one", { defaultRequired: false })])),
    };
    const { el, api } = await mount([], { background: passive });
    expect(field(el, "one")).not.toBeNull();
    expect(api.getContentTranslationTargets).not.toHaveBeenCalled();
    expect(passive.getContentTranslationTargets).toHaveBeenCalledExactlyOnceWith("es", {});
    await edit(el, "one", "Croqueta");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledWith("es", {
      edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "Croqueta" }],
    });
  });
  it("retains column objects on redraw and updates their labels for the UI language", async () => {
    const { el } = await mount();
    const table = q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!;
    const columns = table.columns;
    await edit(el, "one", "Croqueta");
    expect(table.columns).toBe(columns);
    setLocale("en-GB");
    el.requestUpdate();
    await el.updateComplete;
    await table.updateComplete;
    expect(table.columns[0]!.label).toBe("Name");
    expect(q<HTMLElementTagNameMap["wt-combobox"]>(el, '[name="kind"]')!.options[1]!.label).toBe(
      "Product",
    );
  });
  it("keeps the 101st row readable but prevents starting it until an edit is undone", async () => {
    const rows = Array.from({ length: 101 }, (_, n) =>
      target(String(n), { defaultRequired: false }),
    );
    const { el, api } = await mount(rows);
    for (let n = 0; n < 50; n++)
      field(el, String(n)).dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Nombre" },
          bubbles: true,
          composed: true,
        }),
      );
    await el.updateComplete;
    await click(el, "next");
    for (let n = 50; n < 100; n++)
      field(el, String(n)).dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Nombre" },
          bubbles: true,
          composed: true,
        }),
      );
    await el.updateComplete;
    await click(el, "next");
    expect(field(el, "100").disabled).toBe(true);
    expect(q(el, "[data-test=edited-count]")!.textContent).toContain("100");
    await click(el, "previous");
    await edit(el, "99", "");
    await click(el, "next");
    expect(field(el, "100").disabled).toBe(false);
    await edit(el, "100", "Último");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    const batch = vi.mocked(api.saveContentTranslations).mock.calls[0]![1];
    expect(batch.edits).toHaveLength(100);
    expect(batch.edits.at(-1)).toEqual({
      kind: "product",
      id: "100",
      expected: "baseline-100",
      text: "Último",
    });
    expect(batch.edits.some((row) => row.id === "99")).toBe(false);
  });
  it("marks oversized UTF-8 names after submission and disables Save until corrected", async () => {
    const { el, api } = await mount([target("one", { defaultRequired: false })]);
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
    let finish!: (value: { saved: TranslationTarget[] }) => void;
    const save = vi.fn(
      () =>
        new Promise<{ saved: TranslationTarget[] }>((resolve) => {
          finish = resolve;
        }),
    );
    const { el } = await mount([target("one", { defaultRequired: false })], {
      saveContentTranslations: save,
    });
    await edit(el, "one", "Croqueta");
    const input = field(el, "one").shadowRoot!.querySelector("input")!;
    await userEvent.click(input);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    await click(el, "save");
    expect(save).toHaveBeenCalledOnce();
    expect(field(el, "one").disabled).toBe(true);
    finish({ saved: [] });
    await vi.waitFor(() => expect(el.open).toBe(false));
  });
  it("retains every editor address, context label and localized kind option", async () => {
    const rows: TranslationTarget[] = [
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
    const { el } = await mount(rows);
    const links = [...q(el, "wt-data-table")!.shadowRoot!.querySelectorAll("tbody a")];
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
    const links = [...q(el, "wt-data-table")!.shadowRoot!.querySelectorAll("tbody a")];
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
  it("keeps filters before search, allows any selected kinds and shows the shared no-matches sentence", async () => {
    const { el } = await mount([
      target(),
      target("unit", { kind: "unit" }),
      target("list", { kind: "extra_list" }),
    ]);
    expect(
      [...el.shadowRoot!.querySelectorAll(".filters > *")].map((field) =>
        field.getAttribute("name"),
      ),
    ).toEqual(["kind", "why", "search"]);
    const kinds = q<HTMLElementTagNameMap["wt-combobox"]>(el, '[name="kind"]')!;
    await chooseOptions(kinds, ["product", "unit"]);
    await el.updateComplete;
    expect(kinds.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe("2 tipos");
    await q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!.updateComplete;
    expect(
      q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!.rows.map(
        (row) => (row as TranslationTarget).id,
      ),
    ).toEqual(["one", "unit"]);
    q(el, '[name="search"]')!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "not present" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    await q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!.updateComplete;
    expect(q(el, "tbody")).toBeNull();
    expect(q(el, ".empty .message")!.textContent!.trim()).toBe(
      "Nada coincide con tu búsqueda ni con tus filtros.",
    );
  });
  it("opens only the selected language with quiet unchanged Save and no default copied from staff", async () => {
    const { el, api } = await mount();
    expect(q<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.heading).toContain("Español");
    expect(field(el, "one").value).toBe("");
    expect(field(el, "one", "defaultText")).toBeNull();
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.disabled).toBe(true);
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.variant).toBe(
      "secondary",
    );
    await click(el, "save");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    await edit(el, "one", "Croqueta");
    expect(field(el, "one", "defaultText").value).toBe("");
    expect(field(el, "one", "defaultText").required).toBe(true);
    expect(field(el, "one", "defaultText").placeholder).toBe("STAFF one");
    expect(field(el, "one").getAttribute("lang")).toBe("es");
    expect(field(el, "one", "defaultText").getAttribute("lang")).toBe("en");
    await click(el, "save");
    expect(field(el, "one", "defaultText").error).not.toBe("");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    await edit(el, "one", " Ham croquette ", "defaultText");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
      edits: [
        {
          kind: "product",
          id: "one",
          expected: "baseline-one",
          text: "Croqueta",
          defaultText: "Ham croquette",
        },
      ],
    });
  });
  it("assembles pages sequentially before enabling edits and displays 50 at a time", async () => {
    let finish!: (value: TranslationPage) => void;
    const first = Array.from({ length: 50 }, (_, n) =>
      target(String(n), { defaultRequired: false }),
    );
    const read = vi
      .fn()
      .mockResolvedValueOnce(result(first, "next-page"))
      .mockImplementationOnce(
        () =>
          new Promise<TranslationPage>((resolve) => {
            finish = resolve;
          }),
      );
    const pending = mount(first, { getContentTranslationTargets: read });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(
      document
        .querySelector("dashboard-content-translations-dialog")!
        .shadowRoot!.querySelector("wt-data-table"),
    ).toBeNull();
    finish(result([target("last", { defaultRequired: false })]));
    const { el, api } = await pending;
    expect(read.mock.calls).toEqual([
      ["es", {}],
      ["es", { after: "next-page" }],
    ]);
    expect(q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!.rows).toHaveLength(50);
    await edit(el, "0", "First");
    await click(el, "next");
    expect(field(el, "last")).not.toBeNull();
    expect(field(el, "0")).toBeNull();
    await edit(el, "last", "Last");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledWith("es", {
      edits: [
        { kind: "product", id: "0", expected: "baseline-0", text: "First" },
        { kind: "product", id: "last", expected: "baseline-last", text: "Last" },
      ],
    });
  });
  it("filters kind, reason and context before paging without losing hidden edits; Show edited reveals them", async () => {
    const rows = [
      target("one", { defaultRequired: false }),
      target("label", {
        kind: "option_label",
        reason: "partial",
        parent: { id: "list", name: "Sauces" },
        owners: { kind: "option_label", listId: "list" },
        defaultRequired: false,
      }),
    ];
    const { el, api } = await mount(rows);
    await edit(el, "one", "Croqueta");
    const kind = q<HTMLElementTagNameMap["wt-combobox"]>(el, '[name="kind"]')!;
    const why = q<HTMLElementTagNameMap["wt-combobox"]>(el, '[name="why"]')!;
    expect(kind.multiple).toBe(true);
    expect(why.multiple).toBe(false);
    await chooseOptions(kind, ["option_label"]);
    await el.updateComplete;
    await chooseOption(why, "partial");
    await el.updateComplete;
    const search = q<HTMLElementTagNameMap["wt-input"]>(el, '[name="search"]')!;
    search.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Sauces" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    await q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!.updateComplete;
    expect(
      q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!.rows.map(
        (row) => (row as TranslationTarget).id,
      ),
    ).toEqual(["label"]);
    expect(q(el, "[data-test=edited-count]")!.textContent).toContain("1");
    expect(q(el, "[data-test=hidden-count]")!.textContent).toContain("1");
    await click(el, "show-edited");
    expect(field(el, "one").value).toBe("Croqueta");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledWith("es", {
      edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "Croqueta" }],
    });
  });
  it("reveals and focuses a hidden invalid companion above the bottom message", async () => {
    const { el, api } = await mount();
    await edit(el, "one", "Croqueta");
    const search = q<HTMLElementTagNameMap["wt-input"]>(el, '[name="search"]')!;
    search.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "not present" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    await q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!.updateComplete;
    expect(field(el, "one")).toBeNull();
    await click(el, "save");
    await vi.waitFor(() => expect(field(el, "one", "defaultText")?.error).not.toBe(""));
    const companion = field(el, "one", "defaultText");
    await vi.waitFor(() => expect(companion.shadowRoot!.activeElement?.tagName).toBe("INPUT"));
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
          field: "text",
          language: "es",
          causeCode: "product.invalid",
          causeParams: { field: "customerName" },
        },
      })
      .mockResolvedValue({ saved: [] });
    const { el } = await mount([target("one", { defaultRequired: false })], {
      saveContentTranslations: save,
    });
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
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(result([]));
    const { el } = await mount([], { getContentTranslationTargets: read });
    expect(q(el, "[data-test=read-error]")).not.toBeNull();
    await click(el, "retry");
    await vi.waitFor(() => expect(q(el, "[data-test=complete]")).not.toBeNull());
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.disabled).toBe(true);
    cleanupWidgets();
    const unavailable = await mount([
      target("one", { eligible: false, unavailableReason: "inactive" }),
    ]);
    expect(field(unavailable.el, "one").disabled).toBe(true);
    expect(q(unavailable.el, "[data-test=unavailable-product-one]")).not.toBeNull();
    expect(q<HTMLAnchorElement>(unavailable.el, "a")!.getAttribute("href")).toBe(
      "/manage/catalogue/product/one",
    );
  });
  it("empty reversion makes Save quiet and prevents an accidental request", async () => {
    const { el, api } = await mount();
    await edit(el, "one", "Croqueta");
    await edit(el, "one", "English", "defaultText");
    await edit(el, "one", " ");
    await edit(el, "one", "  ", "defaultText");
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!.disabled).toBe(true);
    await click(el, "save");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
  });
  it("trims only at submission, retaining selection during a middle edit", async () => {
    const { el } = await mount([target("one", { defaultRequired: false })]);
    const control = field(el, "one");
    await control.updateComplete;
    const native = control.shadowRoot!.querySelector("input")!;
    await userEvent.fill(native, "  Croqueta  ");
    native.setSelectionRange(4, 4);
    await userEvent.type(native, "X");
    await el.updateComplete;
    expect(native.value).toBe("  CrXoqueta  ");
    expect(native.selectionStart).toBe(5);
  });
});

describe("translation live review", () => {
  it("holds arrivals and dirty concurrent fills until an explicit keep decision", async () => {
    const one = target("one", { defaultRequired: false });
    let rows = [one];
    const current = { ...one, selectedText: "Their name", expected: "current" };
    const liveData = new LiveData();
    const read = vi.fn(async (_language: string, query: { targets?: unknown[] }) =>
      result(query.targets ? [current] : rows),
    );
    const { el, api } = await mount(rows, { liveData, getContentTranslationTargets: read });
    await edit(el, "one", "My draft");
    const input = field(el, "one").shadowRoot!.querySelector("input")!;
    await userEvent.click(input);
    rows = [target("arrival", { defaultRequired: false })];
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=arrivals]")?.textContent).toContain("1"));
    expect(field(el, "arrival")).toBeNull();
    expect(field(el, "one")).not.toBeNull();
    expect(field(el, "one").value).toBe("My draft");
    expect(field(el, "one").shadowRoot!.activeElement).toBe(input);
    expect(q(el, "[data-test=changed-product-one]")).not.toBeNull();
    await click(el, "save");
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    await click(el, "review");
    await vi.waitFor(() =>
      expect(q(el, "[data-test=review-product-one]")?.textContent).toContain("Their name"),
    );
    expect(q(el, "[data-test=review-product-one]")!.textContent).toContain("My draft");
    await click(el, "keep-product-one");
    expect(field(el, "arrival")).not.toBeNull();
    expect(field(el, "one").value).toBe("My draft");
    await click(el, "save");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("es", {
      edits: [{ kind: "product", id: "one", expected: "current", text: "My draft" }],
    });
  });
  it.each(["replace", "discard"])(
    "requires explicit %s before clearing an edited concurrent fill",
    async (choice) => {
      const one = target("one", { defaultRequired: false });
      let current = one;
      const read = vi.fn(async () => result([current]));
      const { el, api } = await mount([one], { getContentTranslationTargets: read });
      await edit(el, "one", "My draft");
      current = { ...one, selectedText: "Their name", expected: "current" };
      await click(el, "review");
      await vi.waitFor(() => expect(q(el, "[data-test=review-product-one]")).not.toBeNull());
      expect(field(el, "one").value).toBe("My draft");
      await click(el, `${choice}-product-one`);
      expect(field(el, "one").value).toBe("Their name");
      await click(el, "save");
      expect(api.saveContentTranslations).not.toHaveBeenCalled();
    },
  );
  it("assembles page-two departures and arrivals atomically and abandons a changing configuration", async () => {
    const first = Array.from({ length: 50 }, (_, n) =>
      target(String(n), { defaultRequired: false }),
    );
    let phase = 0;
    let finish!: (page: TranslationPage) => void;
    const liveData = new LiveData();
    const read = vi.fn(
      async (_language: string, query: { after?: string; targets?: unknown[] }) => {
        if (query.targets)
          return result([
            target("last", {
              defaultRequired: false,
              eligible: false,
              unavailableReason: "missing",
            }),
          ]);
        if (!query.after) return result(first, "second");
        if (phase === 0) return result([target("last", { defaultRequired: false })]);
        return await new Promise<TranslationPage>((resolve) => {
          finish = resolve;
        });
      },
    );
    const { el } = await mount(first, { liveData, getContentTranslationTargets: read });
    await click(el, "next");
    await edit(el, "last", "My last");
    phase = 1;
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(read.mock.calls.filter(([, q]) => q.after).length).toBe(2));
    expect(field(el, "last").value).toBe("My last");
    expect(q(el, "[data-test=arrivals]")).toBeNull();
    finish({
      ...result([target("arrival", { defaultRequired: false })]),
      config: { languages: ["en", "es"], defaultLanguage: "es" },
    });
    await vi.waitFor(() => expect(q(el, "[data-test=read-error]")).not.toBeNull());
    expect(field(el, "last").value).toBe("My last");
    expect(q(el, "[data-test=changed-product-last]")).toBeNull();
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(read.mock.calls.filter(([, q]) => q.after).length).toBe(3));
    finish(result([target("arrival", { defaultRequired: false })]));
    await vi.waitFor(() => expect(q(el, "[data-test=arrivals]")?.textContent).toContain("1"));
    expect(field(el, "last").value).toBe("My last");
    expect(q(el, "[data-test=changed-product-last]")).not.toBeNull();
    expect(q(el, "[data-test=unavailable-product-last]")).not.toBeNull();
    expect(q(el, "[data-test=read-error]")).toBeNull();
  });
  it("ignores old PUT success after close and reopen", async () => {
    let finish!: (response: { saved: TranslationTarget[] }) => void;
    const save = vi.fn(
      () =>
        new Promise<{ saved: TranslationTarget[] }>((resolve) => {
          finish = resolve;
        }),
    );
    const { el } = await mount([target("one", { defaultRequired: false })], {
      saveContentTranslations: save,
    });
    const saved = vi.fn();
    el.addEventListener("translations-saved", saved);
    await edit(el, "one", "Old draft");
    await click(el, "save");
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(field(el, "one")).not.toBeNull());
    await edit(el, "one", "New draft");
    finish({ saved: [] });
    await vi.waitFor(() => expect(field(el, "one").value).toBe("New draft"));
    expect(saved).not.toHaveBeenCalled();
    expect(el.open).toBe(true);
  });
});

it("reconnect abandons an old PUT while keeping edited text retryable", async () => {
  let finish!: (value: { saved: TranslationTarget[] }) => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<{ saved: TranslationTarget[] }>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ saved: [] });
  const { el, host } = await mount([target("one", { defaultRequired: false })], {
    saveContentTranslations: save,
  });
  await edit(el, "one", "Draft");
  await click(el, "save");
  el.remove();
  host.append(el);
  await el.updateComplete;
  await vi.waitFor(() => expect(field(el, "one").disabled).toBe(false));
  finish({ saved: [] });
  await vi.waitFor(() => expect(el.open).toBe(true));
  expect(field(el, "one").value).toBe("Draft");
  await click(el, "save");
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(save).toHaveBeenCalledTimes(2);
});
it("retained reference review is split into reads of at most 50 without dropping filled drafts", async () => {
  const rows = Array.from({ length: 51 }, (_, n) => target(String(n), { defaultRequired: false }));
  let filled = false;
  const read = vi.fn(
    async (_language: string, query: { after?: string; targets?: { id: string }[] }) => {
      if (query.targets)
        return result(
          query.targets.map(({ id }) => ({
            ...rows[Number(id)]!,
            selectedText: "Their name",
            expected: `latest-${id}`,
          })),
        );
      return filled
        ? result([])
        : query.after
          ? result(rows.slice(50))
          : result(rows.slice(0, 50), "second");
    },
  );
  const { el } = await mount(rows, { getContentTranslationTargets: read });
  for (let n = 0; n < 50; n++)
    field(el, String(n)).dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: `Draft ${n}` },
        bubbles: true,
        composed: true,
      }),
    );
  await el.updateComplete;
  await click(el, "next");
  await edit(el, "50", "Draft 50");
  filled = true;
  await click(el, "review");
  await vi.waitFor(() => expect(q(el, "[data-test=review-product-50]")).not.toBeNull());
  const queries = read.mock.calls.filter(([, q]) => q.targets).map(([, q]) => q.targets!);
  expect(queries.map((q) => q.length)).toEqual([50, 1]);
  expect(queries.flat().map((q) => q.id)).toEqual(rows.map((row) => row.id));
  expect(field(el, "50").value).toBe("Draft 50");
});
it("a late opening GET and late review GET cannot overwrite a reopened draft", async () => {
  let finish!: (page: TranslationPage) => void;
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<TranslationPage>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(result([target("one", { defaultRequired: false })]));
  const api = { getContentTranslationTargets: read } as unknown as DashboardApi;
  const { el } = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    { open: true, language: "es", api },
  );
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  await vi.waitFor(() => expect(field(el, "one")).not.toBeNull());
  await edit(el, "one", "New draft");
  finish(result([target("old")]));
  await vi.waitFor(() => expect(q(el, "[data-test=loading]")).toBeNull());
  expect(field(el, "old")).toBeNull();
  expect(field(el, "one").value).toBe("New draft");
  read.mockImplementationOnce(
    () =>
      new Promise<TranslationPage>((resolve) => {
        finish = resolve;
      }),
  );
  await click(el, "review");
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  await vi.waitFor(() => expect(field(el, "one")).not.toBeNull());
  await edit(el, "one", "Newest draft");
  finish(result([target("old")]));
  await vi.waitFor(() => expect(q(el, "[data-test=loading]")).toBeNull());
  expect(field(el, "old")).toBeNull();
  expect(field(el, "one").value).toBe("Newest draft");
});
it("live read recovery preserves an action refusal and a retry sends the same draft", async () => {
  let failure = false;
  const liveData = new LiveData();
  const read = vi.fn(async () => {
    if (failure) throw Error("offline");
    return result([target("one", { defaultRequired: false })]);
  });
  const save = vi
    .fn()
    .mockRejectedValueOnce({ code: "content.translation_stale" })
    .mockResolvedValue({ saved: [] });
  const { el } = await mount([], {
    liveData,
    getContentTranslationTargets: read,
    saveContentTranslations: save,
  });
  await edit(el, "one", "Draft");
  await click(el, "save");
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error).toBe(
      codeMessage("content.translation_stale"),
    ),
  );
  failure = true;
  liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(q(el, "[data-test=read-error]")).not.toBeNull());
  failure = false;
  liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(q(el, "[data-test=read-error]")).toBeNull());
  expect(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!.error).toBe(
    codeMessage("content.translation_stale"),
  );
  expect(field(el, "one").value).toBe("Draft");
  await click(el, "save");
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(save.mock.calls).toEqual([
    ["es", { edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "Draft" }] }],
    ["es", { edits: [{ kind: "product", id: "one", expected: "baseline-one", text: "Draft" }] }],
  ]);
});

it("a newer live snapshot wins over a delayed explicit review without changing the draft", async () => {
  const one = target("one", { defaultRequired: false });
  let current = one;
  let finish!: (page: TranslationPage) => void;
  const liveData = new LiveData();
  const read = vi.fn(async () => result([current]));
  const { el } = await mount([one], { liveData, getContentTranslationTargets: read });
  await edit(el, "one", "My draft");
  read.mockImplementationOnce(
    () =>
      new Promise<TranslationPage>((resolve) => {
        finish = resolve;
      }),
  );
  await click(el, "review");
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  current = { ...one, selectedText: "New live", expected: "new-live" };
  liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(q(el, "[data-test=changed-product-one]")).not.toBeNull());
  finish(result([{ ...one, selectedText: "Old review", expected: "old-review" }]));
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(false),
  );
  await click(el, "review");
  await vi.waitFor(() =>
    expect(q(el, "[data-test=review-product-one]")?.textContent).toContain("New live"),
  );
  expect(q(el, "[data-test=review-product-one]")!.textContent).not.toContain("Old review");
  expect(field(el, "one").value).toBe("My draft");
});

it("an obsolete review refusal cannot replace a recovered live read or release a newer review", async () => {
  const one = target("one", { defaultRequired: false });
  const liveData = new LiveData();
  let refuse!: (error: Error) => void;
  let finish!: (value: TranslationPage) => void;
  const read = vi.fn(async () => result([one]));
  const { el } = await mount([one], { liveData, getContentTranslationTargets: read });
  await edit(el, "one", "Draft");
  read.mockImplementationOnce(
    () =>
      new Promise<TranslationPage>((_resolve, reject) => {
        refuse = reject;
      }),
  );
  await click(el, "review");
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(false),
  );
  read.mockImplementationOnce(
    () =>
      new Promise<TranslationPage>((resolve) => {
        finish = resolve;
      }),
  );
  await click(el, "review");
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(5));
  refuse(Error("old failure"));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(q(el, "[data-test=read-error]")).toBeNull();
  expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(true);
  finish(result([one]));
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(false),
  );
});

it("Review latest reveals a hidden conflict with its old, current and draft text", async () => {
  const one = target("one", { defaultRequired: false });
  let current = one;
  const read = vi.fn(async () => result([current]));
  const { el } = await mount([one], { getContentTranslationTargets: read });
  await edit(el, "one", "My draft");
  q(el, '[name="search"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "hidden" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  await q<HTMLElementTagNameMap["wt-data-table"]>(el, "wt-data-table")!.updateComplete;
  expect(field(el, "one")).toBeNull();
  current = { ...one, selectedText: "Their name", expected: "latest" };
  await click(el, "review");
  await vi.waitFor(() =>
    expect(q(el, "[data-test=review-product-one]")?.textContent).toContain("Their name"),
  );
  expect(field(el, "one").value).toBe("My draft");
});

it("an old passive scan refusal cannot replace a newer successful explicit review", async () => {
  const one = target("one", { defaultRequired: false });
  const liveData = new LiveData();
  let refuse!: (error: Error) => void;
  const read = vi.fn(async () => result([one]));
  const { el } = await mount([one], { liveData, getContentTranslationTargets: read });
  await edit(el, "one", "Draft");
  read.mockImplementationOnce(
    () =>
      new Promise<TranslationPage>((_resolve, reject) => {
        refuse = reject;
      }),
  );
  liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await click(el, "review");
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=review]")!.disabled).toBe(false),
  );
  refuse(Error("old passive failure"));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(q(el, "[data-test=read-error]")).toBeNull();
  expect(field(el, "one").value).toBe("Draft");
});
