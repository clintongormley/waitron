import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("kiosk mode with its language chooser has no violations", async () => {
    const { host } = await mountWidget<TillTabShell>(
      "till-tab-shell",
      { tabs, activeTabKey: "counter", affordances, kiosk: true, loadLocales },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
