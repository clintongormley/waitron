import { LitElement, html } from "lit";
import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeaveController } from "@waitron/ui";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { WAITRON_CHOICES, fixAll, type ThemeChoices } from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS, deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { es } from "../i18n/strings.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
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
