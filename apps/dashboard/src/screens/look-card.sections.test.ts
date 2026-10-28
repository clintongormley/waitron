import { commands, page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { WAITRON_CHOICES, fixAll, type ThemeChoices } from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS, deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { fill, setLocale, t } from "../i18n/t.js";
import { ADVANCED_SECTIONS, type AdvancedSectionId } from "../widgets/advanced-sections.js";
import {
  cleanupWidgets,
  mountWidget,
  openDisclosure,
  openFoldsAround,
} from "../widgets/test-helpers.js";
import { sectionSummary } from "../widgets/theme-words.js";
import "./look-card.js";

type Card = HTMLElementTagNameMap["dashboard-look-card"];
type Advanced = HTMLElementTagNameMap["dashboard-theme-advanced"];
type Disclosure = HTMLElementTagNameMap["wt-disclosure"];

function theme(id: string, name: string, choices: ThemeChoices): ThemeView {
  const derived = deriveTheme(choices);
  return {
    id,
    name,
    updatedAt: "2026-10-21T10:00:00.000Z",
    choices,
    light: derived.light,
    dark: derived.dark,
    warnings: derived.warnings,
  };
}

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  logo: null,
  handSet: { light: {}, dark: {} },
  textScale: 100,
  text: {},
};
const CHRISTMAS: ThemeChoices = {
  brandColor: "#7a1f2b",
  brandFix: { dark: true },
  background: "neutral",
  corners: "standard",
  logo: null,
  handSet: { light: { bg: "#f8f1e1" }, dark: {} },
  textScale: 100,
  text: { size: { sm: 13 } },
};
const TWO_FIXES: ThemeChoices = {
  ...WAITRON_CHOICES,
  handSet: { light: { text: "#6a6a6a", "surface-sunken": "#bbbbbb" }, dark: {} },
};
const lucia = theme("t-lucia", "Bar Lucía", LUCIA);
const christmas = theme("t-xmas", "Christmas", CHRISTMAS);
const LIST: ThemeList = { themes: [lucia, christmas], inUse: lucia.id };

// Folds open at once rather than over their animation.
beforeEach(async () => {
  setLocale("en-GB");
  await commands.emulateReducedMotion("reduce");
});
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  await commands.emulateReducedMotion(null);
});

async function mountEditing(list: ThemeList = LIST) {
  const saveTheme = vi.fn(async (id: string, choices: ThemeChoices) =>
    theme(id, list.themes.find((view) => view.id === id)!.name, choices),
  );
  const { el } = await mountWidget<Card>("dashboard-look-card", {
    api: { saveTheme } as unknown as DashboardApi,
    list,
    canEdit: true,
  });
  await startEditing(el);
  return { el, saveTheme };
}

function mountChoices(choices: ThemeChoices) {
  const view = theme("t-hand", "By hand", choices);
  return mountEditing({ themes: [view], inUse: view.id });
}

async function startEditing(el: Card) {
  await userEvent.click(el.shadowRoot!.querySelector("[data-test=edit]")!);
  await el.updateComplete;
}

const q = (el: Card, selector: string) => el.shadowRoot!.querySelector(selector);
const advanced = (el: Card) => q(el, "dashboard-theme-advanced") as Advanced;
const disclosure = (el: Card) =>
  advanced(el).shadowRoot!.querySelector("[data-test=advanced]") as Disclosure;
const section = (el: Card, id: AdvancedSectionId) =>
  advanced(el).shadowRoot!.querySelector(`[data-test=section-${id}]`) as Disclosure;
const handCode = (el: Card, mode: string, key: string) =>
  advanced(el).shadowRoot!.querySelector(
    `wt-input[name="handSet.${mode}.${key}"]`,
  ) as HTMLElementTagNameMap["wt-input"];
const textRows = (el: Card) =>
  advanced(el).shadowRoot!.querySelector(
    "dashboard-theme-text",
  ) as HTMLElementTagNameMap["dashboard-theme-text"];
const sizeBox = (el: Card, key: string) =>
  textRows(el).shadowRoot!.querySelector(
    `wt-number-stepper[name="text.size.${key}"]`,
  ) as HTMLElementTagNameMap["wt-number-stepper"];
const choice = (el: Card, name: string) =>
  textRows(el).shadowRoot!.querySelector(
    `wt-combobox[name="${name}"]`,
  ) as HTMLElementTagNameMap["wt-combobox"];
const button = (el: Card, name: string) =>
  q(el, `[data-test=${name}]`) as HTMLElementTagNameMap["wt-button"];
const bottom = async (el: Card) =>
  (
    await formMessageOf(q(el, "wt-form-actions") as HTMLElementTagNameMap["wt-form-actions"])
  )?.textContent?.trim() ?? "";
const editing = (el: Card) => q(el, "section.settings-card")!.hasAttribute("data-editing");

async function settle(el: Card) {
  await el.updateComplete;
  await advanced(el).updateComplete;
  for (const id of ADVANCED_SECTIONS) await section(el, id).updateComplete;
  await disclosure(el).updateComplete;
}

async function openSection(el: Card, id: AdvancedSectionId) {
  await openDisclosure(disclosure(el), { domClick: true });
  await openDisclosure(section(el, id), { domClick: true });
}

async function close(fold: Disclosure) {
  await userEvent.click(fold.shadowRoot!.querySelector("button.header")!);
  await fold.updateComplete;
  expect(fold.open).toBe(false);
}

async function closeEverySection(el: Card) {
  for (const id of ADVANCED_SECTIONS) if (section(el, id).open) await close(section(el, id));
  if (disclosure(el).open) await close(disclosure(el));
}

async function typeHand(el: Card, mode: string, key: string, value: string) {
  const inner = handCode(el, mode, key).shadowRoot!.querySelector("input")!;
  await openFoldsAround(inner, { domClick: true });
  await page.elementLocator(inner).fill(value);
  await settle(el);
}

async function typeSize(el: Card, key: string, value: string) {
  const inner = sizeBox(el, key).shadowRoot!.querySelector("input")!;
  await openFoldsAround(inner, { domClick: true });
  await page.elementLocator(inner).fill(value);
  await settle(el);
  await textRows(el).updateComplete;
}

async function chooseText(el: Card, name: string, value: string) {
  await openFoldsAround(choice(el, name), { domClick: true });
  await chooseOption(choice(el, name), value);
  await settle(el);
  await textRows(el).updateComplete;
}

async function chooseOtherCorners(el: Card) {
  const other = q(el, "wt-segmented-control[name=corners]")!.shadowRoot!.querySelector(
    'button[aria-checked="false"]',
  )!;
  await userEvent.click(other);
  await settle(el);
}

/** The open sections, in order; every other section is closed. */
function openSections(el: Card): AdvancedSectionId[] {
  return ADVANCED_SECTIONS.filter((id) => section(el, id).open);
}

function focused(el: Card): Element | null {
  let at: Element | null = el.shadowRoot!.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  return at;
}

describe("Advanced's five sections in the Look card", () => {
  it("the editor opens with Advanced closed, and Advanced opens with every section closed", async () => {
    const { el } = await mountEditing();
    expect(disclosure(el).open).toBe(false);
    await openDisclosure(disclosure(el));
    await settle(el);
    expect(openSections(el)).toEqual([]);
  });

  it("Save with a half-typed Field underline opens Advanced and Fields and focus at its code, and sends nothing", async () => {
    const { el, saveTheme } = await mountEditing();
    await openSection(el, "fields");
    await typeHand(el, "dark", "field-line", "#12");
    await close(section(el, "fields"));
    await close(disclosure(el));

    await userEvent.click(button(el, "save"));
    await settle(el);
    expect(saveTheme).not.toHaveBeenCalled();
    expect(disclosure(el).open).toBe(true);
    expect(openSections(el)).toEqual(["fields"]);
    expect(section(el, "fields").hasAttribute("has-error")).toBe(true);
    const inner = handCode(el, "dark", "field-line").shadowRoot!.querySelector("input");
    await expect.poll(() => focused(el)).toBe(inner);
    expect(await bottom(el)).toBe(t("form.fix_fields"));
    expect(button(el, "save").disabled).toBe(true);
  });

  it("Save with errors in two sections opens both and focuses the first", async () => {
    const { el, saveTheme } = await mountEditing();
    await typeHand(el, "light", "bg", "#12");
    await typeSize(el, "sm", "7");
    await closeEverySection(el);
    expect(openSections(el)).toEqual([]);

    await userEvent.click(button(el, "save"));
    await settle(el);
    expect(saveTheme).not.toHaveBeenCalled();
    expect(openSections(el)).toEqual(["surfaces", "text"]);
    const inner = handCode(el, "light", "bg").shadowRoot!.querySelector("input");
    await expect.poll(() => focused(el)).toBe(inner);
  });

  it("a refusal naming a colour opens its section, and one naming a text setting opens Text", async () => {
    const { el, saveTheme } = await mountEditing();
    await chooseOtherCorners(el);
    expect(disclosure(el).open).toBe(false);
    expect(openSections(el)).toEqual([]);

    saveTheme.mockRejectedValueOnce({
      code: "theme.invalid",
      params: { field: "handSet.light.bg", reason: "bad_value" },
    });
    await userEvent.click(button(el, "save"));
    await expect.poll(() => section(el, "surfaces").open).toBe(true);
    await settle(el);
    expect(disclosure(el).open).toBe(true);
    expect(openSections(el)).toEqual(["surfaces"]);

    saveTheme.mockRejectedValueOnce({
      code: "theme.invalid",
      params: { field: "text.weight.bold", reason: "bad_value" },
    });
    await userEvent.click(button(el, "save"));
    await expect.poll(() => section(el, "text").open).toBe(true);
    await settle(el);
    // A cleared error leaves its section open.
    expect(openSections(el)).toEqual(["surfaces", "text"]);
  });
});

describe("sections stay as they are while the draft changes under them", () => {
  const hardToRead = /hard to read$/;

  async function twoFixesWithTextColours() {
    const opened = await mountChoices(TWO_FIXES);
    const surfacesBefore = sectionSummary("surfaces", TWO_FIXES, deriveTheme(TWO_FIXES).warnings);
    await openSection(opened.el, "text-colours");
    await settle(opened.el);
    expect(openSections(opened.el)).toEqual(["text-colours"]);
    expect(section(opened.el, "surfaces").summary).toBe(surfacesBefore);
    expect(surfacesBefore).toMatch(hardToRead);
    return opened;
  }

  it("Fix all", async () => {
    const { el } = await twoFixesWithTextColours();
    await userEvent.click(button(el, "fix-all"));
    await settle(el);
    expect(disclosure(el).open).toBe(true);
    expect(openSections(el)).toEqual(["text-colours"]);
    const fixed = fixAll(WAITRON_DEFAULTS, TWO_FIXES);
    expect(section(el, "surfaces").summary).toBe(
      sectionSummary("surfaces", fixed, deriveTheme(fixed).warnings),
    );
    expect(section(el, "surfaces").summary).not.toMatch(hardToRead);
  });

  it("Reset all", async () => {
    const { el } = await twoFixesWithTextColours();
    const reset = advanced(el).shadowRoot!.querySelector("[data-test=reset-all]")!;
    await userEvent.click(reset);
    await settle(el);
    expect(disclosure(el).open).toBe(true);
    expect(openSections(el)).toEqual(["text-colours"]);
    for (const id of ADVANCED_SECTIONS)
      expect(section(el, id).summary, id).toBe(t("appearance.section_none"));
  });

  it("Use Waitron's look", async () => {
    const { el } = await twoFixesWithTextColours();
    await userEvent.click(button(el, "use-waitron"));
    await settle(el);
    expect(disclosure(el).open).toBe(true);
    expect(openSections(el)).toEqual(["text-colours"]);
    for (const id of ADVANCED_SECTIONS)
      expect(section(el, id).summary, id).toBe(t("appearance.section_none"));
  });

  it("a newer read of the theme in use", async () => {
    const { el } = await mountEditing();
    await openSection(el, "surfaces");
    const newer = theme("t-lucia", "Bar Lucía", {
      ...LUCIA,
      handSet: { light: { bg: "#f8f1e1" }, dark: {} },
    });
    el.list = { themes: [newer, christmas], inUse: lucia.id };
    await settle(el);
    expect(handCode(el, "light", "bg").value).toBe("#f8f1e1");
    expect(disclosure(el).open).toBe(true);
    expect(openSections(el)).toEqual(["surfaces"]);
  });

  it("Save with a warning, then Back in the Hard to read dialog", async () => {
    const { el, saveTheme } = await twoFixesWithTextColours();
    await chooseOtherCorners(el);
    await userEvent.click(button(el, "save"));
    const dialog = q(el, "dashboard-hard-to-read-dialog")!;
    await expect.poll(() => dialog.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);

    const back = new Promise((resolve) =>
      dialog.addEventListener("hard-to-read-back", resolve, { once: true }),
    );
    await userEvent.click(dialog.shadowRoot!.querySelector("[data-test=back]")!);
    await back;
    await settle(el);
    expect(disclosure(el).open).toBe(true);
    expect(openSections(el)).toEqual(["text-colours"]);
    expect(saveTheme).not.toHaveBeenCalled();
  });
});

describe("sections are closed again the next time the editor opens", () => {
  it("after Cancel", async () => {
    const { el } = await mountEditing();
    await openSection(el, "buttons");
    await openDisclosure(section(el, "text"), { domClick: true });
    await userEvent.click(button(el, "cancel"));
    await el.updateComplete;
    expect(editing(el)).toBe(false);

    await startEditing(el);
    await settle(el);
    expect(disclosure(el).open).toBe(false);
    expect(openSections(el)).toEqual([]);
  });

  it("after Save", async () => {
    const { el, saveTheme } = await mountEditing();
    await chooseText(el, "text.weight.bold", "700");
    expect(openSections(el)).toEqual(["text"]);
    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    await expect.poll(() => editing(el)).toBe(false);

    await startEditing(el);
    await settle(el);
    expect(disclosure(el).open).toBe(false);
    expect(openSections(el)).toEqual([]);
  });

  it("editing another theme shows its sections closed, with its closed lines", async () => {
    const { el } = await mountEditing();
    await openSection(el, "surfaces");
    el.edit({ id: christmas.id });
    await settle(el);
    expect(disclosure(el).open).toBe(false);
    expect(openSections(el)).toEqual([]);
    const warnings = deriveTheme(CHRISTMAS).warnings;
    for (const id of ADVANCED_SECTIONS)
      expect(section(el, id).summary, id).toBe(sectionSummary(id, CHRISTMAS, warnings));
    const pageLight = fill("appearance.hand_item", {
      name: t("appearance.colour.bg"),
      mode: t("appearance.mode.light"),
    });
    expect(ADVANCED_SECTIONS.map((id) => section(el, id).summary)).toEqual([
      fill("appearance.advanced_set_one", { names: pageLight }),
      t("appearance.section_none"),
      t("appearance.section_none"),
      t("appearance.section_none"),
      fill("appearance.advanced_set_one", { names: t("appearance.text.size.sm") }),
    ]);
  });
});

describe("what is open is not stored", () => {
  function storage(): Record<string, Record<string, string | null>> {
    const read = (store: Storage) =>
      Object.fromEntries(
        Array.from({ length: store.length }, (_, i) => store.key(i)!).map((key) => [
          key,
          store.getItem(key),
        ]),
      );
    return { local: read(localStorage), session: read(sessionStorage) };
  }

  it("opening Advanced and opening and closing two sections writes nothing to storage", async () => {
    localStorage.clear();
    sessionStorage.clear();
    const { el } = await mountEditing();
    const before = storage();
    await openDisclosure(disclosure(el));
    await openDisclosure(section(el, "surfaces"));
    await openDisclosure(section(el, "text"));
    await close(section(el, "surfaces"));
    await close(section(el, "text"));
    expect(storage()).toEqual(before);
  });
});
