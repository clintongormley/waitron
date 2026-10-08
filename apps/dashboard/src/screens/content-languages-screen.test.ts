import { LiveData } from "@waitron/dashboard-kit";
import { capitaliseFirst, type ContentLanguageRules, type ContentLanguages } from "@waitron/shared";
import { currentContentLanguages } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, TranslationPage } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { en, es } from "../i18n/strings.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { AddContentLanguageDialog } from "../widgets/add-content-language.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./content-languages-screen.js";
import type { ContentLanguagesScreen } from "./content-languages-screen.js";

const CONFIG: ContentLanguages = { defaultLanguage: "ca", languages: ["ca", "en", "de"] };
const NO_RULES: ContentLanguageRules = { required: [], official: [] };

function api(overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    getContentLanguages: vi.fn().mockResolvedValue(CONFIG),
    getContentLanguageRules: vi.fn().mockResolvedValue(NO_RULES),
    updateContentLanguages: vi.fn().mockResolvedValue(undefined),
    getContentTranslationGaps: vi.fn().mockResolvedValue([]),
    getContentTranslationTargets: vi.fn(async (language: string): Promise<TranslationPage> => ({
      language,
      config: CONFIG,
      required: [],
      rows: [],
      next: null,
      total: 0,
    })),
    saveContentTranslations: vi.fn().mockResolvedValue({ saved: [] }),
    getReceiptLanguage: vi.fn().mockResolvedValue({
      language: "ca-ES",
      choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      fixed: null,
    }),
    ...overrides,
  } as unknown as DashboardApi;
}

const q = (el: ContentLanguagesScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector) ??
  el
    .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      "wt-data-table[data-test=languages]",
    )
    ?.shadowRoot?.querySelector<HTMLElement>(selector) ??
  null;
const dialog = (el: ContentLanguagesScreen) =>
  el.shadowRoot!.querySelector<AddContentLanguageDialog>("dashboard-add-content-language")!;
const name = (code: string) =>
  capitaliseFirst(
    new Intl.DisplayNames([currentLocale()], { type: "language" }).of(code)!,
    currentLocale(),
  );
const rows = (el: ContentLanguagesScreen) => [
  ...el
    .shadowRoot!.querySelector("[data-test=languages]")!
    .shadowRoot!.querySelectorAll<HTMLElement>("tbody tr"),
];
const shown = (el: ContentLanguagesScreen) =>
  rows(el).map((row) => row.querySelector(".field-value")!.textContent!.trim());
const disabled = (el: ContentLanguagesScreen, action: string): boolean =>
  q(el, `[data-test=${action}]`)!.hasAttribute("disabled");
const saveMessage = (el: ContentLanguagesScreen) => q(el, "wt-card [data-error]");

async function flush(el: ContentLanguagesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    "wt-data-table[data-test=languages]",
  )?.updateComplete;
}

async function mount(client: DashboardApi): Promise<ContentLanguagesScreen> {
  const { el } = await mountWidget<ContentLanguagesScreen>("dashboard-content-languages-screen", {
    api: client,
  });
  await flush(el);
  return el;
}

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const OFFICIAL = ["es", "ca", "gl", "eu"];
const BARCELONA: ContentLanguageRules = { required: ["ca", "es"], official: OFFICIAL };
const NOTHING_REQUIRED: ContentLanguageRules = { required: [], official: OFFICIAL };
const VALENCIA: ContentLanguageRules = {
  required: ["ca", "es"],
  official: OFFICIAL,
  foreignLanguageNotice: {
    minimumForeign: 1,
    text: { en: "Offer one foreign language too.", es: "Ofrece también un idioma extranjero." },
  },
};

const notice = (el: ContentLanguagesScreen) => q(el, "[data-test=foreign-language-notice]");
const rowOf = (el: ContentLanguagesScreen, code: string) =>
  rows(el).find((row) => row.querySelector(".field-value")!.textContent!.trim() === name(code))!;

describe("required content languages", () => {
  const rulesApi = (rules: ContentLanguageRules, config: ContentLanguages) =>
    api({
      getContentLanguages: vi.fn().mockResolvedValue(config),
      getContentLanguageRules: vi.fn().mockResolvedValue(rules),
    });

  it("offers no Remove on a required language and labels it Required, keeping Set as default on a required one that is not the default", async () => {
    const el = await mount(
      rulesApi(BARCELONA, { defaultLanguage: "ca", languages: ["ca", "es", "en"] }),
    );
    expect(q(el, "[data-test=remove-es]")).toBeNull();
    expect(q(el, "[data-test=remove-ca]")).toBeNull();
    expect(q(el, "[data-test=set-default-es]")).not.toBeNull();
    expect(q(el, "[data-test=remove-en]")).not.toBeNull();
    expect(rowOf(el, "ca").textContent).toContain(t("content_languages.default"));
    expect(rowOf(el, "ca").textContent).toContain(t("content_languages.required"));
    expect(rowOf(el, "es").textContent).toContain(t("content_languages.required"));
    expect(rowOf(el, "en").textContent).not.toContain(t("content_languages.required"));
  });

  it("names the Required label in each UI language", () => {
    expect(en["content_languages.required"]).toBe("Required");
    expect(es["content_languages.required"]).toBe("Obligatorio");
  });

  it("offers Remove on every language but the default where none is required", async () => {
    const el = await mount(
      rulesApi(NOTHING_REQUIRED, { defaultLanguage: "es", languages: ["es", "ca", "en"] }),
    );
    expect(q(el, "[data-test=remove-ca]")).not.toBeNull();
    expect(q(el, "[data-test=remove-en]")).not.toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(t("content_languages.required"));
  });

  it("shows the region's foreign-language notice while too few enabled languages are foreign, in the UI language", async () => {
    const el = await mount(rulesApi(VALENCIA, { defaultLanguage: "es", languages: ["es", "ca"] }));
    expect(notice(el)!.textContent!.trim()).toBe("Ofrece también un idioma extranjero.");
  });

  it("shows the notice in English when the UI is in English", async () => {
    setLocale("en-GB");
    const el = await mount(rulesApi(VALENCIA, { defaultLanguage: "es", languages: ["es", "ca"] }));
    expect(notice(el)!.textContent!.trim()).toBe("Offer one foreign language too.");
  });

  it("falls back to the English notice when it has no text in the UI language", async () => {
    const rules = {
      ...VALENCIA,
      foreignLanguageNotice: { minimumForeign: 1, text: { en: "Offer one foreign language too." } },
    };
    const el = await mount(rulesApi(rules, { defaultLanguage: "es", languages: ["es", "ca"] }));
    expect(notice(el)!.textContent!.trim()).toBe("Offer one foreign language too.");
  });

  it("shows no notice when it has no text in the UI language or in English", async () => {
    const rules = { ...VALENCIA, foreignLanguageNotice: { minimumForeign: 1, text: {} } };
    const el = await mount(rulesApi(rules, { defaultLanguage: "es", languages: ["es", "ca"] }));
    expect(notice(el)).toBeNull();
  });

  it("shows no notice once enough enabled languages are foreign", async () => {
    const el = await mount(
      rulesApi(VALENCIA, { defaultLanguage: "es", languages: ["es", "ca", "en"] }),
    );
    expect(notice(el)).toBeNull();
  });

  it("shows the notice once the only foreign language is removed", async () => {
    const el = await mount(
      rulesApi(VALENCIA, { defaultLanguage: "es", languages: ["es", "ca", "en"] }),
    );
    q(el, "[data-test=remove-en]")!.click();
    await vi.waitFor(() =>
      expect(notice(el)?.textContent?.trim()).toBe("Ofrece también un idioma extranjero."),
    );
  });

  it("shows no notice where the region gives none", async () => {
    const el = await mount(
      rulesApi(NOTHING_REQUIRED, { defaultLanguage: "es", languages: ["es", "ca"] }),
    );
    expect(notice(el)).toBeNull();
  });

  it("hands the official languages to the Add language dialog", async () => {
    const el = await mount(
      rulesApi(NOTHING_REQUIRED, { defaultLanguage: "es", languages: ["es"] }),
    );
    expect(dialog(el).official).toEqual(OFFICIAL);
  });

  it("shows a save refused for leaving out a required language once, in the card, when the server requires a language the screen's rules do not", async () => {
    const client = api({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "ca"] }),
      updateContentLanguages: vi
        .fn()
        .mockRejectedValue({ code: "content.language_required", params: { language: "ca" } }),
    });
    const el = await mount(client);
    q(el, "[data-test=remove-ca]")!.click();
    await vi.waitFor(() =>
      expect(saveMessage(el)?.textContent).toBe(codeMessage("content.language_required")),
    );
    expect(el.shadowRoot!.querySelectorAll("[data-error]")).toHaveLength(1);
    expect(shown(el)).toEqual(["Español", "Catalán"]);
  });

  it("adds every missing required language to an added one, so a list lacking two can be repaired", async () => {
    const client = rulesApi(BARCELONA, { defaultLanguage: "en", languages: ["en"] });
    const el = await mount(client);
    q(el, "[data-test=add-language]")!.click();
    await flush(el);
    const add = dialog(el);
    await chooseOption(add.shadowRoot!.querySelector("wt-combobox[name=language]")!, "ca");
    await add.updateComplete;
    const saved = { defaultLanguage: "en", languages: ["en", "ca", "es"] };
    await vi.waitFor(() => expect(shown(el)).toEqual(["Inglés", "Catalán", "Español"]));
    expect(client.updateContentLanguages).toHaveBeenCalledWith(saved);
    expect(currentContentLanguages()).toEqual(saved);
  });

  it("adds every missing required language to a removal and to a new default", async () => {
    const client = rulesApi(BARCELONA, { defaultLanguage: "en", languages: ["en", "fr", "es"] });
    const el = await mount(client);
    q(el, "[data-test=remove-fr]")!.click();
    await vi.waitFor(() =>
      expect(client.updateContentLanguages).toHaveBeenCalledWith({
        defaultLanguage: "en",
        languages: ["en", "es", "ca"],
      }),
    );

    const other = rulesApi(BARCELONA, { defaultLanguage: "en", languages: ["en", "fr"] });
    const second = await mount(other);
    q(second, "[data-test=set-default-fr]")!.click();
    await vi.waitFor(() =>
      expect(other.updateContentLanguages).toHaveBeenCalledWith({
        defaultLanguage: "fr",
        languages: ["fr", "en", "ca", "es"],
      }),
    );
  });

  it("shows a loading status until the rules arrive", async () => {
    const el = await mount(api({ getContentLanguageRules: vi.fn(() => new Promise(() => {})) }));
    expect(q(el, "[role=status]")!.textContent!.trim()).toBe(t("content_languages.loading"));
    expect(q(el, "[data-test=languages]")).toBeNull();
  });

  it("still reports a failed read of the rules when the languages arrive after it", async () => {
    const el = await mount(
      api({
        getContentLanguageRules: vi.fn().mockRejectedValue(new Error("offline")),
        getContentLanguages: vi.fn(
          () => new Promise((resolve) => setTimeout(() => resolve(CONFIG), 50)),
        ),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await el.updateComplete;
    expect(q(el, "[role=alert]")?.textContent?.trim()).toBe(t("content_languages.load_error"));
    expect(q(el, "[role=status]")).toBeNull();
  });

  it("reports a failed read of the rules and shows the languages once a retry succeeds", async () => {
    const client = api({
      getContentLanguageRules: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(BARCELONA),
    });
    const el = await mount(client);
    expect(q(el, "[role=alert]")!.textContent!.trim()).toBe(t("content_languages.load_error"));
    expect(q(el, "[data-test=languages]")).toBeNull();
    q(el, "[data-test=retry]")!.click();
    await flush(el);
    expect(q(el, "[role=alert]")).toBeNull();
    expect(shown(el)).toEqual(["Catalán", "Alemán", "Inglés"]);
  });
});

describe("content languages after the server comes back", () => {
  const down = { code: "connection.failed" };

  it("reads the languages a failed first read of the rules never asked for once the server answers again", async () => {
    const client = Object.assign(
      api({ getContentLanguageRules: vi.fn().mockRejectedValue(down) }),
      { liveData: new LiveData() },
    );
    const el = await mount(client);
    await vi.waitFor(() =>
      expect(q(el, "[role=alert]")?.textContent?.trim()).toBe(t("content_languages.load_error")),
    );
    expect(client.getContentLanguages).not.toHaveBeenCalled();
    vi.mocked(client.getContentLanguageRules).mockResolvedValue(BARCELONA);
    client.liveData.refresh();
    await vi.waitFor(() => expect(shown(el)).toEqual(["Catalán", "Alemán", "Inglés"]));
    expect(q(el, "[role=alert]")).toBeNull();
    expect(rowOf(el, "ca").textContent).toContain(t("content_languages.required"));
  });

  it("reads the languages again when reattached while the rules' read fails, once it succeeds", async () => {
    const client = Object.assign(api(), { liveData: new LiveData() });
    const { el, host } = await mountWidget<ContentLanguagesScreen>(
      "dashboard-content-languages-screen",
      { api: client },
    );
    await vi.waitFor(() => expect(client.getContentLanguages).toHaveBeenCalledOnce());
    el.remove();
    vi.mocked(client.getContentLanguageRules).mockRejectedValueOnce(down);
    host.appendChild(el);
    await vi.waitFor(() =>
      expect(q(el, "[role=alert]")?.textContent?.trim()).toBe(t("content_languages.load_error")),
    );
    client.liveData.refresh();
    await vi.waitFor(() => expect(client.getContentLanguages).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(q(el, "[role=alert]")).toBeNull());
  });

  it("shows the missing translations once the server answers again", async () => {
    const client = Object.assign(
      api({ getContentTranslationGaps: vi.fn().mockRejectedValue(down) }),
      { liveData: new LiveData() },
    );
    const el = await mount(client);
    await vi.waitFor(() => expect(q(el, "[data-test=gaps-error]")).not.toBeNull());
    vi.mocked(client.getContentTranslationGaps).mockResolvedValue([]);
    client.liveData.refresh();
    await vi.waitFor(() => expect(q(el, "[data-test=gaps-error]")).toBeNull());
    expect(q(el, "[data-test=gaps-loading]")).toBeNull();
  });
});

describe("content languages screen", () => {
  it("lists the default first, then the others alphabetically by their Spanish names, each starting with a capital", async () => {
    const el = await mount(api());
    expect(q(el, "h1")!.textContent).toBe(t("content_languages.title"));
    expect(el.shadowRoot!.textContent).toContain(t("content_languages.help"));
    expect(shown(el)).toEqual(["Catalán", "Alemán", "Inglés"]);
    expect(rows(el)[0]!.textContent).toContain(t("content_languages.default"));
    expect(rows(el)[1]!.textContent).not.toContain(t("content_languages.default"));
  });

  it("sorts the other languages by their English names in English", async () => {
    setLocale("en-GB");
    const el = await mount(api());
    expect(shown(el)).toEqual(["Catalan", "English", "German"]);
  });

  it("offers no default language select and no Edit dialog", async () => {
    const el = await mount(api());
    expect(q(el, "select")).toBeNull();
    expect(q(el, "[data-test=edit-languages]")).toBeNull();
    expect(dialog(el).open).toBe(false);
  });

  it("gives every language Edit translations and every other language Make default and Delete", async () => {
    const el = await mount(api());
    expect(rows(el)[0]!.querySelectorAll("wt-button")).toHaveLength(1);
    for (const [index, code] of [
      [1, "de"],
      [2, "en"],
    ] as const) {
      const buttons = [...rows(el)[index]!.querySelectorAll("wt-button")];
      expect(buttons.map((button) => button.dataset.test)).toEqual([
        `set-default-${code}`,
        `remove-${code}`,
        `edit-translations-${code}`,
      ]);
      expect(buttons.map((button) => button.textContent!.trim())).toEqual([
        t("content_languages.set_default"),
        t("content_languages.remove"),
        t("content_languages.edit_translations"),
      ]);
      expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
        `${t("content_languages.set_default")}: ${name(code)}`,
        `${t("content_languages.remove")}: ${name(code)}`,
        null,
      ]);
    }
  });

  it("uses the shared table separators and shows each name in bold", async () => {
    const el = await mount(api());
    const [first, ...others] = rows(el);
    expect(getComputedStyle(first!.querySelector("td")!).borderBottomStyle).toBe("solid");
    for (const row of others.slice(0, -1))
      expect(getComputedStyle(row.querySelector("td")!).borderBottomStyle).toBe("solid");
    expect(getComputedStyle(others.at(-1)!.querySelector("td")!).borderBottomStyle).toBe("none");
    const bold = getComputedStyle(el).getPropertyValue("--wt-font-weight-bold").trim();
    for (const row of rows(el)) {
      expect(getComputedStyle(row.querySelector(".field-value")!).fontWeight).toBe(bold);
    }
  });

  it("says that removing a language keeps its translations, and nothing more", async () => {
    expect(en["content_languages.preserve"]).toBe("Deleting a language keeps its translations.");
    expect(es["content_languages.preserve"]).toBe(
      "Al eliminar un idioma se conservan sus traducciones.",
    );
    const el = await mount(api());
    expect(q(el, "wt-card")!.textContent).toContain(t("content_languages.preserve"));
  });

  it("moves a language set as default to the top, saves it, and shares it with the rest of the dashboard", async () => {
    const client = api();
    const el = await mount(client);
    q(el, "[data-test=set-default-en]")!.click();
    const saved = { defaultLanguage: "en", languages: ["en", "ca", "de"] };
    await vi.waitFor(() => expect(shown(el)).toEqual(["Inglés", "Alemán", "Catalán"]));
    expect(client.updateContentLanguages).toHaveBeenCalledWith(saved);
    expect(currentContentLanguages()).toEqual(saved);
    expect(rows(el)[0]!.querySelectorAll("wt-button")).toHaveLength(1);
  });

  it("removes a language, keeping the default, and saves", async () => {
    const client = api();
    const el = await mount(client);
    q(el, "[data-test=remove-en]")!.click();
    const saved = { defaultLanguage: "ca", languages: ["ca", "de"] };
    await vi.waitFor(() => expect(shown(el)).toEqual(["Catalán", "Alemán"]));
    expect(client.updateContentLanguages).toHaveBeenCalledWith(saved);
    expect(currentContentLanguages()).toEqual(saved);
  });

  it("holds every action while a save is in flight, and sends one save for a second press", async () => {
    let finish!: () => void;
    const client = api({
      updateContentLanguages: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const el = await mount(client);
    q(el, "[data-test=remove-en]")!.click();
    await el.updateComplete;
    for (const action of ["set-default-de", "remove-de", "set-default-en", "remove-en"]) {
      expect(disabled(el, action), action).toBe(true);
    }
    expect(disabled(el, "add-language")).toBe(true);
    q(el, "[data-test=remove-de]")!.click();
    q(el, "[data-test=set-default-de]")!.click();
    expect(client.updateContentLanguages).toHaveBeenCalledOnce();

    finish();
    await vi.waitFor(() => expect(shown(el)).toEqual(["Catalán", "Alemán"]));
    expect(disabled(el, "remove-de")).toBe(false);
    expect(disabled(el, "add-language")).toBe(false);
  });

  it("shows a refused save once, in the card above Add language, and leaves the actions working", async () => {
    const client = api({
      updateContentLanguages: vi
        .fn()
        .mockRejectedValueOnce({ code: "content.default_missing" })
        .mockResolvedValue(undefined),
    });
    const el = await mount(client);
    q(el, "[data-test=set-default-de]")!.click();
    await vi.waitFor(() =>
      expect(saveMessage(el)?.textContent).toBe(codeMessage("content.default_missing")),
    );
    expect(el.shadowRoot!.querySelectorAll("[data-error]")).toHaveLength(1);
    expect(saveMessage(el)!.getAttribute("role")).toBe("alert");
    const list = q(el, "[data-test=languages]")!;
    const footer = q(el, "[data-test=add-language]")!.parentElement!;
    expect(
      list.compareDocumentPosition(saveMessage(el)!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      saveMessage(el)!.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(shown(el)).toEqual(["Catalán", "Alemán", "Inglés"]);
    expect(currentContentLanguages()).not.toEqual({
      defaultLanguage: "de",
      languages: ["de", "ca", "en"],
    });
    expect(disabled(el, "set-default-de")).toBe(false);
    expect(disabled(el, "remove-en")).toBe(false);

    q(el, "[data-test=remove-en]")!.click();
    await vi.waitFor(() => expect(shown(el)).toEqual(["Catalán", "Alemán"]));
    expect(saveMessage(el)).toBeNull();
  });

  it("puts Add language in the card's footer, after the rows", async () => {
    const el = await mount(api());
    const card = q(el, "wt-card")!;
    const list = q(el, "[data-test=languages]")!;
    const add = q(el, "[data-test=add-language]")!;
    const footer = add.parentElement!;
    expect(card.contains(list)).toBe(true);
    expect(footer.parentElement).toBe(card);
    expect(list.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(footer).justifyContent).toBe("flex-end");
    expect(getComputedStyle(footer).borderTopStyle).toBe("solid");
    expect(add.textContent!.trim()).toBe(t("content_languages.add"));
    expect(add.getAttribute("variant")).toBe("secondary");
    expect(add.classList).toContain("card-action");
    expect(add.classList).toContain("accent-primary");
  });

  it("opens Add language in a dialog, and adding closes it and shows the new language in its place", async () => {
    const client = api();
    const el = await mount(client);
    q(el, "[data-test=add-language]")!.click();
    await flush(el);
    const add = dialog(el);
    expect(add.open).toBe(true);
    await chooseOption(add.shadowRoot!.querySelector("wt-combobox[name=language]")!, "fr");
    await add.updateComplete;
    const saved = { defaultLanguage: "ca", languages: ["ca", "en", "de", "fr"] };
    await vi.waitFor(() => expect(shown(el)).toEqual(["Catalán", "Alemán", "Francés", "Inglés"]));
    expect(client.updateContentLanguages).toHaveBeenCalledWith(saved);
    expect(currentContentLanguages()).toEqual(saved);
    expect(dialog(el).open).toBe(false);
  });

  it("adds to the languages as they are now, after a change made elsewhere while the dialog was open", async () => {
    const liveData = new LiveData();
    const client = Object.assign(api(), { liveData });
    const el = await mount(client);
    q(el, "[data-test=add-language]")!.click();
    await flush(el);
    vi.mocked(client.getContentLanguages).mockResolvedValue({
      defaultLanguage: "ca",
      languages: ["ca", "en", "de", "it"],
    });
    liveData.invalidate([{ type: "content_languages" }]);
    await vi.waitFor(() => expect(shown(el)).toContain("Italiano"));
    const add = dialog(el);
    await chooseOption(add.shadowRoot!.querySelector("wt-combobox[name=language]")!, "fr");
    await add.updateComplete;
    await vi.waitFor(() =>
      expect(client.updateContentLanguages).toHaveBeenCalledWith({
        defaultLanguage: "ca",
        languages: ["ca", "en", "de", "it", "fr"],
      }),
    );
  });

  describe("a change made elsewhere while a save is in flight", () => {
    const WITH_ITALIAN = { defaultLanguage: "ca", languages: ["ca", "en", "de", "it"] };

    async function mountLive() {
      const liveData = new LiveData();
      let finish!: () => void;
      const client = Object.assign(
        api({
          updateContentLanguages: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                finish = resolve;
              }),
          ),
        }),
        { liveData },
      );
      const el = await mount(client);
      return { el, client, liveData, finish: () => finish() };
    }

    async function serverNow(
      { el, client, liveData }: Awaited<ReturnType<typeof mountLive>>,
      config: ContentLanguages,
    ): Promise<void> {
      vi.mocked(client.getContentLanguages).mockResolvedValue(config);
      liveData.invalidate([{ type: "content_languages" }]);
      await vi.waitFor(() => expect(shown(el)).toContain("Italiano"));
    }

    async function finishWhileReReading(
      { el, client, finish }: Awaited<ReturnType<typeof mountLive>>,
      settled: () => void,
    ): Promise<(config: ContentLanguages) => void> {
      const reads = vi.mocked(client.getContentLanguages).mock.calls.length;
      let release!: (config: ContentLanguages) => void;
      vi.mocked(client.getContentLanguages).mockReturnValueOnce(
        new Promise<ContentLanguages>((resolve) => {
          release = resolve;
        }),
      );
      finish();
      await vi.waitFor(settled);
      expect(shown(el)).toEqual(["Catalán", "Alemán", "Inglés", "Italiano"]);
      await vi.waitFor(() => expect(client.getContentLanguages).toHaveBeenCalledTimes(reads + 1));
      await el.updateComplete;
      expect(shown(el)).toEqual(["Catalán", "Alemán", "Inglés", "Italiano"]);
      expect(currentContentLanguages()).toEqual(WITH_ITALIAN);
      return release;
    }

    it("keeps showing a language added elsewhere while a removal was being saved until a fresh read returns, then shows what the server holds", async () => {
      const live = await mountLive();
      const { el } = live;
      q(el, "[data-test=remove-en]")!.click();
      await el.updateComplete;
      await serverNow(live, WITH_ITALIAN);
      const release = await finishWhileReReading(live, () =>
        expect(disabled(el, "add-language")).toBe(false),
      );
      const after = { defaultLanguage: "ca", languages: ["ca", "de", "it"] };
      release(after);
      await vi.waitFor(() => expect(shown(el)).toEqual(["Catalán", "Alemán", "Italiano"]));
      expect(currentContentLanguages()).toEqual(after);
      expect(saveMessage(el)).toBeNull();
    });

    it("keeps showing a language added elsewhere while a new default was being saved until a fresh read returns, then shows what the server holds", async () => {
      const live = await mountLive();
      const { el } = live;
      q(el, "[data-test=set-default-de]")!.click();
      await el.updateComplete;
      await serverNow(live, WITH_ITALIAN);
      const release = await finishWhileReReading(live, () =>
        expect(disabled(el, "add-language")).toBe(false),
      );
      const after = { defaultLanguage: "de", languages: ["de", "ca", "en", "it"] };
      release(after);
      await vi.waitFor(() =>
        expect(shown(el)).toEqual(["Alemán", "Catalán", "Inglés", "Italiano"]),
      );
      expect(currentContentLanguages()).toEqual(after);
    });

    it("keeps showing a language added elsewhere while an added language was being saved until a fresh read returns, then shows what the server holds", async () => {
      const live = await mountLive();
      const { el } = live;
      q(el, "[data-test=add-language]")!.click();
      await flush(el);
      const add = dialog(el);
      await chooseOption(add.shadowRoot!.querySelector("wt-combobox[name=language]")!, "fr");
      await add.updateComplete;
      await add.updateComplete;
      await serverNow(live, WITH_ITALIAN);
      const release = await finishWhileReReading(live, () => expect(dialog(el).open).toBe(false));
      const after = { defaultLanguage: "ca", languages: ["ca", "en", "de", "it", "fr"] };
      release(after);
      await vi.waitFor(() =>
        expect(shown(el)).toEqual(["Catalán", "Alemán", "Francés", "Inglés", "Italiano"]),
      );
      expect(currentContentLanguages()).toEqual(after);
    });

    it("reports a failed read after the save as a load failure, not a failed save, keeping the languages it last read", async () => {
      const live = await mountLive();
      const { el, client } = live;
      q(el, "[data-test=remove-en]")!.click();
      await el.updateComplete;
      await serverNow(live, WITH_ITALIAN);
      vi.mocked(client.getContentLanguages).mockRejectedValue(new Error("offline"));
      live.finish();
      await vi.waitFor(() =>
        expect(q(el, "[role=alert]")?.textContent?.trim()).toBe(t("content_languages.load_error")),
      );
      expect(saveMessage(el)).toBeNull();
      expect(shown(el)).toContain("Italiano");
    });

    it("shows the saved languages when nothing arrived during the save", async () => {
      const live = await mountLive();
      const { el, client } = live;
      q(el, "[data-test=remove-en]")!.click();
      await el.updateComplete;
      live.finish();
      const saved = { defaultLanguage: "ca", languages: ["ca", "de"] };
      await vi.waitFor(() => expect(shown(el)).toEqual(["Catalán", "Alemán"]));
      expect(client.updateContentLanguages).toHaveBeenCalledWith(saved);
      expect(currentContentLanguages()).toEqual(saved);
    });
  });

  it("reopens the Add language dialog after it was cancelled", async () => {
    const el = await mount(api());
    q(el, "[data-test=add-language]")!.click();
    await flush(el);
    dialog(el).shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
    await flush(el);
    expect(dialog(el).open).toBe(false);
    q(el, "[data-test=add-language]")!.click();
    await flush(el);
    expect(dialog(el).open).toBe(true);
  });

  it("keeps each row's actions on screen at phone width", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(390, 800);
    try {
      const el = await mount(api());
      const edge = document.documentElement.clientWidth;
      for (const button of el.shadowRoot!.querySelectorAll("wt-button")) {
        const box = button.getBoundingClientRect();
        expect(box.left, button.dataset.test).toBeGreaterThanOrEqual(0);
        expect(box.right, button.dataset.test).toBeLessThanOrEqual(edge);
      }
    } finally {
      await page.viewport(width, height);
    }
  });

  it("shows a loading status, and no Add language, until the languages arrive", async () => {
    const el = await mount(api({ getContentLanguages: vi.fn(() => new Promise(() => {})) }));
    expect(q(el, "[role=status]")!.textContent!.trim()).toBe(t("content_languages.loading"));
    expect(q(el, "[data-test=add-language]")).toBeNull();
    expect(q(el, "dashboard-add-content-language")).toBeNull();
  });

  it("follows a change made elsewhere", async () => {
    const liveData = new LiveData();
    const client = Object.assign(api(), { liveData });
    const el = await mount(client);
    vi.mocked(client.getContentLanguages).mockResolvedValue({
      defaultLanguage: "en",
      languages: ["en"],
    });
    liveData.invalidate([{ type: "content_languages" }]);
    await vi.waitFor(() => expect(shown(el)).toEqual([name("en")]));
    expect(rows(el)[0]!.textContent).toContain(t("content_languages.default"));
  });

  it("reports a failed read and shows the languages once a retry succeeds", async () => {
    const client = api({
      getContentLanguages: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(CONFIG),
    });
    const el = await mount(client);
    expect(q(el, "[role=alert]")!.textContent!.trim()).toBe(t("content_languages.load_error"));
    expect(q(el, "[data-test=add-language]")).toBeNull();
    q(el, "[data-test=retry]")!.click();
    await flush(el);
    expect(q(el, "[role=alert]")).toBeNull();
    expect(shown(el)).toEqual(["Catalán", "Alemán", "Inglés"]);
  });

  it("reports a failed refresh while keeping the languages it last read", async () => {
    const liveData = new LiveData();
    const client = Object.assign(api(), { liveData });
    const el = await mount(client);
    vi.mocked(client.getContentLanguages).mockRejectedValue(new Error("offline"));
    liveData.invalidate([{ type: "content_languages" }]);
    await vi.waitFor(() =>
      expect(q(el, "[role=alert]")?.textContent?.trim()).toBe(t("content_languages.load_error")),
    );
    expect(shown(el)).toEqual(["Catalán", "Alemán", "Inglés"]);
  });
});

describe("receipt language warning", () => {
  const SPANISH_CATALAN: ContentLanguages = { defaultLanguage: "es", languages: ["es", "ca"] };
  const receiptIn = (language: string) =>
    vi
      .fn()
      .mockResolvedValue({ language, choices: OFFICIAL.map((code) => `${code}-ES`), fixed: null });
  const receiptWarning = (el: ContentLanguagesScreen) =>
    q(el, "[data-test=receipt-language-warning]");

  it("says receipts print in a language the content lacks, naming it and the default", async () => {
    setLocale("en-GB");
    const el = await mount(
      api({
        getContentLanguages: vi.fn().mockResolvedValue(SPANISH_CATALAN),
        getReceiptLanguage: receiptIn("gl-ES"),
      }),
    );
    expect(receiptWarning(el)!.getAttribute("role")).toBe("note");
    expect(receiptWarning(el)!.textContent!.trim()).toBe(
      "Receipts print in Galician, which is not one of your content languages, so product names on them print in Spanish, the default language.",
    );
  });

  it("goes once Galician is added", async () => {
    const el = await mount(
      api({
        getContentLanguages: vi.fn().mockResolvedValue(SPANISH_CATALAN),
        getReceiptLanguage: receiptIn("gl-ES"),
      }),
    );
    expect(receiptWarning(el)).not.toBeNull();
    q(el, "[data-test=add-language]")!.click();
    await flush(el);
    const add = dialog(el);
    await chooseOption(add.shadowRoot!.querySelector("wt-combobox[name=language]")!, "gl");
    await add.updateComplete;
    await vi.waitFor(() => expect(receiptWarning(el)).toBeNull());
  });

  it("follows a receipt language changed elsewhere", async () => {
    const liveData = new LiveData();
    const client = Object.assign(
      api({ getContentLanguages: vi.fn().mockResolvedValue(SPANISH_CATALAN) }),
      { liveData },
    );
    const el = await mount(client);
    expect(receiptWarning(el)).toBeNull();
    vi.mocked(client.getReceiptLanguage).mockResolvedValue({
      language: "eu-ES",
      choices: [],
      fixed: null,
    });
    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() => expect(receiptWarning(el)).not.toBeNull());
  });

  it("shows no warning, and still shows the languages, when the receipt language cannot be read", async () => {
    const el = await mount(
      api({
        getContentLanguages: vi.fn().mockResolvedValue(SPANISH_CATALAN),
        getReceiptLanguage: vi.fn().mockRejectedValue(new Error("offline")),
      }),
    );
    expect(receiptWarning(el)).toBeNull();
    expect(q(el, "[role=alert]")).toBeNull();
    expect(q(el, "[data-test=languages]")).not.toBeNull();
  });

  it("writes the warning in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount(
      api({
        getContentLanguages: vi.fn().mockResolvedValue(SPANISH_CATALAN),
        getReceiptLanguage: receiptIn("eu-ES"),
      }),
    );
    expect(receiptWarning(el)!.textContent!.trim()).toBe(
      "Los recibos se imprimen en euskera, que no es uno de tus idiomas del contenido, así que los nombres de los productos salen en español, el idioma predeterminado.",
    );
  });
});

describe("A420 content language table", () => {
  it("shows one row per language with completeness and a pinned menu", async () => {
    setLocale("en-GB");
    const el = await mount(
      api({
        getContentTranslationGaps: vi.fn().mockResolvedValue([
          { language: "ca", gaps: [] },
          {
            language: "en",
            gaps: [{ kind: "product", id: "dish", name: "STAFF Soup", reason: "partial" }],
          },
          { language: "de", gaps: [] },
        ]),
      }),
    );
    const table = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      "wt-data-table[data-test=languages]",
    );
    expect(table).not.toBeNull();
    await table!.updateComplete;
    expect(table!.rows).toEqual(["ca", "en", "de"]);
    expect(table!.columns.map(({ key }) => key)).toEqual(["language", "completeness", "actions"]);
    expect(table!.columns.find(({ key }) => key === "actions")!.pinned).toBe("end");
    const rows = [...table!.shadowRoot!.querySelectorAll("tbody tr")];
    expect(rows[0]!.textContent).toContain("Nothing missing");
    expect(rows[1]!.textContent).toContain("1 missing");
    const menu = rows[1]!.querySelector("wt-row-actions")!;
    expect(menu.label).toBe("Actions: English");
    expect(
      [...menu.querySelectorAll("wt-button")].map((button) => button.textContent!.trim()),
    ).toEqual(["Make default", "Delete", "Edit translations"]);
    expect(rows[0]!.querySelector("[data-test=set-default-ca]")).toBeNull();
    expect(rows[0]!.querySelector("[data-test=remove-ca]")).toBeNull();
    expect(rows[0]!.querySelector("[data-test=edit-translations-ca]")).not.toBeNull();
  });
});

it("shows completeness only from a successful report and refreshes the language rows live", async () => {
  const liveData = new LiveData();
  const client = api({
    liveData,
    getContentTranslationGaps: vi.fn().mockResolvedValue([
      { language: "ca", gaps: [] },
      {
        language: "en",
        gaps: [{ kind: "product", id: "dish", name: "STAFF Soup", reason: "partial" }],
      },
    ]),
  });
  const el = await mount(client);
  const completeness = () =>
    rows(el)
      .find((row) => row.querySelector(".field-value")!.textContent!.trim() === name("en"))!
      .querySelector("td:nth-child(2)")!
      .textContent!.trim();
  expect(completeness()).toBe(t("content_gaps.count").replace("{count}", "1"));
  vi.mocked(client.getContentTranslationGaps).mockRejectedValueOnce(new Error("offline"));
  liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(completeness()).toBe(t("content_gaps.load_error")));
  vi.mocked(client.getContentTranslationGaps).mockResolvedValue([{ language: "en", gaps: [] }]);
  liveData.invalidate([{ type: "products" }]);
  await vi.waitFor(() => expect(completeness()).toBe(t("content_gaps.none")));
});

const translations = (el: ContentLanguagesScreen) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["dashboard-content-translations-dialog"]>(
    "dashboard-content-translations-dialog",
  )!;
const translationModal = (el: ContentLanguagesScreen) =>
  translations(el).shadowRoot!.querySelector("wt-modal")!;

it("opens fresh translation fields for a language just added", async () => {
  let config = CONFIG;
  const client = api({
    getContentLanguages: vi.fn(async () => config),
    updateContentLanguages: vi.fn(async (value: ContentLanguages) => {
      config = value;
    }),
    getContentTranslationGaps: vi.fn(async () =>
      config.languages.map((language) => ({
        language,
        gaps:
          language === "fr"
            ? [{ kind: "product", id: "cheese", name: "STAFF Cheese", reason: "partial" }]
            : [],
      })),
    ),
    getContentTranslationTargets: vi.fn(async (language: string): Promise<TranslationPage> => ({
      language,
      config,
      required: [],
      next: null,
      total: language === "fr" ? 1 : 0,
      rows:
        language === "fr"
          ? [
              {
                kind: "product",
                id: "cheese",
                name: "STAFF Cheese",
                reason: "partial",
                selectedText: null,
                defaultText: "Formatge",
                effectiveSelectedText: null,
                effectiveDefaultText: "Formatge",
                defaultRequired: false,
                eligible: true,
                unavailableReason: null,
                owners: { kind: "product", parentId: null },
                expected: "fresh-fr",
              },
            ]
          : [],
    })),
  });
  const el = await mount(client);
  q(el, "[data-test=add-language]")!.click();
  await flush(el);
  const add = dialog(el);
  await chooseOption(add.shadowRoot!.querySelector("wt-combobox[name=language]")!, "fr");
  await vi.waitFor(() => expect(q(el, "[data-test=edit-translations-fr]")).not.toBeNull());
  q(el, "[data-test=edit-translations-fr]")!.click();
  await flush(el);
  await vi.waitFor(() =>
    expect(translations(el).shadowRoot!.querySelector("wt-data-table")).not.toBeNull(),
  );
  const table = translations(el).shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  expect(translationModal(el).heading).toContain("Francés");
  const field = table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[name=translation-text-product-cheese]",
  );
  expect(field).not.toBeNull();
  expect(field!.value).toBe("");
  expect(field!.getAttribute("lang")).toBe("fr");
  expect(table.shadowRoot!.textContent).toContain("STAFF Cheese");
});

it("opens only the clicked language's staged editor, keeping it closed until asked", async () => {
  const client = api();
  const el = await mount(client);
  expect(translations(el).open).toBe(false);
  expect(client.getContentTranslationTargets).not.toHaveBeenCalled();
  q(el, "[data-test=edit-translations-en]")!.click();
  await flush(el);
  await vi.waitFor(() =>
    expect(client.getContentTranslationTargets).toHaveBeenCalledExactlyOnceWith("en", {}),
  );
  expect(translations(el).open).toBe(true);
  expect(translations(el).language).toBe("en");
  expect(translationModal(el).heading).toContain(name("en"));
  translationModal(el).dispatchEvent(
    new CustomEvent("wt-close", { bubbles: true, composed: true }),
  );
  await flush(el);
  expect(translations(el).open).toBe(false);
});

it("keeps missing-report completeness unknown and closes a complete selected-language editor", async () => {
  const el = await mount(api());
  expect(rows(el)[0]!.querySelector("td:nth-child(2)")!.textContent!.trim()).toBe(
    t("content_gaps.loading"),
  );
  q(el, "[data-test=edit-translations-ca]")!.click();
  await flush(el);
  expect(translations(el).open).toBe(true);
  translations(el).shadowRoot!.querySelector<HTMLElement>("[data-test=close]")!.click();
  await vi.waitFor(() => expect(translations(el).open).toBe(false));
});

it("reopens for another language without keeping the preceding language's fields", async () => {
  const client = api();
  const el = await mount(client);
  q(el, "[data-test=edit-translations-en]")!.click();
  await flush(el);
  translations(el).shadowRoot!.querySelector<HTMLElement>("[data-test=close]")!.click();
  await vi.waitFor(() => expect(translations(el).open).toBe(false));
  q(el, "[data-test=edit-translations-de]")!.click();
  await flush(el);
  expect(translations(el).language).toBe("de");
  expect(translationModal(el).heading).toContain(name("de"));
  expect(client.getContentTranslationTargets).toHaveBeenNthCalledWith(2, "de", {});
});

it("opens the chosen language's target read while completeness is still loading", async () => {
  const el = await mount(api({ getContentTranslationGaps: vi.fn(() => new Promise(() => {})) }));
  q(el, "[data-test=edit-translations-de]")!.click();
  await flush(el);
  expect(translations(el).open).toBe(true);
  expect(translations(el).language).toBe("de");
  expect(translationModal(el).heading).toContain(name("de"));
});

it.each(["es-ES", "en-GB"])(
  "keeps regional required-name warnings and clears only the recovered report's error in %s",
  async (locale) => {
    setLocale(locale);
    const liveData = new LiveData();
    const client = api({
      liveData,
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "ca", "en"] }),
      getContentLanguageRules: vi.fn().mockResolvedValue(BARCELONA),
      getContentTranslationGaps: vi.fn().mockResolvedValue([
        { language: "es", gaps: [] },
        {
          language: "ca",
          gaps: [{ kind: "product", id: "prod-1", name: "STAFF Pan", reason: "partial" }],
        },
        { language: "en", gaps: [] },
      ]),
    });
    const el = await mount(client);
    const warning = () => q(el, "[data-test=required-gaps-ca]");
    expect(warning()!.getAttribute("role")).toBe("note");
    expect(warning()!.textContent!.trim()).toBe(
      t("content_gaps.required_warning_one").replace(
        "{language}",
        new Intl.DisplayNames([locale], { type: "language" }).of("ca")!,
      ),
    );
    vi.mocked(client.getContentTranslationGaps).mockRejectedValueOnce(new Error("offline"));
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=gaps-error]")).not.toBeNull());
    expect(q(el, "[data-test=retry]")).toBeNull();
    expect(warning()).toBeNull();
    vi.mocked(client.getContentTranslationGaps).mockResolvedValue([
      { language: "es", gaps: [] },
      { language: "ca", gaps: [] },
      { language: "en", gaps: [] },
    ]);
    q(el, "[data-test=gaps-retry]")!.click();
    await flush(el);
    expect(q(el, "[data-test=gaps-error]")).toBeNull();
    expect(warning()).toBeNull();
    expect(rowOf(el, "ca").querySelector("td:nth-child(2)")!.textContent!.trim()).toBe(
      t("content_gaps.none"),
    );
  },
);

it("reports the initial completeness failure without blocking languages or selected targets", async () => {
  const client = api({
    getContentTranslationGaps: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([{ language: "ca", gaps: [] }]),
  });
  const el = await mount(client);
  expect(q(el, "[data-test=gaps-error]")).not.toBeNull();
  expect(shown(el)).toEqual(["Catalán", "Alemán", "Inglés"]);
  q(el, "[data-test=edit-translations-ca]")!.click();
  await flush(el);
  expect(translations(el).open).toBe(true);
  q(el, "[data-test=gaps-retry]")!.click();
  await flush(el);
  expect(q(el, "[data-test=gaps-error]")).toBeNull();
});

it("closes a saved editor before the report refresh fails, keeping the failure on the screen", async () => {
  const client = api();
  const el = await mount(client);
  q(el, "[data-test=edit-translations-ca]")!.click();
  await flush(el);
  vi.mocked(client.getContentTranslationGaps).mockRejectedValue(new Error("offline"));
  translations(el).open = false;
  translations(el).dispatchEvent(
    new CustomEvent("translations-saved", { detail: { saved: [] }, bubbles: true, composed: true }),
  );
  await vi.waitFor(() => expect(q(el, "[data-test=gaps-error]")).not.toBeNull());
  expect(translations(el).open).toBe(false);
  expect(translationModal(el).open).toBe(false);
});

it("a real translation PUT closes once before a failing report refresh", async () => {
  const row = {
    kind: "product",
    id: "dish",
    name: "STAFF Soup",
    reason: "absent",
    selectedText: null,
    defaultText: null,
    effectiveSelectedText: null,
    effectiveDefaultText: null,
    defaultRequired: true,
    eligible: true,
    unavailableReason: null,
    owners: { kind: "product", parentId: null },
    expected: "baseline",
  };
  const client = api({
    getContentTranslationTargets: vi.fn().mockResolvedValue({
      language: "ca",
      config: CONFIG,
      required: [],
      rows: [row],
      total: 1,
      next: null,
    }),
  });
  const el = await mount(client);
  q(el, "[data-test=edit-translations-ca]")!.click();
  await flush(el);
  const form = translations(el);
  const table = form.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table
    .shadowRoot!.querySelector("[name=translation-text-product-dish]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Sopa" }, bubbles: true, composed: true }),
    );
  await form.updateComplete;
  vi.mocked(client.getContentTranslationGaps).mockRejectedValue(new Error("offline"));
  const outcomes: boolean[] = [];
  form.addEventListener("translations-saved", () => outcomes.push(form.open));
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await vi.waitFor(() => expect(q(el, "[data-test=gaps-error]")).not.toBeNull());
  expect(outcomes).toEqual([false]);
  expect(form.open).toBe(false);
  expect(translationModal(el).open).toBe(false);
  expect(client.saveContentTranslations).toHaveBeenCalledExactlyOnceWith("ca", {
    edits: [{ kind: "product", id: "dish", expected: "baseline", text: "Sopa" }],
  });
});
