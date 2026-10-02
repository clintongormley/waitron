import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import type { AddContentLanguageDialog } from "../widgets/add-content-language.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
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
    expect(el.shadowRoot!.querySelectorAll("wt-disclosure")).toHaveLength(3);
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=set-default-ca]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-error]")).not.toBeNull());
    await expectNoA11yViolations(host);
  });

  it.each([
    ["open", false],
    ["showing a missing choice", true],
  ] as const)("renders the Add language dialog %s accessibly", async (_state, submit) => {
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api: stubApi(LOADED) },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-language]")!.click();
    await flush(el);
    if (submit) {
      const add = el.shadowRoot!.querySelector<AddContentLanguageDialog>(
        "dashboard-add-content-language",
      )!;
      add.shadowRoot!.querySelector<HTMLElement>("[data-test=save-language]")!.click();
      await add.updateComplete;
      expect(
        add.shadowRoot!.querySelector<HTMLElement & { error: string }>(
          "wt-combobox[name=language]",
        )!.error,
      ).not.toBe("");
    }
    await expectNoA11yViolations(host);
  });
});
