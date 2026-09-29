import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import { ContentLanguageEditor } from "./content-languages.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

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

async function bottomOf(el: ContentLanguageEditor): Promise<string | null> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[role=alert]")?.textContent ?? null;
}

const disabled = (el: ContentLanguageEditor, action: string): boolean =>
  el.shadowRoot!.querySelector(`[data-test="${action}"]`)!.hasAttribute("disabled");

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
    const defaultSelect = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "select[name=default-language]",
    )!;
    await vi.waitFor(() => expect(defaultSelect.getAttribute("aria-invalid")).toBe("true"));
    expect(
      el.shadowRoot!.getElementById(defaultSelect.getAttribute("aria-describedby")!)!.textContent,
    ).toBe(codeMessage("content.default_missing"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(disabled(el, "save-languages")).toBe(false);
    expect(el.open).toBe(true);
    expect(defaultSelect.value).toBe("fr");

    await select(el, "default-language", "en");
    expect(defaultSelect.getAttribute("aria-invalid")).toBe("false");
    expect(await bottomOf(el)).toBeNull();
  });

  it("explains an Add with no language chosen under the field, and clears the problem once one is chosen", async () => {
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
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(additional.getAttribute("aria-invalid")).toBe("true");
    expect(additional.getAttribute("aria-describedby")).toBe("language-error");
    expect(el.shadowRoot!.querySelector("#language-error")!.textContent).toBe(
      t("content_languages.choose"),
    );
    await select(el, "additional-language", "fr");
    expect(el.shadowRoot!.querySelector("#language-error")).toBeNull();
    expect(additional.getAttribute("aria-invalid")).toBe("false");
    expect(additional.hasAttribute("aria-describedby")).toBe(false);
  });

  it("says nothing before the first Add, and a failed Add focuses the field and holds Add until a language is chosen", async () => {
    const { el } = await mountWidget<ContentLanguageEditor>("dashboard-content-languages", {
      open: true,
      config: { defaultLanguage: "en", languages: ["en"] },
      api: { updateContentLanguages: vi.fn() },
    });
    const additional = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "select[name=additional-language]",
    )!;
    expect(el.shadowRoot!.querySelector("#language-error")).toBeNull();
    expect(disabled(el, "add-language")).toBe(false);

    click(el, "add-language");
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
    expect(el.shadowRoot!.activeElement).toBe(additional);
    expect(disabled(el, "add-language")).toBe(true);
    expect(disabled(el, "save-languages")).toBe(false);
    expect(await bottomOf(el)).toBeNull();

    await select(el, "additional-language", "fr");
    expect(disabled(el, "add-language")).toBe(false);
    click(el, "add-language");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=remove-fr]")).not.toBeNull();
  });

  it("drops a refused save's message when Save is pressed again", async () => {
    const api = {
      updateContentLanguages: vi
        .fn()
        .mockRejectedValueOnce({ code: "content.language_invalid" })
        .mockReturnValueOnce(new Promise(() => {})),
    };
    const { el } = await mountWidget<ContentLanguageEditor>("dashboard-content-languages", {
      open: true,
      config: { defaultLanguage: "en", languages: ["en"] },
      api,
    });
    click(el, "save-languages");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(codeMessage("content.language_invalid")),
    );
    click(el, "save-languages");
    await el.updateComplete;
    expect(await bottomOf(el)).toBeNull();
    expect(api.updateContentLanguages).toHaveBeenCalledTimes(2);
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
    await closeReportsDelivered();
    expect(closed).toHaveBeenCalledOnce();
  });

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
    await closeReportsDelivered();
    expect(closed).not.toHaveBeenCalled();
  });
});
