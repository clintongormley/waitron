import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, LanguageTranslationGaps, TranslationPage } from "../api/client.js";
import type { AddContentLanguageDialog } from "../widgets/add-content-language.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { page, userEvent } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
registerIcons(DASHBOARD_ICONS);
import { currentLocale, setLocale } from "../i18n/t.js";
import "./content-languages-screen.js";
import type { ContentLanguagesScreen } from "./content-languages-screen.js";

const LOADED = () => Promise.resolve({ defaultLanguage: "es", languages: ["es", "ca", "en"] });

const NO_RULES = { required: [], official: [] };
const VALENCIA = {
  required: ["ca", "es"],
  official: ["es", "ca", "gl", "eu"],
  foreignLanguageNotice: {
    minimumForeign: 1,
    text: { en: "Offer one foreign language too.", es: "Ofrece también un idioma extranjero." },
  },
};

function stubApi(
  read: () => Promise<unknown>,
  save: () => Promise<void> = () => Promise.resolve(),
  rules: unknown = NO_RULES,
  gaps: unknown = [],
): DashboardApi {
  return {
    getContentLanguages: vi.fn(read),
    getContentLanguageRules: vi.fn().mockResolvedValue(rules),
    updateContentLanguages: vi.fn(save),
    getContentTranslationGaps: vi.fn().mockResolvedValue(gaps),
    getContentTranslationTargets: vi.fn(async (language: string): Promise<TranslationPage> => ({
      language,
      config: { defaultLanguage: "es", languages: ["es", "ca", "en"] },
      required: ["ca", "es"],
      next: null,
      rows: (
        (gaps as LanguageTranslationGaps[]).find((row) => row.language === language)?.gaps ?? []
      ).map((gap) => ({
        ...gap,
        selectedText: null,
        defaultText: "Nombre predeterminado",
        effectiveSelectedText: null,
        effectiveDefaultText: "Nombre predeterminado",
        defaultRequired: false,
        eligible: true,
        unavailableReason: null,
        owners:
          gap.kind === "product"
            ? { kind: "product", parentId: null }
            : gap.kind === "section"
              ? { kind: "section", menuId: gap.parent!.id }
              : { kind: "unit" },
        expected: "token",
      })),
      total: 0,
    })),
    getReceiptLanguage: vi.fn().mockResolvedValue({
      language: "es-ES",
      choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      fixed: null,
    }),
  } as unknown as DashboardApi;
}

async function flush(el: ContentLanguagesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("content-languages-screen a11y (%s theme)", (theme) => {
  it.each([
    ["en-GB", 390],
    ["en-GB", 1280],
    ["es-ES", 390],
    ["es-ES", 1280],
  ] as const)("hovered language actions are accessible in %s at %i px", async (locale, width) => {
    const previous = currentLocale();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setLocale(locale);
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const { el, host } = await mountWidget<ContentLanguagesScreen>(
        "dashboard-content-languages-screen",
        {
          api: stubApi(LOADED, undefined, VALENCIA, [
            { language: "es", gaps: [] },
            {
              language: "ca",
              gaps: [{ kind: "product", id: "dish", name: "STAFF Soup", reason: "partial" }],
            },
            { language: "en", gaps: [] },
          ]),
        },
        theme,
      );
      await flush(el);
      const table = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
        "wt-data-table[data-test=languages]",
      )!;
      await table.updateComplete;
      const menu = table.shadowRoot!.querySelectorAll("wt-row-actions")[1]!;
      const trigger = menu.shadowRoot!.querySelector("button")!;
      expect(trigger.querySelector("wt-icon")!.shadowRoot!.querySelector("svg")).not.toBeNull();
      const edge = document.documentElement.clientWidth;
      const box = trigger.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(edge);
      await page.screenshot({
        element: host,
        path: `__screenshots__/look/a420-table-${locale}-${theme}-${width}.png`,
      });
      await userEvent.click(trigger);
      await vi.waitFor(() =>
        expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true),
      );
      const popup = menu.shadowRoot!.querySelector("[popover]")!.getBoundingClientRect();
      expect(popup.left).toBeGreaterThanOrEqual(0);
      expect(popup.right).toBeLessThanOrEqual(edge);
      const actions = menu.querySelectorAll("wt-button");
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        const inner = action.shadowRoot!.querySelector("button")!;
        await userEvent.hover(inner);
        expect(inner.matches(":hover")).toBe(true);
        await expectNoA11yViolations(host);
      }
      await page.screenshot({
        path: `__screenshots__/look/a420-menu-${locale}-${theme}-${width}.png`,
      });
      await userEvent.click(
        menu
          .querySelector("wt-button[data-test^=edit-translations]")!
          .shadowRoot!.querySelector("button")!,
      );
      await flush(el);
      expect(
        el
          .shadowRoot!.querySelector("dashboard-content-translations-dialog")!
          .shadowRoot!.querySelector("wt-modal")!.open,
      ).toBe(true);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/a420-report-${locale}-${theme}-${width}.png`,
      });
    } finally {
      setLocale(previous);
      await page.viewport(viewport.width, viewport.height);
    }
  });

  it.each([
    ["loaded", LOADED],
    ["loading", () => new Promise(() => {})],
    ["load failed", () => Promise.reject(new Error("offline"))],
  ] as const)("renders the %s state accessibly", async (_state, read) => {
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api: stubApi(read) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the receipt-language warning accessibly", async () => {
    const api = stubApi(LOADED);
    vi.mocked(api.getReceiptLanguage).mockResolvedValue({
      language: "gl-ES",
      choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      fixed: null,
    });
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api },
      theme,
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=receipt-language-warning]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders required languages and the foreign-language notice accessibly", async () => {
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      {
        api: stubApi(
          () => Promise.resolve({ defaultLanguage: "es", languages: ["es", "ca"] }),
          undefined,
          VALENCIA,
        ),
      },
      theme,
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=foreign-language-notice]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it.each([
    [
      "a required language with missing names",
      [
        { language: "es", gaps: [] },
        {
          language: "ca",
          gaps: [
            { kind: "product", id: "prod-1", name: "STAFF Pan", reason: "partial" },
            {
              kind: "section",
              id: "section-1",
              name: "STAFF Drinks",
              reason: "absent",
              parent: { id: "menu-1", name: "Lunch" },
            },
          ],
        },
        {
          language: "en",
          gaps: [{ kind: "unit", id: "unit-1", name: "ración", reason: "partial" }],
        },
      ],
    ],
    [
      "nothing missing anywhere",
      [
        { language: "es", gaps: [] },
        { language: "ca", gaps: [] },
        { language: "en", gaps: [] },
      ],
    ],
  ])("renders the missing translations with %s accessibly", async (_state, gaps) => {
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api: stubApi(LOADED, undefined, VALENCIA, gaps) },
      theme,
    );
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("wt-disclosure")).toHaveLength(0);
    expect(el.shadowRoot!.querySelector("dashboard-content-translations-dialog")).not.toBeNull();
    await el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      "wt-data-table[data-test=languages]",
    )!.updateComplete;
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      "wt-data-table[data-test=languages]",
    )!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=edit-translations-ca]")!
      .click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders a failed read of the missing translations accessibly", async () => {
    const api = stubApi(LOADED, undefined, VALENCIA);
    vi.mocked(api.getContentTranslationGaps).mockRejectedValue(new Error("offline"));
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api },
      theme,
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=gaps-error]")).not.toBeNull();
    await el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      "wt-data-table[data-test=languages]",
    )!.updateComplete;
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      "wt-data-table[data-test=languages]",
    )!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=edit-translations-ca]")!
      .click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the Add language dialog with the official languages grouped accessibly", async () => {
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api: stubApi(LOADED, undefined, VALENCIA) },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-language]")!.click();
    await flush(el);
    const add = el.shadowRoot!.querySelector<AddContentLanguageDialog>(
      "dashboard-add-content-language",
    )!;
    const language = add.shadowRoot!.querySelector("wt-combobox[name=language]")!;
    expect(language.shadowRoot!.querySelectorAll('[role="group"]')).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  it("renders a refused save accessibly", async () => {
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api: stubApi(LOADED, () => Promise.reject({ code: "content.default_missing" })) },
      theme,
    );
    await flush(el);
    await el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      "wt-data-table[data-test=languages]",
    )!.updateComplete;
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      "wt-data-table[data-test=languages]",
    )!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=set-default-ca]")!
      .click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-error]")).not.toBeNull());
    await expectNoA11yViolations(host);
  });

  it.each([
    ["open", false],
    ["closed without a choice", true],
  ] as const)("renders the Add language dialog %s accessibly", async (_state, close) => {
    const api = stubApi(LOADED);
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-language]")!.click();
    await flush(el);
    if (close) {
      const add = el.shadowRoot!.querySelector<AddContentLanguageDialog>(
        "dashboard-add-content-language",
      )!;
      add.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
      await add.updateComplete;
      expect(add.open).toBe(false);
      expect(api.updateContentLanguages).not.toHaveBeenCalled();
    }
    await expectNoA11yViolations(host);
  });
});
