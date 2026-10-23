import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { type ThemeChoices } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import type { DashboardApi, ThemeList, ThemeView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { advancedSummary } from "../widgets/theme-words.js";
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

async function mountEditing() {
  const saveTheme = vi.fn(async (id: string, choices: ThemeChoices) =>
    theme(id, LIST.themes.find((view) => view.id === id)!.name, choices),
  );
  const { el } = await mountWidget<Card>("dashboard-look-card", {
    api: { saveTheme } as unknown as DashboardApi,
    list: LIST,
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
});
