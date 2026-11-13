/// <reference types="@vitest/browser-playwright" />
import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { trackIconTooltip } from "./icon-button.js";
import { iconButton } from "./icon-button-test-helpers.js";
import { registerIcons } from "./components/wt-icon.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await commands.parkPointer();
});

function trackedButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Filters";
  for (const type of ["pointerenter", "pointerleave", "focus", "blur"])
    button.addEventListener(type, trackIconTooltip);
  document.body.append(button);
  onTestFinished(() => button.remove());
  return button;
}

test("Escape hides the tooltip of a hovered icon button", async () => {
  const button = trackedButton();
  await userEvent.hover(button);
  await userEvent.keyboard("{Escape}");
  expect(button.hasAttribute("data-tooltip-hidden")).toBe(true);
});

test("an icon button removed while hovered stops listening for Escape", async () => {
  const added = vi.spyOn(document, "addEventListener");
  const removed = vi.spyOn(document, "removeEventListener");
  const button = trackedButton();
  await userEvent.hover(button);
  const escape = added.mock.calls.find(([type]) => type === "keydown")![1];
  button.remove();
  await userEvent.keyboard("{Escape}");
  expect(button.hasAttribute("data-tooltip-hidden")).toBe(false);
  expect(removed).toHaveBeenCalledWith("keydown", escape, true);
});

test("a click on an icon button's shown tooltip does not press the button", async () => {
  const { button, tooltip, popover } = iconButton();
  await userEvent.hover(button);
  expect(getComputedStyle(tooltip).display).toBe("block");
  await userEvent.click(tooltip);
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(popover.matches(":popover-open")).toBe(false);
});

test("a click on an icon button's icon, and Enter on it, still press it", async () => {
  const { button, icon, popover } = iconButton();
  await userEvent.hover(button);
  await userEvent.click(icon);
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(popover.matches(":popover-open")).toBe(true);
  button.focus();
  await userEvent.keyboard("{Enter}");
  expect(button.getAttribute("aria-pressed")).toBe("false");
});

test("a disabled icon button is drawn faded, with no pointer cursor", () => {
  const { button } = iconButton();
  expect(getComputedStyle(button).opacity).toBe("1");
  button.disabled = true;
  const faded = getComputedStyle(button.parentElement!)
    .getPropertyValue("--wt-opacity-disabled")
    .trim();
  expect(Number(faded)).toBeLessThan(1);
  expect(Number(getComputedStyle(button).opacity)).toBeCloseTo(Number(faded), 5);
  expect(getComputedStyle(button).cursor).toBe("default");
});

for (const theme of ["light", "dark"] as const) {
  for (const attribute of ["aria-pressed", "aria-expanded"]) {
    test(`the ${attribute} icon follows its button's tokens (${theme})`, async () => {
      const { button, icon } = iconButton();
      const host = button.parentElement!;
      host.setAttribute("data-theme", theme);
      host.style.setProperty("--wt-color-text", "rgb(31, 32, 33)");
      host.style.setProperty("--wt-color-primary-text", "rgb(14, 15, 16)");
      registerIcons({ "button-colour-test": "M2 2h12v12H2z" });
      const glyph = document.createElement("wt-icon");
      glyph.name = "button-colour-test";
      icon.replaceWith(glyph);
      await glyph.updateComplete;
      const fill = () => getComputedStyle(glyph.shadowRoot!.querySelector("svg")!).fill;
      expect(fill()).toBe("rgb(31, 32, 33)");
      button.setAttribute(attribute, "true");
      expect(fill()).toBe("rgb(14, 15, 16)");
      host.style.setProperty("--wt-color-primary-text", "rgb(41, 42, 43)");
      expect(fill()).toBe("rgb(41, 42, 43)");
      button.setAttribute(attribute, "false");
      expect(fill()).toBe("rgb(31, 32, 33)");
    });
  }
}
