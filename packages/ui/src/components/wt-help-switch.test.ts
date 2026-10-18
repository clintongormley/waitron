import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import { currentHelpMode, setHelpMode } from "../help-mode.js";
import type { WtHelpSwitch } from "./wt-help-switch.js";
import "./wt-help-switch.js";

afterEach(() => {
  cleanup();
  setHelpMode(false);
});

function buttonOf(el: WtHelpSwitch): HTMLButtonElement {
  return el.shadowRoot!.querySelector("button")!;
}

function iconOf(el: WtHelpSwitch): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(".icon")!;
}

test("starts unpressed while help is off", async () => {
  const el = (await mount("<wt-help-switch></wt-help-switch>")) as WtHelpSwitch;
  const button = buttonOf(el);
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(button.getAttribute("aria-label")).toBe("Help");
  expect(iconOf(el).getAttribute("aria-hidden")).toBe("true");
  expect(iconOf(el).textContent).toBe("?");
});

test("a click turns help on and shows as pressed; a second turns it off", async () => {
  const el = (await mount("<wt-help-switch></wt-help-switch>")) as WtHelpSwitch;
  buttonOf(el).click();
  await el.updateComplete;
  expect(currentHelpMode()).toBe(true);
  expect(buttonOf(el).getAttribute("aria-pressed")).toBe("true");
  buttonOf(el).click();
  await el.updateComplete;
  expect(currentHelpMode()).toBe(false);
  expect(buttonOf(el).getAttribute("aria-pressed")).toBe("false");
});

test("follows help turned on elsewhere", async () => {
  const el = (await mount("<wt-help-switch></wt-help-switch>")) as WtHelpSwitch;
  setHelpMode(true);
  await el.updateComplete;
  expect(buttonOf(el).getAttribute("aria-pressed")).toBe("true");
});

test("two switches stay in step", async () => {
  await mount("<div><wt-help-switch></wt-help-switch><wt-help-switch></wt-help-switch></div>");
  const [first, second] = [...host.querySelectorAll<WtHelpSwitch>("wt-help-switch")] as [
    WtHelpSwitch,
    WtHelpSwitch,
  ];
  await Promise.all([first.updateComplete, second.updateComplete]);
  buttonOf(first).click();
  await second.updateComplete;
  expect(buttonOf(second).getAttribute("aria-pressed")).toBe("true");
});

test("Enter and Space toggle it", async () => {
  const el = (await mount("<wt-help-switch></wt-help-switch>")) as WtHelpSwitch;
  buttonOf(el).focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(currentHelpMode()).toBe(true);
  await userEvent.keyboard(" ");
  await el.updateComplete;
  expect(currentHelpMode()).toBe(false);
});

test("is a --wt-tap-min target", async () => {
  const el = (await mount("<wt-help-switch></wt-help-switch>")) as WtHelpSwitch;
  host.style.setProperty("--wt-tap-min", "50px");
  const box = buttonOf(el).getBoundingClientRect();
  expect(box.width).toBeGreaterThanOrEqual(50);
  expect(box.height).toBeGreaterThanOrEqual(50);
});

test("paints from the tokens", async () => {
  const el = (await mount("<wt-help-switch></wt-help-switch>")) as WtHelpSwitch;
  host.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-primary", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-on-primary", "rgb(7, 8, 9)");
  expect(getComputedStyle(iconOf(el)).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(iconOf(el)).borderColor).toBe("rgb(1, 2, 3)");
  setHelpMode(true);
  await el.updateComplete;
  const pressed = getComputedStyle(iconOf(el));
  expect(pressed.backgroundColor).toBe("rgb(4, 5, 6)");
  expect(pressed.color).toBe("rgb(7, 8, 9)");
  expect(pressed.borderColor).toBe("rgba(0, 0, 0, 0)");
});

test("takes the app's word for Help", async () => {
  const el = (await mount('<wt-help-switch label="Ayuda"></wt-help-switch>')) as WtHelpSwitch;
  expect(buttonOf(el).getAttribute("aria-label")).toBe("Ayuda");
});
