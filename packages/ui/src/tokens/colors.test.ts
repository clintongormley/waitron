import { expect, test, afterEach } from "vitest";
import { commands } from "vitest/browser";
import { mountTokenRoot, token } from "./token-test-helpers.js";
import { applyTokens } from "../index.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

let host: HTMLElement;

function mount(theme?: "light" | "dark"): HTMLElement {
  host = mountTokenRoot(theme);
  return host;
}

afterEach(async () => {
  host?.remove();
  // Reset OS colour-scheme emulation so it can't leak into other test files.
  await commands.emulateColorScheme(null);
});

test("defines the core colour contract", () => {
  const el = mount("light");
  for (const name of [
    "--wt-color-bg",
    "--wt-color-surface",
    "--wt-color-text",
    "--wt-color-text-muted",
    "--wt-color-primary",
    "--wt-color-on-primary",
    "--wt-color-danger",
    "--wt-color-on-danger",
    "--wt-color-warning",
    "--wt-color-on-warning",
    "--wt-color-border",
    "--wt-color-focus",
    "--wt-color-scrim",
  ]) {
    expect(token(el, name), `${name} should be defined`).not.toBe("");
  }
});

test("light and dark resolve to different backgrounds", () => {
  const light = mount("light");
  const lightBg = token(light, "--wt-color-bg");
  light.remove();

  const dark = mount("dark");
  const darkBg = token(dark, "--wt-color-bg");

  expect(lightBg).not.toBe(darkBg);
});

test("prefers-color-scheme sets the default theme when data-theme is absent", async () => {
  // No data-theme attribute at all: the @media (prefers-color-scheme: dark)
  // block is the only thing that can make this element resolve to dark.
  const el = mount();

  await commands.emulateColorScheme("dark");
  expect(token(el, "--wt-color-bg")).toBe("#101216");

  await commands.emulateColorScheme("light");
  expect(token(el, "--wt-color-bg")).toBe("#f7f7f8");
});

test("data-theme overrides the media preference in both directions", async () => {
  // OS prefers dark, but an explicit data-theme="light" must still win.
  await commands.emulateColorScheme("dark");
  const light = mount("light");
  expect(token(light, "--wt-color-bg")).toBe("#f7f7f8");
  light.remove();

  // OS prefers light, but an explicit data-theme="dark" must still win.
  await commands.emulateColorScheme("light");
  const dark = mount("dark");
  expect(token(dark, "--wt-color-bg")).toBe("#101216");
});

test("tells the browser which scheme to draw native controls in", async () => {
  // A native control the app does not paint itself — a radio, a checkbox, a scrollbar — is drawn by
  // the user agent, which picks its appearance from `color-scheme` and NOT from `data-theme`.
  // Without this the dark theme got the light drawing: an UNCHECKED radio rendered as a solid white
  // dot, heavier than the checked one's ring, so the wrong row read as the selected one. Measured
  // side by side in headless Chromium, `accent-color` alone does not change that fill.
  await commands.emulateColorScheme("light");
  expect(getComputedStyle(mount("dark")).colorScheme).toBe("dark");
  host.remove();

  await commands.emulateColorScheme("dark");
  expect(getComputedStyle(mount("light")).colorScheme).toBe("light");
  host.remove();

  // No data-theme: the media block is the only thing that can answer.
  await commands.emulateColorScheme("dark");
  expect(getComputedStyle(mount()).colorScheme).toBe("dark");
});

test("a nested theme root does not inherit the outer root's scheme", async () => {
  // `color-scheme` is an inherited property, so a theme root nested inside a DARK one and carrying
  // no data-theme of its own would be drawn dark while its colour tokens resolve light — light
  // surfaces with dark-drawn radios and checkboxes. The base block's `color-scheme: light` is the
  // only thing that stops it: measured with that one declaration removed, this reads `dark` while
  // --wt-color-bg still reads #f7f7f8. NOTHING nests a theme root today — `grep -rn applyTokens`
  // over apps and packages shows the three apps calling it on document.documentElement alone, the
  // demo making two SIBLING panels, and the rest applying it to a test host on document.body — so
  // this case is constructed here rather than observed, and the declaration is what keeps the
  // answer right if one ever is nested.
  await commands.emulateColorScheme("light");
  const outer = mount("dark");
  const inner = document.createElement("div");
  outer.appendChild(inner);
  applyTokens(inner);

  expect(getComputedStyle(inner).colorScheme).toBe("light");
  expect(token(inner, "--wt-color-bg")).toBe("#f7f7f8");
});
