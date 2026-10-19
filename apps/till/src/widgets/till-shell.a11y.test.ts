import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { ShellAffordance, TillShell } from "./till-shell.js";

const affordances: ShellAffordance[] = ["station", "expo", "schedule"];

const loadLocales = async () => [
  { code: "es-ES", label: "Español" },
  { code: "en-GB", label: "English" },
];

afterEach(cleanupWidgets);

const full: Partial<TillShell> = {
  formFactor: "till",
  activeScreen: "counter",
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

describe.each(["light", "dark"] as const)("till-shell a11y (%s theme)", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "the name menu in %s, closed and open in each clock state",
    async (locale) => {
      const original = currentLocale();
      setLocale(locale);
      try {
        await atViewport(1280, 844, async () => {
          for (const state of ["working", "on_break", "out", null] as const) {
            cleanupWidgets();
            const { el, host } = await mountWidget<TillShell>(
              "till-shell",
              {
                formFactor: "till",
                operatorName: "Ana",
                clockAvailable: true,
                clockState:
                  state === null
                    ? null
                    : {
                        personId: "ana",
                        locationId: "venue",
                        businessDay: "2026-10-14",
                        state,
                        activeLocationId: state === "out" ? null : "venue",
                        lastEntryId: "entry",
                        firstClockIn: false,
                      },
              },
              theme,
            );
            const menu = el.shadowRoot!.querySelector("wt-row-actions.operator-menu")!;
            expect(menu).not.toBeNull();
            await (menu as unknown as { updateComplete: Promise<unknown> }).updateComplete;
            await expectNoA11yViolations(host);
            await userEvent.click(menu.shadowRoot!.querySelector("button")!);
            await expectNoA11yViolations(host);
            await userEvent.keyboard("{Escape}");
          }
        });
      } finally {
        setLocale(original);
      }
    },
  );
  it("the tab bar + header chrome has no violations", async () => {
    const { host } = await mountWidget<TillShell>(
      "till-shell",
      { formFactor: "till", activeScreen: "counter", operatorName: "Ana", affordances },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it.each([
    [390, "en-GB"],
    [1280, "en-GB"],
    [390, "es-ES"],
    [1280, "es-ES"],
  ] as const)(
    "A738 counted till bar and Testing at %i in %s have no violations",
    async (width, locale) => {
      const original = currentLocale();
      setLocale(locale);
      try {
        await atViewport(width, 844, async () => {
          const { el, host } = await mountWidget<TillShell>(
            "till-shell",
            {
              ...full,
              parkedCount: 12,
              waitingCount: 3,
              activeOrderList: "waiting",
              testingKitchen: true,
            },
            theme,
          );
          await expectNoA11yViolations(host);
          const menu =
            el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
              '[data-test="more-menu"]',
            )!;
          await menu.updateComplete;
          await userEvent.click(menu.shadowRoot!.querySelector("button")!);
          await expectNoA11yViolations(host);
          await userEvent.click(menu.querySelector("summary")!);
          await expectNoA11yViolations(host);
          await userEvent.keyboard("{Escape}");
          el.waitingCount = 0;
          await el.updateComplete;
          await expectNoA11yViolations(host);
        });
      } finally {
        setLocale(original);
      }
    },
  );

  it("kiosk mode (header-less body) has no violations", async () => {
    const { host } = await mountWidget<TillShell>(
      "till-shell",
      {
        formFactor: "till",
        activeScreen: "counter",
        operatorName: "Ana",
        affordances,
        kiosk: true,
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("the bar with its language chooser, closed and open, has no violations", async () => {
    const { el, host } = await mountWidget<TillShell>(
      "till-shell",
      {
        formFactor: "tablet-landscape",
        activeScreen: "floor",
        operatorName: "Ana",
        affordances,
        loadLocales,
      },
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
            const { el, host } = await mountWidget<TillShell>("till-shell", full, theme);
            await expectNoA11yViolations(host);
            const menu = el.shadowRoot!.querySelector('wt-row-actions[data-test="more-menu"]')!;
            expect(
              el.shadowRoot!.querySelector("[data-test=department-transfers]")?.textContent,
            ).toContain("2");
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

  it("the full bar with Find a bill and Settings in More, closed and open, has no violations", async () => {
    await atViewport(2560, 844, async () => {
      const { el, host } = await mountWidget<TillShell>("till-shell", full, theme);
      const menu = el.shadowRoot!.querySelector('wt-row-actions[data-test="more-menu"]')!;
      await vi.waitFor(() => expect(menu.querySelectorAll(":scope > *")).toHaveLength(6));
      expect(menu.querySelector("wt-button.find-bill")).not.toBeNull();
      expect(menu.querySelector("wt-button.settings")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("wt-row-actions.operator-menu")).not.toBeNull();
      await expectNoA11yViolations(host);
      await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>("button")!);
      await vi.waitFor(() =>
        expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true),
      );
      await expectNoA11yViolations(host);
    });
  });

  it.each(["en-GB", "es-ES"] as const)(
    "the bar at 1280 wide in %s, some items in More, its menu closed and open, has no violations",
    async (locale) => {
      const original = currentLocale();
      setLocale(locale);
      try {
        await atViewport(1280, 844, async () => {
          const { el, host } = await mountWidget<TillShell>(
            "till-shell",
            { ...full, operatorName: "Ana Isabel García López" },
            theme,
          );
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await el.updateComplete;
          const menu = el.shadowRoot!.querySelector('wt-row-actions[data-test="more-menu"]')!;
          expect(menu).not.toBeNull();
          expect(
            el.shadowRoot!.querySelector("header .session > [data-test=more-menu] .logout"),
          ).not.toBeNull();
          await expectNoA11yViolations(host);
          menu.shadowRoot!.querySelector<HTMLElement>("button")!.click();
          await vi.waitFor(() =>
            expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(
              true,
            ),
          );
          await expectNoA11yViolations(host);
        });
      } finally {
        setLocale(original);
      }
    },
  );

  it("kiosk mode with its language chooser has no violations", async () => {
    const { host } = await mountWidget<TillShell>(
      "till-shell",
      { formFactor: "till", activeScreen: "counter", affordances, kiosk: true, loadLocales },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
