import { LiveData } from "@waitron/dashboard-kit";
import type { ContentLanguages } from "@waitron/shared";
import { currentContentLanguages } from "@waitron/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import type { ContentLanguageEditor } from "../widgets/content-languages.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./content-languages-screen.js";
import type { ContentLanguagesScreen } from "./content-languages-screen.js";

const CONFIG: ContentLanguages = { defaultLanguage: "ca", languages: ["ca", "en", "de"] };

function api(overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    getContentLanguages: vi.fn().mockResolvedValue(CONFIG),
    updateContentLanguages: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}

const q = (el: ContentLanguagesScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
const dialog = (el: ContentLanguagesScreen) =>
  el.shadowRoot!.querySelector<ContentLanguageEditor>("dashboard-content-languages")!;
const name = (code: string) =>
  new Intl.DisplayNames([currentLocale()], { type: "language" }).of(code);
const enabled = (el: ContentLanguagesScreen) =>
  [...el.shadowRoot!.querySelectorAll("[data-test=enabled-languages] li")].map((li) =>
    li.textContent!.trim(),
  );

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

afterEach(cleanupWidgets);

describe("content languages screen", () => {
  it("shows the default language and every enabled language by name", async () => {
    const el = await mount(api());
    expect(q(el, "h1")!.textContent).toBe(t("content_languages.title"));
    expect(el.shadowRoot!.textContent).toContain(t("content_languages.help"));
    expect(q(el, "[data-test=default-language]")!.textContent!.trim()).toBe(name("ca"));
    expect(enabled(el)).toEqual([name("ca"), name("en"), name("de")]);
    expect(dialog(el).open).toBe(false);
  });

  it("shows the values in one card, bold, with Edit in the card's footer after them", async () => {
    const el = await mount(api());
    const card = q(el, "wt-card")!;
    const values = card.querySelector("dl")!;
    const edit = q(el, "[data-test=edit-languages]")!;
    const footer = edit.parentElement!;
    expect(values.contains(q(el, "[data-test=default-language]"))).toBe(true);
    expect(values.contains(q(el, "[data-test=enabled-languages]"))).toBe(true);
    expect(footer.parentElement).toBe(card);
    expect(values.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getComputedStyle(footer).justifyContent).toBe("flex-end");
    expect(getComputedStyle(footer).borderTopStyle).toBe("solid");
    expect(edit.getAttribute("variant")).toBe("secondary");
    expect(edit.classList).toContain("card-action");
    expect(edit.classList).toContain("accent-primary");
    const bold = getComputedStyle(el).getPropertyValue("--wt-font-weight-bold").trim();
    expect(getComputedStyle(q(el, "[data-test=default-language]")!).fontWeight).toBe(bold);
    expect(getComputedStyle(q(el, "[data-test=enabled-languages] li")!).fontWeight).toBe(bold);
  });

  it("shows a loading status, and no Edit, until the languages arrive", async () => {
    const el = await mount(api({ getContentLanguages: vi.fn(() => new Promise(() => {})) }));
    expect(q(el, "[role=status]")!.textContent!.trim()).toBe(t("content_languages.loading"));
    expect(q(el, "[data-test=edit-languages]")).toBeNull();
    expect(q(el, "dashboard-content-languages")).toBeNull();
  });

  it("opens the content languages dialog on the current configuration from Edit", async () => {
    const el = await mount(api());
    q(el, "[data-test=edit-languages]")!.click();
    await flush(el);
    expect(dialog(el).open).toBe(true);
    expect(dialog(el).config).toEqual(CONFIG);
  });

  it("shows what a save through the dialog stored, and shares it with the rest of the dashboard", async () => {
    const client = api();
    const el = await mount(client);
    q(el, "[data-test=edit-languages]")!.click();
    await flush(el);
    const editor = dialog(el);
    const additional = editor.shadowRoot!.querySelector<HTMLSelectElement>(
      "select[name=additional-language]",
    )!;
    additional.value = "fr";
    additional.dispatchEvent(new Event("change"));
    await editor.updateComplete;
    editor.shadowRoot!.querySelector<HTMLElement>("[data-test=add-language]")!.click();
    await editor.updateComplete;
    editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-languages]")!.click();
    const saved = { defaultLanguage: "ca", languages: ["ca", "en", "de", "fr"] };
    await vi.waitFor(() => expect(client.updateContentLanguages).toHaveBeenCalledWith(saved));
    await vi.waitFor(() => expect(enabled(el)).toContain(name("fr")));
    expect(enabled(el)).toEqual([name("ca"), name("en"), name("de"), name("fr")]);
    expect(currentContentLanguages()).toEqual(saved);
    expect(dialog(el).open).toBe(false);
  });

  it("reopens the dialog from Edit after it was cancelled", async () => {
    const el = await mount(api());
    q(el, "[data-test=edit-languages]")!.click();
    await flush(el);
    dialog(el).shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
    await flush(el);
    expect(dialog(el).open).toBe(false);
    q(el, "[data-test=edit-languages]")!.click();
    await flush(el);
    expect(dialog(el).open).toBe(true);
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
    await vi.waitFor(() => expect(enabled(el)).toEqual([name("en")]));
    expect(q(el, "[data-test=default-language]")!.textContent!.trim()).toBe(name("en"));
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
    expect(q(el, "[data-test=edit-languages]")).toBeNull();
    q(el, "[data-test=retry]")!.click();
    await flush(el);
    expect(q(el, "[role=alert]")).toBeNull();
    expect(enabled(el)).toEqual([name("ca"), name("en"), name("de")]);
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
    expect(enabled(el)).toEqual([name("ca"), name("en"), name("de")]);
  });
});
