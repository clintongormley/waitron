import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WtButton, WtDialog } from "@waitron/ui";
import { WAITRON_CHOICES } from "@waitron/ui-core/theme";
import { es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  dialogClosed,
  expectMessageAboveButtons,
  mountWidget,
} from "./test-helpers.js";
import { saveDialogLine } from "./theme-words.js";
import type { ThemeSwitchDialog } from "./theme-switch-dialog.js";
import "./theme-switch-dialog.js";

beforeEach(() => setLocale("en-GB"));

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function mount(props: Partial<ThemeSwitchDialog> = {}) {
  const { el } = await mountWidget<ThemeSwitchDialog>("dashboard-theme-switch-dialog", {
    open: true,
    name: "Christmas",
    ...props,
  });
  const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
  await expect.poll(() => dialog.open).toBe(true);
  const heard = { confirm: vi.fn(), back: vi.fn() };
  el.addEventListener("theme-switch-confirm", (e) => heard.confirm(e.bubbles, e.composed));
  el.addEventListener("theme-switch-back", (e) => heard.back(e.bubbles, e.composed));
  return { el, dialog, heard };
}

const use = (dialog: WtDialog) => dialog.querySelector<WtButton>("[data-test=switch-use]")!;
const back = (dialog: WtDialog) => dialog.querySelector<WtButton>("[data-test=switch-back]")!;
const paragraphs = (dialog: WtDialog) =>
  [...dialog.querySelectorAll("p")].map((p) => p.textContent?.trim());
const items = (dialog: WtDialog) =>
  [...dialog.querySelectorAll("li")].map((li) => li.textContent?.trim());

const brandDark = () =>
  saveDialogLine(
    { field: "brandColor", mode: "dark", against: ["bg"], fix: "#9fb8ff", blockedBy: [] },
    WAITRON_CHOICES,
  );

describe("the switch dialog", () => {
  it("asks to use the theme on every screen and says what changes", async () => {
    const { dialog } = await mount();
    expect(dialog.heading).toBe("Use Christmas on every screen?");
    expect(paragraphs(dialog)).toEqual([
      "Every dashboard changes now, and every signed-in till within 15 seconds.",
    ]);
    expect(items(dialog)).toEqual([]);
    expect(back(dialog).textContent?.trim()).toBe("Back");
    expect(back(dialog).slot).toBe("cancel");
    expect(use(dialog).textContent?.trim()).toBe("Use it");
    expect(use(dialog).variant).toBe("primary");
    expect(use(dialog).disabled).toBe(false);
  });

  it("lists the theme's warnings under Hard to read", async () => {
    const line = brandDark();
    expect(line).toBe("Brand colour: buttons are hard to see on dark screens.");
    const { dialog } = await mount({ name: "Summer terrace", lines: [line] });
    expect(dialog.heading).toBe("Use Summer terrace on every screen?");
    expect(paragraphs(dialog)).toEqual([
      "Every dashboard changes now, and every signed-in till within 15 seconds.",
      "Hard to read:",
    ]);
    expect(items(dialog)).toEqual(["Brand colour: buttons are hard to see on dark screens."]);
  });

  it("Use it sends theme-switch-confirm once, however often it is pressed", async () => {
    const { dialog, heard } = await mount();
    use(dialog).click();
    use(dialog).click();
    expect(heard.confirm).toHaveBeenCalledTimes(1);
    expect(heard.confirm).toHaveBeenCalledWith(true, true);
    expect(heard.back).not.toHaveBeenCalled();
  });

  it("Escape is Back", async () => {
    const { el, dialog, heard } = await mount();
    const closed = dialogClosed(dialog);
    await userEvent.keyboard("{Escape}");
    await closed;
    expect(heard.back).toHaveBeenCalledTimes(1);
    expect(heard.back).toHaveBeenCalledWith(true, true);
    expect(heard.confirm).not.toHaveBeenCalled();
    expect(el.open).toBe(false);
  });

  it("Back sends one theme-switch-back", async () => {
    const { dialog, heard } = await mount();
    const closed = dialogClosed(dialog);
    await userEvent.click(back(dialog));
    await closed;
    await frame();
    expect(heard.back).toHaveBeenCalledTimes(1);
    expect(heard.confirm).not.toHaveBeenCalled();
  });

  it("Use it sends no Back when the screen closes the dialog after it", async () => {
    const { el, dialog, heard } = await mount();
    el.addEventListener("theme-switch-confirm", () => {
      el.open = false;
    });
    const closed = dialogClosed(dialog);
    await userEvent.click(use(dialog));
    await closed;
    await frame();
    expect(heard.confirm).toHaveBeenCalledTimes(1);
    expect(heard.back).not.toHaveBeenCalled();
  });

  it("while busy, Use it is disabled and loading and Back does nothing", async () => {
    const { el, dialog, heard } = await mount({ busy: true });
    expect(use(dialog).disabled).toBe(true);
    expect(use(dialog).loading).toBe(true);
    expect(dialog.dismissible).toBe(false);
    use(dialog).click();
    back(dialog).click();
    await el.updateComplete;
    await frame();
    expect(heard.confirm).not.toHaveBeenCalled();
    expect(heard.back).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it("shows a refusal at the bottom with Use it enabled, and Use it can be pressed again", async () => {
    const { el, dialog, heard } = await mount();
    use(dialog).click();
    el.busy = true;
    await el.updateComplete;
    el.busy = false;
    el.error = "This theme no longer exists.";
    await el.updateComplete;
    await expectMessageAboveButtons(dialog, use(dialog), "This theme no longer exists.");
    expect(use(dialog).disabled).toBe(false);
    expect(use(dialog).loading).toBe(false);
    expect(dialog.open).toBe(true);
    use(dialog).click();
    expect(heard.confirm).toHaveBeenCalledTimes(2);
  });

  it("reads in Spanish", async () => {
    setLocale("es-ES");
    const { dialog } = await mount({ lines: ["Line"] });
    expect(dialog.heading).toBe(es["appearance.switch_heading"].replace("{name}", "Christmas"));
    expect(paragraphs(dialog)).toEqual([
      es["appearance.switch_body"],
      es["appearance.switch_hard_to_read"],
    ]);
    expect(back(dialog).textContent?.trim()).toBe(es["action.back"]);
    expect(use(dialog).textContent?.trim()).toBe(es["appearance.use_it"]);
  });
});
