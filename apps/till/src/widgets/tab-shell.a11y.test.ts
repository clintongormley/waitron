import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TabDef } from "../layout.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./tab-shell.js";
import type { ShellAffordance, TillTabShell } from "./tab-shell.js";

const tabs: TabDef[] = [
  { key: "counter", title: "Counter", columns: 12, cards: [] },
  { key: "floor", title: "Floor", columns: 12, cards: [] },
];

const affordances: ShellAffordance[] = ["station", "expo", "schedule"];

const loadLocales = async () => [
  { code: "es-ES", label: "Español" },
  { code: "en-GB", label: "English" },
];

afterEach(cleanupWidgets);

const full: Partial<TillTabShell> = {
  tabs: [...tabs, { key: "order", title: "Order", columns: 12, cards: [] }],
  activeTabKey: "counter",
  operatorName: "Ana",
  affordances: ["find-bill", ...affordances],
  transferAvailable: true,
  transferCount: 2,
  canSwitchProfile: true,
  loadLocales,
};

async function atViewport(width: number, height: number, run: () => Promise<void>): Promise<void> {
  const before = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, height);
  try {
    await run();
  } finally {
    await page.viewport(before.width, before.height);
  }
}

describe.each(["light", "dark"] as const)("till-tab-shell a11y (%s theme)", (theme) => {
  it("the tab bar + header chrome has no violations", async () => {
    const { host } = await mountWidget<TillTabShell>(
      "till-tab-shell",
      { tabs, activeTabKey: "counter", operatorName: "Ana", affordances },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("kiosk mode (header-less body) has no violations", async () => {
    const { host } = await mountWidget<TillTabShell>(
      "till-tab-shell",
      { tabs, activeTabKey: "counter", operatorName: "Ana", affordances, kiosk: true },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("the bar with its language chooser, closed and open, has no violations", async () => {
    const { el, host } = await mountWidget<TillTabShell>(
      "till-tab-shell",
      { tabs, activeTabKey: "counter", operatorName: "Ana", affordances, loadLocales },
      theme,
    );
    await expectNoA11yViolations(host);
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-trigger"]')!.click();
    await vi.waitFor(() => {
      expect(chooser.shadowRoot!.querySelector('[role="menu"]')).not.toBeNull();
    });
    await expectNoA11yViolations(host);
  });

  it.each(["en-GB", "es-ES"] as const)(
    "the phone bar in %s, upright and on its side, its menu closed and open, has no violations",
    async (locale) => {
      const original = currentLocale();
      setLocale(locale);
      try {
        for (const [width, height] of [
          [390, 844],
          [600, 390],
        ] as const) {
          await atViewport(width, height, async () => {
            const { el, host } = await mountWidget<TillTabShell>("till-tab-shell", full, theme);
            await expectNoA11yViolations(host);
            const menu = el.shadowRoot!.querySelector('wt-row-actions[data-test="more-menu"]')!;
            expect(menu.querySelector("wt-count-badge")).not.toBeNull();
            menu.shadowRoot!.querySelector<HTMLElement>("button")!.click();
            await vi.waitFor(() =>
              expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(
                true,
              ),
            );
            await expectNoA11yViolations(host);
          });
          cleanupWidgets();
        }
      } finally {
        setLocale(original);
      }
    },
  );

  it("the full bar at 1280 wide has no violations", async () => {
    await atViewport(1280, 844, async () => {
      const { el, host } = await mountWidget<TillTabShell>("till-tab-shell", full, theme);
      expect(el.shadowRoot!.querySelector("wt-row-actions")).toBeNull();
      await expectNoA11yViolations(host);
    });
  });

  it("kiosk mode with its language chooser has no violations", async () => {
    const { host } = await mountWidget<TillTabShell>(
      "till-tab-shell",
      { tabs, activeTabKey: "counter", affordances, kiosk: true, loadLocales },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
