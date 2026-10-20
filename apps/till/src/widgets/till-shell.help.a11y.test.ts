import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import { setHelpMode } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";

const loadLocales = async () => [
  { code: "es-ES", label: "Español" },
  { code: "en-GB", label: "English" },
];

const shells: Record<"till" | "handheld", Partial<TillShell>> = {
  till: {
    formFactor: "till",
    activeScreen: "counter",
    operatorName: "Ana",
    affordances: ["find-bill", "schedule"],
    canSwitchProfile: true,
    loadLocales,
  },
  handheld: {
    formFactor: "phone-portrait",
    activeScreen: "floor",
    operatorName: "Ana",
    affordances: ["find-bill", "schedule"],
    canSwitchProfile: true,
    loadLocales,
  },
};

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

let viewport = { width: 0, height: 0 };

beforeEach(() => {
  viewport = { width: window.innerWidth, height: window.innerHeight };
});

afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  await page.viewport(viewport.width, viewport.height);
});

describe.each(["light", "dark"] as const)("till-shell's Help switch a11y (%s theme)", (theme) => {
  it.each([
    ["till", 1280],
    ["till", 390],
    ["handheld", 1280],
    ["handheld", 390],
  ] as const)("%s at %ipx, help off and on, More closed and open", async (form, width) => {
    await page.viewport(width, 844);
    for (const on of [false, true]) {
      cleanupWidgets();
      setHelpMode(on);
      const { el, host } = await mountWidget<TillShell>("till-shell", shells[form], theme);
      await frame();
      await frame();
      await el.updateComplete;
      const help = el.shadowRoot!.querySelector<HTMLElement & LitElement>(
        '[data-test="help-switch"]',
      )!;
      await help.updateComplete;
      expect(help.shadowRoot!.querySelector("button")!.getAttribute("aria-pressed")).toBe(
        on ? "true" : "false",
      );
      await expectNoA11yViolations(host);
      const more = el.shadowRoot!.querySelector<HTMLElement & LitElement>(
        'header [data-test="more-menu"]',
      )!;
      await more.updateComplete;
      await userEvent.click(more.shadowRoot!.querySelector("button")!);
      const popup = more.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
      await expectNoA11yViolations(host);
      await userEvent.keyboard("{Escape}");
    }
  });
});
