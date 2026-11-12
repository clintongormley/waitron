import { type LitElement } from "lit";
import { afterEach, expect, test, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import type {} from "../a11y-helpers.js";
import { registerIcons } from "./wt-icon.js";
import "../index.js";

type IconButton = LitElement & {
  label: string;
  icon: string;
  pressed?: boolean;
  disabled: boolean;
};
const buttonOf = (el: Element) => el.shadowRoot?.querySelector("button") ?? null;

afterEach(async () => {
  cleanup();
  await commands.parkPointer();
});

test("names the native action, and updates and removes its toggle state", async () => {
  const wrapper = await mount("<div></div>");
  const el = document.createElement("wt-icon-button");
  el.label = "Select";
  el.icon = "select-rows";
  el.pressed = false;
  wrapper.append(el);
  await el.updateComplete;
  expect(buttonOf(el)).toBeInstanceOf(HTMLButtonElement);
  const button = buttonOf(el)!;
  expect(button.type).toBe("button");
  expect(button.part.contains("button")).toBe(true);
  expect(button.getAttribute("aria-label")).toBe("Select");
  expect(button.getAttribute("aria-pressed")).toBe("false");
  el.pressed = true;
  el.label = "Seleccionar";
  el.icon = "check";
  await el.updateComplete;
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(button.getAttribute("aria-label")).toBe("Seleccionar");
  expect(button.querySelector("wt-icon")!.name).toBe("check");
  expect(button.querySelector(".icon-tooltip")!.textContent).toBe("Seleccionar");
  el.pressed = undefined;
  await el.updateComplete;
  expect(button.hasAttribute("aria-pressed")).toBe(false);
});

test("pointer, Enter and Space each activate once; disabled refuses activation", async () => {
  const el = (await mount('<wt-icon-button label="Select"></wt-icon-button>')) as IconButton;
  expect(buttonOf(el)).toBeInstanceOf(HTMLButtonElement);
  const pressed = vi.fn();
  host.addEventListener("click", pressed);
  await userEvent.click(buttonOf(el)!);
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard(" ");
  expect(pressed).toHaveBeenCalledTimes(3);
  el.disabled = true;
  await el.updateComplete;
  buttonOf(el)!.click();
  expect(buttonOf(el)!.disabled).toBe(true);
  expect(pressed).toHaveBeenCalledTimes(3);
});

test("delegates focus and binds the hover, focus and Escape tooltip lifecycle", async () => {
  const el = await mount('<wt-icon-button label="Select"></wt-icon-button>');
  expect(buttonOf(el)).toBeInstanceOf(HTMLButtonElement);
  const button = buttonOf(el)!;
  const tooltip = button.querySelector<HTMLElement>(".icon-tooltip")!;
  await userEvent.keyboard("{Tab}");
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(button);
  expect(getComputedStyle(tooltip).display).toBe("block");
  expect(tooltip.getAttribute("aria-hidden")).toBe("true");
  await userEvent.hover(button);
  await userEvent.keyboard("{Escape}");
  expect(getComputedStyle(tooltip).display).toBe("none");
  button.blur();
  await commands.parkPointer();
  await userEvent.hover(button);
  expect(getComputedStyle(tooltip).display).toBe("block");
  const pressed = vi.fn();
  el.addEventListener("click", pressed);
  await userEvent.click(tooltip);
  expect(pressed).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  expect(getComputedStyle(tooltip).display).toBe("none");
  button.blur();
  await commands.parkPointer();
  await userEvent.hover(button);
  expect(getComputedStyle(tooltip).display).toBe("block");
});

test.each(["light", "dark"])(
  "paints its glyph, tap area, pressed state and focus ring from tokens (%s)",
  async (theme) => {
    registerIcons({ "icon-button-test": "M2 2h12v12H2z" });
    const el = (await mount(
      '<wt-icon-button label="Select" icon="icon-button-test"></wt-icon-button>',
    )) as IconButton;
    expect(buttonOf(el)).toBeInstanceOf(HTMLButtonElement);
    host.setAttribute("data-theme", theme);
    el.style.setProperty("--wt-color-text", "rgb(31, 32, 33)");
    el.style.setProperty("--wt-color-surface", "rgb(241, 242, 243)");
    el.style.setProperty("--wt-color-primary-text", "rgb(14, 15, 16)");
    el.style.setProperty("--wt-color-primary", "rgb(24, 25, 26)");
    el.style.setProperty("--wt-color-surface-lifted", "rgb(211, 212, 213)");
    el.style.setProperty("--wt-tap-min", "52px");
    el.style.setProperty("--wt-focus-ring", "3px solid rgb(44, 45, 46)");
    const button = buttonOf(el)!;
    const glyph = button.querySelector("wt-icon")!;
    await glyph.updateComplete;
    const paint = () => getComputedStyle(glyph.shadowRoot!.querySelector("svg")!);
    expect(paint().fill).toBe("rgb(31, 32, 33)");
    expect(getComputedStyle(button).backgroundColor).toBe("rgb(241, 242, 243)");
    expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(52);
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
    expect(el.getBoundingClientRect().width).toBe(button.getBoundingClientRect().width);
    expect(el.getBoundingClientRect().height).toBe(button.getBoundingClientRect().height);
    el.pressed = true;
    await el.updateComplete;
    expect(paint().fill).toBe("rgb(14, 15, 16)");
    expect(getComputedStyle(button).borderTopColor).toBe("rgb(24, 25, 26)");
    expect(getComputedStyle(button).backgroundColor).toBe("rgb(211, 212, 213)");
    el.style.setProperty("--wt-color-primary-text", "rgb(41, 42, 43)");
    expect(paint().fill).toBe("rgb(41, 42, 43)");
    el.pressed = false;
    await el.updateComplete;
    expect(paint().fill).toBe("rgb(31, 32, 33)");
    await userEvent.keyboard("{Tab}");
    el.focus();
    expect(getComputedStyle(button).outlineColor).toBe("rgb(44, 45, 46)");
    expect(getComputedStyle(button).outlineWidth).toBe("3px");
    el.disabled = true;
    await el.updateComplete;
    expect(Number(getComputedStyle(button).opacity)).toBeCloseTo(
      Number(getComputedStyle(el).getPropertyValue("--wt-opacity-disabled")),
    );
    expect(getComputedStyle(button).cursor).toBe("default");
  },
);
