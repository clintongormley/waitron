import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import { cleanupWidgets, mountWidget as mountBaseWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";
import type { BarTable } from "../state/bar-tables.js";
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
    ["working", ["Start break", "Clock out", "My hours", "Fix my hours"]],
    ["on_break", ["End break", "Clock out", "My hours", "Fix my hours"]],
    ["out", ["Clock in", "My hours", "Fix my hours"]],
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
    const zones = el.shadowRoot!.querySelector("wt-button.zones")!;
    const settings = item(zones).parentElement!;
    expect(settings.getAttribute("role")).toBe("group");
    expect(item(profile).nextElementSibling!.localName).toBe("hr");
    expect(item(profile).nextElementSibling!.nextElementSibling).toBe(settings);
    expect(item(zones).previousElementSibling).toBe(settings.firstElementChild);
    expect(item(zones).nextElementSibling).toBe(
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

  it("places a handheld's language chooser in More, never in the bar", async () => {
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
      expect(el.shadowRoot!.querySelectorAll("wt-language-chooser")).toHaveLength(1);
      expect(el.shadowRoot!.querySelector("header .session > wt-language-chooser")).toBeNull();
      const chooser = el.shadowRoot!.querySelector(
        'header .session > wt-row-actions[data-test="more-menu"] > .settings-group > wt-language-chooser',
      )!;
      expect(chooser).not.toBeNull();
      expect(chooser.getAttribute("layout")).toBe("group");
      expect(chooser.getAttribute("active")).toBe(currentLocale());
    } finally {
      await page.viewport(width, height);
    }
  });

  it("names each language in full in More's language group, at 1280 wide and at 390", async () => {
    setLocale("es-ES");
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "tablet-landscape",
      loadLocales: async () => [{ code: "es-ES", label: "Español" }],
    });
    const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
    const width = window.innerWidth;
    const height = window.innerHeight;
    try {
      for (const w of [1280, 390]) {
        await page.viewport(w, 844);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        expect(el.shadowRoot!.querySelectorAll("wt-language-chooser")).toHaveLength(1);
        expect(el.shadowRoot!.querySelector("wt-language-chooser")).toBe(chooser);
        const menu = menuOf(el)! as LitElement;
        await menu.updateComplete;
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() =>
          expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true),
        );
        const choice = await vi.waitFor(() => {
          const found = chooser.shadowRoot!.querySelector<HTMLElement>('[data-test="lang-es-ES"]');
          expect(found).not.toBeNull();
          return found!;
        });
        expect(choice.textContent!.trim()).toBe("Español");
        await expect.element(page.elementLocator(choice)).toHaveAccessibleName("Español");
        await userEvent.keyboard("{Escape}");
      }
    } finally {
      await page.viewport(width, height);
    }
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

  it("keeps the theme chooser out of the bar, and puts Theme in More's Settings group after the languages, with no name menu on a handheld without the clock", async () => {
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
        expect(el.shadowRoot!.querySelector("wt-row-actions.operator-menu")).toBeNull();
        const menu = menuOf(el)! as HTMLElement;
        expect(
          menu.querySelector(".settings-group > [data-test=theme-choices]")!.previousElementSibling!
            .localName,
        ).toBe("wt-language-chooser");
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

  it("labels More's Theme choices in Spanish", async () => {
    await atViewport(1280, async () => {
      const before = currentLocale();
      setLocale("es-ES");
      try {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "tablet-landscape",
          operatorName: "Ana",
        });
        const menu = menuOf(el) as WtRowActions;
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

  it("marks the new choice in More when the theme choice changes", async () => {
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
              .shadowRoot!.querySelector(
                `[data-test=more-menu] [data-test=theme-choice-${choice}]`,
              )!
              .getAttribute("aria-pressed"),
          ),
        ).toEqual(["false", "true", "false"]);
      } finally {
        chooseTheme("device");
        localStorage.removeItem(THEME_STORAGE_KEY);
      }
    });
  });

  it("asks for a theme picked in More, closes the menu and leaves applying it to the app", async () => {
    await atViewport(1280, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "tablet-landscape",
        activeScreen: "counter",
        operatorName: "Ana",
      });
      const menu = menuOf(el) as WtRowActions;
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
      await atViewport(390, async () => {
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
        const menu = menuOf(el) as WtRowActions;
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
        expect(controls.filter((c) => c.classList.contains("zones"))).toHaveLength(1);
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
        expect(top(".find-bill")).toBeGreaterThan(top(".station"));
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
      expect(labels()).toEqual(formFactor === "till" ? ["Counter", "Floor"] : ["Floor"]);
      setLocale("es-ES");
      await el.updateComplete;
      expect(labels()).toEqual(formFactor === "till" ? ["Mostrador", "Sala"] : ["Sala"]);
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

/** More's actions at phone width, in More's order: the screens, then Settings, then Log out. */
const phoneMenuActions = [
  [".expo", "show-expo"],
  [".station", "show-station"],
  [".find-bill", "find-bill"],
  [".schedule", "show-schedule"],
  [".profile", "open-profile"],
  ["[data-open-transfers]", "open-transfers"],
  [".zones", "open-device-zones"],
  [".equipment", "open-equipment"],
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
/** More's items in order, the Settings group's in its place; its rules and heading are not items. */
const moreItems = (el: TillShell) =>
  [...menuOf(el)!.querySelectorAll(":scope > *, :scope > .settings-group > *")]
    .filter((child) => !child.matches(".settings-group, .menu-rule, .settings-heading"))
    .map((child) => {
      const item = child.localName === "wt-menu-row" ? child.firstElementChild! : child;
      return (item.getAttribute("data-test") ?? item.className) || item.localName;
    });

describe("till-shell's Zones on this device entry", () => {
  it.each([390, ROOMY_WIDTH])(
    "a handheld's More offers Zones on this device at every width, emitting open-device-zones (%i)",
    async (width) => {
      const locale = currentLocale();
      setLocale("en-GB");
      await atViewport(width, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        const zones = menuOf(el)!.querySelector<HTMLElement>("wt-button.zones")!;
        expect(zones.textContent!.trim()).toBe("Zones on this device");
        const equipment = menuOf(el)!.querySelector("wt-button.equipment");
        const item = (option: Element) =>
          option.parentElement?.localName === "wt-menu-row" ? option.parentElement : option;
        expect(item(zones).nextElementSibling).toBe(item(equipment!));
        if (width === ROOMY_WIDTH) {
          expect(moreItems(el)).toEqual([
            "wt-count-badge",
            "expo",
            "station",
            "find-bill",
            "schedule",
            "profile",
            "department-transfers",
            "wt-button",
            "zones",
            "equipment",
            "wt-language-chooser",
            "theme-choices",
            "logout",
          ]);
          expect(el.shadowRoot!.querySelector("header > .brand")!.textContent).toBe("Waitron");
        }
        expect(
          el.shadowRoot!.querySelector("header .session")!.querySelector(":scope > .zones"),
        ).toBeNull();
        const fired: Event[] = [];
        el.addEventListener("open-device-zones", (event) => fired.push(event));
        zones.click();
        expect(fired).toHaveLength(1);
        expect(fired[0]!.bubbles).toBe(true);
        expect(fired[0]!.composed).toBe(true);
      }).finally(() => setLocale(locale));
    },
  );

  it("a till offers no Zones entry outside Settings", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", { ...full, formFactor: "till" });
    expect(el.shadowRoot!.querySelector(".zones")).toBeNull();
  });
});

describe("a handheld's More", () => {
  const working: Partial<TillShell> = {
    ...full,
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

  /** More's contents in drawing order: a rule is "—", a group opens with "[" and its heading. */
  const contents = (parent: Element): string[] =>
    [...parent.children].flatMap((child): string[] => {
      if (child.hasAttribute("slot")) return [];
      const item = child.localName === "wt-menu-row" ? child.firstElementChild! : child;
      if (item.localName === "hr") return ["—"];
      if (item.classList.contains("operator")) return ["name"];
      if (item.getAttribute("data-test") === "department-transfers") return ["transfers count"];
      if (item.localName === "wt-language-chooser") return ["language"];
      if (item.getAttribute("data-test") === "theme-choices") return ["theme"];
      if (item.getAttribute("role") === "group") {
        const heading = item.querySelector(`#${item.getAttribute("aria-labelledby")}`)!;
        return [
          `[${heading.textContent!.trim()}`,
          ...contents(item).filter((label) => label !== heading.textContent!.trim()),
          "]",
        ];
      }
      return [item.textContent!.trim()];
    });

  it("holds the name group, the screens, the Settings group and Log out, in that order, at 390", async () => {
    const locale = currentLocale();
    setLocale("en-GB");
    await atViewport(390, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", working);
      expect(contents(menuOf(el)!)).toEqual([
        "name",
        "Start break",
        "Clock out",
        "My hours",
        "Fix my hours",
        "—",
        "Pass",
        "Kitchen",
        "Find a bill",
        "My schedule",
        "Profile",
        "transfers count",
        "Transfers",
        "—",
        "[Settings",
        "Zones on this device",
        "Equipment",
        "language",
        "theme",
        "]",
        "—",
        "Log out",
      ]);
    }).finally(() => setLocale(locale));
  });

  it.each([
    ["en-GB", "Settings"],
    ["es-ES", "Ajustes"],
  ])("names the Settings group by its heading (%s)", async (locale, heading) => {
    const original = currentLocale();
    setLocale(locale);
    await atViewport(390, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", working);
      const menu = menuOf(el)!;
      const group = menu.querySelector(".zones")!.closest<HTMLElement>('[role="group"]')!;
      expect(group).not.toBeNull();
      expect(group.parentElement).toBe(menu);
      const label = el.shadowRoot!.getElementById(group.getAttribute("aria-labelledby")!)!;
      expect(group.contains(label)).toBe(true);
      expect(label.textContent!.trim()).toBe(heading);
      await userEvent.click(triggerOf(el));
      await vi.waitFor(() => expect(label.getBoundingClientRect().height).toBeGreaterThan(0));
      expect(getComputedStyle(label).visibility).toBe("visible");
    }).finally(() => setLocale(original));
  });

  it("keeps Log out and Theme out of the name's menu when the name is on the bar", async () => {
    const locale = currentLocale();
    setLocale("en-GB");
    await atViewport(ROOMY_WIDTH, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", working);
      const name = el.shadowRoot!.querySelector("header .session > wt-row-actions.operator-menu")!;
      expect(name).not.toBeNull();
      expect([...name.querySelectorAll("wt-button")].map((b) => b.textContent!.trim())).toEqual([
        "Start break",
        "Clock out",
        "My hours",
        "Fix my hours",
      ]);
      expect(name.querySelector('[data-test="theme-choices"]')).toBeNull();
      const more = menuOf(el)!;
      expect(more.querySelector(".operator")).toBeNull();
      expect(contents(more)).toEqual([
        "Pass",
        "Kitchen",
        "Find a bill",
        "My schedule",
        "Profile",
        "transfers count",
        "Transfers",
        "—",
        "[Settings",
        "Zones on this device",
        "Equipment",
        "language",
        "theme",
        "]",
        "—",
        "Log out",
      ]);
    }).finally(() => setLocale(locale));
  });

  it.each([
    ["as text without", {}, []],
    [
      "as a menu of its actions with",
      { clockAvailable: true, clockState: working.clockState },
      ["Start break", "Clock out", "My hours", "Fix my hours"],
    ],
  ] as const)(
    "draws a handheld's name on the bar %s the clock, and the same group in a narrow More",
    async (_, clock, actions) => {
      const locale = currentLocale();
      setLocale("en-GB");
      try {
        await atViewport(ROOMY_WIDTH, async () => {
          const { el } = await mountWidget<TillShell>("till-shell", { ...full, ...clock });
          const session = el.shadowRoot!.querySelector("header .session")!;
          const menu = session.querySelector(":scope > wt-row-actions.operator-menu");
          if (actions.length === 0) {
            expect(menu).toBeNull();
            expect(session.querySelector(":scope > .operator")!.textContent).toContain(
              "Ana Fernández",
            );
          } else {
            expect(
              [...menu!.querySelectorAll("wt-button")].map((b) => b.textContent!.trim()),
            ).toEqual(actions);
            expect(session.querySelector(":scope > .operator")).toBeNull();
          }
        });
        await atViewport(390, async () => {
          const { el } = await mountWidget<TillShell>("till-shell", { ...full, ...clock });
          expect(contents(menuOf(el)!).slice(0, actions.length + 3)).toEqual([
            "name",
            ...actions,
            "—",
            "Pass",
          ]);
        });
      } finally {
        setLocale(locale);
      }
    },
  );

  it("a till's More and name menu are unchanged", async () => {
    const locale = currentLocale();
    setLocale("en-GB");
    await atViewport(1280, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        ...working,
        formFactor: "till",
        activeScreen: "counter",
      });
      const name = el.shadowRoot!.querySelector("wt-row-actions.operator-menu")!;
      expect([...name.querySelectorAll("wt-button")].map((b) => b.textContent!.trim())).toEqual([
        "Start break",
        "Clock out",
        "My hours",
        "Fix my hours",
      ]);
      expect(name.querySelector('[data-test="theme-choices"]')).not.toBeNull();
      expect(contents(name)).toEqual([
        "Start break",
        "Clock out",
        "My hours",
        "Fix my hours",
        "theme",
      ]);
      expect(moreItems(el)).toEqual([
        "find-bill",
        "schedule",
        "profile",
        "wt-language-chooser",
        "settings",
        "logout",
      ]);
    }).finally(() => setLocale(locale));
  });

  it("a till without the clock keeps its name menu, holding Theme alone", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      ...full,
      formFactor: "till",
      activeScreen: "counter",
    });
    const name = el.shadowRoot!.querySelector("header .session > wt-row-actions.operator-menu")!;
    expect(name).not.toBeNull();
    expect(contents(name)).toEqual(["theme"]);
  });
});

function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

describe("a handheld's table buttons", () => {
  const tables: BarTable[] = [
    { tableId: "t4", name: "T4", unsent: true, current: false, held: false },
    { tableId: "t9", name: "T9", unsent: true, current: false, held: false },
  ];
  const tabsOf = (el: TillShell) => [
    ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('header [role="tab"]'),
  ];
  const buttonOf = (el: TillShell, tableId: string) =>
    el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-bar-table="${tableId}"]`)!;

  it("draws Floor, then one button per table, in the order given", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<TillShell>("till-shell", {
      activeScreen: "floor",
      barTables: tables,
    });
    expect(tabsOf(el).map((tab) => tab.textContent!.trim())).toEqual(["Floor", "T4", "T9"]);
    for (const table of tables) {
      const icon = buttonOf(el, table.tableId).querySelector('wt-icon[name="floor-unsent"]');
      expect(icon).not.toBeNull();
      expect(icon!.getAttribute("aria-hidden")).toBe("true");
      expect(buttonOf(el, table.tableId).classList.contains("bar-table")).toBe(true);
    }
    expect(
      [...el.shadowRoot!.querySelectorAll(".tab")].map((tab) => tab.textContent!.trim()),
    ).toEqual(["Floor"]);
  });

  it.each([
    ["en-GB", "T4 unsent"],
    ["es-ES", "T4 sin enviar"],
  ] as const)(
    "names a button with unsent dishes 'T4 unsent', and one without by its name (%s)",
    async (locale, label) => {
      const original = currentLocale();
      setLocale(locale);
      try {
        const { el } = await mountWidget<TillShell>("till-shell", {
          activeScreen: "order",
          barTables: [
            { tableId: "t4", name: "T4", unsent: true, current: false, held: false },
            { tableId: "t9", name: "T9", unsent: false, current: true, held: false },
          ],
        });
        expect(buttonOf(el, "t4").getAttribute("aria-label")).toBe(label);
        expect(buttonOf(el, "t9").hasAttribute("aria-label")).toBe(false);
        expect(buttonOf(el, "t9").querySelector("wt-icon")).toBeNull();
        expect(buttonOf(el, "t9").textContent!.trim()).toBe("T9");
      } finally {
        setLocale(original);
      }
    },
  );

  it("selects the table on screen and not Floor; selects Floor when no table is current", async () => {
    setLocale("en-GB");
    const { el } = await mountWidget<TillShell>("till-shell", {
      activeScreen: "order",
      barTables: [{ ...tables[0]!, current: true }, tables[1]!],
    });
    const selected = () => tabsOf(el).map((tab) => tab.getAttribute("aria-selected"));
    expect(selected()).toEqual(["false", "true", "false"]);
    Object.assign(el, { barTables: tables });
    await el.updateComplete;
    expect(selected()).toEqual(["true", "false", "false"]);
  });

  it("emits open-bar-table with the table's id", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      activeScreen: "floor",
      barTables: tables,
    });
    const events: CustomEvent[] = [];
    const listen = (event: Event) => events.push(event as CustomEvent);
    document.addEventListener("open-bar-table", listen);
    const screens: unknown[] = [];
    el.addEventListener("screen-select", (event) => screens.push(event));
    try {
      await userEvent.click(buttonOf(el, "t9"));
    } finally {
      document.removeEventListener("open-bar-table", listen);
    }
    expect(events.map((event) => event.detail)).toEqual([{ tableId: "t9", held: false }]);
    expect(events[0]!.bubbles).toBe(true);
    expect(events[0]!.composed).toBe(true);
    expect(screens).toEqual([]);
  });

  it("says in open-bar-table whether the button goes back to the held bill", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      activeScreen: "floor",
      barTables: [{ ...tables[0]!, held: true }, tables[1]!],
    });
    const details: unknown[] = [];
    const listen = (event: Event) => details.push((event as CustomEvent).detail);
    document.addEventListener("open-bar-table", listen);
    try {
      await userEvent.click(buttonOf(el, "t4"));
      await userEvent.click(buttonOf(el, "t9"));
    } finally {
      document.removeEventListener("open-bar-table", listen);
    }
    expect(details).toEqual([
      { tableId: "t4", held: true },
      { tableId: "t9", held: false },
    ]);
  });

  it("a till draws no table buttons", async () => {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "till",
      activeScreen: "counter",
      barTables: tables,
    });
    expect(el.shadowRoot!.querySelector("[data-bar-table]")).toBeNull();
    expect(tabsOf(el).map((tab) => tab.textContent!.trim())).toEqual(["Counter", "Floor"]);
  });

  it("the strip scrolls sideways when the buttons do not fit at 360, keeping Help and More on screen", async () => {
    setLocale("en-GB");
    await atViewport(360, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "phone-portrait",
        activeScreen: "floor",
        operatorName: "Ana",
        barTables: Array.from({ length: 10 }, (_, i) => ({
          tableId: `t${i + 1}`,
          name: `T${i + 1}`,
          unsent: true,
          current: false,
          held: false,
        })),
      });
      await frame();
      const strip = el.shadowRoot!.querySelector<HTMLElement>("header nav.tabs")!;
      expect(strip.querySelectorAll("[data-bar-table]")).toHaveLength(10);
      expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
      const header = el.shadowRoot!.querySelector("header")!.getBoundingClientRect();
      for (const item of [el.shadowRoot!.querySelector("header wt-help-switch")!, menuOf(el)!]) {
        const box = item.getBoundingClientRect();
        expect(box.width).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(header.left);
        expect(box.right).toBeLessThanOrEqual(header.right + 0.5);
        expect(box.right).toBeLessThanOrEqual(360 + 0.5);
      }
    });
  });

  describe("the selected table's button is scrolled into the strip's view at 390", () => {
    const tenTables = (current?: string): BarTable[] =>
      Array.from({ length: 10 }, (_, i) => ({
        tableId: `t${i + 1}`,
        name: `T${i + 1}`,
        unsent: true,
        current: `t${i + 1}` === current,
        held: false,
      }));
    const stripOf = (el: TillShell) =>
      el.shadowRoot!.querySelector<HTMLElement>("header nav.tabs")!;
    const expectInStrip = (el: TillShell, tableId: string) => {
      const strip = stripOf(el).getBoundingClientRect();
      const box = buttonOf(el, tableId).getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(strip.left - 0.5);
      expect(box.right).toBeLessThanOrEqual(strip.right + 0.5);
    };

    it("when the shell first draws with the last table selected", async () => {
      setLocale("en-GB");
      await atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "phone-portrait",
          activeScreen: "order",
          operatorName: "Ana",
          barTables: tenTables("t10"),
        });
        await frame();
        expect(stripOf(el).scrollWidth).toBeGreaterThan(stripOf(el).clientWidth);
        await vi.waitFor(() => expectInStrip(el, "t10"));
      });
    });

    it("when the selection moves to the last table, and not again on a redraw that keeps it", async () => {
      setLocale("en-GB");
      await atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "phone-portrait",
          activeScreen: "floor",
          operatorName: "Ana",
          barTables: tenTables(),
        });
        await frame();
        expect(stripOf(el).scrollLeft).toBe(0);
        el.activeScreen = "order";
        el.barTables = tenTables("t10");
        await el.updateComplete;
        await vi.waitFor(() => expectInStrip(el, "t10"));
        stripOf(el).scrollLeft = 0;
        el.barTables = tenTables("t10");
        await el.updateComplete;
        await frame();
        expect(stripOf(el).scrollLeft).toBe(0);
      });
    });

    it("back towards the start when the selection moves from the last table to the first", async () => {
      setLocale("en-GB");
      await atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "phone-portrait",
          activeScreen: "order",
          operatorName: "Ana",
          barTables: tenTables("t10"),
        });
        await vi.waitFor(() => expectInStrip(el, "t10"));
        el.barTables = tenTables("t1");
        await el.updateComplete;
        await vi.waitFor(() => expectInStrip(el, "t1"));
      });
    });

    it("again when buttons are added before the selected table", async () => {
      setLocale("en-GB");
      await atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "phone-portrait",
          activeScreen: "order",
          operatorName: "Ana",
          barTables: tenTables("t4").slice(3),
        });
        await frame();
        await vi.waitFor(() => expectInStrip(el, "t4"));
        const width = stripOf(el).clientWidth;
        expect(stripOf(el).scrollWidth).toBeGreaterThan(width);
        el.barTables = tenTables("t4");
        await el.updateComplete;
        await frame();
        expect(stripOf(el).clientWidth).toBe(width);
        await vi.waitFor(() => expectInStrip(el, "t4"));
      });
    });

    it("looks for no button on a redraw that changes no button while the bar is not drawn", async () => {
      await atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "phone-portrait",
          activeScreen: "order",
          operatorName: "Ana",
          kiosk: true,
          barTables: tenTables("t10"),
        });
        await frame();
        const lookups = vi.spyOn(el.shadowRoot!, "querySelector");
        el.operatorName = "Sam";
        await el.updateComplete;
        el.barTables = tenTables("t10");
        await el.updateComplete;
        await frame();
        const asked = lookups.mock.calls.map(([selector]) => selector);
        expect(asked.filter((selector) => selector.startsWith("[data-bar-table"))).toEqual([]);
      });
    });

    it("again when the strip narrows under the selected table", async () => {
      setLocale("en-GB");
      await atViewport(1280, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "tablet-landscape",
          activeScreen: "order",
          operatorName: "Ana",
          barTables: tenTables("t10"),
        });
        await vi.waitFor(() => expectInStrip(el, "t10"));
        await page.viewport(390, 844);
        await frame();
        expect(stripOf(el).scrollWidth).toBeGreaterThan(stripOf(el).clientWidth);
        await vi.waitFor(() => expectInStrip(el, "t10"));
      });
    });

    it("waits through a bar with no header, and reveals the table once the header is drawn", async () => {
      setLocale("en-GB");
      await atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "phone-portrait",
          activeScreen: "order",
          operatorName: "Ana",
          kiosk: true,
          barTables: tenTables("t10"),
        });
        await frame();
        expect(el.shadowRoot!.querySelector("header")).toBeNull();
        el.kiosk = false;
        await el.updateComplete;
        await vi.waitFor(() => expectInStrip(el, "t10"));
      });
    });

    it("lets a table that goes before the bar has settled go, and reveals it when it comes back", async () => {
      setLocale("en-GB");
      await atViewport(390, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", {
          formFactor: "phone-portrait",
          activeScreen: "floor",
          operatorName: "Ana",
          barTables: tenTables(),
        });
        await frame();
        el.barTables = tenTables("t10");
        await el.updateComplete;
        el.barTables = [];
        await el.updateComplete;
        await frame();
        expect(el.shadowRoot!.querySelector("[data-bar-table]")).toBeNull();
        el.barTables = tenTables("t10");
        await el.updateComplete;
        await vi.waitFor(() => expectInStrip(el, "t10"));
      });
    });
  });
});

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
    "with no venue logo, puts Log out last in More, reachable by scrolling it, at %ix%i, in Spanish",
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
            expect(menuOf(el)!.lastElementChild!.classList.contains("logout")).toBe(true);
            expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
            popup.scrollTop = popup.scrollHeight;
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
          expect(tabs).toHaveLength(1);
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
              "header .brand, header wt-venue-logo, header .tab, header wt-language-chooser, header wt-row-actions, header .session > *",
            ),
          ]
            .map((c) => c.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0);
          expect(visible.length).toBe(3);
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
      const order = [...menu.querySelectorAll(":scope > *, :scope > .settings-group > *")]
        .filter((c) => c.slot !== "badge")
        .filter((c) => !c.matches(".settings-group, .menu-rule, .settings-heading"))
        .map((c) => (c.localName === "wt-menu-row" ? c.firstElementChild! : c))
        .map(
          (c) =>
            (c.getAttribute("data-test") ??
              (c.hasAttribute("data-open-transfers") ? "data-open-transfers" : c.className)) ||
            c.localName,
        );
      expect(order).toEqual([
        "operator",
        "expo",
        "station",
        "find-bill",
        "schedule",
        "profile",
        "department-transfers",
        "data-open-transfers",
        "zones",
        "equipment",
        "wt-language-chooser",
        "theme-choices",
        "logout",
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
      for (const [, type] of phoneMenuActions) el.addEventListener(type, () => fired.push(type));
      for (const [selector] of phoneMenuActions) {
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        await userEvent.click(menu.querySelector<HTMLElement>(selector)!);
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("false"));
      }
      expect(fired).toEqual(phoneMenuActions.map(([, type]) => type));

      const keys: string[] = [];
      el.addEventListener("screen-select", (e) =>
        keys.push((e as CustomEvent<{ screen: string }>).detail.screen),
      );
      for (const tab of el.shadowRoot!.querySelectorAll<HTMLElement>(".tab")) {
        await userEvent.click(tab);
      }
      expect(keys).toEqual(["floor"]);
    });
  });

  it("reaches every action by keyboard", async () => {
    await atViewport(390, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      const fired: string[] = [];
      for (const [, type] of phoneMenuActions) el.addEventListener(type, () => fired.push(type));
      const tabsEls = el.shadowRoot!.querySelectorAll<HTMLElement>(".tab");
      // Tab stops into More for each action: they rise in More's order, and before Log out come
      // the two languages and the three Theme choices.
      const steps: number[] = [];
      for (const [selector] of phoneMenuActions) {
        tabsEls[tabsEls.length - 1]!.focus();
        await userEvent.tab(); // the Help switch
        await userEvent.tab();
        expect(deepActive()).toBe(triggerOf(el));
        await userEvent.keyboard("{Enter}");
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        const target = menuOf(el)!.querySelector<HTMLElement>(selector)!;
        const focused = () =>
          target.contains(deepActive()) || target.shadowRoot!.contains(deepActive());
        let step = 0;
        while (!focused() && step < 20) {
          await userEvent.tab();
          step += 1;
        }
        expect(focused(), selector).toBe(true);
        steps.push(step);
        await userEvent.keyboard("{Enter}");
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("false"));
      }
      expect(fired).toEqual(phoneMenuActions.map(([, type]) => type));
      expect(steps.slice(0, -1)).toEqual(steps.slice(0, -1).map((_, index) => index + 1));
      expect(steps.at(-1)).toBe(steps.at(-2)! + 2 + 3 + 1);
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

  it("draws the wide handheld header with the name, Help and More on the bar and every other entry in More", async () => {
    await atViewport(ROOMY_WIDTH, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      expect(moreItems(el)).toEqual([
        "wt-count-badge",
        "expo",
        "station",
        "find-bill",
        "schedule",
        "profile",
        "department-transfers",
        "wt-button",
        "zones",
        "equipment",
        "wt-language-chooser",
        "theme-choices",
        "logout",
      ]);
      expect(el.shadowRoot!.querySelector("header .session > .operator")).not.toBeNull();
      expect(el.shadowRoot!.querySelector("header > .brand")!.textContent).toBe("Waitron");
      const session = el.shadowRoot!.querySelector("header .session")!;
      expect(
        [...session.children].map(
          (c) =>
            (c.getAttribute("data-test") ??
              (c.hasAttribute("data-open-transfers") ? "data-open-transfers" : c.className)) ||
            c.localName,
        ),
      ).toEqual(["operator", "help-switch", "more-menu"]);
    });
  });

  it("switches layout as the screen narrows and widens, keeping the one language chooser", async () => {
    await atViewport(390, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      const chooser = el.shadowRoot!.querySelector("wt-language-chooser")!;
      expect(menuOf(el)).not.toBeNull();
      await page.viewport(ROOMY_WIDTH, 844);
      await vi.waitFor(() =>
        expect(moreItems(el)).toEqual([
          "wt-count-badge",
          "expo",
          "station",
          "find-bill",
          "schedule",
          "profile",
          "department-transfers",
          "wt-button",
          "zones",
          "equipment",
          "wt-language-chooser",
          "theme-choices",
          "logout",
        ]),
      );
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
  /** What leaves a handheld's bar for More, the name alone: its key and the selector of the name
   * as ☰ draws it. */
  const leaveOrder = [["operator", ".operator"]] as const;

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
        ":scope > .brand, :scope > wt-venue-logo, :scope > .tabs, :scope > .session > *",
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

  const tablesOf = (count: number): BarTable[] =>
    Array.from({ length: count }, (_, i) => ({
      tableId: `t${i + 1}`,
      name: `T${i + 1}`,
      unsent: true,
      current: false,
      held: false,
    }));
  /** The fewest table buttons that move `name` into More at the current width, measured on a bar
   * gaining one button at a time, because how wide the text draws differs between platforms. */
  async function tablesMoving(name: string): Promise<number> {
    const { el, host } = await mountWidget<TillShell>("till-shell", {
      ...full,
      operatorName: name,
    });
    await settle(el);
    let count = 0;
    while (menuOf(el)!.querySelector(".operator") === null && count < 40) {
      count += 1;
      el.barTables = tablesOf(count);
      await settle(el);
    }
    host.remove();
    expect(count, name).toBeLessThan(40);
    return count;
  }
  const brandOf = (el: TillShell) =>
    el.shadowRoot!.querySelector("header > .brand, header > wt-venue-logo");
  const sessionItems = (el: TillShell) =>
    [...el.shadowRoot!.querySelectorAll("header .session > *")].map(
      (item) => (item.getAttribute("data-test") ?? item.className) || item.localName,
    );
  const everyEntry = [
    "wt-count-badge",
    "expo",
    "station",
    "find-bill",
    "schedule",
    "profile",
    "department-transfers",
    "wt-button",
    "zones",
    "equipment",
    "wt-language-chooser",
    "theme-choices",
    "logout",
  ];

  for (const width of [1280, ROOMY_WIDTH]) {
    for (const locale of ["en-GB", "es-ES"]) {
      it(`keeps only Floor, the table buttons, the name, Help and More on a handheld's bar, every other entry in More, at ${width} in ${locale}`, async () => {
        await withLocale(locale, () =>
          atViewport(width, async () => {
            const { el } = await mountWidget<TillShell>("till-shell", {
              ...full,
              barTables: tablesOf(2),
            });
            await settle(el);
            expect(
              [...el.shadowRoot!.querySelectorAll('header .tabs [role="tab"]')].map((tab) =>
                tab.textContent!.trim(),
              ),
            ).toEqual([t("tab.floor"), "T1", "T2"]);
            expect(sessionItems(el)).toEqual(["operator", "help-switch", "more-menu"]);
            expect(moreItems(el)).toEqual(everyEntry);
            expectOneRow(el);
          }),
        );
      });
    }
  }

  it("hides the brand first, then moves the name into More, as table buttons fill the bar, and gives both back as they go", async () => {
    await withLocale("en-GB", () =>
      atViewport(1024, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", {
          ...full,
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
        });
        await settle(el);
        const nameInMore = () => menuOf(el)!.querySelector(".operator") !== null;
        const state = () =>
          `${brandOf(el) === null ? "-" : "brand"} ${nameInMore() ? "more" : "name"}`;
        expect(state()).toBe("brand name");
        const filling = [state()];
        let count = 0;
        while (!nameInMore() && count < 40) {
          count += 1;
          el.barTables = tablesOf(count);
          await settle(el);
          expectOneRow(el);
          filling.push(state());
        }
        expect(filling).toContain("- name");
        expect(filling.at(-1)).toBe("- more");
        expect(filling.filter((s) => s === "brand more")).toEqual([]);
        expect(filling.indexOf("- name")).toBeLessThan(filling.indexOf("- more"));
        expect(sessionItems(el)).toEqual(["help-switch", "more-menu"]);
        expect(moreItems(el).slice(0, 2)).toEqual(["wt-count-badge", "operator"]);
        expect(
          [...menuOf(el)!.querySelectorAll(":scope > [data-clock-action]")].map((b) =>
            b.getAttribute("data-clock-action"),
          ),
        ).toEqual(["break-start", "out"]);
        const emptying = [state()];
        while (count > 0) {
          count -= 1;
          el.barTables = tablesOf(count);
          await settle(el);
          expectOneRow(el);
          emptying.push(state());
        }
        expect(emptying).toContain("- name");
        expect(emptying.at(-1)).toBe("brand name");
        expect(emptying.indexOf("- name")).toBeLessThan(emptying.indexOf("brand name"));
        expect(emptying.filter((s) => s === "brand more")).toEqual([]);
        expect(sessionItems(el)).toEqual(["operator-menu", "help-switch", "more-menu"]);
      }),
    );
  });

  it("shows the brand mark at step 0 though More holds every entry", async () => {
    await withLocale("en-GB", () =>
      atViewport(ROOMY_WIDTH, async () => {
        const { el } = await mountWidget<TillShell>("till-shell", full);
        await settle(el);
        expect(moreItems(el)).toEqual(everyEntry);
        expect(el.shadowRoot!.querySelector("header > .brand")!.textContent).toBe("Waitron");
        expectOneRow(el);
      }),
    );
  });

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

  it.each([
    ["en-GB", "Transfers", "Department transfers"],
    ["es-ES", "Traspasos", "Traspasos entre departamentos"],
  ] as const)(
    "names the bar's transfers button with the short name in %s, keeping the dialog's full title",
    async (locale, short, title) => {
      await withLocale(locale, () =>
        atViewport(ROOMY_WIDTH, async () => {
          const { el } = await mountWidget<TillShell>("till-shell", {
            ...full,
            formFactor: "till",
            activeScreen: "counter",
            transferCount: undefined,
          });
          await settle(el);
          const button = el.shadowRoot!.querySelector<HTMLElement>(
            "header .till-strip > [data-open-transfers]",
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
    "labels Log out %s's short word inside More, where it is with the name on the bar too, keeping the counter header's full name",
    async (locale, label, headerName) => {
      await withLocale(locale, async () => {
        expect(t("action.logout")).toBe(headerName);
        await atViewport(ROOMY_WIDTH, async () => {
          const { el, host } = await mountWidget<TillShell>("till-shell", full);
          await settle(el);
          expect(moreItems(el)).toEqual(everyEntry);
          expect(sessionItems(el)).toEqual(["operator", "help-switch", "more-menu"]);
          const inMore = menuOf(el)!.querySelector<HTMLElement>(".logout")!;
          expect([...el.shadowRoot!.querySelectorAll(".logout")]).toEqual([inMore]);
          expect(inMore.textContent!.trim()).toBe(label);
          await userEvent.click(triggerOf(el));
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

  it("keeps More in its own order", async () => {
    await atViewport(1024, async () => {
      const { el } = await mountWidget<TillShell>("till-shell", full);
      await settle(el);
      const menu = menuOf(el)!;
      const order = [...menu.querySelectorAll(":scope > *, :scope > .settings-group > *")]
        .filter((c) => c.slot !== "badge")
        .filter((c) => !c.matches(".settings-group, .menu-rule, .settings-heading"))
        .map((c) => (c.localName === "wt-menu-row" ? c.firstElementChild! : c))
        .map(
          (c) =>
            (c.getAttribute("data-test") ??
              (c.hasAttribute("data-open-transfers") ? "data-open-transfers" : c.className)) ||
            c.localName,
        );
      const moreOrder = [
        "operator",
        "expo",
        "station",
        "find-bill",
        "schedule",
        "profile",
        "department-transfers",
        "data-open-transfers",
        "zones",
        "equipment",
        "wt-language-chooser",
        "theme-choices",
        "logout",
      ];
      expect(order.length).toBeGreaterThan(0);
      expect(order).toEqual(moreOrder.filter((key) => order.includes(key)));
      expect(el.shadowRoot!.querySelector("header .session > .operator")).not.toBeNull();
      expect(order).toEqual(moreOrder.filter((key) => key !== "operator"));
      for (const key of order) {
        const selector = key.startsWith("data-")
          ? `[${key}]`
          : key.startsWith("wt-")
            ? key
            : `.${key}`;
        if (key === "department-transfers") continue;
        expect(el.shadowRoot!.querySelectorAll(`header ${selector}`), key).toHaveLength(1);
      }
      for (const button of menu.querySelectorAll("wt-button")) {
        expect(button.getAttribute("variant")).toBe("ghost");
        expect(button.getAttribute("align")).toBe("start");
      }
      const session = el.shadowRoot!.querySelector("header .session")!;
      expect(session.querySelector(":scope > wt-button")).toBeNull();
      expect(session.lastElementChild).toBe(menu);
    });
  });

  it("puts the name back on the bar, and the brand, once the screen is wide enough", async () => {
    await atViewport(700, async () => {
      const tables = tablesOf(await tablesMoving(full.operatorName!));
      const { el } = await mountWidget<TillShell>("till-shell", { ...full, barTables: tables });
      await settle(el);
      expect(inMore(el)).toEqual(["operator"]);
      expect(el.shadowRoot!.querySelector(".brand")).toBeNull();
      await page.viewport(ROOMY_WIDTH, 844);
      await settle(el);
      expect(inMore(el)).toEqual([]);
      expect(moreItems(el)).toEqual(everyEntry);
      expect(el.shadowRoot!.querySelector("header > .brand")!.textContent).toBe("Waitron");
      expectOneRow(el);
    });
  });

  it("refits when the operator's name grows", async () => {
    await withLocale("en-GB", () =>
      atViewport(1100, async () => {
        const long = "María de los Ángeles Fernández-Villaverde y Castro";
        const count = await tablesMoving(long);
        expect(await tablesMoving(full.operatorName!)).toBeGreaterThan(count);
        const { el } = await mountWidget<TillShell>("till-shell", {
          ...full,
          barTables: tablesOf(count),
        });
        await settle(el);
        const was = inMore(el).length;
        el.operatorName = long;
        await settle(el);
        expectOneRow(el);
        expect(inMore(el).length).toBeGreaterThan(was);
        await expectEachActionOnce(el);
      }),
    );
  });

  it("lists added actions in More and drops them when they go", async () => {
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
      expect(moreItems(el)).toEqual([
        "zones",
        "equipment",
        "wt-language-chooser",
        "theme-choices",
        "logout",
      ]);
      expect(el.shadowRoot!.querySelector(".brand")).not.toBeNull();
      Object.assign(el, full);
      await settle(el);
      expectOneRow(el);
      expect(menuOf(el)).not.toBeNull();
      expect(moreItems(el)).toEqual(everyEntry);
      await expectEachActionOnce(el);
      Object.assign(el, few);
      await settle(el);
      expectOneRow(el);
      expect(moreItems(el)).toEqual([
        "zones",
        "equipment",
        "wt-language-chooser",
        "theme-choices",
        "logout",
      ]);
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
        const { el } = await mountWidget<TillShell>("till-shell", {
          ...full,
          formFactor: "till",
          activeScreen: "floor",
          showCounter: false,
        });
        await settle(el);
        const [status, ...rest] = statuses(el);
        expect(rest).toEqual([]);
        expect(status!.getAttribute("data-test")).toBe("department-transfers");
        expect(status!.parentElement).toBe(
          el.shadowRoot!.querySelector("header .till-strip > [data-open-transfers]"),
        );
        expect(status!.getBoundingClientRect().width).toBeGreaterThan(1);
        expect(status!.getAttribute("aria-label")).toBe(
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
        const tables = tablesOf(await tablesMoving(full.operatorName!));
        const { el } = await mountWidget<TillShell>("till-shell", { ...full, barTables: tables });
        await settle(el);
        const menu = menuOf(el)!;
        await userEvent.click(triggerOf(el));
        await vi.waitFor(() => expect(triggerOf(el).getAttribute("aria-expanded")).toBe("true"));
        const held = inMore(el);
        expect(held).toEqual(["operator"]);
        await page.viewport(ROOMY_WIDTH, 844);
        await settle(el);
        expect(menuOf(el)).toBe(menu);
        expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
        expect(inMore(el)).toEqual(held);
        await userEvent.keyboard("{Escape}");
        await settle(el);
        expect(inMore(el)).toEqual([]);
        expect(moreItems(el)).toEqual(everyEntry);
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
        expect(el.shadowRoot!.querySelector(".brand")).not.toBeNull();
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
            expect(moreItems(el), `${ticks}`).toEqual(everyEntry);
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
    await atViewport(1024, async () => {
      const tables = tablesOf(await tablesMoving(full.operatorName!));
      await page.viewport(ROOMY_WIDTH, 844);
      const { el, host } = await mountWidget<TillShell>("till-shell", {
        ...full,
        barTables: tables,
      });
      await settle(el);
      expect(moreItems(el)).toEqual(everyEntry);
      el.remove();
      host.append(el);
      await settle(el);
      await page.viewport(1024, 844);
      await settle(el);
      expect(inMore(el)).toEqual(["operator"]);
      expectOneRow(el);
    });
  });

  const shortName = { operatorName: "Ana" };
  const longName = { operatorName: "María de los Ángeles Fernández-Villaverde y Castro" };
  /** Measurements the race batches share, keyed by width, language and what was measured. */
  const raceMeasures = new Map<string, Promise<unknown>>();
  const measuredOnce = <T>(what: string, measure: () => Promise<T>): Promise<T> => {
    const key = `${innerWidth}|${currentLocale()}|${what}`;
    if (!raceMeasures.has(key)) raceMeasures.set(key, measure());
    return raceMeasures.get(key) as Promise<T>;
  };

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
          const count = await measuredOnce(`tables ${longName.operatorName}`, () =>
            tablesMoving(longName.operatorName),
          );
          const base = { ...full, barTables: tablesOf(count) };
          const freshMore = (name: Partial<TillShell>) =>
            measuredOnce(`fresh ${count} ${JSON.stringify(name)}`, async () => {
              const { el: fresh } = await mountWidget<TillShell>("till-shell", {
                ...base,
                ...name,
              });
              await settle(fresh);
              const moved = inMore(fresh);
              fresh.remove();
              return moved;
            });
          // The fresh bar keeps the short name and moves the long one, so a fit cut short could
          // leave either answer.
          expect(await freshMore(shortName)).toEqual([]);
          expect(await freshMore(longName)).toEqual(["operator"]);
          const want = await freshMore({ ...start, ...first, ...second });
          const { el } = await mountWidget<TillShell>("till-shell", { ...base, ...start });
          await settle(el);
          const differs: string[] = [];
          // Each pass starts the second fit one microtask later than the last, so some pass cuts
          // the first short at each of its waits.
          for (let ticks = from; ticks <= to; ticks += 1) {
            Object.assign(el, base, start);
            await settle(el);
            Object.assign(el, first);
            for (let i = 0; i < ticks; i += 1) await Promise.resolve();
            Object.assign(el, second);
            await settle(el);
            expectOneRow(el);
            if (inMore(el).join() !== want.join()) differs.push(`${ticks}: ${inMore(el).join()}`);
          }
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
  ["phone-portrait", ["Floor"], "floor", null],
  ["tablet-landscape", ["Floor"], "floor", null],
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
      if (second === null) {
        // D13: the Order screen has no tab on a handheld, so Floor stays selected on it.
        Object.assign(el, { activeScreen: "order" });
        await el.updateComplete;
        expect(buttons()[0]!.getAttribute("aria-selected")).toBe("true");
      } else {
        const selected: unknown[] = [];
        el.addEventListener("screen-select", (event) =>
          selected.push((event as CustomEvent).detail),
        );
        await userEvent.click(buttons()[1]!);
        expect(selected).toEqual([{ screen: second }]);
        Object.assign(el, { activeScreen: second });
        await el.updateComplete;
        expect(buttons()[1]!.getAttribute("aria-selected")).toBe("true");
      }
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

describe("the notices slot", () => {
  async function withNotices(props: Partial<TillShell>) {
    const { el } = await mountWidget<TillShell>("till-shell", { operatorName: "Ana", ...props });
    const child = document.createElement("div");
    child.slot = "notices";
    child.style.blockSize = "20px";
    child.textContent = "A notice";
    el.appendChild(child);
    await el.updateComplete;
    return { el, child };
  }

  it.each(["till", "phone-portrait"] as const)(
    "puts the notices between the top bar and the screen on a %s",
    async (formFactor) => {
      const { el, child } = await withNotices({ formFactor, activeScreen: "floor" });
      const slot = child.assignedSlot;
      expect(slot).not.toBeNull();
      expect(slot!.parentElement?.classList.contains("shell")).toBe(true);
      const head = el.shadowRoot!.querySelector("header")!.getBoundingClientRect();
      const region = el.shadowRoot!.querySelector(".region")!.getBoundingClientRect();
      const box = child.getBoundingClientRect();
      expect(box.height).toBeGreaterThan(0);
      expect(box.top).toBeGreaterThanOrEqual(head.bottom);
      expect(box.bottom).toBeLessThanOrEqual(region.top);
    },
  );

  // Pins: a kiosk or kitchen display already draws no slot for notices.
  it.each([
    ["a kiosk", { kiosk: true }],
    ["a kitchen display", { formFactor: "kds" }],
  ] as const)("has no notices slot on %s (pin)", async (_name, props) => {
    const { child } = await withNotices(props as Partial<TillShell>);
    expect(child.assignedSlot).toBeNull();
  });
});
