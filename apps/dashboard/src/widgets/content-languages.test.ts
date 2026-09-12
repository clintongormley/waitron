import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ContentLanguageEditor } from "./content-languages.js";

afterEach(cleanupWidgets);

async function select(el: ContentLanguageEditor, name: string, value: string): Promise<void> {
  const input = el.shadowRoot!.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event("change"));
  await el.updateComplete;
}

function click(el: ContentLanguageEditor, action: string): void {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${action}"]`)!.click();
}

describe("content language editor", () => {
  it("adds a language at runtime and protects the default from removal", async () => {
    const api = { updateContentLanguages: vi.fn().mockResolvedValue(undefined) };
    const { el } = await mountWidget<ContentLanguageEditor>("dashboard-content-languages", {
      open: true,
      config: { defaultLanguage: "en", languages: ["en"] },
      api,
    });
    await select(el, "additional-language", "fr");
    click(el, "add-language");
    await el.updateComplete;
    const removeDefault = el.shadowRoot!.querySelector("[data-test=remove-en]")!;
    expect(removeDefault.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    click(el, "save-languages");
    await vi.waitFor(() =>
      expect(api.updateContentLanguages).toHaveBeenCalledWith({
        defaultLanguage: "en",
        languages: ["en", "fr"],
      }),
    );
    await vi.waitFor(() => expect(el.open).toBe(false));
  });

  it("changes the default and removes another language without touching stored translations", async () => {
    const api = { updateContentLanguages: vi.fn().mockResolvedValue(undefined) };
    const { el } = await mountWidget<ContentLanguageEditor>("dashboard-content-languages", {
      open: true,
      config: { defaultLanguage: "en", languages: ["en", "fr", "ca"] },
      api,
    });
    await select(el, "default-language", "fr");
    click(el, "remove-ca");
    await el.updateComplete;
    click(el, "save-languages");
    await vi.waitFor(() =>
      expect(api.updateContentLanguages).toHaveBeenCalledWith({
        defaultLanguage: "fr",
        languages: ["fr", "en"],
      }),
    );
  });

  it("retains a draft after a live refresh and a refused save", async () => {
    const api = {
      updateContentLanguages: vi.fn().mockRejectedValue({ code: "content.default_missing" }),
    };
    const { el } = await mountWidget<ContentLanguageEditor>("dashboard-content-languages", {
      open: true,
      config: { defaultLanguage: "en", languages: ["en", "fr"] },
      api,
    });
    await select(el, "default-language", "fr");
    el.config = { defaultLanguage: "en", languages: ["en", "fr", "ca"] };
    await el.updateComplete;
    expect(
      el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=default-language]")!.value,
    ).toBe("fr");
    click(el, "save-languages");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
    expect(el.open).toBe(true);
    expect(
      el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=default-language]")!.value,
    ).toBe("fr");
  });
});
