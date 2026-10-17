import { html, render } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { themeChoices, themeChoicesStyles } from "./theme-choices.js";
import { applyTokens } from "./tokens/index.js";
import type { ThemeChoice } from "./theme-choice.js";

const labels = { theme: "Tema", light: "Claro", dark: "Oscuro", device: "Según el dispositivo" };

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function mountChoices(active: ThemeChoice, onPick: (choice: ThemeChoice) => void = () => {}) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  applyTokens(host);
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [themeChoicesStyles.styleSheet!];
  render(html`${themeChoices({ active, labels, onPick })}`, root);
  const group = root.querySelector<HTMLElement>("[data-test=theme-choices]")!;
  const buttons = [...group.querySelectorAll<HTMLButtonElement>("button")];
  return { root, group, buttons };
}

it("is a group named by its label, holding one button per choice in order", async () => {
  const { group, buttons } = mountChoices("device");
  expect(group.getAttribute("role")).toBe("group");
  await expect.element(page.elementLocator(group)).toHaveAccessibleName("Tema");
  expect(buttons.map((b) => b.getAttribute("data-test"))).toEqual([
    "theme-choice-light",
    "theme-choice-dark",
    "theme-choice-device",
  ]);
  expect(buttons.map((b) => b.textContent!.trim())).toEqual([
    "Claro",
    "Oscuro",
    "Según el dispositivo",
  ]);
  expect(buttons.map((b) => b.type)).toEqual(["button", "button", "button"]);
  expect(buttons.map((b) => b.querySelector("wt-icon")!.getAttribute("name"))).toEqual([
    "theme-light",
    "theme-dark",
    "theme-device",
  ]);
});

it.each(["light", "dark", "device"] as const)("marks %s alone as pressed", (active) => {
  const { buttons } = mountChoices(active);
  expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(
    ["light", "dark", "device"].map((choice) => String(choice === active)),
  );
});

it("hands a pick to onPick and changes nothing itself", () => {
  const onPick = vi.fn();
  const { buttons } = mountChoices("device", onPick);
  buttons[1]!.click();
  expect(onPick).toHaveBeenCalledExactlyOnceWith("dark");
  expect(buttons[2]!.getAttribute("aria-pressed")).toBe("true");
  buttons[0]!.click();
  expect(onPick).toHaveBeenLastCalledWith("light");
});

it("marks the pressed choice with a border the others do not draw", () => {
  const { buttons } = mountChoices("dark");
  const border = (b: HTMLButtonElement) => getComputedStyle(b).borderTopColor;
  expect(border(buttons[1]!)).not.toBe(border(buttons[0]!));
  expect(border(buttons[0]!)).toBe(border(buttons[2]!));
  expect(buttons[0]!.getBoundingClientRect().width).toBe(
    buttons[0]!.parentElement!.getBoundingClientRect().width,
  );
});
