import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { AddContentLanguageDialog } from "./add-content-language.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);

const CONFIG = { defaultLanguage: "es", languages: ["es", "en"] };

async function mount(
  api: AddContentLanguageDialog["api"] = {
    updateContentLanguages: vi.fn().mockResolvedValue(undefined),
  },
) {
  return mountWidget<AddContentLanguageDialog>("dashboard-add-content-language", {
    open: true,
    config: CONFIG,
    api,
  });
}

const field = (el: AddContentLanguageDialog) =>
  el.shadowRoot!.querySelector<HTMLSelectElement>("select[name=language]")!;

async function choose(el: AddContentLanguageDialog, value: string): Promise<void> {
  field(el).value = value;
  field(el).dispatchEvent(new Event("change"));
  await el.updateComplete;
}

function click(el: AddContentLanguageDialog, action: string): void {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${action}"]`)!.click();
}

async function bottomOf(el: AddContentLanguageDialog): Promise<string | null> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent ?? null;
}

const disabled = (el: AddContentLanguageDialog, action: string): boolean =>
  el.shadowRoot!.querySelector(`[data-test="${action}"]`)!.hasAttribute("disabled");

describe("add content language dialog", () => {
  it("holds only a required language list, offering the languages not yet enabled with a capital letter", async () => {
    const { el } = await mount();
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    expect(modal.getAttribute("heading")).toBe(t("content_languages.add"));
    expect(el.shadowRoot!.querySelectorAll("select, input, textarea")).toHaveLength(1);
    expect(field(el).required).toBe(true);
    expect(field(el).closest("label")!.textContent).toContain(t("content_languages.language"));
    const options = [...field(el).options];
    expect(options[0]!.value).toBe("");
    expect(options[0]!.textContent!.trim()).toBe(t("content_languages.choose"));
    const codes = options.map((option) => option.value);
    expect(codes).not.toContain("es");
    expect(codes).not.toContain("en");
    expect(options.find((option) => option.value === "fr")!.textContent!.trim()).toBe("Francés");
    const buttons = el.shadowRoot!.querySelectorAll("wt-form-actions wt-button");
    expect([...buttons].map((button) => button.textContent!.trim())).toEqual([
      t("action.cancel"),
      t("action.add"),
    ]);
  });

  it("holds the field and its error to the standard form width on a wide window", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(1280, 800);
    try {
      const { el } = await mount();
      click(el, "save-language");
      await el.updateComplete;
      const probe = document.createElement("div");
      probe.style.width = "var(--wt-form-max-width)";
      el.shadowRoot!.appendChild(probe);
      const form = probe.getBoundingClientRect().width;
      const body = el.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector(".body")!;
      expect(body.clientWidth).toBeGreaterThan(form);
      const parts = el.shadowRoot!.querySelectorAll("label, select, #language-error");
      expect(parts).toHaveLength(3);
      for (const part of parts) {
        expect(part.getBoundingClientRect().width, part.localName).toBeCloseTo(form, 0);
      }
    } finally {
      await page.viewport(width, height);
    }
  });

  it("adds the chosen language after the enabled ones, keeps the default, announces the saved languages and closes", async () => {
    const api = { updateContentLanguages: vi.fn().mockResolvedValue(undefined) };
    const { el, host } = await mount(api);
    const saved = vi.fn();
    host.addEventListener("languages-saved", saved);
    await choose(el, "fr");
    click(el, "save-language");
    const config = { defaultLanguage: "es", languages: ["es", "en", "fr"] };
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.updateContentLanguages).toHaveBeenCalledWith(config);
    expect(saved.mock.calls[0]![0].detail).toEqual(config);
    expect(el.open).toBe(false);
  });

  it("says nothing before the first Add, then explains an Add with no language beside the field and at the bottom, focuses it and holds Add until one is chosen", async () => {
    const api = { updateContentLanguages: vi.fn() };
    const { el } = await mount(api);
    expect(el.shadowRoot!.querySelector("#language-error")).toBeNull();
    expect(await bottomOf(el)).toBeNull();
    expect(disabled(el, "save-language")).toBe(false);

    click(el, "save-language");
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
    expect(api.updateContentLanguages).not.toHaveBeenCalled();
    expect(field(el).getAttribute("aria-invalid")).toBe("true");
    expect(field(el).getAttribute("aria-describedby")).toBe("language-error");
    expect(el.shadowRoot!.querySelector("#language-error")!.textContent).toBe(
      t("content_languages.choose"),
    );
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.activeElement).toBe(field(el));
    expect(disabled(el, "save-language")).toBe(true);
    expect(el.open).toBe(true);

    await choose(el, "fr");
    expect(el.shadowRoot!.querySelector("#language-error")).toBeNull();
    expect(field(el).getAttribute("aria-invalid")).toBe("false");
    expect(field(el).hasAttribute("aria-describedby")).toBe(false);
    expect(await bottomOf(el)).toBeNull();
    expect(disabled(el, "save-language")).toBe(false);
  });

  it("shows a refused save at the bottom, leaves the dialog open with Add working, and drops the message when Add is pressed again", async () => {
    const api = {
      updateContentLanguages: vi
        .fn()
        .mockRejectedValueOnce({ code: "content.language_invalid" })
        .mockReturnValueOnce(new Promise(() => {})),
    };
    const { el } = await mount(api);
    await choose(el, "fr");
    click(el, "save-language");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(codeMessage("content.language_invalid")),
    );
    expect(el.open).toBe(true);
    expect(disabled(el, "save-language")).toBe(false);
    expect(field(el).value).toBe("fr");

    click(el, "save-language");
    await el.updateComplete;
    expect(await bottomOf(el)).toBeNull();
    expect(api.updateContentLanguages).toHaveBeenCalledTimes(2);
  });

  it("keeps the chosen language through a live refresh of the enabled languages", async () => {
    const { el } = await mount();
    await choose(el, "fr");
    el.config = { defaultLanguage: "es", languages: ["es", "en", "ca"] };
    await el.updateComplete;
    expect(field(el).value).toBe("fr");
    expect([...field(el).options].map((option) => option.value)).not.toContain("ca");
  });

  it("starts again when reopened: nothing chosen and no messages", async () => {
    const { el } = await mount();
    await choose(el, "fr");
    await choose(el, "");
    click(el, "save-language");
    await el.updateComplete;
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    expect(field(el).value).toBe("");
    expect(el.shadowRoot!.querySelector("#language-error")).toBeNull();
    expect(await bottomOf(el)).toBeNull();
    expect(disabled(el, "save-language")).toBe(false);
  });

  it("closes from Cancel, announcing languages-closed", async () => {
    const { el, host } = await mount();
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
    const { el, host } = await mount();
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

  it("stays open and unchanged while a save is in flight", async () => {
    let finish!: () => void;
    const api = {
      updateContentLanguages: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const { el, host } = await mount(api);
    const closed = vi.fn();
    const saved = vi.fn();
    host.addEventListener("languages-closed", closed);
    host.addEventListener("languages-saved", saved);
    await choose(el, "fr");
    click(el, "save-language");
    await el.updateComplete;

    expect(field(el).disabled).toBe(true);
    click(el, "save-language");
    el.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
    await el.updateComplete;
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    await userEvent.keyboard("{Escape}");
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(api.updateContentLanguages).toHaveBeenCalledOnce();
    expect(closed).not.toHaveBeenCalled();
    expect(el.open).toBe(true);

    finish();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(saved.mock.calls[0]![0].detail).toEqual({
      defaultLanguage: "es",
      languages: ["es", "en", "fr"],
    });
    await closeReportsDelivered();
    expect(closed).not.toHaveBeenCalled();
  });
});
