import { LiveData } from "@waitron/dashboard-kit";
import { capitaliseFirst, type ContentLanguageRules, type ContentLanguages } from "@waitron/shared";
import { currentContentLanguages } from "@waitron/ui";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
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

  it("shows a save refused for leaving out a required language once, in the card", async () => {
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
    const select = add.shadowRoot!.querySelector<HTMLSelectElement>("select[name=language]")!;
    select.value = "fr";
    select.dispatchEvent(new Event("change"));
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
    const select = add.shadowRoot!.querySelector<HTMLSelectElement>("select[name=language]")!;
    select.value = "fr";
    select.dispatchEvent(new Event("change"));
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
      const select = add.shadowRoot!.querySelector<HTMLSelectElement>("select[name=language]")!;
      select.value = "fr";
      select.dispatchEvent(new Event("change"));
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
