import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import {
  WAITRON_CHOICES,
  fixAll,
  normaliseChoices,
  readThemeDocument,
  type ThemeChoices,
} from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS, deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { advancedSummary, handNames, keptNote } from "../widgets/theme-words.js";
import "./look-card.js";

type Card = HTMLElementTagNameMap["dashboard-look-card"];
type Advanced = HTMLElementTagNameMap["dashboard-theme-advanced"];

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
  handSet: { light: {}, dark: {} },
};
const CHRISTMAS: ThemeChoices = {
  brandColor: "#7a1f2b",
  brandFix: { dark: true },
  background: "neutral",
  corners: "standard",
  handSet: { light: {}, dark: {} },
};
const lucia = theme("t-lucia", "Bar Lucía", LUCIA);
const christmas = theme("t-xmas", "Christmas", CHRISTMAS);
const LIST: ThemeList = { themes: [lucia, christmas], inUse: lucia.id };

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
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
  await userEvent.click(el.shadowRoot!.querySelector("[data-test=edit]")!);
  await el.updateComplete;
  return { el, saveTheme };
}

const q = (el: Card, selector: string) => el.shadowRoot!.querySelector(selector);
const advanced = (el: Card) => q(el, "dashboard-theme-advanced") as Advanced;
const disclosure = (el: Card) =>
  advanced(el).shadowRoot!.querySelector(
    "[data-test=advanced]",
  ) as HTMLElementTagNameMap["wt-disclosure"];
const handCode = (el: Card, mode: string, key: string) =>
  advanced(el).shadowRoot!.querySelector(
    `wt-input[name="handSet.${mode}.${key}"]`,
  ) as HTMLElementTagNameMap["wt-input"];
const picker = (el: Card, mode: string, key: string) =>
  advanced(el).shadowRoot!.querySelector(
    `input[type=color][name="handSetPicker.${mode}.${key}"]`,
  ) as HTMLInputElement;
const button = (el: Card, name: string) =>
  q(el, `[data-test=${name}]`) as HTMLElementTagNameMap["wt-button"];
const workedOut = (el: Card, mode: string, key: string) =>
  advanced(el).shadowRoot!.querySelector(
    `[data-test=hand-worked-out-${mode}-${key}]`,
  ) as HTMLElementTagNameMap["wt-button"];
const preview = (el: Card) =>
  q(el, "dashboard-theme-preview") as HTMLElementTagNameMap["dashboard-theme-preview"];
const bottom = async (el: Card) =>
  (
    await formMessageOf(q(el, "wt-form-actions") as HTMLElementTagNameMap["wt-form-actions"])
  )?.textContent?.trim() ?? "";
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

async function settle(el: Card) {
  await el.updateComplete;
  await advanced(el).updateComplete;
}

async function openAdvanced(el: Card) {
  const d = disclosure(el);
  await userEvent.click(d.shadowRoot!.querySelector("button.header")!);
  await d.updateComplete;
}

async function typeHand(el: Card, mode: string, key: string, value: string) {
  if (!disclosure(el).open) await openAdvanced(el);
  const inner = handCode(el, mode, key).shadowRoot!.querySelector("input")!;
  await page.elementLocator(inner).fill(value);
  await settle(el);
}

async function closeAdvanced(el: Card) {
  const d = disclosure(el);
  await userEvent.click(d.shadowRoot!.querySelector("button.header")!);
  await d.updateComplete;
  expect(d.open).toBe(false);
}

function focused(el: Card): Element | null {
  let at: Element | null = el.shadowRoot!.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  return at;
}

const CREAM: ThemeChoices = { ...LUCIA, handSet: { light: { bg: "#f8f1e1" }, dark: {} } };

describe("the Look card's Advanced section", () => {
  it("opens closed, and a typed code repaints the preview and is sent", async () => {
    const { el, saveTheme } = await mountEditing();
    expect(disclosure(el).open).toBe(false);
    expect(button(el, "save").variant).toBe("secondary");
    expect(button(el, "save").disabled).toBe(true);
    const darkBg = preview(el).theme.dark["--wt-color-bg"];

    await typeHand(el, "light", "bg", "#f8f1e1");
    expect(preview(el).theme.light["--wt-color-bg"]).toBe("#f8f1e1");
    expect(preview(el).theme.dark["--wt-color-bg"]).toBe(darkBg);
    expect(button(el, "save").variant).toBe("primary");
    expect(button(el, "save").disabled).toBe(false);
    expect(q(el, "wt-input[name=brandColor]")).not.toBeNull();
    expect((q(el, "wt-input[name=brandColor]") as HTMLElementTagNameMap["wt-input"]).value).toBe(
      "#1e5b3a",
    );

    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    expect(saveTheme).toHaveBeenCalledWith("t-lucia", CREAM);
  });

  it("a picked colour reaches the draft after one animation frame", async () => {
    const { el, saveTheme } = await mountEditing();
    await openAdvanced(el);
    const input = picker(el, "light", "bg");
    input.value = "#f8f1e1";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await nextFrame();
    await settle(el);
    expect(preview(el).theme.light["--wt-color-bg"]).toBe("#f8f1e1");
    expect(button(el, "save").variant).toBe("primary");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    expect(saveTheme).toHaveBeenCalledWith("t-lucia", CREAM);
  });

  it("Use worked-out colour takes the draft back to the opened one", async () => {
    const { el } = await mountEditing();
    await typeHand(el, "light", "bg", "#f8f1e1");
    expect(button(el, "save").disabled).toBe(false);
    await userEvent.click(workedOut(el, "light", "bg"));
    await settle(el);
    expect(button(el, "save").variant).toBe("secondary");
    expect(button(el, "save").disabled).toBe(true);
    expect(preview(el).theme.light["--wt-color-bg"]).toBe(lucia.light!["--wt-color-bg"]);
  });

  it("a half-typed code stops Save, opens Advanced and points at the field until it is fixed", async () => {
    const { el, saveTheme } = await mountEditing();
    await typeHand(el, "light", "bg", "#12");
    await closeAdvanced(el);
    expect(button(el, "save").disabled).toBe(false);
    await userEvent.click(button(el, "save"));
    await settle(el);
    expect(saveTheme).not.toHaveBeenCalled();
    await expect.poll(() => disclosure(el).open).toBe(true);
    expect(disclosure(el).hasAttribute("has-error")).toBe(true);
    expect(handCode(el, "light", "bg").error).toBe(t("appearance.bad_code"));
    expect(handCode(el, "dark", "bg").error).toBe("");
    expect(await bottom(el)).toBe(t("form.fix_fields"));
    const inner = handCode(el, "light", "bg").shadowRoot!.querySelector("input");
    await expect.poll(() => focused(el)).toBe(inner);
    expect(button(el, "save").disabled).toBe(true);
    expect(button(el, "save-as-new").disabled).toBe(true);

    await userEvent.click(workedOut(el, "light", "bg"));
    await settle(el);
    expect(handCode(el, "light", "bg").error).toBe("");
    expect(await bottom(el)).toBe("");
    expect(button(el, "save-as-new").disabled).toBe(false);
  });

  it("a code that turns valid after Save clears its message and enables Save", async () => {
    const { el } = await mountEditing();
    await typeHand(el, "light", "bg", "#12");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => handCode(el, "light", "bg").error).toBe(t("appearance.bad_code"));
    await typeHand(el, "light", "bg", "#123456");
    expect(handCode(el, "light", "bg").error).toBe("");
    expect(await bottom(el)).toBe("");
    expect(button(el, "save").disabled).toBe(false);
  });

  it("a refusal naming a hand-set value lands under it, and the next hand change clears it", async () => {
    const { el, saveTheme } = await mountEditing();
    await typeHand(el, "light", "bg", "#f8f1e1");
    saveTheme.mockRejectedValueOnce({
      code: "theme.invalid",
      params: { field: "handSet.light.bg", reason: "bad_value" },
    });
    await closeAdvanced(el);
    await userEvent.click(button(el, "save"));
    await expect.poll(() => handCode(el, "light", "bg").error).toBe(t("appearance.bad_code"));
    expect(disclosure(el).open).toBe(true);
    expect(await bottom(el)).toBe(t("form.fix_fields"));
    expect(button(el, "save").disabled).toBe(false);
    const inner = handCode(el, "light", "bg").shadowRoot!.querySelector("input");
    await expect.poll(() => focused(el)).toBe(inner);

    await typeHand(el, "dark", "text", "#eeeeee");
    expect(handCode(el, "light", "bg").error).toBe("");
    expect(await bottom(el)).toBe("");

    saveTheme.mockRejectedValueOnce({
      code: "theme.invalid",
      params: { field: "handSet.light", reason: "bad_value" },
    });
    await userEvent.click(button(el, "save"));
    await expect.poll(() => bottom(el)).toBe(codeMessage("theme.invalid"));
    expect(handCode(el, "light", "bg").error).toBe("");
    expect(button(el, "save").disabled).toBe(false);
    expect(saveTheme).toHaveBeenCalledTimes(2);
  });

  it("a newer read leaves a draft holding a half-typed code as it is", async () => {
    const { el } = await mountEditing();
    await typeHand(el, "light", "bg", "#12");
    const newer = theme("t-lucia", "Bar Lucía", { ...LUCIA, corners: "square" });
    el.list = { themes: [newer, christmas], inUse: lucia.id };
    await settle(el);
    expect(handCode(el, "light", "bg").value).toBe("#12");
    const corners = q(
      el,
      "wt-segmented-control[name=corners]",
    ) as HTMLElementTagNameMap["wt-segmented-control"];
    expect(corners.value).toBe("round");
  });

  it("editing another theme shows its Advanced closed, even one forced open by an error", async () => {
    const closedLine = advancedSummary(CHRISTMAS, deriveTheme(CHRISTMAS).warnings);
    const { el } = await mountEditing();
    await openAdvanced(el);
    expect(disclosure(el).open).toBe(true);
    el.edit({ id: christmas.id });
    await settle(el);
    expect(disclosure(el).open).toBe(false);
    expect(disclosure(el).summary).toBe(closedLine);

    el.edit({ id: lucia.id });
    await settle(el);
    await typeHand(el, "light", "bg", "#12");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => disclosure(el).hasAttribute("has-error")).toBe(true);
    el.edit({ id: christmas.id });
    await settle(el);
    expect(disclosure(el).open).toBe(false);
    expect(disclosure(el).hasAttribute("has-error")).toBe(false);
    expect(disclosure(el).summary).toBe(closedLine);
  });

  it("disables every code field while a save is under way", async () => {
    const { el, saveTheme } = await mountEditing();
    let release!: () => void;
    saveTheme.mockImplementationOnce(
      (id, choices) =>
        new Promise((resolve) => {
          release = () => resolve(theme(id, "Bar Lucía", choices));
        }),
    );
    await typeHand(el, "light", "bg", "#f8f1e1");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    await settle(el);
    const fields = [
      ...advanced(el).shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>(
        "wt-input[name^='handSet.']",
      ),
    ];
    expect(fields).toHaveLength(44);
    expect(fields.every((field) => field.disabled)).toBe(true);
    release();
  });

  it("a hand change that arrives while a save is under way changes nothing", async () => {
    const { el, saveTheme } = await mountEditing();
    let release!: () => void;
    saveTheme.mockImplementationOnce(
      (id, choices) =>
        new Promise((resolve) => {
          release = () => resolve(theme(id, "Bar Lucía", choices));
        }),
    );
    await typeHand(el, "light", "bg", "#f8f1e1");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    advanced(el).dispatchEvent(
      new CustomEvent("hand-change", {
        detail: { kind: "pick", mode: "light", key: "bg", colour: "#000000" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(el);
    expect(advanced(el).draft.choices).toEqual(CREAM);
    expect(advanced(el).fixed).toEqual({});
    release();
    await expect
      .poll(() => q(el, "section.settings-card")!.hasAttribute("data-editing"))
      .toBe(false);
    expect(saveTheme).toHaveBeenCalledTimes(1);
    expect(saveTheme).toHaveBeenCalledWith("t-lucia", CREAM);
  });

  it("keeps the section's errors while nothing they come from changes", async () => {
    const { el } = await mountEditing();
    await typeHand(el, "light", "bg", "#12");
    await userEvent.click(button(el, "save"));
    await expect.poll(() => handCode(el, "light", "bg").error).toBe(t("appearance.bad_code"));
    const errors = advanced(el).errors;
    const corners = q(
      el,
      "wt-segmented-control[name=corners]",
    ) as HTMLElementTagNameMap["wt-segmented-control"];
    const square = [...corners.shadowRoot!.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === t("appearance.corners.square"),
    )!;
    await userEvent.click(square);
    await settle(el);
    expect(corners.value).toBe("square");
    expect(advanced(el).errors).toBe(errors);
  });

  describe("Save with a picked colour still waiting for its frame", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("sends the picked colour first", async () => {
      const { el, saveTheme } = await mountEditing();
      await typeHand(el, "dark", "text", "#eeeeee");
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
      const input = picker(el, "light", "bg");
      input.value = "#f8f1e1";
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      expect(frames).toHaveLength(1);
      await userEvent.click(button(el, "save"));
      await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
      expect(saveTheme.mock.calls[0]![1].handSet).toEqual({
        light: { bg: "#f8f1e1" },
        dark: { text: "#eeeeee" },
      });
    });

    it("asks about a colour hard to read that the waiting pick brings", async () => {
      const { el, saveTheme } = await mountEditing();
      await typeHand(el, "dark", "text", "#eeeeee");
      expect(advanced(el).derived.warnings).toEqual([]);
      vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
      const input = picker(el, "light", "text");
      input.value = "#ffffff";
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await userEvent.click(button(el, "save"));
      await el.updateComplete;
      expect(saveTheme).not.toHaveBeenCalled();
      const dialog = q(el, "dashboard-hard-to-read-dialog")!;
      await expect.poll(() => dialog.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
      expect(advanced(el).draft.choices.handSet.light).toEqual({ text: "#ffffff" });
    });
  });
});

const words = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const inAdvanced = (el: Card, name: string) =>
  advanced(el).shadowRoot!.querySelector(`[data-test=${name}]`);

function mountChoices(choices: ThemeChoices) {
  const view = theme("t-hand", "By hand", choices);
  return mountEditing({ themes: [view], inUse: view.id });
}

async function press(el: Card, name: string) {
  const target = inAdvanced(el, name) ?? q(el, `[data-test=${name}]`);
  expect(target, name).not.toBeNull();
  await userEvent.click(target!);
  await settle(el);
}

const CREAM_SAGE: ThemeChoices = {
  ...LUCIA,
  handSet: { light: { bg: "#f8f1e1", "text-muted": "#8fa898" }, dark: {} },
};
const BLOCKED: ThemeChoices = {
  ...WAITRON_CHOICES,
  handSet: { light: { text: "#555555", "surface-sunken": "#555555" }, dark: {} },
};
const TWO_FIXES: ThemeChoices = {
  ...WAITRON_CHOICES,
  handSet: { light: { text: "#6a6a6a", "surface-sunken": "#bbbbbb" }, dark: {} },
};

describe("fixes and Undo in Advanced", () => {
  it("a row's fix records where it came from, Undo puts it back, and Cancel sends nothing", async () => {
    const { el, saveTheme } = await mountChoices(CREAM_SAGE);
    await openAdvanced(el);
    await press(el, "hand-fix-light-text-muted");
    expect(handCode(el, "light", "text-muted").value).toBe("#526a5b");
    expect(words(inAdvanced(el, "hand-fixed-light-text-muted"))).toBe(
      "Light screens: fixed from #8fa898",
    );
    expect(button(el, "save").disabled).toBe(false);
    await press(el, "hand-undo-light-text-muted");
    expect(handCode(el, "light", "text-muted").value).toBe("#8fa898");
    expect(inAdvanced(el, "hand-warning-light-text-muted")).not.toBeNull();
    expect(inAdvanced(el, "hand-fixed-light-text-muted")).toBeNull();
    await userEvent.click(button(el, "cancel"));
    await el.updateComplete;
    expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(false);
    expect(saveTheme).not.toHaveBeenCalled();
  });

  it("fixing the blocking colour changes only it, and Undo brings both warnings back", async () => {
    const { el } = await mountChoices(BLOCKED);
    await openAdvanced(el);
    expect(q(el, "[data-test=fix-all]")).toBeNull();
    expect(words(inAdvanced(el, "hand-fix-light-surface-sunken"))).toBe("Use #cacaca");
    await press(el, "hand-fix-light-surface-sunken");
    expect(handCode(el, "light", "surface-sunken").value).toBe("#cacaca");
    expect(words(inAdvanced(el, "hand-fixed-light-surface-sunken"))).toBe(
      "Light screens: fixed from #555555",
    );
    expect(handCode(el, "light", "text").value).toBe("#555555");
    expect(inAdvanced(el, "hand-warning-light-text")).toBeNull();
    await press(el, "hand-undo-light-surface-sunken");
    expect(handCode(el, "light", "surface-sunken").value).toBe("#555555");
    expect(inAdvanced(el, "hand-warning-light-text")).not.toBeNull();
    expect(inAdvanced(el, "hand-warning-light-surface-sunken")).not.toBeNull();
  });

  it("Fix all records only the values it changed", async () => {
    const { el } = await mountChoices(TWO_FIXES);
    await openAdvanced(el);
    expect(q(el, "[data-test=fix-all]")).not.toBeNull();
    await press(el, "fix-all");
    const fixed = fixAll(WAITRON_DEFAULTS, TWO_FIXES);
    expect(advanced(el).draft.choices).toEqual(fixed);
    expect(fixed.handSet.light).toEqual({ text: "#4a4a4a", "surface-sunken": "#bbbbbb" });
    expect(words(inAdvanced(el, "hand-fixed-light-text"))).toBe(
      "Light screens: fixed from #6a6a6a",
    );
    expect(inAdvanced(el, "hand-fixed-light-surface-sunken")).toBeNull();
    expect(advanced(el).derived.warnings).toEqual([]);
    expect(inAdvanced(el, "hand-warning-light-text")).toBeNull();
    await press(el, "hand-undo-light-text");
    expect(handCode(el, "light", "text").value).toBe("#6a6a6a");
    expect(inAdvanced(el, "hand-warning-light-text")).not.toBeNull();
    expect(inAdvanced(el, "hand-warning-light-surface-sunken")).not.toBeNull();
  });

  it("a fix's record goes once the value is changed by hand, so Fix all records the new value", async () => {
    const { el } = await mountChoices(TWO_FIXES);
    await openAdvanced(el);
    await press(el, "hand-fix-light-text");
    expect(words(inAdvanced(el, "hand-fixed-light-text"))).toBe(
      "Light screens: fixed from #6a6a6a",
    );
    await typeHand(el, "light", "text", "#6b6b6b");
    expect(inAdvanced(el, "hand-fixed-light-text")).toBeNull();
    await press(el, "fix-all");
    expect(words(inAdvanced(el, "hand-fixed-light-text"))).toBe(
      "Light screens: fixed from #6b6b6b",
    );
    await press(el, "hand-undo-light-text");
    expect(handCode(el, "light", "text").value).toBe("#6b6b6b");
  });

  it("setting the fixed shade again by hand brings back no fixed line", async () => {
    const { el } = await mountChoices(CREAM_SAGE);
    await openAdvanced(el);
    await press(el, "hand-fix-light-text-muted");
    await typeHand(el, "light", "text-muted", "#8fa898");
    expect(inAdvanced(el, "hand-fixed-light-text-muted")).toBeNull();
    await typeHand(el, "light", "text-muted", "#526a5b");
    expect(handCode(el, "light", "text-muted").value).toBe("#526a5b");
    expect(inAdvanced(el, "hand-fixed-light-text-muted")).toBeNull();
    expect(inAdvanced(el, "hand-undo-light-text-muted")).toBeNull();
  });

  it("a fixed value picked away and back with the colour picker brings back no fixed line", async () => {
    const { el } = await mountChoices(CREAM_SAGE);
    await openAdvanced(el);
    await press(el, "hand-fix-light-text-muted");
    expect(inAdvanced(el, "hand-fixed-light-text-muted")).not.toBeNull();
    for (const colour of ["#8fa898", "#526a5b"]) {
      const input = picker(el, "light", "text-muted");
      input.value = colour;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await nextFrame();
      await settle(el);
    }
    expect(handCode(el, "light", "text-muted").value).toBe("#526a5b");
    expect(inAdvanced(el, "hand-fixed-light-text-muted")).toBeNull();
    expect(inAdvanced(el, "hand-undo-light-text-muted")).toBeNull();
  });

  it("a fix's record goes with Use worked-out colour, so Fix all records the value set after", async () => {
    const { el } = await mountChoices(TWO_FIXES);
    await openAdvanced(el);
    await press(el, "hand-fix-light-text");
    expect(advanced(el).fixed).toEqual({
      "handSet.light.text": { from: "#6a6a6a", to: "#4a4a4a" },
    });
    await press(el, "hand-worked-out-light-text");
    expect(advanced(el).draft.choices.handSet.light.text).toBeUndefined();
    expect(advanced(el).fixed).toEqual({});
    await typeHand(el, "light", "text", "#6b6b6b");
    await press(el, "fix-all");
    expect(words(inAdvanced(el, "hand-fixed-light-text"))).toBe(
      "Light screens: fixed from #6b6b6b",
    );
  });

  it("a fix taken back by Use worked-out colour shows no fixed line when a newer read sets its shade", async () => {
    const sunken: ThemeChoices = {
      ...WAITRON_CHOICES,
      handSet: { light: { "surface-sunken": "#bbbbbb" }, dark: {} },
    };
    const { el } = await mountChoices(sunken);
    await typeHand(el, "light", "text", "#6a6a6a");
    await press(el, "hand-fix-light-text");
    expect(handCode(el, "light", "text").value).toBe("#4a4a4a");
    await press(el, "hand-worked-out-light-text");
    expect(button(el, "save").disabled).toBe(true);
    const newer = theme("t-hand", "By hand", {
      ...sunken,
      handSet: { light: { ...sunken.handSet.light, text: "#4a4a4a" }, dark: {} },
    });
    el.list = { themes: [newer], inUse: newer.id };
    await settle(el);
    expect(advanced(el).draft.choices.handSet.light.text).toBe("#4a4a4a");
    expect(inAdvanced(el, "hand-fixed-light-text")).toBeNull();
    expect(inAdvanced(el, "hand-undo-light-text")).toBeNull();
  });

  it("Fix all clears a refusal shown under a colour", async () => {
    const { el, saveTheme } = await mountChoices(TWO_FIXES);
    await typeHand(el, "light", "bg", "#fafafa");
    saveTheme.mockRejectedValueOnce({
      code: "theme.invalid",
      params: { field: "handSet.light.bg", reason: "bad_value" },
    });
    await userEvent.click(button(el, "save"));
    const dialog = q(el, "dashboard-hard-to-read-dialog")!;
    const anyway = () =>
      dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "[data-test=save-anyway]",
      );
    await expect.poll(() => dialog.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
    await userEvent.click(anyway()!);
    await expect.poll(() => handCode(el, "light", "bg").error).toBe(t("appearance.bad_code"));
    await press(el, "fix-all");
    expect(handCode(el, "light", "bg").error).toBe("");
    expect(await bottom(el)).toBe("");
  });

  it("Fix and save sends Fix all's choices and closes the editor", async () => {
    const { el, saveTheme } = await mountChoices(CREAM_SAGE);
    const corners = q(
      el,
      "wt-segmented-control[name=corners]",
    ) as HTMLElementTagNameMap["wt-segmented-control"];
    await userEvent.click(
      [...corners.shadowRoot!.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === t("appearance.corners.square"),
      )!,
    );
    await settle(el);
    await userEvent.click(button(el, "save"));
    const dialog = q(el, "dashboard-hard-to-read-dialog")!;
    const fixAndSave = () =>
      dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "[data-test=fix-and-save]",
      );
    await expect.poll(() => fixAndSave()).not.toBeNull();
    await userEvent.click(fixAndSave()!);
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    expect(saveTheme.mock.calls[0]![1]).toEqual(
      normaliseChoices(fixAll(WAITRON_DEFAULTS, { ...CREAM_SAGE, corners: "square" })),
    );
    await expect
      .poll(() => q(el, "section.settings-card")!.hasAttribute("data-editing"))
      .toBe(false);
  });
});

describe("the kept-colours note", () => {
  it("shows after the brand colour changes while a colour is set by hand, until none is", async () => {
    const { el } = await mountChoices(CREAM);
    expect(q(el, "[data-test=kept-note]")).toBeNull();
    await userEvent.click(q(el, 'button.swatch[data-color="#b12525"]')!);
    await settle(el);
    expect(words(q(el, "[data-test=kept-note]"))).toBe(keptNote(advanced(el).draft.choices));
    expect(words(q(el, "[data-test=kept-note]"))).not.toBe("");
    await openAdvanced(el);
    await press(el, "hand-worked-out-light-bg");
    expect(q(el, "[data-test=kept-note]")).toBeNull();
  });

  it("does not come back once no colour is set by hand", async () => {
    const { el } = await mountChoices(CREAM);
    await userEvent.click(q(el, 'button.swatch[data-color="#b12525"]')!);
    await settle(el);
    expect(q(el, "[data-test=kept-note]")).not.toBeNull();
    await openAdvanced(el);
    await press(el, "hand-worked-out-light-bg");
    expect(q(el, "[data-test=kept-note]")).toBeNull();
    await typeHand(el, "light", "text", "#333333");
    expect(q(el, "[data-test=kept-note]")).toBeNull();
  });

  it("corners alone raise no note", async () => {
    const { el } = await mountChoices(CREAM);
    const corners = q(
      el,
      "wt-segmented-control[name=corners]",
    ) as HTMLElementTagNameMap["wt-segmented-control"];
    await userEvent.click(
      [...corners.shadowRoot!.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === t("appearance.corners.square"),
      )!,
    );
    await settle(el);
    expect(corners.value).toBe("square");
    expect(q(el, "[data-test=kept-note]")).toBeNull();
  });
});

describe("putting every colour back", () => {
  function noneSetByHand(el: Card) {
    expect(advanced(el).draft.choices.handSet).toEqual({ light: {}, dark: {} });
    expect(advanced(el).draft.handCodes).toEqual({ light: {}, dark: {} });
    expect(advanced(el).shadowRoot!.querySelector(".tag")).toBeNull();
    expect(advanced(el).shadowRoot!.querySelector("[data-test^=hand-fixed-]")).toBeNull();
  }

  it("Use Waitron's look clears colours, fixed lines, the kept note and a refusal", async () => {
    const { el, saveTheme } = await mountChoices(CREAM_SAGE);
    await openAdvanced(el);
    await press(el, "hand-fix-light-text-muted");
    saveTheme.mockRejectedValueOnce({
      code: "theme.invalid",
      params: { field: "handSet.light.bg", reason: "bad_value" },
    });
    await userEvent.click(button(el, "save"));
    await expect.poll(() => handCode(el, "light", "bg").error).toBe(t("appearance.bad_code"));
    await userEvent.click(q(el, 'button.swatch[data-color="#b12525"]')!);
    await settle(el);
    expect(q(el, "[data-test=kept-note]")).not.toBeNull();
    expect(inAdvanced(el, "hand-fixed-light-text-muted")).not.toBeNull();
    expect(handCode(el, "light", "bg").error).toBe(t("appearance.bad_code"));

    await userEvent.click(button(el, "use-waitron"));
    await settle(el);
    noneSetByHand(el);
    expect(q(el, "[data-test=kept-note]")).toBeNull();
    expect(handCode(el, "light", "bg").error).toBe("");
    expect(await bottom(el)).toBe("");
    expect(button(el, "use-waitron").disabled).toBe(true);
    expect(disclosure(el).summary).toBe(t("appearance.advanced_none"));
  });

  it("Use Waitron's look drops a half-typed code", async () => {
    const { el } = await mountChoices(CREAM);
    await typeHand(el, "dark", "bg", "#12");
    expect(handCode(el, "dark", "bg").value).toBe("#12");
    await userEvent.click(button(el, "use-waitron"));
    await settle(el);
    noneSetByHand(el);
    expect(handCode(el, "dark", "bg").value).not.toBe("#12");
    expect(button(el, "use-waitron").disabled).toBe(true);
  });

  it("Reset all puts every value back to worked out, and Cancel sends nothing", async () => {
    const { el, saveTheme } = await mountChoices(CREAM_SAGE);
    await openAdvanced(el);
    await press(el, "hand-fix-light-text-muted");
    await press(el, "reset-all");
    noneSetByHand(el);
    await userEvent.click(button(el, "cancel"));
    await el.updateComplete;
    expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(false);
    expect(saveTheme).not.toHaveBeenCalled();
    expect(words(q(el, "[data-test=saved-hand]"))).toBe(handNames(CREAM_SAGE).join(", "));
  });
});

describe("the dark version's own button colour", () => {
  async function typeBrand(el: Card, value: string) {
    const inner = q(el, "wt-input[name=brandColor]")!.shadowRoot!.querySelector("input")!;
    await page.elementLocator(inner).fill(value);
    await settle(el);
  }

  async function darkOwn(colour = "#5fa77a") {
    const opened = await mountEditing();
    await typeHand(opened.el, "dark", "primary", colour);
    return opened;
  }

  it("Pick a different colour for dark screens opens Advanced at the dark Main buttons code, changing nothing", async () => {
    const { el } = await mountEditing();
    const fixedLine = q(el, "[data-test=brand-fixed-dark]")!;
    expect(words(fixedLine)).toBe("Buttons on dark screens: #437e5b");
    const link = button(el, "pick-dark");
    expect(words(link)).toBe("Pick a different colour for dark screens");
    expect(fixedLine.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(q(el, "[data-test=dark-own]")).toBeNull();
    expect(disclosure(el).open).toBe(false);

    await userEvent.click(link);
    await settle(el);
    expect(disclosure(el).open).toBe(true);
    const inner = handCode(el, "dark", "primary").shadowRoot!.querySelector("input");
    await expect.poll(() => focused(el)).toBe(inner);
    expect(button(el, "save").variant).toBe("secondary");
    expect(button(el, "save").disabled).toBe(true);
  });

  it("a dark Main buttons colour set by hand paints dark screens only and is sent without the fix", async () => {
    const { el, saveTheme } = await darkOwn();
    expect(preview(el).theme.dark["--wt-color-primary"]).toBe("#5fa77a");
    expect(preview(el).theme.dark["--wt-color-primary-hover"]).toBe("#72ba8c");
    expect(preview(el).theme.light["--wt-color-primary"]).toBe("#1e5b3a");
    expect(q(el, "[data-test=brand-fixed-dark]")).toBeNull();
    expect(q(el, "[data-test=pick-dark]")).toBeNull();
    const own = q(el, "[data-test=dark-own]")!;
    expect(words(own)).toBe("Buttons on dark screens: #5fa77a, set by hand");
    expect(words(own.nextElementSibling)).toBe("·");
    expect(own.nextElementSibling!.nextElementSibling).toBe(button(el, "use-brand"));
    expect(words(button(el, "use-brand"))).toBe("Use the brand colour");

    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    const sent = saveTheme.mock.calls[0]![1];
    expect(sent.brandFix).toEqual({});
    expect(sent.handSet.dark.primary).toBe("#5fa77a");
    expect(readThemeDocument(sent).ok).toBe(true);
  });

  it("Use the brand colour works dark Main buttons out again and offers the fix without taking it", async () => {
    const { el } = await darkOwn();
    await userEvent.click(button(el, "use-brand"));
    await settle(el);
    expect(advanced(el).draft.choices.handSet.dark.primary).toBeUndefined();
    expect(advanced(el).draft.choices.brandFix).toEqual({});
    expect(q(el, "[data-test=brand-warning-dark]")).not.toBeNull();
    expect(words(q(el, "[data-test=brand-fix-dark]"))).toBe("Use #437e5b on dark screens");
    expect(q(el, "[data-test=dark-own]")).toBeNull();
    expect(q(el, "[data-test=pick-dark]")).not.toBeNull();
  });

  it("the brand colour changed away and back keeps the fix out while dark Main buttons are set by hand", async () => {
    const { el, saveTheme } = await darkOwn();
    await userEvent.click(q(el, 'button.swatch[data-color="#b12525"]')!);
    await settle(el);
    await typeBrand(el, "#1e5b3a");
    expect(advanced(el).draft.choices.brandColor).toBe("#1e5b3a");
    expect(advanced(el).draft.choices.brandFix).toEqual({});
    expect(q(el, "[data-test=brand-fixed-dark]")).toBeNull();
    expect(q(el, "[data-test=brand-undo-dark]")).toBeNull();

    await userEvent.click(button(el, "save"));
    await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
    const sent = saveTheme.mock.calls[0]![1];
    expect(sent.brandFix).toEqual({});
    expect(sent.handSet.dark.primary).toBe("#5fa77a");
    expect(readThemeDocument(sent).ok).toBe(true);
  });

  it("a readable dark Main buttons code warns of nothing, and its worked-out colour warns with the fix", async () => {
    const { el } = await darkOwn("#5a9c74");
    expect(preview(el).theme.dark["--wt-color-primary"]).toBe("#5a9c74");
    expect(advanced(el).derived.warnings).toEqual([]);
    expect(q(el, "[data-test=brand-warning-dark]")).toBeNull();
    expect(inAdvanced(el, "hand-warning-dark-primary")).toBeNull();

    await press(el, "hand-worked-out-dark-primary");
    expect(preview(el).theme.dark["--wt-color-primary"]).toBe("#1e5b3a");
    expect(q(el, "[data-test=brand-warning-dark]")).not.toBeNull();
    expect(words(q(el, "[data-test=brand-fix-dark]"))).toBe("Use #437e5b on dark screens");
  });

  for (const [colour, link] of [
    [undefined, "pick-dark"],
    ["#5fa77a", "use-brand"],
  ] as const) {
    it(`disables ${link} while a save is under way`, async () => {
      const { el, saveTheme } = await mountEditing();
      let release!: () => void;
      saveTheme.mockImplementationOnce(
        (id, choices) =>
          new Promise((resolve) => {
            release = () => resolve(theme(id, "Bar Lucía", choices));
          }),
      );
      if (colour === undefined) await typeHand(el, "light", "bg", "#f8f1e1");
      else await typeHand(el, "dark", "primary", colour);
      expect(button(el, link).disabled).toBe(false);
      await userEvent.click(button(el, "save"));
      await expect.poll(() => saveTheme.mock.calls.length).toBe(1);
      await settle(el);
      expect(button(el, link).disabled).toBe(true);
      release();
    });
  }
});
