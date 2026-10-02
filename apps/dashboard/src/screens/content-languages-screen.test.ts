import { LiveData, tableNoMatches } from "@waitron/dashboard-kit";
import { capitaliseFirst, type ContentLanguageRules, type ContentLanguages } from "@waitron/shared";
import { currentContentLanguages } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, LanguageTranslationGaps, TranslationGap } from "../api/client.js";
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
    getReceiptLanguage: vi.fn().mockResolvedValue({
      language: "ca-ES",
      choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      fixed: null,
    }),
    ...overrides,
  } as unknown as DashboardApi;
}

const q = (el: ContentLanguagesScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
const dialog = (el: ContentLanguagesScreen) =>
  el.shadowRoot!.querySelector<AddContentLanguageDialog>("dashboard-add-content-language")!;
const name = (code: string) =>
  capitaliseFirst(
    new Intl.DisplayNames([currentLocale()], { type: "language" }).of(code)!,
    currentLocale(),
  );
const rows = (el: ContentLanguagesScreen) => [
  ...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=languages] > li"),
];
const shown = (el: ContentLanguagesScreen) =>
  rows(el).map((row) => row.querySelector(".field-value")!.textContent!.trim());
const disabled = (el: ContentLanguagesScreen, action: string): boolean =>
  q(el, `[data-test=${action}]`)!.hasAttribute("disabled");
const saveMessage = (el: ContentLanguagesScreen) => q(el, "wt-card [data-error]");

async function flush(el: ContentLanguagesScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
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
const MADRID: ContentLanguageRules = { required: [], official: OFFICIAL };
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

  it("offers Remove on every language but the default where the region requires none", async () => {
    const el = await mount(
      rulesApi(MADRID, { defaultLanguage: "es", languages: ["es", "ca", "en"] }),
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
    const el = await mount(rulesApi(MADRID, { defaultLanguage: "es", languages: ["es", "ca"] }));
    expect(notice(el)).toBeNull();
  });

  it("hands the official languages to the Add language dialog", async () => {
    const el = await mount(rulesApi(MADRID, { defaultLanguage: "es", languages: ["es"] }));
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
    add.shadowRoot!.querySelector<HTMLElement>("[data-test=save-language]")!.click();
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

  it("gives the default no actions, and every other language Set as default and Remove", async () => {
    const el = await mount(api());
    expect(rows(el)[0]!.querySelectorAll("wt-button")).toHaveLength(0);
    for (const [index, code] of [
      [1, "de"],
      [2, "en"],
    ] as const) {
      const buttons = [...rows(el)[index]!.querySelectorAll("wt-button")];
      expect(buttons.map((button) => button.dataset.test)).toEqual([
        `set-default-${code}`,
        `remove-${code}`,
      ]);
      expect(buttons.map((button) => button.textContent!.trim())).toEqual([
        t("content_languages.set_default"),
        t("content_languages.remove"),
      ]);
      expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
        `${t("content_languages.set_default")}: ${name(code)}`,
        `${t("content_languages.remove")}: ${name(code)}`,
      ]);
    }
  });

  it("separates the rows with a hairline, none above the first, and shows each name in bold", async () => {
    const el = await mount(api());
    const [first, ...others] = rows(el);
    expect(getComputedStyle(first!).borderTopStyle).toBe("none");
    for (const row of others) expect(getComputedStyle(row).borderTopStyle).toBe("solid");
    const bold = getComputedStyle(el).getPropertyValue("--wt-font-weight-bold").trim();
    for (const row of rows(el)) {
      expect(getComputedStyle(row.querySelector(".field-value")!).fontWeight).toBe(bold);
    }
  });

  it("says that removing a language keeps its translations, and nothing more", async () => {
    expect(en["content_languages.preserve"]).toBe("Removing a language keeps its translations.");
    expect(es["content_languages.preserve"]).toBe(
      "Al quitar un idioma se conservan sus traducciones.",
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
    expect(rows(el)[0]!.querySelectorAll("wt-button")).toHaveLength(0);
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
    add.shadowRoot!.querySelector<HTMLElement>("[data-test=save-language]")!.click();
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
    add.shadowRoot!.querySelector<HTMLElement>("[data-test=save-language]")!.click();
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
      add.shadowRoot!.querySelector<HTMLElement>("[data-test=save-language]")!.click();
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

describe("missing translations", () => {
  const PAN: TranslationGap = {
    kind: "product",
    id: "prod-1",
    name: "STAFF Pan",
    reason: "partial",
  };
  const SPANISH_DEFAULT: ContentLanguages = {
    defaultLanguage: "es",
    languages: ["es", "ca", "en"],
  };
  const report = (byLanguage: Record<string, TranslationGap[]>): LanguageTranslationGaps[] =>
    Object.entries(byLanguage).map(([language, gaps]) => ({ language, gaps }));

  function gapsApi(
    config: ContentLanguages,
    rules: ContentLanguageRules,
    gaps: LanguageTranslationGaps[] | (() => Promise<LanguageTranslationGaps[]>),
  ) {
    return api({
      getContentLanguages: vi.fn().mockResolvedValue(config),
      getContentLanguageRules: vi.fn().mockResolvedValue(rules),
      getContentTranslationGaps:
        typeof gaps === "function" ? vi.fn(gaps) : vi.fn().mockResolvedValue(gaps),
    });
  }

  const disclosure = (el: ContentLanguagesScreen, code: string) =>
    q(el, `[data-test=gaps-${code}]`) as
      (HTMLElement & { heading: string; summary: string; open: boolean }) | null;
  const disclosures = (el: ContentLanguagesScreen) =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>("wt-disclosure")].map(
      (each) => each.dataset.test,
    );
  const table = (el: ContentLanguagesScreen, code: string) =>
    q(el, `[data-test=gaps-table-${code}]`) as
      | (HTMLElement & {
          rows: TranslationGap[];
          columns: { key: string; filter?: { options: { value: string }[] } }[];
          updateComplete: Promise<unknown>;
        })
      | null;
  async function links(el: ContentLanguagesScreen, code: string) {
    const found = table(el, code)!;
    await found.updateComplete;
    return [...found.shadowRoot!.querySelectorAll<HTMLAnchorElement>("tbody a")];
  }
  /** Whether the screen cancelled the click. The window listener then cancels it in any case, so a
   * test never navigates the page it runs in. */
  function clickPrevented(link: HTMLAnchorElement, held: MouseEventInit): boolean {
    let prevented = false;
    const guard = (event: Event) => {
      prevented = event.defaultPrevented;
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
    return prevented;
  }
  const warning = (el: ContentLanguagesScreen, code: string) =>
    q(el, `[data-test=required-gaps-${code}]`);
  const lower = (code: string) =>
    new Intl.DisplayNames([currentLocale()], { type: "language" }).of(code)!;

  it("lists a product missing its Catalan name under Catalan, flagged as required, in a Barcelona venue whose default is Spanish", async () => {
    const el = await mount(
      gapsApi(
        SPANISH_DEFAULT,
        BARCELONA,
        report({ es: [], ca: [PAN], en: [{ ...PAN, reason: "absent" }] }),
      ),
    );
    expect(q(el, "[data-test=missing-translations] h2")!.textContent).toBe(t("content_gaps.title"));
    const catalan = disclosure(el, "ca")!;
    expect(catalan.open).toBe(true);
    expect(catalan.heading).toBe(`${name("ca")} · ${t("content_languages.required")}`);
    expect(catalan.summary).toBe(t("content_gaps.count").replace("{count}", "1"));
    expect(warning(el, "ca")!.getAttribute("role")).toBe("note");
    expect(warning(el, "ca")!.textContent!.trim()).toBe(
      t("content_gaps.required_warning_one").replace("{language}", lower("ca")),
    );
    expect(table(el, "ca")!.rows).toEqual([PAN]);
    const [link] = await links(el, "ca");
    expect(link!.getAttribute("href")).toBe("/manage/catalogue/product/prod-1");
    expect(link!.getAttribute("aria-label")).toBe(
      t("content_gaps.open_named").replace("{name}", "STAFF Pan"),
    );
    expect(table(el, "ca")!.shadowRoot!.querySelector("tbody")!.textContent).toContain("STAFF Pan");
    expect(table(el, "ca")!.shadowRoot!.querySelector("tbody")!.textContent).toContain(
      t("content_gaps.partial"),
    );
  });

  it("says the dashboard's one no-matches sentence when a search hides every missing name", async () => {
    const el = await mount(
      gapsApi(SPANISH_DEFAULT, BARCELONA, report({ es: [], ca: [PAN], en: [] })),
    );
    const found = table(el, "ca")!;
    await found.updateComplete;
    const box = found.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
    box.value = "zzz-nothing";
    box.dispatchEvent(new Event("input"));
    await found.updateComplete;
    expect(found.shadowRoot!.querySelector("tbody")).toBeNull();
    expect(found.shadowRoot!.querySelector(".empty .message")!.textContent).toBe(tableNoMatches());
  });

  it("orders the required languages first, then the default, then the rest, and says a language with nothing missing is complete", async () => {
    const el = await mount(
      gapsApi(
        { defaultLanguage: "en", languages: ["en", "fr", "es", "ca"] },
        BARCELONA,
        report({ en: [], fr: [PAN], es: [], ca: [PAN] }),
      ),
    );
    expect(disclosures(el)).toEqual(["gaps-ca", "gaps-es", "gaps-en", "gaps-fr"]);
    const spanish = disclosure(el, "es")!;
    expect(spanish.open).toBe(false);
    expect(spanish.summary).toBe(t("content_gaps.none"));
    expect(spanish.textContent!.trim()).toBe(
      t("content_gaps.complete").replace("{language}", lower("es")),
    );
    expect(table(el, "es")).toBeNull();
    expect(warning(el, "es")).toBeNull();
    expect(disclosure(el, "en")!.heading).toBe(`${name("en")} · ${t("content_languages.default")}`);
    expect(disclosure(el, "fr")!.heading).toBe(name("fr"));
    expect(disclosure(el, "fr")!.open).toBe(false);
    expect(warning(el, "fr")).toBeNull();
  });

  it("flags Spanish where it is required and the default is Catalan, since no save can leave Catalan out there", async () => {
    const absent = { ...PAN, reason: "absent" as const };
    const el = await mount(
      gapsApi(
        { defaultLanguage: "ca", languages: ["ca", "es", "en"] },
        BARCELONA,
        report({
          ca: [],
          es: [absent, { ...PAN, id: "prod-2", name: "STAFF Croqueta" }],
          en: [absent],
        }),
      ),
    );
    expect(disclosure(el, "ca")!.heading).toBe(
      `${name("ca")} · ${t("content_languages.default")} · ${t("content_languages.required")}`,
    );
    expect(disclosure(el, "es")!.open).toBe(true);
    expect(disclosure(el, "es")!.summary).toBe(t("content_gaps.count").replace("{count}", "2"));
    expect(warning(el, "es")!.textContent!.trim()).toBe(
      t("content_gaps.required_warning").replace("{language}", lower("es")).replace("{count}", "2"),
    );
    expect(warning(el, "ca")).toBeNull();
    expect(table(el, "es")!.shadowRoot!.querySelector("tbody")!.textContent).toContain(
      t("content_gaps.absent"),
    );
  });

  it("drops the row and the warning when the live data delivers a report without it", async () => {
    const liveData = new LiveData();
    const client = Object.assign(
      gapsApi(SPANISH_DEFAULT, BARCELONA, report({ es: [], ca: [PAN], en: [] })),
      { liveData },
    );
    const el = await mount(client);
    expect(warning(el, "ca")).not.toBeNull();
    vi.mocked(client.getContentTranslationGaps).mockResolvedValue(
      report({ es: [], ca: [], en: [] }),
    );
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(warning(el, "ca")).toBeNull());
    expect(disclosure(el, "ca")!.summary).toBe(t("content_gaps.none"));
    expect(table(el, "ca")).toBeNull();
  });

  it("shows a failed read of the list, with its own Try again, while the languages stay usable", async () => {
    const client = gapsApi(SPANISH_DEFAULT, BARCELONA, report({ es: [], ca: [PAN], en: [] }));
    vi.mocked(client.getContentTranslationGaps).mockRejectedValueOnce(new Error("offline"));
    const el = await mount(client);
    expect(q(el, "[data-test=gaps-error]")!.textContent!.trim()).toBe(t("content_gaps.load_error"));
    expect(q(el, "[data-test=gaps-error]")!.getAttribute("role")).toBe("alert");
    expect(shown(el)).toEqual(["Español", "Catalán", "Inglés"]);
    expect(q(el, "[data-test=retry]")).toBeNull();
    q(el, "[data-test=gaps-retry]")!.click();
    await flush(el);
    expect(q(el, "[data-test=gaps-error]")).toBeNull();
    expect(table(el, "ca")!.rows).toEqual([PAN]);
  });

  it("reports a failed refresh of the list in the list alone, keeping the rows it last read", async () => {
    const liveData = new LiveData();
    const client = Object.assign(
      gapsApi(SPANISH_DEFAULT, BARCELONA, report({ es: [], ca: [PAN], en: [] })),
      { liveData },
    );
    const el = await mount(client);
    vi.mocked(client.getContentTranslationGaps).mockRejectedValue(new Error("offline"));
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=gaps-error]")).not.toBeNull());
    expect(q(el, "[data-test=retry]")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(t("content_languages.load_error"));
    expect(table(el, "ca")!.rows).toEqual([PAN]);
  });

  it("shows a loading status for the list once the languages are shown", async () => {
    const el = await mount(gapsApi(SPANISH_DEFAULT, BARCELONA, () => new Promise(() => {})));
    expect(q(el, "[data-test=gaps-loading]")!.textContent!.trim()).toBe(t("content_gaps.loading"));
    expect(q(el, "[data-test=gaps-loading]")!.getAttribute("role")).toBe("status");
    expect(shown(el)).toEqual(["Español", "Catalán", "Inglés"]);
  });

  it("links each kind to the screen that edits it, naming a variant, an option and a section with what holds it", async () => {
    const menu = { id: "menu-1", name: "Lunch" };
    const gaps: TranslationGap[] = [
      PAN,
      {
        kind: "variant",
        id: "var-1",
        name: "STAFF Small",
        reason: "partial",
        parent: { id: "prod-1", name: "STAFF Pan" },
      },
      { kind: "option_list", id: "list-1", name: "STAFF Doneness", reason: "partial" },
      {
        kind: "option_label",
        id: "label-1",
        name: "STAFF Rare",
        reason: "absent",
        parent: { id: "list-1", name: "STAFF Doneness" },
      },
      { kind: "extra_list", id: "extras-1", name: "STAFF Sides", reason: "partial" },
      { kind: "menu", id: "root-1", name: "Lunch", reason: "absent", parent: menu },
      { kind: "section", id: "section-1", name: "STAFF Drinks", reason: "partial", parent: menu },
      { kind: "unit", id: "unit-1", name: "ración", reason: "partial" },
    ];
    const el = await mount(gapsApi(SPANISH_DEFAULT, MADRID, report({ es: [], ca: gaps, en: [] })));
    disclosure(el, "ca")!.open = true;
    await flush(el);
    const found = await links(el, "ca");
    const byName = Object.fromEntries(
      found.map((link) => [link.getAttribute("aria-label"), link.getAttribute("href")]),
    );
    const open = (label: string) => t("content_gaps.open_named").replace("{name}", label);
    expect(byName).toEqual({
      [open("STAFF Pan")]: "/manage/catalogue/product/prod-1",
      [open("STAFF Pan › STAFF Small")]: "/manage/catalogue/product/var-1",
      [open("STAFF Doneness")]: "/manage/modifiers/view/options/list/list-1",
      [open("STAFF Doneness › STAFF Rare")]: "/manage/modifiers/view/options/list/list-1",
      [open("STAFF Sides")]: "/manage/modifiers/view/extras/list/extras-1",
      [open("Lunch")]: "/manage/menus/menu/menu-1/view/structure",
      [open("Lunch › STAFF Drinks")]: "/manage/menus/menu/menu-1/view/structure",
      [open("ración")]: "/manage/units",
    });
    const filters = Object.fromEntries(
      table(el, "ca")!
        .columns.filter((column) => column.filter)
        .map((column) => [column.key, column.filter!.options.map((option) => option.value)]),
    );
    expect(filters).toEqual({
      kind: [
        "product",
        "variant",
        "option_list",
        "option_label",
        "extra_list",
        "menu",
        "section",
        "unit",
      ],
      reason: ["partial", "absent"],
    });
    const kind = table(el, "ca")!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      'wt-combobox[data-filter="kind"]',
    )!;
    expect([kind.searchPlaceholder, kind.noResultsLabel]).toEqual(["Buscar", "Sin resultados"]);
  });

  it("opens a product's editor inside the dashboard rather than reloading the page", async () => {
    const el = await mount(
      gapsApi(SPANISH_DEFAULT, BARCELONA, report({ es: [], ca: [PAN], en: [] })),
    );
    const asked: string[] = [];
    el.addEventListener("wt-edit-product", (event) =>
      asked.push((event as CustomEvent<{ productId: string }>).detail.productId),
    );
    const [link] = await links(el, "ca");
    expect(clickPrevented(link!, {})).toBe(true);
    expect(asked).toEqual(["prod-1"]);
  });

  it("opens a variant's own editor inside the dashboard, and leaves every other kind's link to the browser", async () => {
    const variant: TranslationGap = {
      kind: "variant",
      id: "var-1",
      name: "STAFF Small",
      reason: "partial",
      parent: { id: "prod-1", name: "STAFF Pan" },
    };
    const list: TranslationGap = {
      kind: "option_list",
      id: "list-1",
      name: "STAFF Doneness",
      reason: "partial",
    };
    const el = await mount(
      gapsApi(SPANISH_DEFAULT, BARCELONA, report({ es: [], ca: [variant, list], en: [] })),
    );
    const asked: string[] = [];
    el.addEventListener("wt-edit-product", (event) =>
      asked.push((event as CustomEvent<{ productId: string }>).detail.productId),
    );
    const byHref = Object.fromEntries(
      (await links(el, "ca")).map((link) => [link.getAttribute("href"), link]),
    );
    expect(clickPrevented(byHref["/manage/catalogue/product/var-1"]!, {})).toBe(true);
    expect(clickPrevented(byHref["/manage/modifiers/view/options/list/list-1"]!, {})).toBe(false);
    expect(asked).toEqual(["var-1"]);
  });

  it("leaves a click with Ctrl or Cmd held to the browser, to open the editor in a new tab", async () => {
    const el = await mount(
      gapsApi(SPANISH_DEFAULT, BARCELONA, report({ es: [], ca: [PAN], en: [] })),
    );
    const asked: string[] = [];
    el.addEventListener("wt-edit-product", () => asked.push("asked"));
    const [link] = await links(el, "ca");
    expect(clickPrevented(link!, { ctrlKey: true })).toBe(false);
    expect(clickPrevented(link!, { metaKey: true })).toBe(false);
    expect(asked).toEqual([]);
  });

  it("names the section's text in each UI language", () => {
    expect(en["content_gaps.title"]).toBe("Missing translations");
    expect(es["content_gaps.title"]).toBe("Traducciones que faltan");
    expect(en["content_gaps.count"]).toBe("{count} missing");
    expect(es["content_gaps.count"]).toBe("{count} sin traducir");
    expect(en["content_gaps.complete"]).toBe("Every name has a {language} translation.");
    expect(es["content_gaps.complete"]).toBe("Todos los nombres están traducidos al {language}.");
  });

  it("writes the required-language warning in English when the UI is in English", async () => {
    setLocale("en-GB");
    const el = await mount(
      gapsApi(
        SPANISH_DEFAULT,
        BARCELONA,
        report({ es: [], ca: [PAN, { ...PAN, id: "prod-2" }], en: [] }),
      ),
    );
    expect(warning(el, "ca")!.textContent!.trim()).toBe(
      "Catalan is required in this region, and 2 names are not translated into it yet.",
    );
    expect(disclosure(el, "ca")!.heading).toBe("Catalan · Required");
    expect(disclosure(el, "ca")!.summary).toBe("2 missing");
    expect(disclosure(el, "es")!.textContent!.trim()).toBe("Every name has a Spanish translation.");
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
    add.shadowRoot!.querySelector<HTMLElement>("[data-test=save-language]")!.click();
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
