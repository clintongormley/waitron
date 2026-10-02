import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { AddContentLanguageDialog } from "./add-content-language.js";
import { contentLanguageChoices } from "@waitron/shared";
import { en, es } from "../i18n/strings.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

const CONFIG = { defaultLanguage: "es", languages: ["es", "en"] };

async function mount(
  save: AddContentLanguageDialog["save"] = vi.fn().mockResolvedValue(undefined),
  official?: readonly string[],
) {
  return mountWidget<AddContentLanguageDialog>("dashboard-add-content-language", {
    open: true,
    config: CONFIG,
    save,
    ...(official ? { official } : {}),
  });
}

const OFFICIAL = ["es", "ca", "gl", "eu"];
/** The option groups in the order the dropdown draws them. */
const groups = (el: AddContentLanguageDialog): string[] => [
  ...new Set(field(el).options.flatMap((option) => (option.group ? [option.group] : []))),
];
const inGroup = (el: AddContentLanguageDialog, index: number) =>
  field(el).options.filter((option) => option.group === groups(el)[index]);
const codesIn = (options: { value: string }[]) => options.map((option) => option.value);

const field = (el: AddContentLanguageDialog) => box(el);

async function choose(el: AddContentLanguageDialog, value: string): Promise<void> {
  await chooseOption(field(el), value);
  await el.updateComplete;
}

/** The dropdown's own trigger, which carries its invalid state and its description. */
const control = (el: AddContentLanguageDialog): HTMLElement =>
  field(el).shadowRoot!.querySelector<HTMLElement>("button.trigger")!;

function click(el: AddContentLanguageDialog, action: string): void {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${action}"]`)!.click();
}

async function bottomOf(el: AddContentLanguageDialog): Promise<string | null> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent ?? null;
}

const disabled = (el: AddContentLanguageDialog, action: string): boolean =>
  el.shadowRoot!.querySelector(`[data-test="${action}"]`)!.hasAttribute("disabled");

type LanguageBox = HTMLElement & {
  value: string;
  label: string;
  placeholder: string;
  search: string;
  error: string;
  required: boolean;
  disabled: boolean;
  options: { value: string; label: string; group?: string }[];
  updateComplete: Promise<unknown>;
};

const box = (el: AddContentLanguageDialog): LanguageBox =>
  el.shadowRoot!.querySelector<LanguageBox>('wt-combobox[name="language"]')!;

/** What the closed dropdown shows on its trigger, not what its properties say it holds. */
async function shownLanguage(el: AddContentLanguageDialog): Promise<string | undefined> {
  await box(el).updateComplete;
  return box(el).shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
}

describe("add content language dialog: the shared dropdown", () => {
  it("picks the language from a required shared dropdown with a search box, the official languages grouped first", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { el } = await mount(save, OFFICIAL);
    const language = box(el);
    expect(language).not.toBeNull();
    expect(language.label).toBe(t("content_languages.language"));
    expect(language.required).toBe(true);
    expect(language.search).toBe("auto");
    expect(language.placeholder).toBe(t("content_languages.choose"));
    const others = contentLanguageChoices(currentLocale()).filter(
      ({ code }) => !["es", "en", "ca", "eu", "gl"].includes(code),
    );
    expect(language.options).toEqual([
      { value: "ca", label: "Catalán", group: t("content_languages.official_group") },
      { value: "eu", label: "Euskera", group: t("content_languages.official_group") },
      { value: "gl", label: "Gallego", group: t("content_languages.official_group") },
      ...others.map(({ code, name }) => ({
        value: code,
        label: name,
        group: t("content_languages.other_group"),
      })),
    ]);
    expect(language.value).toBe("");
    expect(await shownLanguage(el)).toBe(t("content_languages.choose"));

    await chooseOption(language, "gl");
    await el.updateComplete;
    expect(await shownLanguage(el)).toBe("Gallego");
    click(el, "save-language");
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith({ defaultLanguage: "es", languages: ["es", "en", "gl"] }),
    );
  });
});

describe("add content language dialog: official languages first", () => {
  it("lists the official languages not yet enabled in a group of their own, then every other language in a second group, each alphabetical", async () => {
    const { el } = await mount(undefined, OFFICIAL);
    expect(field(el).placeholder).toBe(t("content_languages.choose"));
    expect(groups(el)).toHaveLength(2);
    expect(groups(el)[0]).toBe(t("content_languages.official_group"));
    expect(groups(el)[1]).toBe(t("content_languages.other_group"));
    expect(codesIn(inGroup(el, 0))).toEqual(["ca", "eu", "gl"]);
    expect(inGroup(el, 0).map((o) => o.label)).toEqual(["Catalán", "Euskera", "Gallego"]);
    const others = contentLanguageChoices(currentLocale())
      .map(({ code }) => code)
      .filter((code) => !["es", "en", "ca", "eu", "gl"].includes(code));
    expect(codesIn(inGroup(el, 1))).toEqual(others);
    expect(codesIn(field(el).options)).toEqual(["ca", "eu", "gl", ...others]);
  });

  it("names the two groups in each UI language", () => {
    expect(en["content_languages.official_group"]).toBe("Official languages");
    expect(es["content_languages.official_group"]).toBe("Idiomas oficiales");
    expect(en["content_languages.other_group"]).toBe("Other languages");
    expect(es["content_languages.other_group"]).toBe("Otros idiomas");
  });

  it("orders the official group by the English names in English", async () => {
    setLocale("en-GB");
    const { el } = await mount(undefined, OFFICIAL);
    expect(inGroup(el, 0).map((o) => o.label)).toEqual(["Basque", "Catalan", "Galician"]);
  });

  it("keeps one flat list when there are no official languages", async () => {
    const { el } = await mount();
    expect(groups(el)).toHaveLength(0);
    expect(codesIn(field(el).options)).toEqual([
      ...contentLanguageChoices(currentLocale())
        .map(({ code }) => code)
        .filter((code) => !["es", "en"].includes(code)),
    ]);
  });

  it("keeps one flat list when every official language is already enabled", async () => {
    const { el } = await mount(undefined, ["es", "en"]);
    expect(groups(el)).toHaveLength(0);
  });

  it("saves an official language chosen from its group, and keeps it chosen through a live refresh", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { el } = await mount(save, OFFICIAL);
    await choose(el, "gl");
    el.config = { defaultLanguage: "es", languages: ["es", "en", "de"] };
    await el.updateComplete;
    expect(field(el).value).toBe("gl");
    expect(await shownLanguage(el)).toBe("Gallego");
    click(el, "save-language");
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        defaultLanguage: "es",
        languages: ["es", "en", "de", "gl"],
      }),
    );
  });
});

describe("add content language dialog", () => {
  it("holds only a required language list, offering the languages not yet enabled with a capital letter", async () => {
    const { el } = await mount();
    const modal = el.shadowRoot!.querySelector("wt-modal")!;
    expect(modal.getAttribute("heading")).toBe(t("content_languages.add"));
    expect(
      el.shadowRoot!.querySelectorAll(
        "select, input, textarea, wt-combobox, wt-input, wt-textarea",
      ),
    ).toHaveLength(1);
    expect(field(el).required).toBe(true);
    expect(field(el).label).toContain(t("content_languages.language"));
    const options = field(el).options;
    expect(field(el).placeholder).toBe(t("content_languages.choose"));
    const codes = options.map((option) => option.value);
    expect(codes).not.toContain("es");
    expect(codes).not.toContain("en");
    expect(options.find((option) => option.value === "fr")!.label).toBe("Francés");
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
      const parts = [
        field(el),
        field(el).shadowRoot!.querySelector(".field"),
        field(el).shadowRoot!.querySelector("[data-error]"),
      ].filter((part) => part !== null);
      expect(parts).toHaveLength(3);
      for (const part of parts) {
        expect(part.getBoundingClientRect().width, part.localName).toBeCloseTo(form, 0);
      }
    } finally {
      await page.viewport(width, height);
    }
  });

  it("saves the chosen language after the enabled ones, keeping the default, then announces the save and closes", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { el, host } = await mount(save);
    const saved = vi.fn();
    host.addEventListener("languages-saved", saved);
    await choose(el, "fr");
    click(el, "save-language");
    const config = { defaultLanguage: "es", languages: ["es", "en", "fr"] };
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(config);
    expect(el.open).toBe(false);
  });

  it("says nothing before the first Add, then explains an Add with no language beside the field and at the bottom, focuses it and holds Add until one is chosen", async () => {
    const save = vi.fn();
    const { el } = await mount(save);
    expect(field(el).error).toBe("");
    expect(await bottomOf(el)).toBeNull();
    expect(disabled(el, "save-language")).toBe(false);

    click(el, "save-language");
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
    expect(save).not.toHaveBeenCalled();
    expect(control(el).getAttribute("aria-invalid")).toBe("true");
    const describedBy = control(el).getAttribute("aria-describedby")!;
    expect(field(el).shadowRoot!.getElementById(describedBy)!.textContent).toBe(
      t("content_languages.choose"),
    );
    expect(field(el).error).toBe(t("content_languages.choose"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.activeElement).toBe(field(el));
    expect(disabled(el, "save-language")).toBe(true);
    expect(el.open).toBe(true);

    await choose(el, "fr");
    expect(field(el).error).toBe("");
    expect(control(el).getAttribute("aria-invalid")).toBe("false");
    expect(control(el).hasAttribute("aria-describedby")).toBe(false);
    expect(await bottomOf(el)).toBeNull();
    expect(disabled(el, "save-language")).toBe(false);
  });

  it("shows a refused save at the bottom, leaves the dialog open with Add working, and drops the message when Add is pressed again", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce({ code: "content.language_invalid" })
      .mockReturnValueOnce(new Promise(() => {}));
    const { el } = await mount(save);
    await choose(el, "fr");
    click(el, "save-language");
    await vi.waitFor(async () =>
      expect(await bottomOf(el)).toBe(codeMessage("content.language_invalid")),
    );
    expect(el.open).toBe(true);
    expect(disabled(el, "save-language")).toBe(false);
    expect(field(el).value).toBe("fr");
    expect(await shownLanguage(el)).toBe("Francés");

    click(el, "save-language");
    await el.updateComplete;
    expect(await bottomOf(el)).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("keeps the chosen language through a live refresh of the enabled languages", async () => {
    const { el } = await mount();
    await choose(el, "fr");
    el.config = { defaultLanguage: "es", languages: ["es", "en", "ca"] };
    await el.updateComplete;
    expect(field(el).value).toBe("fr");
    expect(await shownLanguage(el)).toBe("Francés");
    expect(field(el).options.map((option) => option.value)).not.toContain("ca");
  });

  it("drops the chosen language when a live refresh enables it: the placeholder shows, stays when the language is disabled again, and Add counts as nothing chosen", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { el } = await mount(save);
    await choose(el, "");
    await choose(el, "fr");
    el.config = { defaultLanguage: "es", languages: ["es", "en", "fr"] };
    await el.updateComplete;
    expect(field(el).value).toBe("");
    expect(await shownLanguage(el)).toBe(t("content_languages.choose"));
    el.config = CONFIG;
    await el.updateComplete;
    expect(field(el).value).toBe("");

    click(el, "save-language");
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
    expect(save).not.toHaveBeenCalled();
    expect(control(el).getAttribute("aria-invalid")).toBe("true");
    expect(field(el).error).toBe(t("content_languages.choose"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(el.open).toBe(true);
  });

  it("sends no duplicate when Add is pressed before a refresh enabling the chosen language has rendered", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { el } = await mount(save);
    await choose(el, "fr");
    el.config = { defaultLanguage: "es", languages: ["es", "en", "fr"] };
    click(el, "save-language");
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
    expect(save).not.toHaveBeenCalled();
    expect(field(el).value).toBe("");
    expect(control(el).getAttribute("aria-invalid")).toBe("true");
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
    expect(field(el).error).toBe("");
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
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { el, host } = await mount(save);
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
    expect(save).toHaveBeenCalledOnce();
    expect(closed).not.toHaveBeenCalled();
    expect(el.open).toBe(true);

    finish();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({ defaultLanguage: "es", languages: ["es", "en", "fr"] });
    await closeReportsDelivered();
    expect(closed).not.toHaveBeenCalled();
  });
});
