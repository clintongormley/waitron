import { html, render } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { themeChoices, themeChoicesStyles, themeLabelsPerLocale } from "./theme-choices.js";
import { applyTokens } from "./tokens/index.js";
import type { ThemeChoice } from "./theme-choice.js";

const labels = { theme: "Tema", light: "Claro", dark: "Oscuro", device: "Según el dispositivo" };

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function mountChoices(
  active: ThemeChoice,
  onPick: (choice: ThemeChoice) => void = () => {},
  theme?: "light" | "dark",
) {
  const host = document.createElement("div");
  host.style.width = "320px";
  document.body.append(host);
  hosts.push(host);
  applyTokens(host);
  if (theme) host.setAttribute("data-theme", theme);
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [themeChoicesStyles.styleSheet!];
  render(html`${themeChoices({ active, labels, onPick })}`, root);
  const group = root.querySelector<HTMLElement>("[data-test=theme-choices]")!;
  const buttons = [...group.querySelectorAll<HTMLButtonElement>("button")];
  return { root, group, buttons };
}

it("is a group named by its visible label, holding one icon-only button per choice in order", async () => {
  const { group, buttons } = mountChoices("device");
  expect(group.getAttribute("role")).toBe("group");
  await expect.element(page.elementLocator(group)).toHaveAccessibleName("Tema");
  expect(buttons.map((b) => b.getAttribute("data-test"))).toEqual([
    "theme-choice-light",
    "theme-choice-dark",
    "theme-choice-device",
  ]);
  for (const [i, name] of ["Claro", "Oscuro", "Según el dispositivo"].entries())
    await expect.element(page.elementLocator(buttons[i]!)).toHaveAccessibleName(name);
  expect(buttons.map((b) => b.textContent!.trim())).toEqual(["", "", ""]);
  expect(group.querySelector("#theme-choices-label")!.textContent).toBe("Tema");
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

it.each(["light", "dark"] as const)(
  "fills the pressed choice alone, with the primary colour, in the %s theme",
  (theme) => {
    const { buttons } = mountChoices("dark", () => {}, theme);
    const bg = (b: HTMLButtonElement) => getComputedStyle(b).backgroundColor;
    expect(bg(buttons[1]!)).not.toBe(bg(buttons[0]!));
    expect(bg(buttons[0]!)).toBe(bg(buttons[2]!));
    expect(bg(buttons[0]!)).toBe("rgba(0, 0, 0, 0)");
    const probe = document.createElement("span");
    probe.style.background = "var(--wt-color-primary)";
    probe.style.color = "var(--wt-color-on-primary)";
    buttons[1]!.parentElement!.append(probe);
    expect(bg(buttons[1]!)).toBe(getComputedStyle(probe).backgroundColor);
    expect(getComputedStyle(buttons[1]!).color).toBe(getComputedStyle(probe).color);
    probe.remove();
  },
);

it("lays the label and the three choices on one row at 320 px, each at least a tap target", () => {
  const { root, buttons } = mountChoices("device");
  const label = root.querySelector<HTMLElement>("#theme-choices-label")!.getBoundingClientRect();
  const boxes = buttons.map((b) => b.getBoundingClientRect());
  expect(new Set(boxes.map((r) => r.top)).size).toBe(1);
  expect(label.right).toBeLessThanOrEqual(boxes[0]!.left);
  expect(label.bottom).toBeGreaterThan(boxes[0]!.top);
  const tap = parseFloat(
    getComputedStyle(root.host as HTMLElement).getPropertyValue("--wt-tap-min"),
  );
  for (const r of boxes) {
    expect(r.width).toBeGreaterThanOrEqual(tap);
    expect(r.height).toBeGreaterThanOrEqual(tap);
  }
});

it("themeLabelsPerLocale hands back the same labels until the language changes", () => {
  const build = vi.fn(() => ({ ...labels }));
  const labelsFor = themeLabelsPerLocale(build);
  const spanish = labelsFor("es-ES");
  expect(labelsFor("es-ES")).toBe(spanish);
  expect(build).toHaveBeenCalledOnce();
  const english = labelsFor("en-GB");
  expect(english).not.toBe(spanish);
  expect(labelsFor("en-GB")).toBe(english);
  expect(build).toHaveBeenCalledTimes(2);
});
