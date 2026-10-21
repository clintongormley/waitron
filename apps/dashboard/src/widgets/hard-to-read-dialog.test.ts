import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "./test-helpers.js";
import "./hard-to-read-dialog.js";

type Dialog = HTMLElementTagNameMap["dashboard-hard-to-read-dialog"];

const LINES = [
  "Brand colour: buttons are hard to see on light screens.",
  "Sunken areas (light) is hard to read.",
];

const inner = (el: Dialog) => el.shadowRoot!.querySelector("wt-dialog")!;
const button = (el: Dialog, name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${name}]`);
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function mount(canFix: boolean) {
  setLocale("en-GB");
  const { el } = await mountWidget<Dialog>("dashboard-hard-to-read-dialog", {
    open: true,
    lines: LINES,
    canFix,
  });
  const heard = { back: vi.fn(), anyway: vi.fn(), fix: vi.fn() };
  el.addEventListener("hard-to-read-back", heard.back);
  el.addEventListener("hard-to-read-save-anyway", heard.anyway);
  el.addEventListener("hard-to-read-fix-and-save", heard.fix);
  return { el, heard };
}

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

describe("the Hard to read dialog", () => {
  it("lists each line under its heading, and offers Fix and save as the main button", async () => {
    const { el } = await mount(true);
    expect(inner(el).open).toBe(true);
    expect(inner(el).heading).toBe(t("appearance.dialog_heading"));
    const items = [...el.shadowRoot!.querySelectorAll("wt-dialog ul > li")];
    expect(items.map((item) => item.textContent?.trim())).toEqual(LINES);
    expect(button(el, "back")!.slot).toBe("cancel");
    expect(button(el, "back")!.textContent?.trim()).toBe(t("action.back"));
    expect(button(el, "save-anyway")!.slot).toBe("secondary");
    expect(button(el, "save-anyway")!.variant).toBe("secondary");
    expect(button(el, "save-anyway")!.textContent?.trim()).toBe(t("appearance.save_anyway"));
    expect(button(el, "fix-and-save")!.variant).toBe("primary");
    expect(button(el, "fix-and-save")!.slot).toBe("");
    expect(button(el, "fix-and-save")!.textContent?.trim()).toBe(t("appearance.fix_and_save"));
  });

  it("without Fix and save, Save anyway is the main button", async () => {
    const { el } = await mount(false);
    expect(button(el, "fix-and-save")).toBeNull();
    expect(button(el, "save-anyway")!.variant).toBe("primary");
    expect(button(el, "save-anyway")!.slot).toBe("");
    expect(button(el, "back")).not.toBeNull();
  });

  it("Escape is Back", async () => {
    const { el, heard } = await mount(true);
    const closed = dialogClosed(inner(el));
    await userEvent.keyboard("{Escape}");
    await closed;
    expect(heard.back).toHaveBeenCalledTimes(1);
    expect(heard.anyway).not.toHaveBeenCalled();
    expect(heard.fix).not.toHaveBeenCalled();
  });

  it("Back sends one hard-to-read-back", async () => {
    const { el, heard } = await mount(true);
    await userEvent.click(button(el, "back")!);
    expect(heard.back).toHaveBeenCalledTimes(1);
    expect(heard.anyway).not.toHaveBeenCalled();
    expect(heard.fix).not.toHaveBeenCalled();
  });

  for (const [name, event] of [
    ["save-anyway", "anyway"],
    ["fix-and-save", "fix"],
  ] as const) {
    it(`${name} sends its event once, closes the dialog and sends no Back`, async () => {
      const { el, heard } = await mount(true);
      const sent = vi.fn();
      el.addEventListener(`hard-to-read-${name}`, (e) => sent(e.bubbles, e.composed));
      const closed = dialogClosed(inner(el));
      await userEvent.click(button(el, name)!);
      expect(heard[event]).toHaveBeenCalledTimes(1);
      expect(sent).toHaveBeenCalledWith(true, true);
      await closed;
      await frame();
      expect(heard.back).not.toHaveBeenCalled();
      expect(heard[event]).toHaveBeenCalledTimes(1);
    });
  }

  it("reopened before the closing report lands, it still treats Escape as Back", async () => {
    const { el, heard } = await mount(true);
    button(el, "save-anyway")!.click();
    await el.updateComplete;
    await inner(el).updateComplete;
    expect(inner(el).open).toBe(false);
    el.open = true;
    await el.updateComplete;
    await frame();
    await frame();
    expect(inner(el).open).toBe(true);
    const closed = dialogClosed(inner(el));
    await userEvent.keyboard("{Escape}");
    await closed;
    expect(heard.back).toHaveBeenCalledTimes(1);
  });
});
