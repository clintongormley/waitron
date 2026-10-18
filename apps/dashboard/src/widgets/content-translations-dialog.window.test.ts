import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import { DASHBOARD_ICONS } from "../icons.js";
import type {
  TranslationCell,
  TranslationCellRef,
  TranslationItem,
  TranslationItemPage,
  TranslationQuery,
} from "@waitron/catalogue/src/content-translation-types.js";
import type { ContentSuggestionRead } from "@waitron/catalogue/src/content-suggestion-types.js";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./content-translations-dialog.js";
import type { ContentTranslationsDialog } from "./content-translations-dialog.js";

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
const row = (id: string, languages = config.languages): TranslationItem => ({
  kind: "product",
  id,
  name: `STAFF ${id}`,
  owners: { kind: "product", parentId: null },
  cells: languages.map((language) => cell(id, language)),
});
const result = (rows = [row("001")], next: string | null = null): TranslationItemPage => ({
  config,
  required: [],
  configuration: "configuration-one",
  rows,
  next,
  total: 101,
});
const suggestions = (): ContentSuggestionRead => ({
  config,
  required: [],
  configuration: "configuration-one",
  waitingFixes: 0,
  run: null,
  suggestions: [],
  next: "suggestion-next",
  service: "on",
  cloudOrigin: null,
});
const cursor = (id: string, query?: TranslationQuery) =>
  JSON.stringify({
    configuration: "configuration-one",
    filter: {
      languages: query?.languages ?? ["en", "es", "fr"],
      missing: query && "missing" in query ? query.missing : { mode: "language", language: "es" },
      kind: null,
      search: "",
      waitingFixes: false,
    },
    last: { kind: "product", id },
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
registerIcons(DASHBOARD_ICONS);
async function mount(
  overrides: Record<string, unknown> = {},
  settings = config,
  language = "es",
  theme?: "light" | "dark",
) {
  const api = {
    getContentTranslationTargets: vi.fn(async () => result()),
    getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => ({
      config,
      required: [],
      configuration: "configuration-one",
      cells: refs.map((ref) => ({ ...cell(ref.id, ref.language), ...ref })),
    })),
    getContentSuggestions: vi.fn(async () => suggestions()),
    saveContentTranslations: vi.fn(async (batch: { edits: TranslationCell[] }) => ({
      saved: batch.edits.map((edit) => ({
        ...cell(edit.id, edit.language, edit.text),
        expected: "saved",
      })),
    })),
    ...overrides,
  };
  const mounted = await mountWidget<ContentTranslationsDialog>(
    "dashboard-content-translations-dialog",
    { open: true, language, config: settings, api: api as unknown as DashboardApi },
    theme,
  );
  const { el } = mounted;
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=loading]")).toBeNull());
  await el.updateComplete;
  return { ...mounted, api };
}
const windowFor = (el: ContentTranslationsDialog) =>
  el.shadowRoot!.querySelector("dashboard-content-translation-window")!;
const input = (el: ContentTranslationsDialog, id = "001", language = "es", field = "name") =>
  windowFor(el)?.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="translation-product-${id}-${language}-${field}"]`,
  );
const button = (el: ContentTranslationsDialog, name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${name}]`)!;
async function edit(el: ContentTranslationsDialog, value: string, id = "001", language = "es") {
  await vi.waitFor(() => expect(input(el, id, language)).toBeTruthy());
  const field = input(el, id, language)!;
  await field.updateComplete;
  await userEvent.fill(field.shadowRoot!.querySelector("input")!, value);
  await el.updateComplete;
  await windowFor(el).updateComplete;
}
async function select(el: ContentTranslationsDialog, name: string, value: string) {
  el.shadowRoot!.querySelector(`[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
}
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("bounded multilingual translation editor", () => {
  it("reads pages and suggestions passively while saving the batch through the active client", async () => {
    const background = {
      getContentTranslationTargets: vi.fn(async () => result()),
      getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => ({
        config,
        required: [],
        configuration: "configuration-one",
        cells: refs.map((ref) => cell(ref.id, ref.language)),
      })),
      getContentSuggestions: vi.fn(async () => suggestions()),
      saveContentTranslations: vi.fn(async () => ({ saved: [cell("001", "es", "Sopa")] })),
    };
    const { el, api } = await mount({ background });
    await edit(el, "Sopa");
    button(el, "save").click();
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(background.getContentTranslationTargets).toHaveBeenCalledExactlyOnceWith({
      languages: ["en", "es", "fr"],
      missing: { mode: "language", language: "es" },
    });
    expect(background.getContentSuggestions).toHaveBeenCalledExactlyOnceWith({});
    expect(api.getContentTranslationTargets).not.toHaveBeenCalled();
    expect(api.getContentSuggestions).not.toHaveBeenCalled();
    expect(background.saveContentTranslations).not.toHaveBeenCalled();
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "001",
          language: "es",
          field: "name",
          expected: "v1-001-es",
          text: "Sopa",
        },
      ],
    });
  });
  it.each([390, 1280])(
    "windows 200 languages and 101 items at %s pixels without losing a last-language draft",
    async (width) => {
      await page.viewport(width, 900);
      const codes = ["en", "es", "fr", "de", "it", "pt", "ca", "eu", "gl", "nl"];
      const regions = [
        "AD",
        "AE",
        "AR",
        "AT",
        "AU",
        "BE",
        "BR",
        "CA",
        "CH",
        "CL",
        "CO",
        "DE",
        "ES",
        "FR",
        "GB",
        "IE",
        "IT",
        "MX",
        "US",
        "ZA",
      ];
      const languages = codes.flatMap((code) => regions.map((region) => `${code}-${region}`));
      expect(Intl.getCanonicalLocales(languages)).toEqual(languages);
      expect(languages).toHaveLength(200);
      const settings = { defaultLanguage: "en-AD", languages };
      const items = vi.fn(async (query: TranslationQuery) => ({
        ...result(
          Array.from({ length: 50 }, (_, n) => row(String(n).padStart(3, "0"), query.languages)),
        ),
        config: settings,
        next: cursor("049", query),
      }));
      const { el } = await mount(
        {
          getContentTranslationTargets: items,
          getContentSuggestions: vi.fn(async () => ({ ...suggestions(), config: settings })),
        },
        settings,
        "en-AD",
      );
      await vi.waitFor(() => expect(input(el, "000", "en-AD")).toBeTruthy());
      expect(windowFor(el).shadowRoot!.querySelectorAll("[data-translation-row]")).toHaveLength(50);
      expect(windowFor(el).shadowRoot!.querySelectorAll("wt-input").length).toBeLessThanOrEqual(
        350,
      );
      await select(el, "jump", "nl-ZA");
      await vi.waitFor(() => expect(input(el, "000", "nl-ZA")).toBeTruthy());
      await edit(el, "Last language", "000", "nl-ZA");
      await select(el, "jump", "en-AD");
      await vi.waitFor(() => expect(input(el, "000", "en-AD")).toBeTruthy());
      await select(el, "jump", "nl-ZA");
      await vi.waitFor(() => expect(input(el, "000", "nl-ZA")?.value).toBe("Last language"));
      expect(items).toHaveBeenCalledTimes(4);
      expect(windowFor(el).width).toBe(width === 390 ? "phone" : "desktop");
    },
  );
  it("opens one final-contract page and suggestion page without draining either cursor", async () => {
    const items = vi.fn(async () => result([row("001")], cursor("001")));
    const { el, api } = await mount({ getContentTranslationTargets: items });
    expect(items).toHaveBeenCalledExactlyOnceWith({
      languages: ["en", "es", "fr"],
      missing: { mode: "language", language: "es" },
    });
    expect(api.getContentSuggestions).toHaveBeenCalledExactlyOnceWith({});
    await vi.waitFor(() => expect(input(el)?.value).toBe(""));
    expect(button(el, "save").disabled).toBe(true);
    expect(el.shadowRoot!.querySelector("[name=why]")).toBeNull();
  });
  it("fetches one next page and keeps a hidden personal draft through Previous and Show staged", async () => {
    const items = vi.fn(async (query: TranslationQuery) => {
      if ("targets" in query) return result(query.targets.map((ref) => row(ref.id)));
      return query.after ? result([row("051")]) : result([row("001")], cursor("001"));
    });
    const { el } = await mount({ getContentTranslationTargets: items });
    await edit(el, "Sopa");
    button(el, "next").click();
    await vi.waitFor(() => expect(input(el, "051")).toBeTruthy());
    expect(items).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("[data-test=hidden-count]")!.textContent).toContain("1");
    button(el, "previous").click();
    await vi.waitFor(() => expect(input(el)?.value).toBe("Sopa"));
    expect(items).toHaveBeenCalledTimes(3);
    button(el, "show-edited").click();
    await vi.waitFor(() => expect(items).toHaveBeenCalledTimes(4));
    expect(items).toHaveBeenLastCalledWith({
      languages: ["en", "es", "fr"],
      targets: [{ kind: "product", id: "001" }],
    });
    expect(input(el)?.value).toBe("Sopa");
  });
  it("sends independent Missing in, kind and search filters while retaining personal text", async () => {
    const { el, api } = await mount();
    await edit(el, "Sopa");
    await select(el, "missing", "any");
    await vi.waitFor(() =>
      expect(api.getContentTranslationTargets).toHaveBeenLastCalledWith({
        languages: ["en", "es", "fr"],
        missing: { mode: "any" },
      }),
    );
    await select(el, "kind", "unit");
    await vi.waitFor(() =>
      expect(api.getContentTranslationTargets).toHaveBeenLastCalledWith({
        languages: ["en", "es", "fr"],
        missing: { mode: "any" },
        kind: "unit",
      }),
    );
    await select(el, "search", "soup");
    await vi.waitFor(() =>
      expect(api.getContentTranslationTargets).toHaveBeenLastCalledWith({
        languages: ["en", "es", "fr"],
        missing: { mode: "any" },
        kind: "unit",
        search: "soup",
      }),
    );
    expect(input(el)?.value).toBe("Sopa");
  });
  it("saves separate languages and a deliberate clear as one exact batch, then closes", async () => {
    const one = row("001");
    one.cells[1] = cell("001", "es", "Old Spanish");
    const { el, api } = await mount({
      getContentTranslationTargets: vi.fn(async () => result([one])),
    });
    await edit(el, "  ");
    await edit(el, "Soupe", "001", "fr");
    const saved = vi.fn();
    el.addEventListener("translations-saved", saved);
    button(el, "save").click();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "001",
          language: "es",
          field: "name",
          expected: "v1-001-es",
          text: null,
        },
        {
          kind: "product",
          id: "001",
          language: "fr",
          field: "name",
          expected: "v1-001-fr",
          text: "Soupe",
        },
      ],
    });
    expect(el.open).toBe(false);
  });
  it("unstages one chosen field while keeping the other language ready to save", async () => {
    const { el, api } = await mount();
    await edit(el, "Sopa");
    await edit(el, "Soupe", "001", "fr");
    const unstage = windowFor(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-unstage='["product","001","es","name"]']`,
    );
    expect(unstage).not.toBeNull();
    unstage!.click();
    await el.updateComplete;
    await windowFor(el).updateComplete;
    expect(input(el)?.value).toBe("");
    expect(input(el, "001", "fr")?.value).toBe("Soupe");
    expect(button(el, "save").disabled).toBe(false);
    button(el, "save").click();
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "001",
          language: "fr",
          field: "name",
          expected: "v1-001-fr",
          text: "Soupe",
        },
      ],
    });
  });
  it("blocks a 101-field batch until you explicitly unstage a chosen field", async () => {
    const { el, api } = await mount({
      getContentTranslationTargets: vi.fn(async () =>
        result(Array.from({ length: 50 }, (_, n) => row(String(n)))),
      ),
    });
    await windowFor(el).updateComplete;
    const fields = [
      ...windowFor(el).shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>("wt-input"),
    ];
    expect(fields).toHaveLength(150);
    for (const [index, field] of fields.slice(0, 101).entries()) {
      field.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: `Draft ${index}` },
          bubbles: true,
          composed: true,
        }),
      );
    }
    await el.updateComplete;
    await windowFor(el).updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=edited-count]")!.textContent).toContain("101");
    expect(button(el, "save").disabled).toBe(true);
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    windowFor(el)
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-unstage]")!
      .click();
    await el.updateComplete;
    await windowFor(el).updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=edited-count]")!.textContent).toContain("100");
    expect(fields[100]!.value).toBe("Draft 100");
    expect(button(el, "save").disabled).toBe(false);
  });
  it.each([
    new TypeError("connection lost"),
    { code: "connection.failed" },
    { code: "connection.timed_out" },
    { code: "server.internal", status: 500 },
  ])("holds the exact uncertain batch after %j for explicit retry", async (error) => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ saved: [cell("001", "es", "Sopa")] });
    const { el } = await mount({ saveContentTranslations: save });
    await edit(el, "Sopa");
    button(el, "save").click();
    await vi.waitFor(() => expect(button(el, "save").disabled).toBe(false));
    await vi.waitFor(() => expect(input(el)?.disabled).toBe(true));
    const first = JSON.stringify(save.mock.calls[0]![0]);
    button(el, "save").click();
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(save).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(save.mock.calls[1]![0])).toBe(first);
    expect(save.mock.calls[1]![0]).toBe(save.mock.calls[0]![0]);
  });
  it("ignores a late page after closing and reopening on a different language", async () => {
    const old = deferred<TranslationItemPage>();
    const items = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(result([row("new")]));
    const mounting = mount({ getContentTranslationTargets: items });
    await vi.waitFor(() => expect(items).toHaveBeenCalledTimes(1));
    const el = document.querySelector("dashboard-content-translations-dialog")!;
    el.open = false;
    await el.updateComplete;
    el.language = "fr";
    el.open = true;
    await el.updateComplete;
    await vi.waitFor(() => expect(items).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(input(el, "new", "fr")).toBeTruthy());
    old.resolve(result([row("old")]));
    await old.promise;
    await mounting;
    await el.updateComplete;
    expect(input(el, "old")).toBeNull();
    expect(input(el, "new", "fr")).toBeTruthy();
  });
  it("keeps an action refusal when a later successful refresh recovers the read", async () => {
    const save = vi
      .fn()
      .mockRejectedValue({ code: "content.translation_stale", params: { scope: "configuration" } });
    const { el } = await mount({ saveContentTranslations: save });
    await edit(el, "Sopa");
    button(el, "save").click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBeTruthy(),
    );
    const refusal = el.shadowRoot!.querySelector("wt-form-actions")!.error;
    button(el, "review").click();
    await vi.waitFor(() => expect(button(el, "review").disabled).toBe(false));
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(refusal);
    expect(input(el)?.disabled).toBe(false);
  });
  it("resumes passive live reads after reconnecting while retaining the personal draft", async () => {
    const liveData = new LiveData();
    const { el, api } = await mount({ liveData });
    await edit(el, "Sopa");
    const host = el.parentElement!;
    el.remove();
    host.append(el);
    await vi.waitFor(() => expect(api.getContentTranslationTargets).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(button(el, "review").disabled).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(api.getContentTranslationTargets).toHaveBeenCalledTimes(3));
    expect(input(el)?.value).toBe("Sopa");
    expect(button(el, "save").disabled).toBe(false);
  });
  it("keeps Save waiting for the newest filter even when an older read finishes first", async () => {
    const first = deferred<TranslationItemPage>();
    const second = deferred<TranslationItemPage>();
    const items = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { el } = await mount({ getContentTranslationTargets: items });
    await edit(el, "Sopa");
    await select(el, "search", "first");
    await select(el, "search", "second");
    first.resolve(result());
    await first.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    await vi.waitFor(() => expect(items).toHaveBeenCalledTimes(3));
    expect(button(el, "save").disabled).toBe(true);
    second.resolve(result());
    await second.promise;
    await vi.waitFor(() => expect(button(el, "save").disabled).toBe(false));
    expect(input(el)?.value).toBe("Sopa");
  });
  it("keeps the mounted native input and caret while a language projection is pending and applies", async () => {
    const expanded = {
      defaultLanguage: "en",
      languages: ["en", "es", "fr", "de", "it", "pt", "ca", "eu", "gl", "nl"],
    };
    const pending = deferred<TranslationItemPage>();
    const items = vi
      .fn()
      .mockResolvedValueOnce({
        ...result([row("001", ["en", "es", "fr", "de", "it", "pt"])]),
        config: expanded,
      })
      .mockImplementationOnce(() => pending.promise);
    const { el } = await mount({ getContentTranslationTargets: items });
    await edit(el, "Sopa original");
    const field = input(el)!;
    const native = field.shadowRoot!.querySelector("input")!;
    native.focus();
    native.setSelectionRange(2, 5);
    await select(el, "jump", "nl");
    await vi.waitFor(() => expect(items).toHaveBeenCalledTimes(2));
    expect(input(el)!.shadowRoot!.querySelector("input")).toBe(native);
    pending.resolve({
      ...result([row("001", ["es", "pt", "ca", "eu", "gl", "nl"])]),
      config: expanded,
    });
    await pending.promise;
    await vi.waitFor(() => expect(input(el, "001", "nl")).toBeTruthy());
    expect(input(el)!.shadowRoot!.querySelector("input")).toBe(native);
    expect(native.value).toBe("Sopa original");
    expect([native.selectionStart, native.selectionEnd]).toEqual([2, 5]);
  });
});

for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    it.each([390, 1280])(
      `renders the bounded editor with optional unit fields and exact retry in ${locale}/${theme} at %i`,
      async (width) => {
        await page.viewport(width, 900);
        setLocale(locale);
        const unit: TranslationItem = {
          kind: "unit",
          id: "unit",
          name: "STAFF weight",
          owners: { kind: "unit" },
          cells: config.languages.flatMap((language) =>
            (["name", "abbreviation"] as const).map((field) => ({
              ...cell("unit", language),
              kind: "unit",
              field,
              owners: { kind: "unit" },
              staffText: field === "name" ? "STAFF kilogram" : "SKG",
            })),
          ),
        };
        const { el, host } = await mount(
          {
            getContentTranslationTargets: vi.fn(async () => result([row("001"), unit])),
            saveContentTranslations: vi.fn().mockRejectedValue({ code: "connection.failed" }),
          },
          config,
          "es",
          theme,
        );
        const kind =
          el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=kind]")!;
        await kind.updateComplete;
        expect(kind.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe(
          t("content_gaps.kind_all"),
        );
        await edit(el, "Sopa");
        const view = windowFor(el);
        const units = [
          ...view.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>(
            '[name^="translation-unit-"]',
          ),
        ];
        expect(units).toHaveLength(6);
        for (const field of units) {
          await field.updateComplete;
          expect(field.shadowRoot!.querySelector("input")!.value).toBe("");
          expect(field.shadowRoot!.querySelector("input")!.required).toBe(false);
          expect(field.placeholder).toBe(field.name.endsWith("-name") ? "STAFF kilogram" : "SKG");
        }
        const modal = el.shadowRoot!.querySelector("wt-modal")!;
        await modal.updateComplete;
        const native = modal.shadowRoot!.querySelector("dialog")!;
        const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
        expect(native.open).toBe(true);
        expect(window.innerWidth).toBe(width);
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
        expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: native,
          path: `__screenshots__/look/a682-editor-${locale}-${theme}-${width}-ready.png`,
        });
        button(el, "save").click();
        await vi.waitFor(() => expect(input(el)?.disabled).toBe(true));
        await vi.waitFor(() => expect(button(el, "save").disabled).toBe(false));
        expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: native,
          path: `__screenshots__/look/a682-editor-${locale}-${theme}-${width}-retry.png`,
        });
      },
    );
  }
}
