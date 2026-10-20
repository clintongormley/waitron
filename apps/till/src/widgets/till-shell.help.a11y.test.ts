import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import { setHelpMode } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";
import { currentLocale, setLocale } from "../i18n/t.js";

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

const looks = (["light", "dark"] as const).flatMap((theme) =>
  (["en-GB", "es-ES"] as const).map((locale) => [theme, locale] as const),
);

async function inLocale(locale: string, run: () => Promise<void>): Promise<void> {
  const original = currentLocale();
  setLocale(locale);
  try {
    await run();
  } finally {
    setLocale(original);
  }
}

describe.each(looks)("till-shell's Help switch a11y (%s theme, %s)", (theme, locale) => {
  it.each([
    ["till", 1280],
    ["till", 390],
    ["handheld", 1280],
    ["handheld", 390],
  ] as const)("%s at %ipx, help off and on, More closed and open", (form, width) =>
    inLocale(locale, async () => {
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
    }),
  );
});

describe.each(looks)(
  "till-shell's language choices in More a11y (%s theme, %s)",
  (theme, locale) => {
    it("a handheld at 320px with the chooser in More and More open", () =>
      inLocale(locale, async () => {
        await page.viewport(320, 844);
        const { el, host } = await mountWidget<TillShell>("till-shell", shells.handheld, theme);
        const more = () =>
          el.shadowRoot!.querySelector<HTMLElement & LitElement>('header [data-test="more-menu"]')!;
        await vi.waitFor(() =>
          expect(
            more().querySelector(':scope > wt-language-chooser[layout="group"]'),
          ).not.toBeNull(),
        );
        expect(el.shadowRoot!.querySelectorAll("wt-language-chooser")).toHaveLength(1);
        await more().updateComplete;
        await userEvent.click(more().shadowRoot!.querySelector("button")!);
        const popup = more().shadowRoot!.querySelector<HTMLElement>("[popover]")!;
        await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
        await expectNoA11yViolations(host);
        await userEvent.keyboard("{Escape}");
      }));
  },
);

const clockState = {
  personId: "ana",
  locationId: "venue",
  businessDay: "2026-10-14",
  state: "working" as const,
  activeLocationId: "venue",
  lastEntryId: "entry",
  firstClockIn: false,
};

describe.each(looks)("till-shell's menu badges a11y (%s theme, %s)", (theme, locale) => {
  it.each([
    ["till", 1280, "wt-row-actions.operator-menu"],
    ["till", 1280, 'header [data-test="more-menu"]'],
    ["handheld", 320, 'header [data-test="more-menu"]'],
  ] as const)("%s at %ipx with %s open and help on", (form, width, selector) =>
    inLocale(locale, async () => {
      await page.viewport(width, 844);
      setHelpMode(true);
      const { el, host } = await mountWidget<TillShell>(
        "till-shell",
        { ...shells[form], transferAvailable: true, clockAvailable: true, clockState },
        theme,
      );
      await frame();
      await frame();
      await el.updateComplete;
      const menu = el.shadowRoot!.querySelector<HTMLElement & LitElement>(selector)!;
      await menu.updateComplete;
      await userEvent.click(menu.shadowRoot!.querySelector("button")!);
      const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
      const rows = [...menu.querySelectorAll<HTMLElement & LitElement>("wt-menu-row")];
      expect(rows.length).toBeGreaterThan(0);
      await Promise.all(rows.map((row) => row.updateComplete));
      await expectNoA11yViolations(host);
      await userEvent.keyboard("{Escape}");
    }),
  );
});
