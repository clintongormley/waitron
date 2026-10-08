import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
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
