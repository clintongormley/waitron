import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeaveController } from "@waitron/ui";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import {
  WAITRON_CHOICES,
  fixAll,
  normaliseChoices,
  type ThemeChoices,
} from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS, deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { es } from "../i18n/strings.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import "./look-card.js";

type Card = HTMLElementTagNameMap["dashboard-look-card"];

const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const q = (el: Card, selector: string) => el.shadowRoot!.querySelector(selector);
const row = (el: Card, name: string) => text(q(el, `[data-test=saved-${name}]`));

function theme(id: string, name: string, choices: ThemeChoices | null): ThemeView {
  const derived = choices === null ? null : deriveTheme(choices);
  return {
    id,
    name,
    updatedAt: "2026-10-21T10:00:00.000Z",
    choices,
    light: derived?.light ?? null,
    dark: derived?.dark ?? null,
    warnings: derived?.warnings ?? [],
  };
}

const LUCIA: ThemeChoices = {
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
  handSet: { light: {}, dark: {} },
};
const lucia = theme("t-lucia", "Bar Lucía", LUCIA);
const inUse = (view: ThemeView): ThemeList => ({ themes: [view], inUse: view.id });

async function mount(list: ThemeList, canEdit = true): Promise<Card> {
  const { el } = await mountWidget<Card>("dashboard-look-card", {
    api: {} as DashboardApi,
    list,
    canEdit,
  });
  return el;
}

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("the read-only Look card", () => {
  it("shows Waitron's theme in use, with no Edit even to an editor", async () => {
    setLocale("en-GB");
    const el = await mount({ themes: [lucia], inUse: null }, true);
    const card = q(el, "section.settings-card")!;
    expect(text(card.querySelector("header > h2"))).toBe(t("appearance.look"));
    expect(card.querySelector("h2")!.id).toBe("look-card");
    expect(row(el, "theme")).toBe("Waitron");
    expect(row(el, "brand")).toBe("Waitron's");
    expect(row(el, "background")).toBe("Neutral");
    expect(row(el, "corners")).toBe("Standard");
    expect(row(el, "hand")).toBe("None");
    expect(text(q(el, "[data-test=look-note]"))).toBe(t("appearance.note"));
    expect(q(el, "[data-test=edit]")).toBeNull();
    expect(q(el, "[data-test=saved-warning]")).toBeNull();
  });

  it("labels the rows in order: theme, brand, background, corners, colours set by hand", async () => {
    setLocale("en-GB");
    const el = await mount(inUse(lucia));
    const labels = [...el.shadowRoot!.querySelectorAll("dt")].map((dt) => text(dt));
    expect(labels).toEqual([
      "Theme in use",
      "Brand colour",
      "Background",
      "Corners",
      "Colours set by hand",
    ]);
  });

  it("shows Bar Lucía in use, its brand row naming the dark screens' shade with two chips", async () => {
    setLocale("en-GB");
    const el = await mount(inUse(lucia), true);
    expect(row(el, "theme")).toBe("Bar Lucía");
    expect(row(el, "brand")).toBe("Custom · #1e5b3a · dark screens #437e5b");
    const chips = [...el.shadowRoot!.querySelectorAll("[data-test=saved-brand] .chip")];
    expect(chips.map((chip) => chip.getAttribute("style"))).toEqual([
      "background:#1e5b3a",
      "background:#437e5b",
    ]);
    expect(chips.every((chip) => chip.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(row(el, "background")).toBe("Tinted");
    expect(row(el, "corners")).toBe("Round");
    expect(text(q(el, "[data-test=edit]"))).toBe(t("action.edit"));
  });

  it("offers no Edit to a session that cannot change the look", async () => {
    const el = await mount(inUse(lucia), false);
    expect(row(el, "theme")).toBe("Bar Lucía");
    expect(q(el, "[data-test=edit]")).toBeNull();
  });

  it("names the light screens' shade when the light fix is taken", async () => {
    setLocale("en-GB");
    const lemon = theme("t-lemon", "Lemon Café", {
      ...WAITRON_CHOICES,
      brandColor: "#f2d300",
      brandFix: { light: true },
    });
    const shade = lemon.light!["--wt-color-primary"];
    const el = await mount(inUse(lemon));
    expect(row(el, "brand")).toBe(`Custom · #f2d300 · light screens ${shade}`);
  });

  it("shows a palette colour with no Custom", async () => {
    setLocale("en-GB");
    const el = await mount(
      inUse(theme("t-red", "Red", { ...WAITRON_CHOICES, brandColor: "#b12525" })),
    );
    expect(row(el, "brand")).toBe("#b12525");
  });

  it("shows a warning saved anyway as a line beside a warning icon", async () => {
    setLocale("en-GB");
    const lemon = theme("t-lemon", "Lemon Café", { ...WAITRON_CHOICES, brandColor: "#f2d300" });
    expect(lemon.warnings.length).toBeGreaterThan(0);
    const el = await mount(inUse(lemon));
    const lines = [...el.shadowRoot!.querySelectorAll("[data-test=saved-warning]")];
    expect(lines.map((line) => text(line))).toEqual([
      "Buttons in the brand colour are hard to see on light screens.",
    ]);
    expect(lines[0]!.querySelector("wt-icon")?.getAttribute("name")).toBe("warning");
  });

  it("words a saved warning in Spanish", async () => {
    setLocale("es-ES");
    const lemon = theme("t-lemon", "Lemon Café", { ...WAITRON_CHOICES, brandColor: "#f2d300" });
    const el = await mount(inUse(lemon));
    expect(text(q(el, "[data-test=saved-warning]"))).toBe(es["appearance.saved_brand_light"]);
  });

  it("shows no warning line for a theme saved with none", async () => {
    const lemon = theme("t-lemon", "Lemon Café", { ...WAITRON_CHOICES, brandColor: "#f2d300" });
    const el = await mount(inUse({ ...lemon, warnings: [] }));
    expect(q(el, "[data-test=saved-warning]")).toBeNull();
  });

  it("shows an unreadable theme's name and Waitron's values", async () => {
    setLocale("en-GB");
    const el = await mount(inUse(theme("t-broken", "Old", null)));
    expect(row(el, "theme")).toBe("Old");
    expect(row(el, "brand")).toBe("Waitron's");
    expect(row(el, "background")).toBe("Neutral");
    expect(row(el, "corners")).toBe("Standard");
    expect(row(el, "hand")).toBe("None");
  });

  it("names colours set by hand, light before dark, each in the theme colours' order", async () => {
    setLocale("en-GB");
    expect(row(await mount(inUse(lucia)), "hand")).toBe("None");
    cleanupWidgets();
    const hand = theme("t-hand", "By hand", {
      ...WAITRON_CHOICES,
      handSet: { dark: { bg: "#101010" }, light: { text: "#6a6a6a", bg: "#f8f1e1" } },
    });
    expect(row(await mount(inUse(hand)), "hand")).toBe("Page (light), Text (light), Page (dark)");
    cleanupWidgets();
    setLocale("es-ES");
    const item = (name: string, mode: string) =>
      es["appearance.hand_item"].replace("{name}", name).replace("{mode}", mode);
    const page = es["appearance.colour.bg"];
    const light = es["appearance.mode.light"];
    expect(row(await mount(inUse(hand)), "hand")).toBe(
      [
        item(page, light),
        item(es["appearance.colour.text"], light),
        item(page, es["appearance.mode.dark"]),
      ].join(", "),
    );
  });
});

type Choices = ThemeChoices;
const saved = (id: string, name: string, choices: Choices) => theme(id, name, choices);

function editRig(list: ThemeList) {
  const saveTheme = vi.fn(async (id: string, choices: Choices) => {
    const name = list.themes.find((view) => view.id === id)?.name ?? id;
    return saved(id, name, choices);
  });
  return { api: { saveTheme } as unknown as DashboardApi & { saveTheme: typeof saveTheme } };
}

async function mountEditing(list: ThemeList) {
  const rig = editRig(list);
  const { el } = await mountWidget<Card>("dashboard-look-card", {
    api: rig.api,
    list,
    canEdit: true,
  });
  await userEvent.click(q(el, "[data-test=edit]")!);
  await el.updateComplete;
  return { el, saveTheme: rig.api.saveTheme };
}

const button = (el: Card, name: string) =>
  q(el, `[data-test=${name}]`) as HTMLElementTagNameMap["wt-button"];
const segmented = (el: Card, name: string) =>
  q(el, `wt-segmented-control[name=${name}]`) as HTMLElementTagNameMap["wt-segmented-control"];
const codeField = (el: Card) =>
  q(el, "wt-input[name=brandColor]") as HTMLElementTagNameMap["wt-input"];
const preview = (el: Card) =>
  q(el, "dashboard-theme-preview") as HTMLElementTagNameMap["dashboard-theme-preview"];
const bottom = async (el: Card) =>
  (
    await formMessageOf(q(el, "wt-form-actions") as HTMLElementTagNameMap["wt-form-actions"])
  )?.textContent?.trim() ?? "";

async function chooseSegment(el: Card, name: string, label: string) {
  const control = segmented(el, name);
  const choice = [...control.shadowRoot!.querySelectorAll("button")].find(
    (b) => text(b) === label,
  )!;
  await userEvent.click(choice);
  await el.updateComplete;
}

async function typeInCode(el: Card, value: string) {
  const inner = codeField(el).shadowRoot!.querySelector("input")!;
  await page.elementLocator(inner).fill(value);
  await el.updateComplete;
}

describe("editing the Look card in place", () => {
  it("Edit opens the card in place with Save quiet and disabled, a saved fix included", async () => {
    setLocale("en-GB");
    const { el } = await mountEditing(inUse(lucia));
    expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(true);
    expect(q(el, "[data-test=edit]")).toBeNull();
    expect(text(q(el, "[data-test=editing-line]"))).toBe(
      "Theme in use: Bar Lucía. Saving changes every screen.",
    );
    expect(button(el, "save").variant).toBe("secondary");
    expect(button(el, "save").disabled).toBe(true);
    expect(button(el, "use-waitron").disabled).toBe(false);
    expect(segmented(el, "background").value).toBe("tinted");
    expect(segmented(el, "corners").value).toBe("round");
    expect(codeField(el).value).toBe("#1e5b3a");
  });

  it("picking away and back to the saved colour keeps its fix, and Save goes quiet again", async () => {
    const { el } = await mountEditing(inUse(lucia));
    await userEvent.click(q(el, 'button.swatch[data-color="#b12525"]')!);
    await el.updateComplete;
    expect(button(el, "save").disabled).toBe(false);
    await typeInCode(el, "#1E5B3A");
    expect(button(el, "save").variant).toBe("secondary");
    expect(button(el, "save").disabled).toBe(true);
    expect(preview(el).theme.dark["--wt-color-primary"]).toBe(lucia.dark!["--wt-color-primary"]);
  });

  it("every change repaints the preview and nothing else", async () => {
    const { el } = await mountEditing(inUse(lucia));
    const before = getComputedStyle(el).getPropertyValue("--wt-color-primary");
    await userEvent.click(q(el, 'button.swatch[data-color="#b12525"]')!);
    await el.updateComplete;
    expect(preview(el).theme.light["--wt-color-primary"]).toBe("#b12525");
    expect(getComputedStyle(el).getPropertyValue("--wt-color-primary")).toBe(before);
    expect(button(el, "save").variant).toBe("primary");
    expect(button(el, "save").disabled).toBe(false);
  });

  it("Save sends the whole draft and closes the editor", async () => {
    setLocale("en-GB");
    const { el, saveTheme } = await mountEditing(inUse(lucia));
    const heard = vi.fn();
    el.addEventListener("look-saved", (event) => heard((event as CustomEvent).detail));
    await chooseSegment(el, "background", "Neutral");
    await userEvent.click(button(el, "save"));
    await expect
      .poll(() => q(el, "section.settings-card")!.hasAttribute("data-editing"))
      .toBe(false);
    expect(saveTheme).toHaveBeenCalledTimes(1);
    expect(saveTheme).toHaveBeenCalledWith("t-lucia", {
      brandColor: "#1e5b3a",
      brandFix: { dark: true },
      background: "neutral",
      corners: "round",
      handSet: { light: {}, dark: {} },
    });
    expect(q(el, "[data-test=saved-theme]")).not.toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0]![0]).toEqual(await saveTheme.mock.results[0]!.value);
  });

  it("a hand-set colour stored through the API is sent back unchanged", async () => {
    setLocale("en-GB");
    const handSet = { light: { bg: "#f8f1e1" }, dark: {} };
    const stored = theme("t-lucia", "Bar Lucía", { ...LUCIA, handSet });
    const { el, saveTheme } = await mountEditing(inUse(stored));
    await chooseSegment(el, "corners", "Square");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    expect(saveTheme.mock.calls[0]![1].handSet).toEqual(handSet);
    expect(saveTheme.mock.calls[0]![1].corners).toBe("square");
  });

  it("a bad code is explained after the first Save, and blocks only its own field", async () => {
    setLocale("en-GB");
    const { el, saveTheme } = await mountEditing(inUse(lucia));
    await typeInCode(el, "#12");
    expect(codeField(el).error).toBe("");
    expect(button(el, "save").disabled).toBe(false);
    await userEvent.click(button(el, "save"));
    await el.updateComplete;
    expect(saveTheme).not.toHaveBeenCalled();
    expect(codeField(el).error).toBe(t("appearance.bad_code"));
    expect(await bottom(el)).toBe(t("form.fix_fields"));
    expect(button(el, "save").disabled).toBe(true);
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(codeField(el));
    await typeInCode(el, "#123456");
    expect(codeField(el).error).toBe("");
    expect(await bottom(el)).toBe("");
    expect(button(el, "save").disabled).toBe(false);
  });

  it("a refusal naming brandColor lands under the field and never disables Save", async () => {
    setLocale("en-GB");
    const { el, saveTheme } = await mountEditing(inUse(lucia));
    await chooseSegment(el, "corners", "Square");
    saveTheme.mockRejectedValueOnce({
      code: "theme.invalid",
      params: { field: "brandColor", reason: "bad_value" },
    });
    await userEvent.click(button(el, "save"));
    await expect.poll(() => codeField(el).error).toBe(t("appearance.bad_code"));
    expect(await bottom(el)).toBe(t("form.fix_fields"));
    expect(button(el, "save").disabled).toBe(false);
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(codeField(el));
    for (const refusal of [
      { code: "theme.not_found" },
      { code: "theme.invalid", params: { field: "brandFix.light", reason: "fix_with_hand_set" } },
    ]) {
      saveTheme.mockRejectedValueOnce(refusal);
      await userEvent.click(button(el, "save"));
      await expect.poll(() => bottom(el)).toBe(codeMessage(refusal.code));
      expect(codeField(el).error).toBe("");
      expect(segmented(el, "corners").error).toBe("");
      expect(button(el, "save").disabled).toBe(false);
    }
    expect(saveTheme).toHaveBeenCalledTimes(3);
  });

  it("losing the right to edit closes the editor without a write", async () => {
    setLocale("en-GB");
    const rig = editRig(inUse(lucia));
    const { el: host } = await mountWidget<LookLeaveHost>("look-card-leave-host", {
      api: rig.api,
      list: inUse(lucia),
    });
    const el = host.shadowRoot!.querySelector("dashboard-look-card")!;
    await el.updateComplete;
    await userEvent.click(q(el, "[data-test=edit]")!);
    await el.updateComplete;
    await chooseSegment(el, "corners", "Square");
    expect(button(el, "save").disabled).toBe(false);
    host.canEdit = false;
    await host.updateComplete;
    await el.updateComplete;
    expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(false);
    expect(q(el, "[data-test=edit]")).toBeNull();
    expect(row(el, "corners")).toBe("Round");
    expect(rig.api.saveTheme).not.toHaveBeenCalled();
    await host.updateComplete;
    expect(host.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
  });

  it("Use Waitron's look changes the draft only, and Cancel undoes it", async () => {
    setLocale("en-GB");
    const { el, saveTheme } = await mountEditing(inUse(lucia));
    expect(button(el, "use-waitron").variant).toBe("secondary");
    await userEvent.click(button(el, "use-waitron"));
    await el.updateComplete;
    const waitrons = q(el, 'button.swatch.none[role="radio"]')!;
    expect(waitrons.getAttribute("aria-checked")).toBe("true");
    expect(text(waitrons)).toBe("Waitron's");
    expect(waitrons.querySelector(".chip")!.getAttribute("style")).toBe("background:#1f6feb");
    expect(segmented(el, "background").value).toBe("neutral");
    expect(segmented(el, "corners").value).toBe("standard");
    expect(codeField(el).value).toBe("");
    expect(button(el, "use-waitron").disabled).toBe(true);
    expect(button(el, "use-waitron").variant).toBe("secondary");
    expect(button(el, "save").disabled).toBe(false);
    expect(saveTheme).not.toHaveBeenCalled();
    await userEvent.click(button(el, "cancel"));
    await el.updateComplete;
    expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(false);
    expect(saveTheme).not.toHaveBeenCalled();
    expect(row(el, "theme")).toBe("Bar Lucía");
    expect(row(el, "brand")).toBe("Custom · #1e5b3a · dark screens #437e5b");
    expect(row(el, "background")).toBe("Tinted");
    expect(row(el, "corners")).toBe("Round");
  });

  it("lays the editor out by the card's own width, so a 700px card squashes no preview panel", async () => {
    const { innerWidth: width, innerHeight: height } = window;
    await page.viewport(1024, 800);
    try {
      const { el } = await mountEditing(inUse(lucia));
      el.parentElement!.style.width = "700px";
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const panels = [...preview(el).shadowRoot!.querySelectorAll<HTMLElement>(".panel")];
      const measured = panels.map((panel) => `${panel.clientWidth}/${panel.scrollWidth}`);
      expect(
        measured.every((pair) => Number(pair.split("/")[0]) >= Number(pair.split("/")[1])),
        measured.join(" "),
      ).toBe(true);
      const choices = q(el, ".choices") as HTMLElement;
      expect(choices.scrollWidth).toBeLessThanOrEqual(choices.clientWidth);
      expect(preview(el).getBoundingClientRect().top).toBeGreaterThanOrEqual(
        choices.getBoundingClientRect().bottom,
      );
    } finally {
      await page.viewport(width, height);
    }
  });

  it("an unreadable theme opens on Waitron's choices", async () => {
    setLocale("en-GB");
    const { el, saveTheme } = await mountEditing(inUse(theme("t-broken", "Old", null)));
    expect(button(el, "save").variant).toBe("secondary");
    expect(button(el, "save").disabled).toBe(true);
    expect(button(el, "use-waitron").disabled).toBe(true);
    await userEvent.click(q(el, 'button.swatch[data-color="#b12525"]')!);
    await el.updateComplete;
    await userEvent.click(button(el, "save"));
    await expect.poll(() => dialogOf(el).open).toBe(true);
    await userEvent.click(dialogButton(el, "save-anyway")!);
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    expect(saveTheme).toHaveBeenCalledWith("t-broken", {
      ...WAITRON_CHOICES,
      brandColor: "#b12525",
    });
  });
});

describe("another dashboard changes the themes while this one edits", () => {
  const OTHER = theme("t-other", "Terraza", { ...WAITRON_CHOICES, brandColor: "#b12525" });

  async function newList(el: Card, list: ThemeList) {
    el.list = list;
    await el.updateComplete;
  }

  it("an unchanged draft follows a newer read", async () => {
    const { el } = await mountEditing(inUse(lucia));
    await newList(el, inUse(theme("t-lucia", "Bar Lucía", { ...LUCIA, corners: "square" })));
    expect(segmented(el, "corners").value).toBe("square");
    expect(preview(el).theme.light["--wt-radius-md"]).toBe(
      deriveTheme({ ...LUCIA, corners: "square" }).light["--wt-radius-md"],
    );
    expect(button(el, "save").variant).toBe("secondary");
    expect(button(el, "save").disabled).toBe(true);
  });

  it("a changed draft is kept over a newer read", async () => {
    const { el, saveTheme } = await mountEditing(inUse(lucia));
    await chooseSegment(el, "background", "Neutral");
    await newList(el, inUse(theme("t-lucia", "Bar Lucía", { ...LUCIA, corners: "square" })));
    expect(segmented(el, "background").value).toBe("neutral");
    expect(segmented(el, "corners").value).toBe("round");
    expect(button(el, "save").variant).toBe("primary");
    expect(button(el, "save").disabled).toBe(false);
    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    expect(saveTheme.mock.calls[0]![1]).toEqual({ ...LUCIA, background: "neutral" });
  });

  it("a switch made elsewhere changes the editing line", async () => {
    setLocale("en-GB");
    const { el } = await mountEditing(inUse(lucia));
    await newList(el, { themes: [lucia, OTHER], inUse: "t-other" });
    expect(text(q(el, "[data-test=editing-line]"))).toBe(t("appearance.editing_not_in_use"));
    expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(true);
    await newList(el, { themes: [lucia, OTHER], inUse: "t-lucia" });
    expect(text(q(el, "[data-test=editing-line]"))).toBe(
      "Theme in use: Bar Lucía. Saving changes every screen.",
    );
  });

  it("a theme deleted elsewhere keeps the draft", async () => {
    setLocale("en-GB");
    const { el, saveTheme } = await mountEditing(inUse(lucia));
    await chooseSegment(el, "corners", "Square");
    await newList(el, { themes: [OTHER], inUse: null });
    expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(true);
    expect(segmented(el, "corners").value).toBe("square");
    expect(text(q(el, "[data-test=editing-line]"))).toBe(t("appearance.editing_not_in_use"));
    saveTheme.mockRejectedValueOnce({ code: "theme.not_found" });
    await userEvent.click(button(el, "save"));
    await expect.poll(() => bottom(el)).toBe(codeMessage("theme.not_found"));
    expect(button(el, "save").disabled).toBe(false);
    expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(true);
  });
});

describe("readability warnings in the editor", () => {
  const TWO_FIXES = theme("t-hand", "By hand", {
    ...WAITRON_CHOICES,
    handSet: { light: { text: "#6a6a6a", "surface-sunken": "#bbbbbb" }, dark: {} },
  });

  async function lemonEditing() {
    const opened = await mountEditing(inUse(lucia));
    await typeInCode(opened.el, "#f2d300");
    return opened;
  }

  it("the lemon warns, as picked, and never blocks Save", async () => {
    setLocale("en-GB");
    const { el } = await lemonEditing();
    const warning = q(el, "[data-test=brand-warning-light]")!;
    expect(text(warning)).toBe(t("appearance.brand_warning_light"));
    expect(warning.querySelector("wt-icon")?.getAttribute("name")).toBe("warning");
    expect(text(q(el, "[data-test=brand-fix-light]"))).toBe("Use #9d8a15 on light screens");
    expect(q(el, "[data-test=brand-warning-dark]")).toBeNull();
    expect(preview(el).theme.light["--wt-color-primary"]).toBe("#f2d300");
    expect(button(el, "save").disabled).toBe(false);
    expect(button(el, "save").variant).toBe("primary");
    expect(await bottom(el)).toBe("");
    expect(codeField(el).error).toBe("");
    expect(segmented(el, "background").error).toBe("");
    expect(segmented(el, "corners").error).toBe("");
  });

  it("the fix is a draft change, and Undo puts the lemon back", async () => {
    setLocale("en-GB");
    const { el, saveTheme } = await lemonEditing();
    await userEvent.click(button(el, "brand-fix-light"));
    await el.updateComplete;
    expect(preview(el).theme.light["--wt-color-primary"]).toBe("#9d8a15");
    expect(text(q(el, "[data-test=brand-fixed-light]"))).toBe("Buttons on light screens: #9d8a15");
    expect(text(q(el, "[data-test=brand-undo-light]"))).toBe(t("appearance.undo"));
    expect(q(el, "[data-test=brand-warning-light]")).toBeNull();
    expect(button(el, "save").disabled).toBe(false);
    await userEvent.click(button(el, "brand-undo-light"));
    await el.updateComplete;
    expect(text(q(el, "[data-test=brand-warning-light]"))).toBe(
      t("appearance.brand_warning_light"),
    );
    expect(q(el, "[data-test=brand-fixed-light]")).toBeNull();
    expect(preview(el).theme.light["--wt-color-primary"]).toBe("#f2d300");
    await userEvent.click(button(el, "brand-fix-light"));
    await el.updateComplete;
    await userEvent.click(button(el, "cancel"));
    await el.updateComplete;
    expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(false);
    expect(saveTheme).not.toHaveBeenCalled();
    expect(row(el, "brand")).toBe("Custom · #1e5b3a · dark screens #437e5b");
    expect(row(el, "background")).toBe("Tinted");
    expect(row(el, "corners")).toBe("Round");
  });

  it("a saved fix shows as fixed when the editor opens", async () => {
    setLocale("en-GB");
    const { el } = await mountEditing(inUse(lucia));
    expect(text(q(el, "[data-test=brand-fixed-dark]"))).toBe("Buttons on dark screens: #437e5b");
    expect(q(el, "[data-test=brand-undo-dark]")).not.toBeNull();
    expect(q(el, "[data-test=brand-warning-dark]")).toBeNull();
    expect(button(el, "save").variant).toBe("secondary");
    expect(button(el, "save").disabled).toBe(true);
  });

  it("picking another brand colour drops the fix", async () => {
    setLocale("en-GB");
    const { el } = await mountEditing(inUse(lucia));
    await userEvent.click(q(el, 'button.swatch[data-color="#b12525"]')!);
    await el.updateComplete;
    expect(q(el, "[data-test=brand-fixed-dark]")).toBeNull();
    expect(text(q(el, "[data-test=brand-warning-dark]"))).toBe(t("appearance.brand_warning_dark"));
    const tinted = deriveTheme({ ...LUCIA, brandColor: "#b12525", brandFix: {} }).warnings;
    expect(tinted.map((w) => [w.field, w.mode])).toEqual([["brandColor", "dark"]]);
    expect(text(q(el, "[data-test=brand-fix-dark]"))).toBe(`Use ${tinted[0]!.fix} on dark screens`);
    await chooseSegment(el, "background", "Neutral");
    expect(text(q(el, "[data-test=brand-fix-dark]"))).toBe("Use #cd423d on dark screens");
  });

  it("Fix all shows for two fixable warnings and fixes them", async () => {
    setLocale("en-GB");
    const rig = editRig(inUse(TWO_FIXES));
    const { el } = await mountWidget<Card>("dashboard-look-card", {
      api: rig.api,
      list: inUse(TWO_FIXES),
      canEdit: true,
    });
    const handRow = row(el, "hand");
    expect(handRow).toBe("Sunken areas (light), Text (light)");
    await userEvent.click(q(el, "[data-test=edit]")!);
    await el.updateComplete;
    expect(text(q(el, "[data-test=fix-all-line]"))).toBe("2 colours are hard to read.");
    expect(text(q(el, "[data-test=fix-all]"))).toBe(t("appearance.fix_all"));
    await userEvent.click(button(el, "fix-all"));
    await el.updateComplete;
    const fixed = fixAll(WAITRON_DEFAULTS, TWO_FIXES.choices!);
    expect(fixed.handSet.light).toEqual({ text: "#4a4a4a", "surface-sunken": "#bbbbbb" });
    expect(preview(el).theme).toEqual(deriveTheme(fixed));
    expect(q(el, "[data-test=fix-all-line]")).toBeNull();
    expect(button(el, "save").disabled).toBe(false);
    await userEvent.click(button(el, "cancel"));
    await el.updateComplete;
    expect(rig.api.saveTheme).not.toHaveBeenCalled();
    expect(row(el, "hand")).toBe(handRow);
  });

  it("shows no Fix all line for the lemon alone", async () => {
    const { el } = await lemonEditing();
    expect(q(el, "[data-test=brand-warning-light]")).not.toBeNull();
    expect(q(el, "[data-test=fix-all-line]")).toBeNull();
    expect(q(el, "[data-test=fix-all]")).toBeNull();
  });

  it("the warnings follow the screen language", async () => {
    setLocale("en-GB");
    const { el } = await lemonEditing();
    setLocale("es-ES");
    await el.updateComplete;
    expect(text(q(el, "[data-test=brand-warning-light]"))).toBe(
      es["appearance.brand_warning_light"],
    );
    expect(text(q(el, "[data-test=brand-fix-light]"))).toBe(
      es["appearance.brand_fix_light"].replace("{colour}", "#9d8a15"),
    );
  });

  it("the fixed line reads its colour, a dot, then Undo drawn as a link", async () => {
    setLocale("en-GB");
    const { el } = await lemonEditing();
    await userEvent.click(button(el, "brand-fix-light"));
    await el.updateComplete;
    const line = button(el, "brand-undo-light").closest("p")!;
    expect(text(line)).toBe("Buttons on light screens: #9d8a15 · Undo");
    const dot = line.querySelector("[data-test=brand-fixed-light] + *")!;
    expect(text(dot)).toBe("·");
    expect(dot.nextElementSibling).toBe(button(el, "brand-undo-light"));
  });

  it("Undo is a button drawn as a link", async () => {
    const { el } = await mountEditing(inUse(lucia));
    const undo = button(el, "brand-undo-dark");
    expect(undo.classList.contains("link")).toBe(true);
    const inner = undo.shadowRoot!.querySelector("button")!;
    expect(getComputedStyle(inner).textDecorationLine).toBe("underline");
  });
});

type HardToRead = HTMLElementTagNameMap["dashboard-hard-to-read-dialog"];
const hardToRead = (el: Card) => q(el, "dashboard-hard-to-read-dialog") as HardToRead;
const dialogOf = (el: Card) => hardToRead(el).shadowRoot!.querySelector("wt-dialog")!;
const dialogButton = (el: Card, name: string) =>
  hardToRead(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `[data-test=${name}]`,
  );
const dialogLines = (el: Card) =>
  [...hardToRead(el).shadowRoot!.querySelectorAll("li")].map((li) => text(li));
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const editing = (el: Card) => q(el, "section.settings-card")!.hasAttribute("data-editing");

describe("saving a draft that is hard to read", () => {
  async function lemonSave() {
    const opened = await mountEditing(inUse(lucia));
    await typeInCode(opened.el, "#f2d300");
    await userEvent.click(button(opened.el, "save"));
    await opened.el.updateComplete;
    await expect.poll(() => dialogOf(opened.el).open).toBe(true);
    return opened;
  }

  it("Save with a warning asks once, before any request", async () => {
    setLocale("en-GB");
    const { el, saveTheme } = await lemonSave();
    expect(dialogLines(el)).toEqual(["Brand colour: buttons are hard to see on light screens."]);
    expect(dialogButton(el, "fix-and-save")).not.toBeNull();
    expect(saveTheme).not.toHaveBeenCalled();
  });

  it("Back sends nothing and keeps the lemon", async () => {
    const { el, saveTheme } = await lemonSave();
    const closed = dialogClosed(dialogOf(el));
    await userEvent.click(dialogButton(el, "back")!);
    await closed;
    await el.updateComplete;
    expect(dialogOf(el).open).toBe(false);
    expect(hardToRead(el).open).toBe(false);
    expect(saveTheme).not.toHaveBeenCalled();
    expect(codeField(el).value).toBe("#f2d300");
    expect(editing(el)).toBe(true);
  });

  it("Escape is Back", async () => {
    const { el, saveTheme } = await lemonSave();
    const closed = dialogClosed(dialogOf(el));
    await userEvent.keyboard("{Escape}");
    await closed;
    await el.updateComplete;
    expect(dialogOf(el).open).toBe(false);
    expect(hardToRead(el).open).toBe(false);
    expect(saveTheme).not.toHaveBeenCalled();
    expect(codeField(el).value).toBe("#f2d300");
    expect(editing(el)).toBe(true);
  });

  it("Save anyway saves the lemon as it is", async () => {
    const { el, saveTheme } = await lemonSave();
    await userEvent.click(dialogButton(el, "save-anyway")!);
    await expect.poll(() => editing(el)).toBe(false);
    expect(saveTheme).toHaveBeenCalledTimes(1);
    expect(saveTheme.mock.calls[0]![1]).toEqual({
      ...LUCIA,
      brandColor: "#f2d300",
      brandFix: {},
    });
  });

  it("Fix and save saves the lemon with its light fix", async () => {
    const { el, saveTheme } = await lemonSave();
    await userEvent.click(dialogButton(el, "fix-and-save")!);
    await expect.poll(() => editing(el)).toBe(false);
    expect(saveTheme).toHaveBeenCalledTimes(1);
    expect(saveTheme.mock.calls[0]![1]).toEqual({
      ...LUCIA,
      brandColor: "#f2d300",
      brandFix: { light: true },
    });
  });

  it("a refused Fix and save keeps the fix in the draft", async () => {
    setLocale("en-GB");
    const { el, saveTheme } = await lemonSave();
    saveTheme.mockRejectedValueOnce({ code: "theme.not_found" });
    await userEvent.click(dialogButton(el, "fix-and-save")!);
    await expect.poll(() => bottom(el)).toBe(codeMessage("theme.not_found"));
    expect(editing(el)).toBe(true);
    expect(text(q(el, "[data-test=brand-fixed-light]"))).toBe("Buttons on light screens: #9d8a15");
    expect(button(el, "save").disabled).toBe(false);
  });

  it("no dialog with no warning", async () => {
    const { el, saveTheme } = await mountEditing(inUse(lucia));
    await chooseSegment(el, "corners", "Square");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    expect(hardToRead(el)?.open ?? false).toBe(false);
  });

  it("Fix and save is offered exactly when Fix all leaves no warning", async () => {
    setLocale("en-GB");
    const blocked = theme("t-hand", "By hand", {
      ...WAITRON_CHOICES,
      handSet: { light: { text: "#555555", "surface-sunken": "#555555" }, dark: {} },
    });
    const opened = await mountEditing(inUse(blocked));
    await chooseSegment(opened.el, "corners", "Square");
    await userEvent.click(button(opened.el, "save"));
    await expect.poll(() => dialogOf(opened.el).open).toBe(true);
    expect(dialogLines(opened.el)).toEqual([
      "Sunken areas (light) is hard to read.",
      "Text (light): no shade can be read while Sunken areas is set by hand to #555555.",
    ]);
    expect(dialogButton(opened.el, "fix-and-save")!.variant).toBe("primary");
    await userEvent.click(dialogButton(opened.el, "fix-and-save")!);
    await expect.poll(() => opened.saveTheme.mock.calls.length).toBe(1);
    const sent = opened.saveTheme.mock.calls[0]![1];
    expect(sent.handSet.light).toEqual({ text: "#555555", "surface-sunken": "#cacaca" });
    expect(sent).toEqual(
      normaliseChoices(fixAll(WAITRON_DEFAULTS, { ...blocked.choices!, corners: "square" })),
    );
    cleanupWidgets();

    const outlasts = theme("t-hand", "By hand", {
      ...WAITRON_CHOICES,
      handSet: { light: { text: "#aaaaaa", "surface-sunken": "#555555" }, dark: {} },
    });
    const { el } = await mountEditing(inUse(outlasts));
    await chooseSegment(el, "corners", "Square");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => dialogOf(el).open).toBe(true);
    expect(dialogButton(el, "fix-and-save")).toBeNull();
    expect(dialogButton(el, "save-anyway")!.variant).toBe("primary");
  });

  for (const choice of ["save-anyway", "fix-and-save"]) {
    it(`a double press of ${choice} saves once`, async () => {
      const { el, saveTheme } = await lemonSave();
      saveTheme.mockImplementation(() => new Promise(() => {}));
      const press = () =>
        hardToRead(el).dispatchEvent(
          new CustomEvent(`hard-to-read-${choice}`, { bubbles: true, composed: true }),
        );
      press();
      press();
      await el.updateComplete;
      expect(saveTheme).toHaveBeenCalledTimes(1);
    });
  }

  it("a double press of Save with no warning saves once", async () => {
    const { el, saveTheme } = await mountEditing(inUse(lucia));
    saveTheme.mockImplementation(() => new Promise(() => {}));
    await chooseSegment(el, "corners", "Square");
    button(el, "save").click();
    button(el, "save").click();
    await el.updateComplete;
    expect(saveTheme).toHaveBeenCalledTimes(1);
  });

  it("a quick second Save after a refused one opens a dialog that stays open", async () => {
    setLocale("en-GB");
    const { el, saveTheme } = await lemonSave();
    saveTheme.mockRejectedValueOnce({ code: "theme.not_found" });
    const firstClose = dialogClosed(dialogOf(el));
    dialogButton(el, "save-anyway")!.click();
    await expect.poll(() => saveTheme.mock.calls.length, { interval: 0 }).toBe(1);
    await el.updateComplete;
    await Promise.resolve();
    await el.updateComplete;
    button(el, "save").click();
    await el.updateComplete;
    await Promise.race([firstClose, frame().then(frame).then(frame)]);
    await frame();
    await el.updateComplete;
    expect(hardToRead(el).open).toBe(true);
    expect(dialogOf(el).open).toBe(true);
    expect(saveTheme).toHaveBeenCalledTimes(1);
  });
});

class LookLeaveHost extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  list!: ThemeList;
  canEdit = true;
  static override properties = { canEdit: { attribute: false } };
  override render() {
    return html`<dashboard-look-card
        .api=${this.api}
        .list=${this.list}
        .canEdit=${this.canEdit}
      ></dashboard-look-card>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("look-card-leave-host", LookLeaveHost);

describe("the editor's spacing and wrapping at phone and desk widths", () => {
  async function onDesk(run: () => Promise<void>): Promise<void> {
    const { innerWidth: width, innerHeight: height } = window;
    await page.viewport(1280, 900);
    try {
      await run();
    } finally {
      await page.viewport(width, height);
    }
  }
  async function resize(el: Card, cardWidth: number) {
    el.parentElement!.style.width = `${cardWidth}px`;
    await frame();
    await frame();
  }
  const rect = (node: Element) => node.getBoundingClientRect();

  for (const cardWidth of [358, 700, 1000]) {
    it(`leaves a space between the preview and the buttons in a ${cardWidth}px card`, async () => {
      await onDesk(async () => {
        setLocale("es-ES");
        const { el } = await mountEditing(inUse(lucia));
        await resize(el, cardWidth);
        const gap = rect(q(el, "wt-form-actions")!).top - rect(preview(el)).bottom;
        expect(gap).toBeGreaterThanOrEqual(16);
      });
    });
  }

  /** Where the fixed line's "·" is: drawn or not, and whether Undo shares the colour's line. */
  function dotOf(el: Card, mode: "light" | "dark") {
    const span = q(el, `[data-test=brand-fixed-${mode}]`)!;
    const dot = span.nextElementSibling!;
    const undo = button(el, `brand-undo-${mode}`);
    const words = document.createRange();
    words.selectNodeContents(span);
    const rects = words.getClientRects();
    const last = rects[rects.length - 1]!;
    const sameLine = (box: DOMRect) => {
      const middle = (box.top + box.bottom) / 2;
      return middle > last.top && middle < last.bottom;
    };
    const box = rect(dot);
    const hit = el.shadowRoot!.elementFromPoint(
      (box.left + box.right) / 2,
      (box.top + box.bottom) / 2,
    );
    return {
      drawn: hit === dot,
      dotOnColourLine: sameLine(box) && box.left >= last.right - 1,
      undoOnColourLine: sameLine(rect(undo)),
    };
  }

  for (const [locale, cardWidth] of [
    ["es-ES", 358],
    ["en-GB", 358],
    ["es-ES", 1000],
    ["en-GB", 1000],
  ] as const) {
    it(`draws the fixed line's "·" only beside Undo on the colour's line (${locale}, ${cardWidth}px)`, async () => {
      await onDesk(async () => {
        setLocale(locale);
        for (const mode of ["light", "dark"] as const) {
          const { el } = await fixedLine(mode);
          await resize(el, cardWidth);
          const found = dotOf(el, mode);
          const label = `${mode} ${JSON.stringify(found)}`;
          expect(found.drawn, label).toBe(found.undoOnColourLine);
          if (found.drawn) expect(found.dotOnColourLine, label).toBe(true);
          if (locale === "en-GB" && cardWidth === 1000) expect(found.drawn, label).toBe(true);
          cleanupWidgets();
        }
      });
    });
  }

  /** Bar Lucía opens with its dark fix taken; the lemon's light fix is taken here. */
  async function fixedLine(mode: "light" | "dark") {
    const opened = await mountEditing(inUse(lucia));
    if (mode === "light") {
      await typeInCode(opened.el, "#f2d300");
      await userEvent.click(button(opened.el, "brand-fix-light"));
      await opened.el.updateComplete;
    }
    return opened;
  }

  it("keeps the saved warning's icon its full size when the line wraps", async () => {
    await onDesk(async () => {
      setLocale("es-ES");
      const lemon = theme("t-lemon", "Lemon Café", { ...WAITRON_CHOICES, brandColor: "#f2d300" });
      const el = await mount(inUse(lemon));
      const line = q(el, "[data-test=saved-warning]")!;
      const icon = line.querySelector("wt-icon")!;
      await resize(el, 1000);
      const wide = rect(icon).width;
      await resize(el, 300);
      expect(rect(line).height).toBeGreaterThan(rect(icon).height * 1.5);
      expect(rect(icon).width).toBe(wide);
    });
  });
});
