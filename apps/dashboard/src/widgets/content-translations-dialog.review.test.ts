import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import type {
  TranslationCell,
  TranslationOwners,
  TranslationCellRef,
  TranslationItem,
  TranslationItemPage,
  TranslationQuery,
} from "@waitron/catalogue/src/content-translation-types.js";
import type { ContentSuggestionRead } from "@waitron/catalogue/src/content-suggestion-types.js";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
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

const review = (el: ContentTranslationsDialog, language = "es", field = "name", id = "001") =>
  el.shadowRoot!.querySelector<HTMLElement>(
    `[data-review='["product","${id}","${language}","${field}"]']`,
  );
async function choose(el: ContentTranslationsDialog, choice: string, language = "es") {
  await vi.waitFor(() =>
    expect(
      review(el, language)?.querySelector<HTMLElementTagNameMap["wt-button"]>(
        `[data-choice=${choice}]`,
      )?.disabled,
    ).toBe(false),
  );
  review(el, language)!.querySelector<HTMLElement>(`[data-choice=${choice}]`)!.click();
  await el.updateComplete;
  await windowFor(el).updateComplete;
}
async function refresh(el: ContentTranslationsDialog) {
  button(el, "review").click();
  await vi.waitFor(() => expect(button(el, "review").disabled).toBe(false));
  await el.updateComplete;
}

describe("field-specific multilingual review", () => {
  it("shows old/current/draft independently and keeps only the chosen field with its latest token", async () => {
    let current = cell("001", "es", "Antes");
    const { el, api } = await mount({
      getContentTranslationTargets: vi.fn(async () =>
        result([{ ...row("001"), cells: [current, cell("001", "fr")] }]),
      ),
      getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => ({
        config,
        required: [],
        configuration: "configuration-one",
        cells: refs.map((ref) => (ref.language === "es" ? current : cell(ref.id, ref.language))),
      })),
    });
    await edit(el, "Mi borrador");
    await edit(el, "Mon brouillon", "001", "fr");
    current = { ...cell("001", "es", "Ahora"), expected: "latest-es" };
    await refresh(el);
    await vi.waitFor(() => expect(review(el)?.textContent).toContain("Antes"));
    expect(review(el)!.textContent).toContain("Ahora");
    expect(review(el)!.textContent).toContain("Mi borrador");
    expect(review(el, "fr")).toBeNull();
    button(el, "save").click();
    await el.updateComplete;
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    await choose(el, "keep");
    button(el, "save").click();
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "001",
          language: "es",
          field: "name",
          expected: "latest-es",
          text: "Mi borrador",
        },
        {
          kind: "product",
          id: "001",
          language: "fr",
          field: "name",
          expected: "v1-001-fr",
          text: "Mon brouillon",
        },
      ],
    });
  });
  it.each(["replace", "discard"])(
    "%s adopts the current field and leaves another language staged",
    async (choice) => {
      let current = cell("001");
      const { el, api } = await mount({
        getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => ({
          config,
          required: [],
          configuration: "configuration-one",
          cells: refs.map((ref) => (ref.language === "es" ? current : cell(ref.id, ref.language))),
        })),
      });
      await edit(el, "Mi borrador");
      await edit(el, "Mon brouillon", "001", "fr");
      current = { ...cell("001", "es", "Ahora"), expected: "latest-es" };
      await refresh(el);
      await vi.waitFor(() => expect(review(el)).toBeTruthy());
      await choose(el, choice);
      expect(input(el)!.value).toBe("Ahora");
      expect(input(el, "001", "fr")!.value).toBe("Mon brouillon");
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
            text: "Mon brouillon",
          },
        ],
      });
    },
  );
  it("Keep retains an intentional clear and sends null with the reviewed token", async () => {
    let current = cell("001", "es", "Antes");
    const { el, api } = await mount({
      getContentTranslationTargets: vi.fn(async () =>
        result([{ ...row("001"), cells: [current] }]),
      ),
      getContentTranslationCells: vi.fn(async () => ({
        config,
        required: [],
        configuration: "configuration-one",
        cells: [current],
      })),
    });
    await edit(el, "");
    current = { ...cell("001", "es", "Ahora"), expected: "latest-clear" };
    await refresh(el);
    await vi.waitFor(() => expect(review(el)).toBeTruthy());
    await choose(el, "keep");
    expect(input(el)!.value).toBe("");
    button(el, "save").click();
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(api.saveContentTranslations).toHaveBeenCalledExactlyOnceWith({
      edits: [
        {
          kind: "product",
          id: "001",
          language: "es",
          field: "name",
          expected: "latest-clear",
          text: null,
        },
      ],
    });
  });
  it.each(["unavailable", "disabled"])("Keep cannot accept a %s change", async (cause) => {
    let current = cell("001");
    let settings = config;
    const { el, api } = await mount({
      getContentTranslationTargets: vi.fn(async () => ({
        ...result([{ ...row("001"), cells: [current] }]),
        config: settings,
      })),
      getContentTranslationCells: vi.fn(async () => ({
        config: settings,
        required: [],
        configuration: "configuration-one",
        cells: [current],
      })),
    });
    await edit(el, "Mi borrador");
    current = { ...current, expected: "changed" };
    if (cause === "unavailable")
      current = { ...current, eligible: false, unavailableReason: "missing" };
    if (cause === "disabled") settings = { defaultLanguage: "en", languages: ["en", "fr"] };
    await refresh(el);
    await vi.waitFor(() => expect(review(el)).toBeTruthy());
    expect(
      review(el)!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-choice=keep]")!.disabled,
    ).toBe(true);
    button(el, "save").click();
    await el.updateComplete;
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    expect(review(el)!.textContent).toContain("Mi borrador");
    await choose(el, "discard");
    expect(review(el)).toBeNull();
    expect(button(el, "save").disabled).toBe(true);
  });
});

describe("revealing the exact invalid cell", () => {
  it("reveals a hidden oversized field and focuses its native input before refusing the save", async () => {
    const items = vi.fn(async (query: TranslationQuery) =>
      result("search" in query && query.search ? [] : [row("001")]),
    );
    const { el, api } = await mount({ getContentTranslationTargets: items });
    await edit(el, "é".repeat(2049));
    button(el, "review").focus();
    await select(el, "search", "not present");
    await vi.waitFor(() => expect(input(el)).toBeNull());
    button(el, "save").click();
    await vi.waitFor(() => expect(input(el)?.error).toBe(t("translations.name_bytes")));
    await vi.waitFor(() => expect(input(el)!.shadowRoot!.activeElement?.tagName).toBe("INPUT"));
    expect(input(el)!.value).toBe("é".repeat(2049));
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).toBe(t("form.fix_fields"));
    expect(api.saveContentTranslations).not.toHaveBeenCalled();
    expect(items).toHaveBeenLastCalledWith({
      languages: ["en", "es", "fr"],
      targets: [{ kind: "product", id: "001" }],
    });
    await edit(el, "Sopa");
    expect(input(el)!.error).toBe("");
    expect(button(el, "save").disabled).toBe(false);
  });
  it("a four-part refusal reveals a hidden language and keeps its message retryable", async () => {
    const settings = {
      defaultLanguage: "en",
      languages: ["en", "es", "fr", "de", "it", "pt", "ja", "ko"],
    };
    const items = vi.fn(async (query: TranslationQuery) => ({
      ...result("search" in query && query.search ? [] : [row("001", query.languages)]),
      config: settings,
    }));
    const save = vi
      .fn()
      .mockRejectedValueOnce({
        code: "content.translation_refused",
        params: {
          kind: "product",
          id: "001",
          language: "es",
          field: "name",
          causeCode: "product.invalid",
        },
      })
      .mockResolvedValue({ saved: [cell("001", "es", "Corregida")] });
    const { el } = await mount(
      {
        getContentTranslationTargets: items,
        getContentTranslationCells: vi.fn(async (refs: readonly TranslationCellRef[]) => ({
          config: settings,
          required: [],
          configuration: "configuration-one",
          cells: refs.map((ref) => cell(ref.id, ref.language)),
        })),
        getContentSuggestions: vi.fn(async () => ({ ...suggestions(), config: settings })),
        saveContentTranslations: save,
      },
      settings,
    );
    await edit(el, "Mi borrador");
    button(el, "review").focus();
    await select(el, "jump", "ko");
    await vi.waitFor(() => expect(input(el)).toBeNull());
    await select(el, "search", "not present");
    await vi.waitFor(() => expect(windowFor(el).rows).toHaveLength(0));
    button(el, "save").click();
    await vi.waitFor(() => expect(input(el)?.error).toBe(codeMessage("product.invalid")));
    await vi.waitFor(() => expect(input(el)!.shadowRoot!.activeElement?.tagName).toBe("INPUT"));
    expect(input(el)!.value).toBe("Mi borrador");
    expect(button(el, "save").disabled).toBe(false);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=jump]")!.value,
    ).toBe("es");
    await edit(el, "Corregida");
    expect(input(el)!.error).toBe("");
    button(el, "save").click();
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(save).toHaveBeenCalledTimes(2);
  });
});

it("a moved option label cannot Keep its old owner's draft", async () => {
  let owner: TranslationOwners = { kind: "option_label", listId: "original-list" };
  const current = (): TranslationCell => ({
    ...cell("001"),
    kind: "option_label",
    owners: owner,
    expected: JSON.stringify(owner),
  });
  const { el, api } = await mount({
    getContentTranslationTargets: vi.fn(async () =>
      result([{ ...row("001"), kind: "option_label", owners: owner, cells: [current()] }]),
    ),
    getContentTranslationCells: vi.fn(async () => ({
      config,
      required: [],
      configuration: "configuration-one",
      cells: [current()],
    })),
  });
  const field = () =>
    windowFor(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "[name=translation-option_label-001-es-name]",
    )!;
  await field().updateComplete;
  await userEvent.fill(field().shadowRoot!.querySelector("input")!, "Personal label");
  owner = { kind: "option_label", listId: "replacement-list" };
  await refresh(el);
  const panel = () => el.shadowRoot!.querySelector<HTMLElement>("[data-review]")!;
  await vi.waitFor(() => expect(panel()?.textContent).toContain("Personal label"));
  const keep = panel().querySelector<HTMLElementTagNameMap["wt-button"]>("[data-choice=keep]")!;
  expect(keep.disabled).toBe(true);
  keep.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  button(el, "save").click();
  await vi.waitFor(() => expect(button(el, "review").disabled).toBe(false));
  expect(api.saveContentTranslations).not.toHaveBeenCalled();
  expect(field().value).toBe("Personal label");
  expect(panel()).not.toBeNull();
});
it("routes an abbreviation refusal to that unit field without marking its name", async () => {
  const fields: TranslationCell[] = [
    { ...cell("kg"), kind: "unit", owners: { kind: "unit" }, staffText: "Kilogramo" },
    {
      ...cell("kg"),
      kind: "unit",
      owners: { kind: "unit" },
      field: "abbreviation",
      staffText: "kg",
      expected: "abbreviation-token",
    },
  ];
  const saved = deferred<{ saved: TranslationCell[] }>();
  const save = vi
    .fn()
    .mockRejectedValueOnce({
      code: "content.translation_refused",
      params: {
        kind: "unit",
        id: "kg",
        language: "es",
        field: "abbreviation",
        causeCode: "unit.invalid",
      },
    })
    .mockImplementationOnce(() => saved.promise);
  const { el } = await mount({
    getContentTranslationTargets: vi.fn(async () =>
      result([
        { kind: "unit", id: "kg", name: "Kilogramo", owners: { kind: "unit" }, cells: fields },
      ]),
    ),
    getContentTranslationCells: vi.fn(async () => ({
      config,
      required: [],
      configuration: "configuration-one",
      cells: fields,
    })),
    saveContentTranslations: save,
  });
  const control = (field: string) =>
    windowFor(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `[name=translation-unit-kg-es-${field}]`,
    )!;
  await control("abbreviation").updateComplete;
  await control("name").updateComplete;
  await userEvent.fill(control("name").shadowRoot!.querySelector("input")!, "Kilogramo cliente");
  await userEvent.fill(control("abbreviation").shadowRoot!.querySelector("input")!, "K");
  button(el, "save").click();
  await vi.waitFor(() => expect(control("abbreviation").error).toBe(codeMessage("unit.invalid")));
  await vi.waitFor(() =>
    expect(control("abbreviation").shadowRoot!.activeElement?.tagName).toBe("INPUT"),
  );
  expect(control("name").error).toBe("");
  expect(control("name").value).toBe("Kilogramo cliente");
  expect(button(el, "save").disabled).toBe(false);
  await userEvent.fill(control("abbreviation").shadowRoot!.querySelector("input")!, "kg");
  button(el, "save").click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith({
    edits: [
      {
        kind: "unit",
        id: "kg",
        language: "es",
        field: "name",
        text: "Kilogramo cliente",
        expected: "v1-kg-es",
      },
      {
        kind: "unit",
        id: "kg",
        language: "es",
        field: "abbreviation",
        text: "kg",
        expected: "abbreviation-token",
      },
    ],
  });
  saved.resolve({
    saved: [
      {
        ...fields[0]!,
        text: "Kilogramo cliente",
        effectiveText: "Kilogramo cliente",
        expected: "saved-name",
      },
      { ...fields[1]!, text: "kg", effectiveText: "kg", expected: "saved" },
    ],
  });
  await save.mock.results[1]!.value;
  await vi.waitFor(() => expect(el.open).toBe(false));
});
it("reveals the second staged page when its 51st field is refused", async () => {
  const rows = Array.from({ length: 51 }, (_, n) => row(String(n).padStart(3, "0")));
  const items = vi.fn(async (query: TranslationQuery) => {
    if ("targets" in query)
      return result(query.targets.map((ref) => rows.find((row) => row.id === ref.id)!));
    return query.after ? result(rows.slice(50)) : result(rows.slice(0, 50), cursor("049", query));
  });
  const { el, api } = await mount({
    getContentTranslationTargets: items,
    saveContentTranslations: vi.fn().mockRejectedValue({
      code: "content.translation_refused",
      params: {
        kind: "product",
        id: "050",
        language: "es",
        field: "name",
        causeCode: "product.invalid",
      },
    }),
  });
  for (const field of windowFor(el).shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[lang=es]",
  ))
    field.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Personal first page" },
        bubbles: true,
        composed: true,
      }),
    );
  await el.updateComplete;
  button(el, "next").click();
  await vi.waitFor(() => expect(input(el, "050")).toBeTruthy());
  await edit(el, "Personal last page", "050");
  button(el, "review").focus();
  button(el, "previous").click();
  await vi.waitFor(() => expect(input(el, "050")).toBeNull());
  button(el, "save").click();
  await vi.waitFor(() => expect(input(el, "050")?.error).toBe(codeMessage("product.invalid")));
  await vi.waitFor(() =>
    expect(input(el, "050")!.shadowRoot!.activeElement?.tagName).toBe("INPUT"),
  );
  expect(api.saveContentTranslations).toHaveBeenCalledOnce();
  expect(items).toHaveBeenLastCalledWith({
    languages: ["en", "es", "fr"],
    targets: [{ kind: "product", id: "050" }],
  });
  expect(windowFor(el).rows).toHaveLength(1);
  expect(el.shadowRoot!.querySelector("[data-test=edited-count]")!.textContent).toContain("51");
  expect(el.shadowRoot!.querySelector("[data-test=hidden-count]")!.textContent).toContain("50");
});

for (const locale of ["en-GB", "es-ES"] as const) {
  for (const theme of ["light", "dark"] as const) {
    it.each([390, 1280])(
      `review remains readable and accessible in ${locale}/${theme} at %s px`,
      async (width) => {
        await page.viewport(width, 900);
        setLocale(locale);
        const old = `Old${"x".repeat(200)}`;
        const latest = `Current${"y".repeat(200)}`;
        const personal = `Draft${"z".repeat(200)}`;
        let current = cell("001", "es", old);
        const { el, host } = await mount(
          {
            getContentTranslationTargets: vi.fn(async () =>
              result([{ ...row("001"), cells: [current] }]),
            ),
            getContentTranslationCells: vi.fn(async () => ({
              config,
              required: [],
              configuration: "configuration-one",
              cells: [current],
            })),
          },
          config,
          "es",
          theme,
        );
        await edit(el, personal);
        current = { ...cell("001", "es", latest), expected: "visual-current" };
        await refresh(el);
        await vi.waitFor(() => expect(review(el)?.textContent).toContain(personal));
        expect(window.innerWidth).toBe(width);
        const panel = review(el)!;
        expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
        const modal = el.shadowRoot!.querySelector("wt-modal")!;
        await modal.updateComplete;
        const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
        expect([...panel.querySelectorAll("dd")].map((value) => value.textContent)).toEqual([
          old,
          latest,
          personal,
        ]);
        for (const control of panel.querySelectorAll("wt-button")) {
          await control.updateComplete;
          expect(
            control.shadowRoot!.querySelector("button")!.getBoundingClientRect().width,
          ).toBeGreaterThan(0);
        }
        await expectNoA11yViolations(host);
        await page.screenshot({
          element: panel,
          path: `__screenshots__/look/a682-review-${locale}-${theme}-${width}.png`,
        });
      },
    );
  }
}
