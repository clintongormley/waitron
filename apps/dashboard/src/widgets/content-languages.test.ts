import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ContentLanguageEditor } from "./content-languages.js";
import { t } from "../i18n/t.js";

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

  it("explains an Add with no language chosen, and clears the problem once one is chosen", async () => {
    const { el } = await mountWidget<ContentLanguageEditor>("dashboard-content-languages", {
      open: true,
      config: { defaultLanguage: "en", languages: ["en"] },
      api: { updateContentLanguages: vi.fn() },
    });
    const additional = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "select[name=additional-language]",
    )!;
    click(el, "add-language");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toBe(
      t("content_languages.problem"),
    );
    expect(additional.getAttribute("aria-invalid")).toBe("true");
    expect(additional.getAttribute("aria-describedby")).toBe("language-error");
    expect(el.shadowRoot!.querySelector("#language-error")!.textContent).toBe(
      t("content_languages.choose"),
    );
    await select(el, "additional-language", "fr");
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(additional.getAttribute("aria-invalid")).toBe("false");
    expect(additional.hasAttribute("aria-describedby")).toBe(false);
  });

  it("closes from Cancel, announcing languages-closed", async () => {
    const { el, host } = await mountWidget<ContentLanguageEditor>("dashboard-content-languages", {
      open: true,
      config: { defaultLanguage: "en", languages: ["en"] },
      api: { updateContentLanguages: vi.fn() },
    });
    const closed = vi.fn();
    host.addEventListener("languages-closed", closed);
    el.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
    await el.updateComplete;
    expect(el.open).toBe(false);
    expect(closed).toHaveBeenCalled();
  });

  // Mounted on its own: after a Cancel, the closed dialog's own close event arrives a task later
  // and announces languages-closed again, which would satisfy these assertions with no Escape.
  it("closes from Escape, announcing languages-closed", async () => {
    const { el, host } = await mountWidget<ContentLanguageEditor>("dashboard-content-languages", {
      open: true,
      config: { defaultLanguage: "en", languages: ["en"] },
      api: { updateContentLanguages: vi.fn() },
    });
    const closed = vi.fn();
    host.addEventListener("languages-closed", closed);
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.matches(":modal")).toBe(true);
    expect(closed).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    expect(el.open).toBe(false);
    expect(dialog.open).toBe(false);
  });

  it("holds the draft open and unchanged while a save is in flight", async () => {
    let finish!: () => void;
    const api = {
      updateContentLanguages: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const { el, host } = await mountWidget<ContentLanguageEditor>("dashboard-content-languages", {
      open: true,
      config: { defaultLanguage: "en", languages: ["en"] },
      api,
    });
    const closed = vi.fn();
    const saved = vi.fn();
    host.addEventListener("languages-closed", closed);
    host.addEventListener("languages-saved", saved);
    await select(el, "additional-language", "fr");
    click(el, "save-languages");
    await el.updateComplete;

    click(el, "save-languages");
    click(el, "add-language");
    el.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
    await el.updateComplete;
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await userEvent.keyboard("{Escape}");
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(api.updateContentLanguages).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector("[data-test=remove-fr]")).toBeNull();
    expect(closed).not.toHaveBeenCalled();
    expect(el.open).toBe(true);

    finish();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(saved.mock.calls[0]![0].detail).toEqual({ defaultLanguage: "en", languages: ["en"] });
  });
});
