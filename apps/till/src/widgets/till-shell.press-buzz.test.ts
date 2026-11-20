import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtSwitch } from "@waitron/ui/src/components/wt-switch.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { es } from "../i18n/strings.js";
import { installPressBuzz } from "../press-buzz.js";
import { PRESS_BUZZ_STORAGE_KEY, setPressBuzz } from "../press-buzz-choice.js";

let originalLocale = currentLocale();
let originalViewport = { width: 0, height: 0 };

beforeEach(async () => {
  originalLocale = currentLocale();
  originalViewport = { width: window.innerWidth, height: window.innerHeight };
  setLocale("en-GB");
  await page.viewport(1280, 844);
});

afterEach(async () => {
  cleanupWidgets();
  setPressBuzz(true);
  window.localStorage.removeItem(PRESS_BUZZ_STORAGE_KEY);
  delete (navigator as { vibrate?: unknown }).vibrate;
  setLocale(originalLocale);
  await page.viewport(originalViewport.width, originalViewport.height);
});

const handheld = (): Promise<{ el: TillShell }> =>
  mountWidget<TillShell>("till-shell", {
    formFactor: "tablet-landscape",
    activeScreen: "counter",
    operatorName: "Ana",
    loadLocales: async () => [{ code: "en-GB", label: "English" }],
  });

const till = (): Promise<{ el: TillShell }> =>
  mountWidget<TillShell>("till-shell", {
    formFactor: "till",
    activeScreen: "counter",
    operatorName: "Ana",
    loadLocales: async () => [{ code: "en-GB", label: "English" }],
  });

const moreMenu = (el: TillShell) =>
  el.shadowRoot!.querySelector<HTMLElement>('header wt-row-actions[data-test="more-menu"]')!;
const nameMenu = (el: TillShell) =>
  el.shadowRoot!.querySelector<HTMLElement>("wt-row-actions.operator-menu")!;

/** The item drawn after `item`, looking through the menu's row wrapper on either side. */
function itemAfter(item: Element): Element | null {
  const row = item.parentElement?.localName === "wt-menu-row" ? item.parentElement : item;
  const next = row.nextElementSibling;
  return next?.localName === "wt-menu-row" ? next.firstElementChild : next;
}

const switchIn = (menu: Element) =>
  menu.querySelector<WtSwitch>('wt-switch[data-test="press-buzz-switch"]');

function otherTabChanged(key: string | null): void {
  window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
}

function noVibration(): void {
  Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });
}

describe("the press buzz switch", () => {
  it("sits right after the theme choices in a handheld's More Settings group", async () => {
    const { el } = await handheld();
    const theme = moreMenu(el).querySelector(".settings-group [data-test=theme-choices]")!;
    const after = itemAfter(theme);
    expect(after?.getAttribute("data-test")).toBe("press-buzz-switch");
    expect(after!.closest(".settings-group")).not.toBeNull();
  });

  it("sits right after the theme choices in a till's name menu", async () => {
    const { el } = await till();
    const theme = nameMenu(el).querySelector("[data-test=theme-choices]")!;
    expect(itemAfter(theme)?.getAttribute("data-test")).toBe("press-buzz-switch");
  });

  it("is named Vibrate on button press and is on by default", async () => {
    const { el } = await handheld();
    const toggle = switchIn(moreMenu(el))!;
    expect(toggle.label).toBe("Vibrate on button press");
    expect(toggle.checked).toBe(true);
    await toggle.updateComplete;
    expect(toggle.shadowRoot!.querySelector("input")!.name).toBe("pressBuzz");
  });

  it("is named in Spanish", async () => {
    setLocale("es-ES");
    const { el } = await handheld();
    expect(switchIn(moreMenu(el))!.label).toBe(es["press_buzz.label"]);
  });

  it("shows off when this device has turned the buzz off", async () => {
    window.localStorage.setItem(PRESS_BUZZ_STORAGE_KEY, "off");
    const { el } = await till();
    expect(switchIn(nameMenu(el))!.checked).toBe(false);
  });

  it("is not drawn where the browser cannot vibrate", async () => {
    noVibration();
    const { el } = await handheld();
    expect(switchIn(moreMenu(el))).toBeNull();
    expect(moreMenu(el).querySelector("[data-test=theme-choices]")).not.toBeNull();
    cleanupWidgets();
    const { el: tillShell } = await till();
    expect(switchIn(nameMenu(tillShell))).toBeNull();
  });

  it("follows another tab's choice and another tab clearing local storage while More is open", async () => {
    const { el } = await handheld();
    const more = moreMenu(el);
    await userEvent.click(more.shadowRoot!.querySelector("button")!);
    const toggle = switchIn(more)!;
    expect(toggle.checked).toBe(true);

    window.localStorage.setItem(PRESS_BUZZ_STORAGE_KEY, "off");
    otherTabChanged(PRESS_BUZZ_STORAGE_KEY);
    await el.updateComplete;
    await toggle.updateComplete;
    expect(toggle.checked).toBe(false);
    expect(toggle.shadowRoot!.querySelector("input")!.checked).toBe(false);

    window.localStorage.removeItem(PRESS_BUZZ_STORAGE_KEY);
    otherTabChanged(null);
    await el.updateComplete;
    await toggle.updateComplete;
    expect(toggle.checked).toBe(true);
    expect(toggle.shadowRoot!.querySelector("input")!.checked).toBe(true);
  });

  it("stops following other tabs once the shell leaves the page", async () => {
    const { el } = await handheld();
    el.remove();
    const update = vi.spyOn(el, "requestUpdate");
    window.localStorage.setItem(PRESS_BUZZ_STORAGE_KEY, "off");
    otherTabChanged(PRESS_BUZZ_STORAGE_KEY);
    expect(update).not.toHaveBeenCalled();
  });

  it("turning it off saves the choice and silences later presses", async () => {
    const { el } = await handheld();
    const toggle = switchIn(moreMenu(el))!;
    toggle.shadowRoot!.querySelector("input")!.click();
    await el.updateComplete;
    await toggle.updateComplete;
    expect(window.localStorage.getItem(PRESS_BUZZ_STORAGE_KEY)).toBe("off");
    expect(toggle.checked).toBe(false);

    const vibrate = vi.fn(() => true);
    const root = document.createElement("div");
    document.body.append(root);
    const remove = installPressBuzz(root, { vibrate });
    try {
      const button = document.createElement("button");
      root.append(button);
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
      expect(vibrate).not.toHaveBeenCalled();
    } finally {
      remove();
      root.remove();
    }

    toggle.shadowRoot!.querySelector("input")!.click();
    await el.updateComplete;
    expect(window.localStorage.getItem(PRESS_BUZZ_STORAGE_KEY)).toBeNull();
  });
});
