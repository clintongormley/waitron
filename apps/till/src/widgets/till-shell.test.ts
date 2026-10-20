import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import {
  expectChooserFaces,
  cleanupWidgets,
  mountWidget as mountBaseWidget,
} from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import {
  chooseTheme,
  currentThemeChoice,
  THEME_SELECTED_EVENT,
  THEME_STORAGE_KEY,
  type WtRowActions,
} from "@waitron/ui";

const mountWidget = <T extends TillShell>(
  tag: string,
  props: Partial<T>,
  theme?: "light" | "dark",
) => mountBaseWidget<T>(tag, { formFactor: "tablet-landscape", ...props }, theme);

afterEach(cleanupWidgets);

describe("till-shell", () => {
  it.each([
    ["working", ["Start break", "Clock out", "My hours", "Fix my hours", "Log out"]],
    ["on_break", ["End break", "Clock out", "My hours", "Fix my hours", "Log out"]],
    ["out", ["Clock in", "My hours", "Fix my hours", "Log out"]],
  ] as const)("the name opens the %s clock actions with a text state", async (state, labels) => {
    const locale = currentLocale();
    const width = innerWidth;
    const height = innerHeight;
    setLocale("en-GB");
    await page.viewport(1280, 844);
    try {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "tablet-landscape",
        operatorName: "Ana",
        clockAvailable: true,
        clockState: {
          personId: "ana",
          locationId: "venue",
          businessDay: "2026-10-14",
          state,
          activeLocationId: state === "out" ? null : "venue",
          lastEntryId: "entry",
          firstClockIn: false,
        },
      });
      const menu = el.shadowRoot!.querySelector<HTMLElement>("wt-row-actions.operator-menu")!;
      expect(menu).not.toBeNull();
      await (menu as LitElement).updateComplete;
      const trigger = menu.shadowRoot!.querySelector("button")!;
      expect(menu.querySelector('[slot="trigger"]')?.textContent).toContain("Ana");
      expect(menu.querySelector("[data-clock-state]")?.textContent).toContain(
        state === "working" ? "Working" : state === "on_break" ? "On a break" : "Clocked out",
      );
      await userEvent.click(trigger);
      expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
      expect([...menu.querySelectorAll("wt-button")].map((b) => b.textContent?.trim())).toEqual(
        labels,
      );
      expect(menu.textContent).toContain("My hours");
      const hours = vi.fn();
      el.addEventListener("my-hours", hours);
      await userEvent.click(menu.querySelector<HTMLElement>("[data-my-hours]")!);
      expect(hours).toHaveBeenCalledTimes(1);
      expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
      await userEvent.click(trigger);
      const actions: unknown[] = [];
      el.addEventListener("clock-action", (e) => actions.push((e as CustomEvent).detail));
      el.addEventListener("clock-action", () => {
        el.clockBusy = true;
      });
      await userEvent.click(menu.querySelector<HTMLElement>("wt-button")!);
      expect(actions).toEqual([
        { action: state === "working" ? "break-start" : state === "on_break" ? "break-end" : "in" },
      ]);
      expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
    } finally {
      setLocale(locale);
      await page.viewport(width, height);
    }
  });

  it("handheld More contains the same clock actions without a nested menu", async () => {
    const locale = currentLocale();
    const width = innerWidth;
    const height = innerHeight;
    setLocale("en-GB");
    await page.viewport(390, 844);
    try {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "tablet-landscape",
        operatorName: "Ana",
        clockAvailable: true,
        clockState: {
          personId: "ana",
          locationId: "venue",
          businessDay: "2026-10-14",
          state: "on_break",
          activeLocationId: "venue",
          lastEntryId: "entry",
          firstClockIn: false,
        },
      });
      const menu = el.shadowRoot!.querySelector('wt-row-actions[data-test="more-menu"]')!;
      expect(menu.querySelector("wt-row-actions")).toBeNull();
      expect(menu.querySelector("[data-my-hours]")?.textContent).toContain("My hours");
      expect(menu.textContent).toContain("Ana");
      expect(menu.querySelector('[data-clock-action="break-end"]')?.textContent).toContain(
        "End break",
      );
      expect(menu.querySelector('[data-clock-action="out"]')?.textContent).toContain("Clock out");
    } finally {
      setLocale(locale);
      await page.viewport(width, height);
    }
  });

  it.each([null, "another-venue"])(
    "unknown or another-location clock state offers Retry or an explanation and disables clock writes (%s)",
    async (activeLocation) => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "tablet-landscape",
        operatorName: "Ana",
        clockAvailable: true,
        clockError: "Could not read the clock",
        clockState:
          activeLocation === null
            ? null
            : {
                personId: "ana",
                locationId: "venue",
                businessDay: "2026-10-14",
                state: "working",
                activeLocationId: activeLocation,
                lastEntryId: "entry",
                firstClockIn: false,
              },
      });
      expect(
        el.shadowRoot!.querySelector("[data-clock-action]")?.hasAttribute("disabled") ?? true,
      ).toBe(true);
      expect(el.shadowRoot!.querySelector(".logout")?.hasAttribute("disabled")).toBe(false);
      if (activeLocation === null)
        expect(el.shadowRoot!.querySelector("[data-clock-state]")?.textContent).toContain(
          t("clock.unknown"),
        );
      else expect(el.shadowRoot!.textContent).toContain(t("clock.other_location"));
    },
  );
  it("renders the fixed primary buttons and marks the active one", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "till",
      activeScreen: "floor",
    });
    const buttons = el.shadowRoot!.querySelectorAll<HTMLElement>(".tab");
    expect(buttons.length).toBe(2);
    const active = el.shadowRoot!.querySelector<HTMLElement>('.tab[aria-selected="true"]')!;
    expect(active.textContent).toContain("Floor");
  });

  it("marks the home screen active when activeScreen is unset or unknown, and tabs are type=button", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", { formFactor: "till" }); // no activeScreen
    const active = el.shadowRoot!.querySelectorAll<HTMLElement>('.tab[aria-selected="true"]');
    expect(active.length).toBe(1);
    expect(active[0]!.textContent).toContain("Counter");
    // Native tab buttons are type=button so they never submit an enclosing form.
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>(".tab")!.type).toBe("button");
  });

  it("emits screen-select when a tab is tapped", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "till",
      activeScreen: "counter",
    });
    let key: string | undefined;
    el.addEventListener(
      "screen-select",
      (e) => (key = (e as CustomEvent<{ screen: string }>).detail.screen),
    );
    el.shadowRoot!.querySelectorAll<HTMLElement>(".tab")[1]!.click();
    expect(key).toBe("floor");
  });

  it("emits show-station only when the station affordance is present", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      activeScreen: "floor",
      affordances: ["station"],
    });
    let fired = false;
    el.addEventListener("show-station", () => (fired = true));
    el.shadowRoot!.querySelector<HTMLElement>(".station")!.click();
    expect(fired).toBe(true);
  });

  it("offers Find a bill from the header when the operator can collect a debt", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      affordances: ["find-bill"],
    });
    const seen: string[] = [];
    el.addEventListener("find-bill", () => seen.push("find-bill"));
    el.shadowRoot!.querySelector<HTMLElement>(".find-bill")!.click();
    expect(seen).toEqual(["find-bill"]);
  });

  it("omits an affordance button that is not in affordances", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      activeScreen: "floor",
      affordances: ["station"],
    });
    expect(el.shadowRoot!.querySelector(".station")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".expo")).toBeNull();
    expect(el.shadowRoot!.querySelector(".schedule")).toBeNull();
  });

  it("emits show-expo, show-schedule and logout from the header chrome", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      activeScreen: "floor",
      affordances: ["expo", "schedule"],
    });
    const fired: string[] = [];
    for (const type of ["show-expo", "show-schedule", "logout"]) {
      el.addEventListener(type, () => fired.push(type));
    }
    el.shadowRoot!.querySelector<HTMLElement>(".expo")!.click();
    el.shadowRoot!.querySelector<HTMLElement>(".schedule")!.click();
    el.shadowRoot!.querySelector<HTMLElement>(".logout")!.click();
    expect(fired).toEqual(["show-expo", "show-schedule", "logout"]);
  });

  it("offers Equipment without the retired Allergens action, emitting open-equipment", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", { formFactor: "tablet-landscape" });
    const equipment = el.shadowRoot!.querySelector<HTMLElement>("wt-button.equipment")!;
    expect(equipment.textContent).toContain(t("equipment.open"));
    expect(el.shadowRoot!.querySelector("wt-button.allergens")).toBeNull();
    let fired = 0;
    el.addEventListener("open-equipment", () => (fired += 1));
    equipment.click();
    expect(fired).toBe(1);
  });

  it("offers Profile before Equipment only when the device can switch profile, emitting open-profile", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", { formFactor: "tablet-landscape" });
    expect(el.shadowRoot!.querySelector("wt-button.profile")).toBeNull();
    el.canSwitchProfile = true;
    await el.updateComplete;
    const profile = el.shadowRoot!.querySelector<HTMLElement>("wt-button.profile")!;
    expect(profile.textContent).toContain(t("profile.open"));
    const item = (option: Element) =>
      option.parentElement?.localName === "wt-menu-row" ? option.parentElement : option;
    expect(item(profile).nextElementSibling).toBe(
      item(el.shadowRoot!.querySelector("wt-button.equipment")!),
    );
    let fired = 0;
    el.addEventListener("open-profile", () => (fired += 1));
    profile.click();
    expect(fired).toBe(1);
  });

  it("shows the operator name in the header", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      activeScreen: "floor",
      operatorName: "Ana",
    });
    expect(el.shadowRoot!.querySelector<HTMLElement>(".operator")!.textContent).toContain("Ana");
  });

  it("places the language chooser in the bar, just before the operator's name", async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(1280, 844);
    try {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "tablet-landscape",
        activeScreen: "floor",
        operatorName: "Ana",
        loadLocales: async () => [{ code: "es-ES", label: "Español" }],
      });
      const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
      expect(chooser).not.toBeNull();
      expect(chooser.parentElement).toBe(el.shadowRoot!.querySelector("header .session"));
      const help = el.shadowRoot!.querySelector('[data-test="help-switch"]')!;
      expect(chooser.nextElementSibling).toBe(help);
      expect(help.nextElementSibling).toBe(el.shadowRoot!.querySelector(".operator-menu"));
      expect(chooser.getAttribute("active")).toBe(currentLocale());
    } finally {
      await page.viewport(width, height);
    }
  });

  it("shows the language's full name at 1280 wide and its short code at 390, always named in full", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      loadLocales: async () => [{ code: "es-ES", label: "Español" }],
    });
    await expectChooserFaces(el.shadowRoot!.querySelector("wt-language-chooser")!, {
      wide: { shown: ["Español"], name: "Español" },
      phone: { shown: ["ES"], name: "ES Español" },
    });
  });

  it("updates the chooser's active language when the till locale changes", async () => {
    setLocale("es-ES");
    try {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "tablet-landscape",
        loadLocales: async () => [],
      });
      setLocale("en-GB");
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("wt-language-chooser")!.getAttribute("active")).toBe(
        "en-GB",
      );
    } finally {
      setLocale("es-ES");
    }
  });

  it("lets one composed chooser selection reach its parent", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      activeScreen: "floor",
      loadLocales: async () => [
        { code: "en-GB", label: "English" },
        { code: "es-ES", label: "Español" },
      ],
    });
    const details: { code: string }[] = [];
    el.addEventListener("wt-locale-selected", (e) =>
      details.push((e as CustomEvent<{ code: string }>).detail),
    );
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    chooser.dispatchEvent(
      new CustomEvent("wt-locale-selected", {
        detail: { code: "en-GB" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(details).toEqual([{ code: "en-GB" }]);
  });

  it("omits the language chooser when loadLocales is not supplied (no throw-on-open surface)", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      activeScreen: "floor",
    });
    expect(el.shadowRoot!.querySelector("wt-language-chooser")).toBeNull();
  });

  it("omits the kitchen display's theme chooser with its language chooser when loadLocales is not supplied", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", { kiosk: true });
    expect(el.shadowRoot!.querySelector("wt-theme-chooser")).toBeNull();
  });

  it("keeps the theme chooser out of the bar, and puts Theme in the operator's menu just after Log out", async () => {
    await atViewport(1280, async () => {
      const before = currentLocale();
      setLocale("en-GB");
      try {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "tablet-landscape",
          activeScreen: "counter",
          operatorName: "Ana",
          loadLocales: async () => [{ code: "en-GB", label: "English" }],
        });
        expect(el.shadowRoot!.querySelector("header wt-language-chooser")).not.toBeNull();
        expect(el.shadowRoot!.querySelector("wt-theme-chooser")).toBeNull();
        const menu = el.shadowRoot!.querySelector<HTMLElement>("wt-row-actions.operator-menu")!;
        expect(
          [...menu.children]
            .filter((c) => c.slot !== "trigger")
            .map((c) => c.getAttribute("data-test") ?? c.className),
        ).toEqual(["logout", "theme-choices"]);
        await (menu as LitElement).updateComplete;
        await userEvent.click(menu.shadowRoot!.querySelector("button")!);
        const group = menu.querySelector<HTMLElement>('[data-test=theme-choices][role="group"]')!;
        await expect.element(group).toHaveAccessibleName("Theme");
        const buttons = [...group.querySelectorAll<HTMLButtonElement>("button")];
        expect(buttons.map((b) => b.getAttribute("data-test"))).toEqual([
          "theme-choice-light",
          "theme-choice-dark",
          "theme-choice-device",
        ]);
        for (const [i, name] of ["Light", "Dark", "Follow device"].entries())
          await expect.element(buttons[i]!).toHaveAccessibleName(name);
        expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
          "false",
          "false",
          "true",
        ]);
      } finally {
        setLocale(before);
      }
    });
  });

  it("labels the operator's Theme choices in Spanish", async () => {
    await atViewport(1280, async () => {
      const before = currentLocale();
      setLocale("es-ES");
      try {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "tablet-landscape",
          operatorName: "Ana",
        });
        const menu = el.shadowRoot!.querySelector<WtRowActions>("wt-row-actions.operator-menu")!;
        await menu.updateComplete;
        await userEvent.click(menu.shadowRoot!.querySelector("button")!);
        const group = menu.querySelector<HTMLElement>('[data-test=theme-choices][role="group"]')!;
        await expect.element(group).toHaveAccessibleName("Tema");
        const buttons = [...group.querySelectorAll("button")];
        for (const [i, name] of ["Claro", "Oscuro", "Según el dispositivo"].entries())
          await expect.element(buttons[i]!).toHaveAccessibleName(name);
      } finally {
        setLocale(before);
      }
    });
  });

  it("marks the new choice in the operator's menu when the theme choice changes", async () => {
    await atViewport(1280, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "tablet-landscape",
        activeScreen: "counter",
        operatorName: "Ana",
      });
      try {
        chooseTheme("dark");
        await el.updateComplete;
        expect(
          ["light", "dark", "device"].map((choice) =>
            el
              .shadowRoot!.querySelector(`.operator-menu [data-test=theme-choice-${choice}]`)!
              .getAttribute("aria-pressed"),
          ),
        ).toEqual(["false", "true", "false"]);
      } finally {
        chooseTheme("device");
        localStorage.removeItem(THEME_STORAGE_KEY);
      }
    });
  });

  it("asks for a theme picked in the operator's menu, closes the menu and leaves applying it to the app", async () => {
    await atViewport(1280, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "tablet-landscape",
        activeScreen: "counter",
        operatorName: "Ana",
      });
      const menu = el.shadowRoot!.querySelector<WtRowActions>("wt-row-actions.operator-menu")!;
      await menu.updateComplete;
      const popup = menu.shadowRoot!.querySelector("[popover]")!;
      const picks: unknown[] = [];
      const onPick = (e: Event) => picks.push((e as CustomEvent).detail);
      document.addEventListener(THEME_SELECTED_EVENT, onPick);
      try {
        await userEvent.click(menu.shadowRoot!.querySelector("button")!);
        expect(popup.matches(":popover-open")).toBe(true);
        await userEvent.click(menu.querySelector<HTMLElement>("[data-test=theme-choice-dark]")!);
        expect(picks).toEqual([{ choice: "dark" }]);
        expect(popup.matches(":popover-open")).toBe(false);
        expect(currentThemeChoice()).toBe("device");
        expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
      } finally {
        document.removeEventListener(THEME_SELECTED_EVENT, onPick);
      }
    });
  });

  it.each(["light", "dark"] as const)(
    "fills the pressed Theme choice, unlike an unpressed one and the menu's bordered buttons, in the %s theme",
    async (theme) => {
      await atViewport(1280, async () => {
        const { el } = await mountWidget<TillShell>(
          "till-shell",
          {
            formFactor: "tablet-landscape",
            operatorName: "Ana",
            clockAvailable: true,
            clockState: {
              personId: "ana",
              locationId: "venue",
              businessDay: "2026-10-14",
              state: "working",
              activeLocationId: "venue",
              lastEntryId: "entry",
              firstClockIn: false,
            },
          },
          theme,
        );
        const menu = el.shadowRoot!.querySelector<WtRowActions>("wt-row-actions.operator-menu")!;
        await menu.updateComplete;
        await userEvent.click(menu.shadowRoot!.querySelector("button")!);
        const hours = menu.querySelector<LitElement>("[data-my-hours]")!;
        await hours.updateComplete;
        const bg = (e: Element) => getComputedStyle(e).backgroundColor;
        const pressed = bg(menu.querySelector("[data-test=theme-choice-device]")!);
        const unpressed = bg(menu.querySelector("[data-test=theme-choice-light]")!);
        const bordered = bg(hours.shadowRoot!.querySelector("button")!);
        expect(pressed, "pressed against unpressed").not.toBe(unpressed);
        expect(pressed, "pressed against a bordered menu button").not.toBe(bordered);
        expect(pressed).not.toBe("rgba(0, 0, 0, 0)");
      });
    },
  );

  it("makes the body inert while a drill-in is slotted", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      activeScreen: "floor",
    });
    expect(el.shadowRoot!.querySelector<HTMLElement>("main.body")!.hasAttribute("inert")).toBe(
      false,
    );
    const drill = document.createElement("div");
    drill.slot = "drill";
    el.appendChild(drill);
    // `slotchange` fires on a microtask AFTER the assignment, then re-renders — the first
    // `updateComplete` lets that fire, the second awaits the slotchange-driven re-render.
    await el.updateComplete;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLElement>("main.body")!.hasAttribute("inert")).toBe(
      true,
    );
    expect(el.shadowRoot!.querySelector<HTMLElement>(".drill")!.hasAttribute("hidden")).toBe(false);
  });

  it("keeps a drill-in over a long tab after the tab is scrolled", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      loadLocales: async () => [{ code: "en-GB", label: "English" }],
    });
    const content = document.createElement("div");
    content.style.height = "3000px";
    el.appendChild(content);
    await el.updateComplete;
    const region = el.shadowRoot!.querySelector<HTMLElement>(".region")!;
    const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBeGreaterThan(0);
    const drillContent = document.createElement("div");
    drillContent.slot = "drill";
    drillContent.textContent = "Order details";
    el.appendChild(drillContent);
    await el.updateComplete;
    await el.updateComplete;
    const drill = el.shadowRoot!.querySelector<HTMLElement>(".drill")!;
    expect(drill.getBoundingClientRect().top).toBeCloseTo(region.getBoundingClientRect().top, 0);
    expect(drill.getBoundingClientRect().bottom).toBeCloseTo(
      region.getBoundingClientRect().bottom,
      0,
    );
    expect(el.shadowRoot!.querySelector<HTMLElement>("main.body")!.inert).toBe(true);
  });

  it("suppresses the whole operator header in kiosk mode, rendering only the body", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "kds",
      activeScreen: "kitchen",
      operatorName: "Ana",
      affordances: [],
      kiosk: true,
    });
    expect(el.shadowRoot!.querySelector(".tab")).toBeNull(); // no tab bar
    expect(el.shadowRoot!.querySelector(".logout")).toBeNull(); // no session chrome
    expect(el.shadowRoot!.querySelector("header")).toBeNull(); // header gone entirely
    expect(el.shadowRoot!.querySelector("slot:not([name])")).not.toBeNull(); // body slot stays
  });

  it.each([
    ["en-GB", "tablet-landscape"],
    ["es-ES", "phone-portrait"],
    ["en-GB", "phone-portrait"],
    ["es-ES", "tablet-landscape"],
  ] as const)(
    "fits the header, every button on screen, at phone width in %s with %s",
    async (locale, formFactor) => {
      const before = currentLocale();
      setLocale(locale);
      const width = window.innerWidth;
      const height = window.innerHeight;
      await page.viewport(390, 844);
      try {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor,
          activeScreen: "floor",
          operatorName: "Ana Fernández",
          affordances: ["find-bill", "station", "expo", "schedule"],
          loadLocales: async () => [{ code: locale, label: locale }],
        });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        expect(window.innerWidth).toBe(390);
        const header = el.shadowRoot!.querySelector("header")!;
        const menu = header.querySelector('wt-row-actions[data-test="more-menu"]')!;
        menu.shadowRoot!.querySelector<HTMLElement>("button")!.click();
        await vi.waitFor(() =>
          expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true),
        );
        const controls = [
          ...header.querySelectorAll<HTMLElement>(
            "wt-row-actions, .tab, wt-button, wt-language-chooser, .operator",
          ),
        ];
        expect(controls.length).toBe(11);
        // A tab past the bar's edge scrolls into view rather than wrapping.
        const offScreen = controls
          .map((c) => {
            if (c.classList.contains("tab"))
              c.scrollIntoView({ inline: "nearest", block: "nearest" });
            const r = c.getBoundingClientRect();
            return { c: c.className || c.localName, r };
          })
          .filter(({ r }) => r.width === 0 || r.left < 0 || r.right > 390)
          .map(({ c }) => c);
        expect(offScreen).toEqual([]);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
        // The bar is one row: every tab level with the first.
        const top = (selector: string): number =>
          header.querySelector(selector)!.getBoundingClientRect().top;
        for (const tab of header.querySelectorAll(".tab")) {
          expect(tab.getBoundingClientRect().top).toBe(top(".tab:first-child"));
        }
        expect(top(".station")).toBeGreaterThan(top(".find-bill"));
      } finally {
        await page.viewport(width, height);
        setLocale(before);
      }
    },
  );

  it("renders the full header when not in kiosk mode (default)", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      activeScreen: "floor",
    });
    expect(el.shadowRoot!.querySelector("header")).not.toBeNull();
  });
});

it("keeps the language chooser on a kitchen display, at the top right on its own, above the body", async () => {
  const { el } = await mountWidget<TillShell>("till-shell", {
    kiosk: true,
    loadLocales: async () => [{ code: "en-GB", label: "English" }],
  });
  expect(el.shadowRoot!.querySelector("header")).toBeNull();
  const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
  expect(chooser).not.toBeNull();
  const own = chooser.getBoundingClientRect();
  const shell = el.getBoundingClientRect();
  const region = el.shadowRoot!.querySelector(".region")!.getBoundingClientRect();
  expect(own.bottom).toBeLessThanOrEqual(region.top);
  expect(own.top - shell.top).toBeLessThanOrEqual(32);
  expect(shell.right - own.right).toBeLessThanOrEqual(32);
  expect(own.left).toBeGreaterThan(shell.left + shell.width / 2);
});

it("keeps the theme chooser beside the language chooser on a kitchen display, at the top right", async () => {
  const { el } = await mountWidget<TillShell>("till-shell", {
    kiosk: true,
    loadLocales: async () => [{ code: "en-GB", label: "English" }],
  });
  expect(el.shadowRoot!.querySelector("header")).toBeNull();
  const theme = el.shadowRoot!.querySelector(".language-corner > wt-theme-chooser")!;
  expect(theme).not.toBeNull();
  expect(theme.nextElementSibling?.localName).toBe("wt-language-chooser");
  await (theme as LitElement).updateComplete;
  const own = theme.getBoundingClientRect();
  const language = theme.nextElementSibling!.getBoundingClientRect();
  const shell = el.getBoundingClientRect();
  const region = el.shadowRoot!.querySelector(".region")!.getBoundingClientRect();
  expect(own.width).toBeGreaterThan(0);
  expect(own.bottom).toBeLessThanOrEqual(region.top);
  expect(own.top - shell.top).toBeLessThanOrEqual(32);
  expect(own.right).toBeLessThanOrEqual(language.left);
  expect(own.left).toBeGreaterThan(shell.left + shell.width / 2);
});

it.each(["till", "phone-portrait", "tablet-landscape"] as const)(
  "translates fixed primary screens for %s on a language switch",
  async (formFactor) => {
    const original = currentLocale();
    try {
      setLocale("en-GB");
      const { el } = await mountWidget<TillShell>("till-shell", { formFactor });
      const labels = () =>
        [...el.shadowRoot!.querySelectorAll(".tab")].map((e) => e.textContent!.trim());
      expect(labels()).toEqual(formFactor === "till" ? ["Counter", "Floor"] : ["Floor", "Order"]);
      setLocale("es-ES");
      await el.updateComplete;
      expect(labels()).toEqual(formFactor === "till" ? ["Mostrador", "Sala"] : ["Sala", "Pedido"]);
    } finally {
      setLocale(original);
    }
  },
);

const full: Partial<TillShell> = {
  formFactor: "tablet-landscape",
  activeScreen: "floor",
  operatorName: "Ana Fernández",
  affordances: ["find-bill", "station", "expo", "schedule"],
  transferAvailable: true,
  transferCount: 2,
  canSwitchProfile: true,
  loadLocales: async () => [
    { code: "en-GB", label: "English" },
    { code: "es-ES", label: "Español" },
  ],
};

// Menu order: each button's selector and the event it emits.
const menuActions = [
  [".find-bill", "find-bill"],
  [".expo", "show-expo"],
  [".station", "show-station"],
  [".schedule", "show-schedule"],
  [".profile", "open-profile"],
  [".equipment", "open-equipment"],
  ["[data-open-transfers]", "open-transfers"],
  [".logout", "logout"],
] as const;

/** Wide enough for `full`'s whole bar to fit on one row. */
const ROOMY_WIDTH = 2560;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function atViewport(width: number, run: () => Promise<void>, height = 844): Promise<void> {
  const before = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, height);
  await frame();
  try {
    await run();
  } finally {
    await page.viewport(before.width, before.height);
  }
}

const menuOf = (el: TillShell) =>
  el.shadowRoot!.querySelector('header wt-row-actions[data-test="more-menu"]');
const triggerOf = (el: TillShell) =>
  menuOf(el)!.shadowRoot!.querySelector<HTMLButtonElement>("button")!;

function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

describe("till-shell at phone width", () => {
  const clockedIn: Partial<TillShell> = {
    ...full,
    transferCount: undefined,
    canSwitchProfile: false,
    clockAvailable: true,
    clockState: {
      personId: "ana",
      locationId: "venue",
      businessDay: "2026-10-14",
      state: "working",
      activeLocationId: "venue",
      lastEntryId: "entry",
      firstClockIn: false,
    },
  };

  async function openMore(el: TillShell): Promise<HTMLElement> {
    const menu = menuOf(el)! as LitElement;
    await menu.updateComplete;
    await userEvent.click(triggerOf(el));
    const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
    return popup;
  }

  it.each([
    [360, 640],
    [390, 664],
  ])(
    "shows Log out inside the open More menu without scrolling at %ix%i, in Spanish",
    async (width, height) => {
      const original = currentLocale();
      setLocale("es-ES");
      try {
        await atViewport(
          width,
          async () => {
            const { el } = await mountWidget<TillShell>("till-shell", clockedIn);
            await frame();
            const popup = await openMore(el);
            expect(menuOf(el)!.querySelector(".operator")).not.toBeNull();
            expect(popup.scrollTop).toBe(0);
            const box = popup.getBoundingClientRect();
            const logout = menuOf(el)!
              .querySelector<HTMLElement>(".logout")!
              .getBoundingClientRect();
            expect(logout.height).toBeGreaterThan(0);
            expect(logout.top).toBeGreaterThanOrEqual(box.top);
            expect(logout.bottom, "Log out ends inside the menu's visible box").toBeLessThanOrEqual(
              box.bottom,
            );
          },
          height,
        );
      } finally {
        setLocale(original);
      }
    },
  );

  it("draws the Theme choices on one row inside More at 320 px", async () => {
    await atViewport(
      320,
      async () => {
        const { el } = await mountWidget<TillShell>("till-shell", clockedIn);
        await frame();
        await openMore(el);
        const tops = [
          ...menuOf(el)!.querySelectorAll<HTMLElement>("[data-test=theme-choices] button"),
        ].map((b) => b.getBoundingClientRect().top);
        expect(tops).toHaveLength(3);
        expect(new Set(tops).size, "the three choices share a top edge").toBe(1);
      },
      740,
    );
  });

  it.each([360])(
    "shows every tab in full at %i px with a counter-zone menu, in Spanish",
    async (width) => {
      const original = currentLocale();
      setLocale("es-ES");
      try {
        await atViewport(width, async () => {
          const { el } = await mountWidget<TillShell>("till-shell", {
            ...full,
            counterZones: [
              { id: "z1", name: "Downstairs bar" },
              { id: "z2", name: "Terraza" },
            ],
            selectedCounterZoneId: "z1",
          });
          await frame();
          const strip = el.shadowRoot!.querySelector<HTMLElement>("header nav.tabs")!;
          const box = strip.getBoundingClientRect();
          const tabs = [...strip.children].map((c) => c.getBoundingClientRect());
          expect(tabs).toHaveLength(2);
          expect(strip.scrollWidth, "the tab strip's content fits its box").toBeLessThanOrEqual(
            strip.clientWidth,
          );
          for (const tab of tabs) expect(tab.right).toBeLessThanOrEqual(box.right + 0.5);
        });
      } finally {
        setLocale(original);
      }
    },
  );

  it.each(["en-GB", "es-ES"] as const)(
    "keeps the header to one row at most 64 px tall in %s",
    async (locale) => {
      const original = currentLocale();
      setLocale(locale);
      try {
        await atViewport(390, async () => {
          const { el } = await mountWidget<TillShell>("till-shell", full);
          await frame();
          const header = el.shadowRoot!.querySelector("header")!.getBoundingClientRect();
          expect(header.height).toBeLessThanOrEqual(64);
          const visible = [
            ...el.shadowRoot!.querySelectorAll<HTMLElement>(
              "header .brand, header .tab, header wt-language-chooser, header wt-row-actions, header .session > *",
            ),
          ]
            .map((c) => c.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0);
          expect(visible.length).toBe(5);
          for (const r of visible) {
            expect(r.top).toBeGreaterThanOrEqual(header.top);
            expect(r.bottom).toBeLessThanOrEqual(header.bottom);
          }
        });
      } finally {
        setLocale(original);
      }
    },
  );

  it("puts every action button, the operator's name and the transfer count in one menu, by touch", async () => {
    await atViewport(390, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      const menu = menuOf(el)!;
      expect(menu).not.toBeNull();
      expect(menu.getAttribute("icon")).toBe("hamburger");
      expect(menu.shadowRoot!.querySelector("wt-icon")!.getAttribute("size")).toBe("lg");
      expect(menu.getAttribute("align")).toBe("end");
      expect(el.shadowRoot!.querySelector(".brand")).toBeNull();
      const order = [...menu.children]
        .filter((c) => c.slot !== "badge")
        .map((c) => (c.localName === "wt-menu-row" ? c.firstElementChild! : c))
        .map(
          (c) =>
            (c.getAttribute("data-test") ??
              (c.hasAttribute("data-open-transfers") ? "data-open-transfers" : c.className)) ||
            c.localName,
        );
      expect(order).toEqual([
        "find-bill",
        "expo",
        "station",
        "schedule",
        "profile",
        "equipment",
        "department-transfers",
        "data-open-transfers",
        "operator",
        "logout",
        "theme-choices",
      ]);
      expect(menu.querySelector(".operator")!.textContent).toContain("Ana Fernández");
      expect(menu.querySelector('[data-test="department-transfers"]')!.textContent).toContain(
        t("department_transfer.open").replace("{count}", "2"),
      );
      for (const button of menu.querySelectorAll("wt-button")) {
        expect(button.getAttribute("variant")).toBe("ghost");
        expect(button.getAttribute("align")).toBe("start");
      }

      const fired: string[] = [];
      for (const [, type] of menuActions) el.addEventListener(type, () => fired.push(type));
      for (const [selector] of menuActions) {
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        await userEvent.click(menu.querySelector<HTMLElement>(selector)!);
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("false"));
      }
      expect(fired).toEqual(menuActions.map(([, type]) => type));

      const keys: string[] = [];
      el.addEventListener("screen-select", (e) =>
        keys.push((e as CustomEvent<{ screen: string }>).detail.screen),
      );
      for (const tab of el.shadowRoot!.querySelectorAll<HTMLElement>(".tab")) {
        await userEvent.click(tab);
      }
      expect(keys).toEqual(["floor", "order"]);
    });
  });

  it("reaches every action by keyboard", async () => {
    await atViewport(390, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      const fired: string[] = [];
      for (const [, type] of menuActions) el.addEventListener(type, () => fired.push(type));
      const tabsEls = el.shadowRoot!.querySelectorAll<HTMLElement>(".tab");
      for (const [index, [selector]] of menuActions.entries()) {
        tabsEls[tabsEls.length - 1]!.focus();
        await userEvent.tab(); // the language chooser
        await userEvent.tab(); // the Help switch
        await userEvent.tab();
        expect(deepActive()).toBe(triggerOf(el));
        await userEvent.keyboard("{Enter}");
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        for (let step = 0; step <= index; step += 1) await userEvent.tab();
        const target = menuOf(el)!.querySelector<HTMLElement>(selector)!;
        expect(target.contains(deepActive()) || target.shadowRoot!.contains(deepActive())).toBe(
          true,
        );
        await userEvent.keyboard("{Enter}");
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("false"));
      }
      expect(fired).toEqual(menuActions.map(([, type]) => type));
    });
  });

  it("badges the menu with the pending transfers and says so in its name", async () => {
    const original = currentLocale();
    setLocale("en-GB");
    try {
      await atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        const badge = menuOf(el)!.querySelector<HTMLElement>('wt-count-badge[slot="badge"]')!;
        expect(badge.getAttribute("tone")).toBe("warning");
        expect(badge.shadowRoot!.textContent).toContain("2");
        expect(triggerOf(el).getAttribute("aria-label")).toBe("More, 2 transfers pending");

        el.transferCount = 1;
        await el.updateComplete;
        await (menuOf(el) as LitElement).updateComplete;
        expect(
          menuOf(el)!.querySelector('wt-count-badge[slot="badge"]')!.shadowRoot!.textContent,
        ).toContain("1");
        expect(triggerOf(el).getAttribute("aria-label")).toBe("More, 1 transfer pending");

        for (const transferCount of [0, undefined]) {
          el.transferCount = transferCount;
          await el.updateComplete;
          await (menuOf(el) as LitElement).updateComplete;
          expect(menuOf(el)!.querySelector("wt-count-badge")).toBeNull();
          expect(triggerOf(el).getAttribute("aria-label")).toBe("More");
        }
      });
    } finally {
      setLocale(original);
    }
  });

  it("names the menu in Spanish", async () => {
    const original = currentLocale();
    setLocale("es-ES");
    try {
      await atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await (menuOf(el) as LitElement).updateComplete;
        expect(triggerOf(el).getAttribute("aria-label")).toBe("Más, traspasos pendientes: 2");
        el.transferCount = 1;
        await el.updateComplete;
        await (menuOf(el) as LitElement).updateComplete;
        expect(triggerOf(el).getAttribute("aria-label")).toBe("Más, traspasos pendientes: 1");
        el.transferCount = 0;
        await el.updateComplete;
        await (menuOf(el) as LitElement).updateComplete;
        expect(triggerOf(el).getAttribute("aria-label")).toBe("Más");
      });
    } finally {
      setLocale(original);
    }
  });

  it.each(["en-GB", "es-ES"] as const)(
    "keeps the open menu on a short landscape screen and scrolls it to Log out, in %s",
    async (locale) => {
      const original = currentLocale();
      setLocale(locale);
      try {
        await atViewport(
          600,
          async () => {
            const { el } = await mountWidget<TillShell>("till-shell", full);
            await userEvent.click(triggerOf(el));
            await vi.waitFor(() =>
              expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"),
            );
            const popup = menuOf(el)!
              .shadowRoot!.querySelector<HTMLElement>("[popover]")!
              .getBoundingClientRect();
            expect(popup.top).toBeGreaterThanOrEqual(0);
            expect(popup.bottom).toBeLessThanOrEqual(window.innerHeight);

            const logout = menuOf(el)!.querySelector<HTMLElement>(".logout")!;
            logout.scrollIntoView({ block: "nearest" });
            const box = logout.getBoundingClientRect();
            expect(box.top).toBeGreaterThanOrEqual(popup.top);
            expect(box.bottom).toBeLessThanOrEqual(popup.bottom);
            expect(
              el.shadowRoot!.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
            ).toBe(logout);
            let loggedOut = 0;
            el.addEventListener("logout", () => (loggedOut += 1));
            await userEvent.click(logout);
            expect(loggedOut).toBe(1);
          },
          390,
        );
      } finally {
        setLocale(original);
      }
    },
  );

  it("announces the transfer count while the menu is closed, from one status region outside it", async () => {
    await atViewport(390, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      const statuses = () => [...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="status"]')];
      expect(statuses()).toHaveLength(1);
      const status = statuses()[0]!;
      expect(menuOf(el)!.contains(status)).toBe(false);
      expect(status.checkVisibility()).toBe(true);
      expect(status.textContent).toContain(t("department_transfer.open").replace("{count}", "2"));
      expect(
        menuOf(el)!.querySelector('[data-test="department-transfers"]')!.hasAttribute("role"),
      ).toBe(false);

      el.transferCount = 3;
      await el.updateComplete;
      expect(statuses()).toEqual([status]);
      expect(status.textContent).toContain(t("department_transfer.open").replace("{count}", "3"));

      el.transferCount = undefined;
      await el.updateComplete;
      expect(statuses()).toEqual([status]);
      expect(status.textContent!.trim()).toBe("");
    });
  });

  it("draws the wide handheld header with Find a bill in More and every other button in priority order", async () => {
    await atViewport(ROOMY_WIDTH, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      expect(
        el
          .shadowRoot!.querySelector('wt-row-actions[data-test="more-menu"]')!
          .querySelectorAll(":scope > *"),
      ).toHaveLength(1);
      expect(el.shadowRoot!.querySelector("wt-row-actions.operator-menu")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("header > .brand")!.textContent).toBe("Waitron");
      const session = el.shadowRoot!.querySelector("header .session")!;
      expect(
        [...session.children].map(
          (c) =>
            (c.getAttribute("data-test") ??
              (c.hasAttribute("data-open-transfers") ? "data-open-transfers" : c.className)) ||
            c.localName,
        ),
      ).toEqual([
        "expo",
        "station",
        "schedule",
        "profile",
        "equipment",
        "department-transfers",
        "data-open-transfers",
        "wt-language-chooser",
        "help-switch",
        "operator-menu",
        "more-menu",
      ]);
      for (const button of session.querySelectorAll(":scope > wt-button")) {
        expect(button.getAttribute("variant")).toBe("secondary");
      }
    });
  });

  it("switches layout as the screen narrows and widens, keeping the one language chooser", async () => {
    await atViewport(390, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
      expect(menuOf(el)).not.toBeNull();
      await page.viewport(ROOMY_WIDTH, 844);
      await vi.waitFor(() => expect(menuOf(el)!.querySelectorAll(":scope > *")).toHaveLength(1));
      expect(el.shadowRoot!.querySelector(".brand")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("wt-language-chooser")).toBe(chooser);
      await page.viewport(390, 844);
      await vi.waitFor(() => expect(menuOf(el)).not.toBeNull());
      expect(el.shadowRoot!.querySelector(".brand")).toBeNull();
      expect(el.shadowRoot!.querySelector("wt-language-chooser")).toBe(chooser);
    });
  });
});

describe("till-shell above phone width", () => {
  /** The order in which the bar's items leave for More, first to leave first: each item's key and
   * the selector of its button. */
  const leaveOrder = [
    ["transfers", "[data-open-transfers]"],
    ["equipment", ".equipment"],
    ["profile", ".profile"],
    ["schedule", ".schedule"],
    ["station", ".station"],
    ["expo", ".expo"],
    ["operator", ".logout"],
  ] as const;

  const settle = async (el: TillShell) => {
    await frame();
    await frame();
    await el.updateComplete;
  };

  const inMore = (el: TillShell): string[] => {
    const menu = menuOf(el);
    return menu === null
      ? []
      : leaveOrder.filter(([, selector]) => menu.querySelector(selector) !== null).map(([k]) => k);
  };

  const popoverOpen = (el: TillShell) =>
    menuOf(el)!.shadowRoot!.querySelector("[popover]")!.matches(":popover-open");

  const withLocale = async (locale: string, run: () => Promise<void>) => {
    const original = currentLocale();
    setLocale(locale);
    try {
      await run();
    } finally {
      setLocale(original);
    }
  };

  function expectOneRow(el: TillShell): void {
    const header = el.shadowRoot!.querySelector("header")!;
    const box = header.getBoundingClientRect();
    const parts = [
      ...header.querySelectorAll<HTMLElement>(
        ":scope > .brand, :scope > .tabs, :scope > .session > *",
      ),
    ]
      .map((part) => ({ name: part.className || part.localName, r: part.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const centres = parts.map(({ r }) => r.top + r.height / 2);
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(2);
    for (const { name, r } of parts) {
      expect(r.top, name).toBeGreaterThanOrEqual(box.top);
      expect(r.bottom, name).toBeLessThanOrEqual(box.bottom);
      expect(r.left, name).toBeGreaterThanOrEqual(box.left);
      expect(r.right, name).toBeLessThanOrEqual(box.right);
    }
    expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  }

  /** Each action is in the header once, on the bar or inside one of its menus, and emits its event. */
  async function expectEachActionOnce(el: TillShell): Promise<void> {
    const header = el.shadowRoot!.querySelector("header")!;
    const fired: string[] = [];
    for (const [, type] of menuActions) el.addEventListener(type, () => fired.push(type));
    for (const [selector] of menuActions) {
      const found = [...header.querySelectorAll<HTMLElement>(selector)];
      expect(found, selector).toHaveLength(1);
      const target = found[0]!;
      const menu = target.closest("wt-row-actions");
      if (menu !== null) {
        const trigger = menu.shadowRoot!.querySelector("button")!;
        await userEvent.click(trigger);
        await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
        const r = target.getBoundingClientRect();
        expect(r.width, selector).toBeGreaterThan(0);
        expect(r.left, selector).toBeGreaterThanOrEqual(0);
        expect(r.right, selector).toBeLessThanOrEqual(window.innerWidth);
        await userEvent.click(target);
        await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
      } else {
        const r = target.getBoundingClientRect();
        expect(r.width, selector).toBeGreaterThan(0);
        expect(r.left, selector).toBeGreaterThanOrEqual(0);
        expect(r.right, selector).toBeLessThanOrEqual(window.innerWidth);
        await userEvent.click(target);
      }
    }
    expect(fired).toEqual(menuActions.map(([, type]) => type));
  }

  for (const width of [700, 1024, 1280]) {
    for (const locale of ["en-GB", "es-ES"]) {
      it(`keeps the bar to one row at ${width} wide in ${locale}, every action reachable once`, async () => {
        await withLocale(locale, () =>
          atViewport(width, async () => {
            const { el } = await mountWidget<TillShell>("till-shell", full);
            await settle(el);
            expectOneRow(el);
            await expectEachActionOnce(el);
          }),
        );
      });
    }
  }

  it.each(["en-GB", "es-ES"] as const)(
    "moves items into More in a fixed order as the screen narrows, in %s",
    async (locale) => {
      await withLocale(locale, () =>
        atViewport(1600, async () => {
          const { el } = await mountWidget<TillShell>("till-shell", full);
          await settle(el);
          let before: string[] = [];
          const seen = new Set<number>();
          for (let width = 1600; width >= 660; width -= 40) {
            await page.viewport(width, 844);
            await settle(el);
            const now = inMore(el);
            expect(now, `${width}`).toEqual(leaveOrder.slice(0, now.length).map(([k]) => k));
            expect(now.length, `${width}`).toBeGreaterThanOrEqual(before.length);
            if (now.length > 0)
              expect(el.shadowRoot!.querySelector(".brand"), `${width}`).toBeNull();
            expectOneRow(el);
            seen.add(now.length);
            before = now;
          }
          // The walk saw a bar with some items left and some still on it.
          expect([...seen].some((n) => n > 0 && n < leaveOrder.length)).toBe(true);
        }),
      );
    },
  );

  const compactHandheld: Partial<TillShell> = {
    formFactor: "tablet-landscape",
    activeScreen: "counter",
    operatorName: "Ana",
    affordances: ["find-bill", "station", "expo", "schedule"],
    transferAvailable: true,
    transferCount: 1,
    loadLocales: full.loadLocales!,
  };

  const service = [".expo", ".station"] as const;

  /** What each item that ranks below Pass and Kitchen draws in the session row. */
  const belowService: Record<string, readonly string[]> = {
    transfers: ['[data-test="department-transfers"]', "[data-open-transfers]"],
    equipment: [".equipment"],
    profile: [".profile"],
    schedule: [".schedule"],
  };

  /** The items of `shell` that rank below Pass and Kitchen, and the viewport widths
   * just wide enough (`fits`) and just too narrow (`tight`) for its bar to keep both with the
   * name hidden and those items in More. Measured in the running browser, because how wide the text
   * draws differs between platforms. */
  async function serviceWidths(
    shell: Partial<TillShell>,
  ): Promise<{ below: string[]; fits: number; tight: number }> {
    let result = { below: [] as string[], fits: 0, tight: 0 };
    await atViewport(ROOMY_WIDTH, async () => {
      const { el, host } = await mountWidget<TillShell>("till-shell", shell);
      await settle(el);
      await settle(el);
      expect(menuOf(el)!.querySelectorAll(":scope > *")).toHaveLength(1);
      const header = el.shadowRoot!.querySelector("header")!;
      const session = header.querySelector<HTMLElement>(".session")!;
      const width = (node: Element) => node.getBoundingClientRect().width;
      const px = (value: string) => parseFloat(value);
      const below = leaveOrder
        .slice(
          0,
          leaveOrder.findIndex(([key]) => key === "station"),
        )
        .filter(([, selector]) => header.querySelector(selector) !== null)
        .map(([key]) => key);
      const sessionGap = px(getComputedStyle(session).columnGap);
      const head = getComputedStyle(header);
      let need =
        px(head.paddingLeft) +
        px(head.columnGap) +
        width(header.querySelector(".tabs")!) +
        width(session) +
        px(head.paddingRight);
      for (const key of below) {
        for (const selector of belowService[key]!) {
          need -= width(session.querySelector(`:scope > ${selector}`)!) + sessionGap;
        }
      }
      const offset = window.innerWidth - width(header);
      await page.viewport(700, 844);
      await settle(el);
      host.remove();
      result = {
        below,
        fits: Math.ceil(need + offset) + 2,
        tight: Math.floor(need + offset) - 2,
      };
    });
    return result;
  }

  for (const [fixture, shell] of [
    ["full", full],
    ["a compact handheld", compactHandheld],
  ] as const) {
    for (const locale of ["en-GB", "es-ES"] as const) {
      it(`moves the transfers, and what ranks below Pass and Kitchen, into More before them, then Kitchen first, with ${fixture} in ${locale}`, async () => {
        await withLocale(locale, async () => {
          const { below, fits, tight } = await serviceWidths(shell);
          expect(below[0]).toBe("transfers");
          for (const [width, left] of [
            [fits, below],
            [tight, [...below, "station"]],
          ] as const) {
            await atViewport(width, async () => {
              const { el, host } = await mountWidget<TillShell>("till-shell", shell);
              await settle(el);
              if (width <= 640) {
                expect(el.shadowRoot!.querySelector("header.phone"), `${width}`).not.toBeNull();
                expect(inMore(el), `${width}`).toEqual(
                  fixture === "full"
                    ? [
                        "transfers",
                        "equipment",
                        "profile",
                        "schedule",
                        "station",
                        "expo",
                        "operator",
                      ]
                    : ["transfers", "equipment", "schedule", "station", "expo", "operator"],
                );
                expectOneRow(el);
                host.remove();
                return;
              }
              expect(el.shadowRoot!.querySelector("header.phone"), `${width}`).toBeNull();
              expect(inMore(el), `${width}`).toEqual(left);
              const menu = menuOf(el)!;
              for (const selector of service) {
                const found = [
                  ...el.shadowRoot!.querySelectorAll<HTMLElement>(`header ${selector}`),
                ];
                expect(found, `${width} ${selector}`).toHaveLength(1);
                const moved = left.includes(selector.slice(1));
                expect(menu.contains(found[0]!), `${width} ${selector}`).toBe(moved);
                if (moved) continue;
                const r = found[0]!.getBoundingClientRect();
                expect(r.width, `${width} ${selector}`).toBeGreaterThan(0);
                expect(r.left, `${width} ${selector}`).toBeGreaterThanOrEqual(0);
                expect(r.right, `${width} ${selector}`).toBeLessThanOrEqual(window.innerWidth);
              }
              expectOneRow(el);
              host.remove();
            });
          }
        });
      });
    }
  }

  it.each([
    ["en-GB", "Transfers", "Department transfers"],
    ["es-ES", "Traspasos", "Traspasos entre departamentos"],
  ] as const)(
    "names the bar's transfers button with the short name in %s, keeping the dialog's full title",
    async (locale, short, title) => {
      await withLocale(locale, () =>
        atViewport(ROOMY_WIDTH, async () => {
          const { el } = await mountWidget<TillShell>("till-shell", full);
          await settle(el);
          expect(menuOf(el)!.querySelectorAll(":scope > *")).toHaveLength(1);
          const button = el.shadowRoot!.querySelector<HTMLElement>(
            "header .session > [data-open-transfers]",
          )!;
          expect(button.textContent!.trim()).toBe(short);
          expect(t("department_transfer.short")).toBe(short);
          expect(t("department_transfer.title")).toBe(title);
        }),
      );
    },
  );

  it.each([
    ["en-GB", "Log out", "Log out"],
    ["es-ES", "Salir", "Cerrar sesión"],
  ] as const)(
    "labels Log out %s's short word, in the name menu and inside More, keeping the counter header's full name",
    async (locale, label, headerName) => {
      await withLocale(locale, async () => {
        expect(t("action.logout")).toBe(headerName);
        await atViewport(ROOMY_WIDTH, async () => {
          const { el, host } = await mountWidget<TillShell>("till-shell", full);
          await settle(el);
          expect(menuOf(el)!.querySelectorAll(":scope > *")).toHaveLength(1);
          const nameMenu = el.shadowRoot!.querySelector("wt-row-actions.operator-menu")!;
          const onBar = nameMenu.querySelector<HTMLElement>(".logout")!;
          expect(onBar.textContent!.trim()).toBe(label);
          await userEvent.click(nameMenu.shadowRoot!.querySelector("button")!);
          await expect
            .element(page.getByRole("button", { name: label, exact: true }))
            .toBeVisible();
          host.remove();
        });
        await atViewport(390, async () => {
          const { el } = await mountWidget<TillShell>("till-shell", full);
          await settle(el);
          const inMenu = menuOf(el)!.querySelector<HTMLElement>(".logout")!;
          expect(inMenu.textContent!.trim()).toBe(label);
          await userEvent.click(triggerOf(el));
          await expect
            .element(page.getByRole("button", { name: label, exact: true }))
            .toBeVisible();
        });
      });
    },
  );

  it("keeps Pass and Kitchen on a compact handheld's Spanish bar at 800 wide when its measured width fits there", async () => {
    await withLocale("es-ES", async () => {
      const { fits, tight } = await serviceWidths(compactHandheld);
      console.info(`The compact handheld's Spanish bar keeps Pass and Kitchen from ${fits} px.`);
      await atViewport(800, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", compactHandheld);
        await settle(el);
        expect(el.shadowRoot!.querySelector("header.phone")).toBeNull();
        const moved = inMore(el);
        if (800 >= fits) {
          for (const key of ["expo", "station"]) {
            expect(moved, `fits from ${fits}`).not.toContain(key);
          }
        }
        if (800 <= tight) expect(moved, `fits from ${fits}`).toContain("station");
        expectOneRow(el);
      });
    });
  });

  it("keeps More in the bar's order, showing only the items that left", async () => {
    await atViewport(1024, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      await settle(el);
      const menu = menuOf(el)!;
      const order = [...menu.children]
        .filter((c) => c.slot !== "badge")
        .map((c) => (c.localName === "wt-menu-row" ? c.firstElementChild! : c))
        .map(
          (c) =>
            (c.getAttribute("data-test") ??
              (c.hasAttribute("data-open-transfers") ? "data-open-transfers" : c.className)) ||
            c.localName,
        );
      const barOrder = [
        "find-bill",
        "expo",
        "station",
        "schedule",
        "profile",
        "equipment",
        "department-transfers",
        "data-open-transfers",
        "operator",
        "logout",
        "theme-choices",
      ];
      expect(order.length).toBeGreaterThan(0);
      expect(order).toEqual(barOrder.filter((key) => order.includes(key)));
      expect(order.length).toBeLessThan(barOrder.length);
      for (const key of order) {
        const selector = key.startsWith("data-") ? `[${key}]` : `.${key}`;
        if (key === "department-transfers") continue;
        expect(el.shadowRoot!.querySelectorAll(`header ${selector}`), key).toHaveLength(1);
      }
      for (const button of menu.querySelectorAll("wt-button")) {
        expect(button.getAttribute("variant")).toBe("ghost");
        expect(button.getAttribute("align")).toBe("start");
      }
      for (const button of el.shadowRoot!.querySelectorAll("header .session > wt-button")) {
        expect(button.getAttribute("variant")).toBe("secondary");
      }
      const session = el.shadowRoot!.querySelector("header .session")!;
      expect(session.lastElementChild).toBe(menu);
    });
  });

  it("puts every item back on the bar, and the name, once the screen is wide enough", async () => {
    await atViewport(700, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      await settle(el);
      expect(menuOf(el)).not.toBeNull();
      expect(el.shadowRoot!.querySelector(".brand")).toBeNull();
      await page.viewport(ROOMY_WIDTH, 844);
      await settle(el);
      expect(menuOf(el)!.querySelectorAll(":scope > *")).toHaveLength(1);
      expect(el.shadowRoot!.querySelector("header > .brand")!.textContent).toBe("Waitron");
      expectOneRow(el);
    });
  });

  it("refits when the operator's name grows", async () => {
    await withLocale("en-GB", () =>
      atViewport(1100, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        const was = inMore(el).length;
        el.operatorName = "María de los Ángeles Fernández-Villaverde y Castro";
        await settle(el);
        expectOneRow(el);
        expect(inMore(el).length).toBeGreaterThan(was);
        await expectEachActionOnce(el);
      }),
    );
  });

  it("refits when actions are added, and gives them back when they go", async () => {
    await atViewport(1280, async () => {
      const few: Partial<TillShell> = {
        ...full,
        affordances: [],
        canSwitchProfile: false,
        transferAvailable: false,
        transferCount: undefined,
      };
      const { el } = await mountWidget<TillShell>("till-shell", few);
      await settle(el);
      expect(menuOf(el)).toBeNull();
      expect(el.shadowRoot!.querySelector(".brand")).not.toBeNull();
      Object.assign(el, full);
      await settle(el);
      expectOneRow(el);
      expect(menuOf(el)).not.toBeNull();
      await expectEachActionOnce(el);
      Object.assign(el, few);
      await settle(el);
      expectOneRow(el);
      expect(menuOf(el)).toBeNull();
      expect(el.shadowRoot!.querySelector(".brand")).not.toBeNull();
    });
  });

  it("refits when the language changes", async () => {
    await withLocale("en-GB", () =>
      atViewport(1280, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        expectOneRow(el);
        setLocale("es-ES");
        await settle(el);
        expectOneRow(el);
        await expectEachActionOnce(el);
        setLocale("en-GB");
        await settle(el);
        expectOneRow(el);
      }),
    );
  });

  const statuses = (el: TillShell) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="status"]'),
  ];

  it("keeps the visible count as the status while the transfers are on the bar", async () => {
    await withLocale("en-GB", () =>
      atViewport(ROOMY_WIDTH, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        expect(menuOf(el)!.querySelectorAll(":scope > *")).toHaveLength(1);
        const [status, ...rest] = statuses(el);
        expect(rest).toEqual([]);
        expect(status!.getAttribute("data-test")).toBe("department-transfers");
        expect(status!.parentElement).toBe(el.shadowRoot!.querySelector("header .session"));
        expect(status!.getBoundingClientRect().width).toBeGreaterThan(1);
        expect(status!.textContent).toContain(
          t("department_transfer.open").replace("{count}", "2"),
        );
      }),
    );
  });

  it("badges More and announces from one region outside it once the transfers have left", async () => {
    await withLocale("en-GB", () =>
      atViewport(700, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        const menu = menuOf(el)!;
        expect(menu.querySelector("[data-open-transfers]")).not.toBeNull();
        const badge = menu.querySelector<HTMLElement>('wt-count-badge[slot="badge"]')!;
        expect(badge.getAttribute("tone")).toBe("warning");
        await (menu as LitElement).updateComplete;
        expect(triggerOf(el).getAttribute("aria-label")).toBe("More, 2 transfers pending");
        const [status, ...rest] = statuses(el);
        expect(rest).toEqual([]);
        expect(menu.contains(status!)).toBe(false);
        expect(status!.checkVisibility()).toBe(true);
        expect(status!.textContent).toContain(
          t("department_transfer.open").replace("{count}", "2"),
        );
      }),
    );
  });

  it("keeps an open More open, and the same status region, when the transfer count changes while the transfers are in More", async () => {
    await withLocale("en-GB", () =>
      atViewport(1024, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        const menu = menuOf(el)!;
        expect(menu.querySelector("[data-open-transfers]")).not.toBeNull();
        const [status] = statuses(el);
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        el.transferCount = 3;
        await settle(el);
        expect(menuOf(el)).toBe(menu);
        expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true");
        expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
        expect(statuses(el)).toEqual([status]);
        expect(status!.textContent).toContain(
          t("department_transfer.open").replace("{count}", "3"),
        );
      }),
    );
  });

  it("waits for an open More to close before giving items back to a wider bar", async () => {
    await withLocale("en-GB", () =>
      atViewport(1024, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        const menu = menuOf(el)!;
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        const held = inMore(el);
        await page.viewport(ROOMY_WIDTH, 844);
        await settle(el);
        expect(menuOf(el)).toBe(menu);
        expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
        expect(inMore(el)).toEqual(held);
        await userEvent.keyboard("{Escape}");
        await settle(el);
        expect(menuOf(el)!.querySelectorAll(":scope > *")).toHaveLength(1);
        expect(el.shadowRoot!.querySelector(".brand")).not.toBeNull();
        expectOneRow(el);
      }),
    );
  });

  it("keeps every item in an open More when an item earlier in the leaving order appears", async () => {
    await withLocale("en-GB", () =>
      atViewport(660, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", {
          ...full,
          canSwitchProfile: false,
        });
        await settle(el);
        const menu = menuOf(el)!;
        const held = inMore(el);
        // Profile would come third in the leaving order, so with three or more items already in
        // More its arrival shifts the count's slice by one.
        expect(held).toContain("schedule");
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        await page.viewport(ROOMY_WIDTH, 844);
        await settle(el);
        el.canSwitchProfile = true;
        await settle(el);
        expect(menuOf(el)).toBe(menu);
        expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true");
        expect(popoverOpen(el)).toBe(true);
        expect(inMore(el)).toEqual(
          leaveOrder.map(([k]) => k).filter((k) => k === "profile" || held.includes(k)),
        );
        await userEvent.keyboard("{Escape}");
        await settle(el);
        expect(menuOf(el)!.querySelectorAll(":scope > *")).toHaveLength(1);
        expect(el.shadowRoot!.querySelector(".brand")).not.toBeNull();
        expectOneRow(el);
      }),
    );
  });

  it("keeps an open More, and everything in it, when the screen widens out of phone width", async () => {
    await withLocale("en-GB", () =>
      atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        const menu = menuOf(el)!;
        const everything = leaveOrder.map(([k]) => k);
        expect(inMore(el)).toEqual(everything);
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        await page.viewport(1280, 844);
        await settle(el);
        expect(menuOf(el)).toBe(menu);
        expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true");
        expect(popoverOpen(el)).toBe(true);
        expect(inMore(el)).toEqual(everything);
        expect(el.shadowRoot!.querySelector(".brand")).toBeNull();
        expectOneRow(el);
        await userEvent.keyboard("{Escape}");
        await settle(el);
        const { el: fresh } = await mountWidget<TillShell>("till-shell", full);
        await settle(fresh);
        expect(inMore(fresh).length).toBeLessThan(everything.length);
        expect(inMore(el)).toEqual(inMore(fresh));
        expectOneRow(el);
      }),
    );
  });

  it("refits when the shell redraws between More closing and its toggle event", async () => {
    await withLocale("en-GB", () =>
      atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        await page.viewport(1280, 844);
        await settle(el);
        // A tap's click reaches the shell after More has hidden itself, and the redraw this asks
        // for runs before the popover's toggle event, which comes as a later task.
        el.addEventListener("click", () => el.requestUpdate(), { once: true });
        await userEvent.click(menuOf(el)!.querySelector<HTMLElement>(".schedule")!);
        await settle(el);
        const { el: fresh } = await mountWidget<TillShell>("till-shell", full);
        await settle(fresh);
        expect(inMore(fresh).length).toBeLessThan(leaveOrder.length);
        expect(inMore(el)).toEqual(inMore(fresh));
        expectOneRow(el);
        await expectEachActionOnce(el);
      }),
    );
  });

  it("keeps an open More, gaining what is left, when the screen narrows into phone width", async () => {
    await withLocale("en-GB", () =>
      atViewport(1024, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        const menu = menuOf(el)!;
        expect(inMore(el).length).toBeLessThan(leaveOrder.length);
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        await page.viewport(390, 844);
        await settle(el);
        expect(menuOf(el)).toBe(menu);
        expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true");
        expect(popoverOpen(el)).toBe(true);
        expect(inMore(el)).toEqual(leaveOrder.map(([k]) => k));
      }),
    );
  });

  it("keeps everything in More when an open More that held a redraw closes at phone width, and refits once wider", async () => {
    await withLocale("en-GB", () =>
      atViewport(1024, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        const fitted = inMore(el);
        expect(fitted.length).toBeLessThan(leaveOrder.length);
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        el.transferCount = 3;
        await settle(el);
        await page.viewport(390, 844);
        await settle(el);
        await userEvent.keyboard("{Escape}");
        await settle(el);
        expect(popoverOpen(el)).toBe(false);
        expect(inMore(el)).toEqual(leaveOrder.map(([k]) => k));
        expect(el.shadowRoot!.querySelector(".brand")).toBeNull();
        await page.viewport(1024, 844);
        await settle(el);
        expect(inMore(el)).toEqual(fitted);
        expectOneRow(el);
      }),
    );
  });

  it("leaves kiosk mode cleanly while a fit begun in kiosk mode is still under way", async () => {
    await withLocale("en-GB", () =>
      atViewport(ROOMY_WIDTH, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", { ...full, kiosk: true });
        await settle(el);
        const rejections: unknown[] = [];
        const record = (event: PromiseRejectionEvent) => rejections.push(event.reason);
        addEventListener("unhandledrejection", record);
        try {
          // Each pass switches kiosk mode off one microtask later than the last, so some pass
          // does it after the fit has looked at kiosk mode and before the shell has redrawn.
          for (let ticks = 0; ticks <= 20; ticks += 1) {
            Object.assign(el, { kiosk: true, transferCount: 2 });
            await settle(el);
            expect(el.shadowRoot!.querySelector("header")).toBeNull();
            el.transferCount = 3;
            for (let i = 0; i < ticks; i += 1) await Promise.resolve();
            el.kiosk = false;
            await settle(el);
            expect(menuOf(el)!.querySelectorAll(":scope > *"), `${ticks}`).toHaveLength(1);
            expect(el.shadowRoot!.querySelector("header > .brand"), `${ticks}`).not.toBeNull();
            expectOneRow(el);
          }
          await frame();
          expect(rejections.map(String)).toEqual([]);
        } finally {
          removeEventListener("unhandledrejection", record);
        }
      }),
    );
  });

  it("keeps fitting after it is taken off the page and put back", async () => {
    await atViewport(ROOMY_WIDTH, async () => {
      const { el, host } = await mountWidget<TillShell>("till-shell", full);
      await settle(el);
      expect(menuOf(el)!.querySelectorAll(":scope > *")).toHaveLength(1);
      el.remove();
      host.append(el);
      await settle(el);
      await page.viewport(1024, 844);
      await settle(el);
      expect(menuOf(el)).not.toBeNull();
      expectOneRow(el);
    });
  });

  const shortName = { operatorName: "Ana" };
  const longName = { operatorName: "María de los Ángeles Fernández-Villaverde y Castro" };

  it.each(
    (
      [
        [
          "the name grows, then the transfer count changes",
          shortName,
          longName,
          { transferCount: 120 },
        ],
        [
          "the name shrinks, then the transfer count changes",
          longName,
          shortName,
          { transferCount: 3 },
        ],
        ["the name grows, then shrinks back", shortName, longName, shortName],
      ] as const
    ).flatMap(([how, start, first, second]) =>
      (
        [
          [0, 13],
          [14, 27],
          [28, 40],
        ] as const
      ).map(([from, to]) => [how, start, first, second, from, to] as const),
    ),
  )(
    "fits as a fresh bar does when %s before the first refit has finished [batch %#]",
    async (_how, start, first, second, from, to) => {
      await withLocale("en-GB", () =>
        atViewport(1100, async () => {
          const { el: fresh } = await mountWidget<TillShell>("till-shell", {
            ...full,
            ...start,
            ...first,
            ...second,
          });
          await settle(fresh);
          const want = inMore(fresh);
          fresh.remove();
          const { el } = await mountWidget<TillShell>("till-shell", { ...full, ...start });
          await settle(el);
          const differs: string[] = [];
          // Each pass starts the second fit one microtask later than the last, so some pass cuts
          // the first short at each of its waits.
          for (let ticks = from; ticks <= to; ticks += 1) {
            Object.assign(el, full, start);
            await settle(el);
            Object.assign(el, first);
            for (let i = 0; i < ticks; i += 1) await Promise.resolve();
            Object.assign(el, second);
            await settle(el);
            expectOneRow(el);
            if (inMore(el).join() !== want.join()) differs.push(`${ticks}: ${inMore(el).join()}`);
          }
          expect(want.length).toBeGreaterThan(0);
          expect(want.length).toBeLessThan(leaveOrder.length);
          expect(differs, `fresh: ${want.join()}`).toEqual([]);
        }),
      );
    },
  );

  it("reports no ResizeObserver loop while the screen narrows and widens across the phone width", async () => {
    await atViewport(1280, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      await settle(el);
      const errors: string[] = [];
      const record = (event: ErrorEvent) => errors.push(event.message);
      addEventListener("error", record);
      try {
        for (const width of [1024, 700, 641, 640, 390, 700, 1280, ROOMY_WIDTH, 390, 1280]) {
          await page.viewport(width, 844);
          await settle(el);
          expect(errors, `${width}`).toEqual([]);
        }
        expectOneRow(el);
      } finally {
        removeEventListener("error", record);
      }
    });
  });
});

it.each([
  ["till", ["Counter", "Floor"], "counter", "floor"],
  ["phone-portrait", ["Floor", "Order"], "floor", "order"],
  ["tablet-landscape", ["Floor", "Order"], "floor", "order"],
] as const)(
  "fixed primary screens for %s work without an authored tab list",
  async (formFactor, labels, _home, second) => {
    const locale = currentLocale();
    setLocale("en-GB");
    try {
      const { el } = await mountWidget<TillShell>("till-shell", { formFactor });
      const buttons = () => [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".tab")];
      expect(buttons().map((button) => button.textContent!.trim())).toEqual(labels);
      expect(
        buttons()
          .filter((button) => button.getAttribute("aria-selected") === "true")
          .map((button) => button.textContent!.trim()),
      ).toEqual([labels[0]]);
      const selected: unknown[] = [];
      el.addEventListener("screen-select", (event) => selected.push((event as CustomEvent).detail));
      await userEvent.click(buttons()[1]!);
      expect(selected).toEqual([{ screen: second }]);
      Object.assign(el, { activeScreen: second });
      await el.updateComplete;
      expect(buttons()[1]!.getAttribute("aria-selected")).toBe("true");
      Object.assign(el, { activeScreen: "retired-custom-screen" });
      await el.updateComplete;
      expect(buttons()[0]!.getAttribute("aria-selected")).toBe("true");
    } finally {
      setLocale(locale);
    }
  },
);

it("the KDS form factor keeps operator controls out and retains its language chooser", async () => {
  const { el } = await mountWidget<TillShell>("till-shell", {
    formFactor: "kds",
    operatorName: "Ana",
    loadLocales: async () => [{ code: "en-GB", label: "English" }],
  });
  expect(el.shadowRoot!.querySelector("header")).toBeNull();
  expect(el.shadowRoot!.querySelector(".tab")).toBeNull();
  expect(el.shadowRoot!.querySelector(".logout")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-language-chooser")).not.toBeNull();
});
