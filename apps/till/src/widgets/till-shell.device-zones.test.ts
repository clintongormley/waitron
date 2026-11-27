import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { SUPPORTED_LOCALES } from "@waitron/shared";
import {
  cleanupWidgets,
  declareTouchScreen,
  mountWidget,
  expectNoA11yViolations,
} from "./test-helpers.js";
import type { TillClockState } from "../api/attendance-api.js";
import type { ShellAffordance, TillShell } from "./till-shell.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./till-shell.js";
import "../screens/till-floor-screen.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

it("opens the counter's checked zone list and emits one selection under a real click", async () => {
  setLocale("en-GB");
  const { el } = await mountWidget<TillShell>("till-shell", {
    formFactor: "till",
    operatorName: "Ana",
    activeScreen: "counter",
    ...{
      counterZones: [
        { id: "bar", name: "Bar" },
        { id: "shop", name: "Shop" },
      ],
      selectedCounterZoneId: "bar",
    },
  });
  const menu = el.shadowRoot!.querySelector<HTMLElement>("[data-counter-zones]");
  expect(menu).not.toBeNull();
  await (menu as TillShell).updateComplete;
  expect(menu!.textContent).toContain("Counter: Bar");
  const changed = vi.fn();
  el.addEventListener("counter-zone-selected", changed);
  await userEvent.click(menu!.shadowRoot!.querySelector("button")!);
  expect(menu!.querySelector('[data-counter-zone="bar"]')!.getAttribute("aria-checked")).toBe(
    "true",
  );
  expect(menu!.querySelector('[data-counter-zone="shop"]')!.getAttribute("aria-checked")).toBe(
    "false",
  );
  el.addEventListener("counter-zone-selected", () => {
    Object.assign(el, { selectedCounterZoneId: "shop" });
  });
  await userEvent.click(menu!.querySelector<HTMLElement>('[data-counter-zone="shop"]')!);
  expect(changed).toHaveBeenCalledOnce();
  expect(changed.mock.calls[0]![0].detail).toEqual({ zoneId: "shop" });
  expect(menu!.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  await el.updateComplete;
  expect(menu!.textContent).toContain("Counter: Shop");
});

it("keeps a single counter a plain tab and hides selling screens outside the device selection", async () => {
  setLocale("en-GB");
  const { el } = await mountWidget<TillShell>("till-shell", {
    ...{ counterZones: [{ id: "bar", name: "Bar" }], showFloor: false },
  });
  const labels = () =>
    [...el.shadowRoot!.querySelectorAll('[role="tab"]')].map((e) => e.textContent!.trim());
  expect(labels()).toEqual(["Counter"]);
  expect(el.shadowRoot!.querySelector("[data-counter-zones]")).toBeNull();
  Object.assign(el, { showCounter: false, showFloor: true, activeScreen: "floor" });
  await el.updateComplete;
  expect(labels()).toEqual(["Floor"]);
  Object.assign(el, { showFloor: false });
  await el.updateComplete;
  expect(labels()).toEqual([]);
  Object.assign(el, { formFactor: "phone-portrait" });
  await el.updateComplete;
  expect(labels()).toEqual(["Floor"]);
});

it.each(["light", "dark"] as const)(
  "exposes the multiple-counter menu accessibly in %s",
  async (theme) => {
    const { el, host } = await mountWidget<TillShell>(
      "till-shell",
      {
        operatorName: "Ana",
        activeScreen: "counter",
        ...{
          counterZones: [
            { id: "bar", name: "Bar" },
            { id: "shop", name: "Shop" },
          ],
          selectedCounterZoneId: "bar",
        },
      },
      theme,
    );
    const menu = el.shadowRoot!.querySelector<HTMLElement>("[data-counter-zones]");
    expect(menu).not.toBeNull();
    await (menu as TillShell).updateComplete;
    await userEvent.click(page.elementLocator(menu!.shadowRoot!.querySelector("button")!));
    await expectNoA11yViolations(host);
  },
);

it("paints the selected Floor tab with its border token beside the counter menu", async () => {
  const { el } = await mountWidget<TillShell>("till-shell", {
    activeScreen: "floor",
    counterZones: [
      { id: "bar", name: "Bar" },
      { id: "shop", name: "Shop" },
    ],
  });
  el.style.setProperty("--wt-color-border", "rgb(13, 27, 39)");
  const floor = el.shadowRoot!.querySelector<HTMLButtonElement>("button.tab")!;
  expect(floor.getAttribute("aria-pressed")).toBe("true");
  expect(getComputedStyle(floor).borderTopColor).toBe("rgb(13, 27, 39)");
});

it("a long counter menu follows a phone rotation and keeps its last zone reachable", async () => {
  await page.viewport(390, 844);
  try {
    const { el } = await mountWidget<TillShell>("till-shell", {
      operatorName: "Ana",
      activeScreen: "counter",
      counterZones: Array.from({ length: 20 }, (_, index) => ({
        id: `zone-${index}`,
        name: `Counter ${index}`,
      })),
      selectedCounterZoneId: "zone-0",
    });
    const menu = el.shadowRoot!.querySelector<HTMLElement>("[data-counter-zones]")!;
    await (menu as TillShell).updateComplete;
    const trigger = menu.shadowRoot!.querySelector("button")!;
    const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await userEvent.click(trigger);
    await userEvent.keyboard("{End}");
    await page.viewport(844, 390);
    await vi.waitFor(() => {
      const box = popup.getBoundingClientRect();
      expect(box.bottom).toBeLessThanOrEqual(innerHeight - 8);
      expect(box.top).toBeGreaterThanOrEqual(8);
      const last = menu.querySelector<HTMLElement>('[data-counter-zone="zone-19"]')!;
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.bottom);
    });
    const selected: string[] = [];
    el.addEventListener("counter-zone-selected", (event) =>
      selected.push((event as CustomEvent<{ zoneId: string }>).detail.zoneId),
    );
    await userEvent.keyboard("{Enter}");
    expect(selected).toEqual(["zone-19"]);
    expect(menu.shadowRoot!.activeElement).toBe(trigger);
  } finally {
    await page.viewport(1280, 900);
  }
});

it("the handheld More menu keeps its host height cap below the bar after rotation", async () => {
  await page.viewport(390, 844);
  try {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "phone-portrait",
      operatorName: "Ana",
      activeScreen: "floor",
      affordances: ["find-bill", "schedule", "station"],
      canSwitchProfile: true,
    });
    const menu = el.shadowRoot!.querySelector<HTMLElement>('[data-test="more-menu"]')!;
    await (menu as TillShell).updateComplete;
    const trigger = menu.shadowRoot!.querySelector("button")!;
    const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await userEvent.click(trigger);
    const portraitBottom = trigger.getBoundingClientRect().bottom;
    await page.viewport(844, 390);
    await vi.waitFor(() => {
      expect(trigger.getBoundingClientRect().bottom).not.toBe(portraitBottom);
    });
    await vi.waitFor(() => {
      expect(popup.getBoundingClientRect().top).toBeCloseTo(
        trigger.getBoundingClientRect().bottom,
        0,
      );
      expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight - 8);
      expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
    });
  } finally {
    await page.viewport(1280, 900);
  }
});

async function openHandheldMore(affordances: ShellAffordance[]) {
  const { el } = await mountWidget<TillShell>("till-shell", {
    formFactor: "phone-portrait",
    operatorName: "Ana",
    activeScreen: "floor",
    affordances,
  });
  const menu = el.shadowRoot!.querySelector<HTMLElement>('[data-test="more-menu"]')!;
  await (menu as TillShell).updateComplete;
  const trigger = menu.shadowRoot!.querySelector("button")!;
  const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(trigger);
  const resizeUntilTriggerMoves = async (width: number, height: number) => {
    const before = trigger.getBoundingClientRect().bottom;
    await page.viewport(width, height);
    await vi.waitFor(() => {
      expect(trigger.getBoundingClientRect().bottom).not.toBe(before);
    });
  };
  const underTrigger = () => {
    expect(popup.matches(":popover-open")).toBe(true);
    expect(popup.getBoundingClientRect().top).toBeCloseTo(
      trigger.getBoundingClientRect().bottom,
      0,
    );
  };
  // A popup shorter than its cap keeps its size when the cap moves, so its own size observer does
  // not place it again.
  const expectPopupUnderTriggerBelowCap = () =>
    vi.waitFor(() => {
      expect(popup.scrollHeight).toBe(popup.clientHeight);
      underTrigger();
    });
  const expectPopupUnderTrigger = () => vi.waitFor(underTrigger);
  return {
    menu,
    popup,
    resizeUntilTriggerMoves,
    expectPopupUnderTriggerBelowCap,
    expectPopupUnderTrigger,
  };
}

it("a short handheld More menu follows ☰ through a rotation and back", async () => {
  await page.viewport(390, 844);
  // The vibrate switch makes More too tall for 844×480; this case is about a menu that fits.
  Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });
  try {
    const more = await openHandheldMore([]);
    await more.resizeUntilTriggerMoves(844, 480);
    await more.expectPopupUnderTriggerBelowCap();
    await more.resizeUntilTriggerMoves(390, 844);
    await more.expectPopupUnderTriggerBelowCap();
  } finally {
    delete (navigator as { vibrate?: unknown }).vibrate;
    await page.viewport(1280, 900);
  }
});

it("a handheld More menu with the vibrate switch follows ☰ through a rotation and still reaches Log out", async () => {
  await page.viewport(390, 844);
  Object.defineProperty(navigator, "vibrate", { value: () => true, configurable: true });
  const forgetTouchScreen = declareTouchScreen();
  try {
    const more = await openHandheldMore([]);
    expect(more.menu.querySelector('[data-test="press-buzz-switch"]')).not.toBeNull();
    const logout = more.menu.querySelector<HTMLElement>("wt-button.logout")!;
    await more.resizeUntilTriggerMoves(844, 440);
    await vi.waitFor(() =>
      expect(more.popup.scrollHeight).toBeGreaterThan(more.popup.clientHeight),
    );
    await more.expectPopupUnderTrigger();
    logout.scrollIntoView({ block: "nearest" });
    await vi.waitFor(() => {
      const top = more.popup.getBoundingClientRect().top + more.popup.clientTop;
      const item = logout.getBoundingClientRect();
      expect(item.top).toBeGreaterThanOrEqual(top);
      expect(item.bottom).toBeLessThanOrEqual(top + more.popup.clientHeight);
      expect(item.bottom).toBeLessThanOrEqual(window.innerHeight);
    });
    await more.resizeUntilTriggerMoves(390, 844);
    await more.expectPopupUnderTrigger();
  } finally {
    delete (navigator as { vibrate?: unknown }).vibrate;
    forgetTouchScreen();
    await page.viewport(1280, 900);
  }
});

it("the handheld More menu follows ☰ when a wider window moves it", async () => {
  await page.viewport(390, 844);
  try {
    const more = await openHandheldMore(["find-bill", "schedule", "station"]);
    await more.resizeUntilTriggerMoves(1024, 768);
    await more.expectPopupUnderTriggerBelowCap();
  } finally {
    await page.viewport(1280, 900);
  }
});

it("puts the narrow Floor controls in one bottom bar and returns focus on widening", async () => {
  await page.viewport(390, 844);
  try {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "phone-portrait",
      operatorName: "Ana",
      clockAvailable: true,
      clockState: {
        personId: "person",
        businessDay: "2026-11-26",
        state: "working",
        firstClockIn: false,
        shiftStart: null,
        lastEntryId: "clock-in",
      },
      activeScreen: "floor",
      canCloseDrawer: true,
      transferAvailable: true,
      transferCount: 2,
    });
    const floor = document.createElement("till-floor-screen");
    floor.canChangeToday = true;
    floor.zones = [
      {
        id: "room",
        name: "Dining room",
        displayOrder: 0,
        active: true,
        closed: false,
        closesAt: null,
        hasPlan: true,
        layoutSetName: "Dinner",
        layoutDue: null,
        serviceMode: "table_tab",
      },
    ];
    floor.zones = [...floor.zones, { ...floor.zones[0]!, id: "terrace", name: "Terrace" }];
    el.append(floor);
    const root = el.shadowRoot!;
    const bar = () => root.querySelector<HTMLElement>("[data-floor-bar]");
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    expect(root.querySelector(".head")).toBeNull();
    expect(root.querySelectorAll('[data-test="more-menu"]')).toHaveLength(1);
    expect(bar()!.querySelector("[data-floor-zone-chooser]")!.textContent).toContain("Dining room");
    expect(bar()!.querySelector('[slot="badge"]')).toHaveProperty("count", 2);
    const trigger = bar()!
      .querySelector("[data-floor-zone-chooser]")!
      .shadowRoot!.querySelector("button")!;
    expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    const more = () => root.querySelector<HTMLElement>('[data-test="more-menu"]')!;
    const openMore = () => userEvent.click(more().shadowRoot!.querySelector("button")!);
    const moreTrigger = more().shadowRoot!.querySelector("button")!;
    const clockAction = vi.fn();
    el.addEventListener("clock-action", clockAction);
    moreTrigger.focus();
    await userEvent.keyboard("{Enter}{Enter}");
    expect(clockAction).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(more().querySelector('[data-clock-action="out"]')?.shadowRoot?.activeElement).toBe(
      more().querySelector('[data-clock-action="out"]')?.shadowRoot?.querySelector("button"),
    );
    await userEvent.keyboard("{Escape}");
    expect(more().shadowRoot!.activeElement).toBe(moreTrigger);

    await openMore();
    await expect.element(page.getByRole("button", { name: /^Transfers.*2/ })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Close the drawer" })).toBeVisible();
    expect(more().querySelector("wt-menu-row:not([action], [divider]):empty")).toBeNull();
    const person = more().querySelector(".operator")!;
    expect(
      person.closest(".floor-operator")?.querySelector('[data-clock-action="out"]'),
    ).not.toBeNull();
    await expect.element(page.getByRole("button", { name: "Taken off 0" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Back to the Dinner plan" }))
      .toBeVisible();
    await userEvent.click(
      more().querySelector('[data-menu-item="spares"]')!.shadowRoot!.querySelector("button")!,
    );
    const zoneMenu = floor.shadowRoot!.querySelector("till-floor-zone-menu")!;
    await vi.waitFor(() =>
      expect(zoneMenu.shadowRoot!.querySelector('[data-dialog="spares"]')).toHaveProperty(
        "open",
        true,
      ),
    );
    await page.viewport(820, 844);
    await vi.waitFor(() => expect(bar()).toBeNull());
    const wideMenu = floor.shadowRoot!.querySelector("till-floor-zone-menu")!;
    expect(wideMenu).toBe(zoneMenu);
    expect(wideMenu.shadowRoot!.querySelector('[data-dialog="spares"]')).toHaveProperty(
      "open",
      true,
    );
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(zoneMenu.shadowRoot!.querySelector('[data-dialog="spares"]')).toHaveProperty(
        "open",
        false,
      ),
    );
    await page.viewport(700, 844);
    await vi.waitFor(() => expect(bar()).not.toBeNull());
    expect(floor.shadowRoot!.querySelector(".zone-toolbar [data-zone]")).toBeNull();
    expect(zoneMenu.shadowRoot!.querySelector("wt-row-actions")?.hidden).toBe(true);
    const zoneChooser = bar()!.querySelector<HTMLElement>("[data-floor-zone-chooser]")!;
    await userEvent.click(zoneChooser.shadowRoot!.querySelector("button")!);
    const selected = zoneChooser.querySelector<HTMLButtonElement>('[aria-checked="true"]')!;
    expect(selected.matches(":focus")).toBe(true);
    expect(selected.firstElementChild?.matches("[data-row-check]")).toBe(true);
    expect(getComputedStyle(selected.firstElementChild!).visibility).toBe("visible");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect
      .element(page.elementLocator(zoneChooser.shadowRoot!.querySelector("button")!))
      .toHaveAccessibleName("Terrace");
    await openMore();
    await page.viewport(800, 844);
    await vi.waitFor(() => {
      expect(bar()).toBeNull();
      expect(more().shadowRoot!.activeElement).toBe(more().shadowRoot!.querySelector("button"));
    });
    expect(floor.shadowRoot!.querySelector(".zone-toolbar")).not.toBeNull();
    await page.viewport(700, 844);
    await vi.waitFor(() =>
      expect(more().shadowRoot!.activeElement).toBe(more().shadowRoot!.querySelector("button")),
    );
    floor.zones = [
      ...floor.zones,
      { ...floor.zones[0]!, id: "patio", name: "Patio", displayOrder: 1 },
    ];
    await floor.updateComplete;
    const zones = bar()!.querySelector("wt-row-actions[data-floor-zone-chooser]")!;
    await userEvent.click(zones.shadowRoot!.querySelector("button")!);
    await vi.waitFor(() => expect(zones.shadowRoot!.querySelector(":popover-open")).not.toBeNull());
    await page.viewport(800, 844);
    await vi.waitFor(() => {
      expect(bar()).toBeNull();
      expect(floor.shadowRoot!.activeElement).toBe(
        floor.shadowRoot!.querySelector('[data-zone="terrace"]'),
      );
      expect(floor.shadowRoot!.activeElement).not.toBeNull();
    });
  } finally {
    await page.viewport(1280, 900);
  }
});

it.each([
  ["en-GB", "working", "16:02", "Clocked in at 17:02", "Clock out", 390, "at 17:02"],
  ["es-ES", "on_break", "00:02", "Entrada fichada a la 01:02", "Fichar salida", 320, "a la 01:02"],
  ["es-ES", "working", "16:02", "Entrada fichada a las 17:02", "Fichar salida", 360, "a las 17:02"],
] as const)(
  "shows the recorded start in narrow Floor More (%s, %s, %s)",
  async (locale, state, utcTime, label, action, width, timePhrase) => {
    setLocale(locale);
    await page.viewport(width, 844);
    try {
      const clockState: TillClockState = {
        personId: "person",
        businessDay: "2026-11-26",
        state,
        firstClockIn: false,
        lastEntryId: "entry",
        shiftStart: { eventAt: `2026-11-26T${utcTime}:00.000Z`, offsetMinutes: 60 },
      };
      const { el } = await mountWidget<TillShell>("till-shell", {
        formFactor: "phone-portrait",
        operatorName: "Ana",
        activeScreen: "floor",
        clockAvailable: true,
        clockState,
      });
      el.append(document.createElement("till-floor-screen"));
      const more = () => el.shadowRoot!.querySelector<HTMLElement>(".floor-menu")!;
      await vi.waitFor(() => expect(more()).not.toBeNull());
      await userEvent.click(more().shadowRoot!.querySelector("button")!);
      const start = page.getByText(label, { exact: true });
      expect(start.elements(), `visible clock-in label: ${label}`).toHaveLength(1);
      await expect.element(start).toBeVisible();
      const name = more().querySelector(".operator-label")!;
      expect(start.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
        name.getBoundingClientRect().bottom,
      );
      expect(getComputedStyle(start.element()).fontSize).toBe("13px");
      const text = [...start.element().childNodes].find(
        (node): node is Text => node instanceof Text,
      )!;
      const time = document.createRange();
      time.setStart(text, text.length - timePhrase.length);
      time.setEnd(text, text.length);
      const lines = time.getClientRects();
      expect(lines, `${timePhrase} at ${width}px`).toHaveLength(1);
      expect(lines[0]!.right).toBeLessThanOrEqual(start.element().getBoundingClientRect().right);
      const clockOut = page.getByRole("button", { name: action, exact: true });
      expect(clockOut.elements()).toHaveLength(1);

      for (const props of [
        { clockAvailable: false },
        { clockState: null },
        { clockState: { ...clockState, state: "out", shiftStart: null } },
        { clockState: { ...clockState, shiftStart: null } },
      ] as const) {
        Object.assign(el, { clockAvailable: true, clockState }, props);
        await el.updateComplete;
        expect(start.elements()).toHaveLength(0);
      }
      Object.assign(el, { clockState, operatorName: "" });
      await el.updateComplete;
      expect(start.elements()).toHaveLength(0);
      el.operatorName = "Ana";
      await el.updateComplete;
      const onAction = vi.fn();
      el.addEventListener("clock-action", onAction);
      await clockOut.click();
      expect(onAction).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ detail: { action: "out" } }),
      );
    } finally {
      await page.viewport(1280, 900);
    }
  },
);

it("aligns Counter choices with table zones and opens Shop once from the keyboard", async () => {
  setLocale("en-GB");
  const { innerWidth: width, innerHeight: height } = window;
  await page.viewport(390, 844);
  try {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "till",
      activeScreen: "floor",
      showCounter: true,
      ...{
        counterZones: [
          { id: "bar", name: "Bar" },
          { id: "shop", name: "Shop" },
        ],
        selectedCounterZoneId: "bar",
      },
    });
    const floor = document.createElement("till-floor-screen");
    floor.zones = [
      {
        id: "room",
        name: "Dining room",
        displayOrder: 0,
        active: true,
        closed: false,
        closesAt: null,
        hasPlan: true,
        layoutSetName: null,
        layoutDue: null,
        serviceMode: "table_tab",
      },
    ];
    el.append(floor);
    const chooser = await vi.waitFor(() => {
      const menu = el.shadowRoot!.querySelector("[data-floor-zone-chooser]");
      expect(menu).not.toBeNull();
      return menu!;
    });
    const selected = vi.fn();
    el.addEventListener("counter-zone-selected", selected);
    await userEvent.click(chooser.shadowRoot!.querySelector("button")!);
    const room = chooser.querySelector<HTMLButtonElement>('[data-floor-zone="room"]')!;
    const counterRows = Array.from(chooser.querySelectorAll('[role="menuitem"] wt-menu-row'));
    expect(counterRows.map((row) => row.getAttribute("label"))).toEqual(["Bar", "Shop"]);
    const roomLabel = room.querySelector("wt-menu-row")!.shadowRoot!.querySelector(".label")!;
    for (const row of counterRows) {
      const label = row.shadowRoot!.querySelector(".label")!;
      expect(label.getBoundingClientRect().left).toBe(roomLabel.getBoundingClientRect().left);
      expect(row.getBoundingClientRect().height).toBe(60);
    }
    expect(room.getAttribute("aria-checked")).toBe("true");
    room.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(chooser.querySelector('[role="menuitem"]:focus wt-menu-row')).toBe(counterRows[1]);
    await userEvent.keyboard("{Enter}");
    expect(selected).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ detail: { zoneId: "shop" } }),
    );
    expect(chooser.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
    expect(el.shadowRoot!.querySelectorAll(".head [data-counter-orders]")).toHaveLength(2);
    expect(el.shadowRoot!.querySelector(".head [data-counter-zones]")).toBeNull();
  } finally {
    await page.viewport(width, height);
  }
});

it("walks from the last floor zone to the kitchen action with the arrow key", async () => {
  setLocale("en-GB");
  await page.viewport(390, 844);
  try {
    const { el } = await mountWidget<TillShell>("till-shell", {
      activeScreen: "floor",
      operatorName: "Ana",
      affordances: ["expo"],
      ...{ floorKitchenRows: [{ label: "Pass" }] },
    });
    const floor = document.createElement("till-floor-screen");
    floor.zones = [
      {
        id: "room",
        name: "Dining room",
        displayOrder: 0,
        active: true,
        closed: false,
        closesAt: null,
        hasPlan: true,
        layoutSetName: null,
        layoutDue: null,
        serviceMode: "table_tab",
      },
    ];
    el.append(floor);
    const chooser = await vi.waitFor(() => {
      const menu = el.shadowRoot!.querySelector("[data-floor-zone-chooser]");
      expect(menu).not.toBeNull();
      return menu!;
    });
    const opened = vi.fn();
    el.addEventListener("show-expo", opened);
    await userEvent.click(chooser.shadowRoot!.querySelector("button")!);
    const zone = chooser.querySelector<HTMLButtonElement>('[data-floor-zone="room"]')!;
    const kitchen = chooser.querySelector<HTMLButtonElement>("[data-floor-kitchen-row]")!;
    const nameInset = (row: HTMLButtonElement, name: string) => {
      const label = row.querySelector("wt-menu-row")?.shadowRoot?.querySelector(".label") ?? row;
      const text = Array.from(label.childNodes).find((node) => node.textContent === name)!;
      const range = document.createRange();
      range.selectNodeContents(text);
      return range.getBoundingClientRect().left - row.getBoundingClientRect().left;
    };
    expect(nameInset(zone, "Dining room")).toBe(56);
    expect(nameInset(kitchen, "Pass")).toBe(56);
    expect(getComputedStyle(zone.querySelector("wt-menu-row")!).borderBlockEndWidth).toBe("0px");
    const kitchenHeading = chooser.querySelector("[data-menu-heading]")!;
    expect(getComputedStyle(kitchenHeading).borderBlockEndWidth).toBe("1px");
    zone.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(
      chooser.querySelector('[role="menuitem"]:focus wt-menu-row')?.getAttribute("label"),
    ).toBe("Pass");
    await userEvent.keyboard("{Enter}");
    expect(opened).toHaveBeenCalledOnce();
    expect(chooser.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  } finally {
    await page.viewport(1280, 900);
  }
});

it("still announces pending transfers with a floor chooser board open", async () => {
  setLocale("en-GB");
  const { el } = await mountWidget<TillShell>("till-shell", {
    formFactor: "phone-portrait",
    floorKitchenOpen: true,
    transferCount: 1,
  });
  const announcement = el.shadowRoot!.querySelector(
    '[role="status"][data-test="department-transfers-status"]',
  );
  expect(announcement?.textContent).toBe("Transfers (1 pending)");
});

it("shows the active language in the joined floor menu choice and gives Log out no arrow", async () => {
  setLocale("en-GB");
  await page.viewport(390, 844);
  try {
    const { el } = await mountWidget<TillShell>("till-shell", {
      formFactor: "phone-portrait",
      operatorName: "Ana",
      activeScreen: "floor",
      loadLocales: async () => [...SUPPORTED_LOCALES],
    });
    el.append(document.createElement("till-floor-screen"));
    const more = () => el.shadowRoot!.querySelector<HTMLElement>(".floor-menu")!;
    await vi.waitFor(() => expect(more()).not.toBeNull());
    await userEvent.click(more().shadowRoot!.querySelector("button")!);
    const chooser = more().querySelector("wt-language-chooser")!;
    const choices = () => [...chooser.shadowRoot!.querySelectorAll(".choice")];
    await vi.waitFor(() => expect(choices()).toHaveLength(2));
    const [spanish, english] = choices();
    expect(spanish!.getAttribute("aria-pressed")).toBe("false");
    expect(english!.getAttribute("aria-pressed")).toBe("true");
    expect(spanish!.getBoundingClientRect().right).toBe(english!.getBoundingClientRect().left);
    expect(getComputedStyle(chooser.shadowRoot!.querySelector(".group-label")!).fontSize).toBe(
      "16px",
    );
    const logout = more().querySelector(".logout")!.shadowRoot!.querySelector("button")!;
    expect(logout.querySelector('[part="chevron"]')).toBeNull();
    expect(getComputedStyle(logout).fontWeight).toBe("600");
  } finally {
    await page.viewport(1280, 900);
  }
});

it.each([
  ["light", 390, 844],
  ["dark", 700, 390],
] as const)("docks both floor sheets at the bar in %s at %i × %i", async (theme, width, height) => {
  setLocale("en-GB");
  await page.viewport(width, height);
  try {
    const { el, host } = await mountWidget<TillShell>(
      "till-shell",
      {
        activeScreen: "floor",
        operatorName: "Ana",
      },
      theme,
    );
    el.style.setProperty("--wt-page-padding", "8px");
    el.style.position = "fixed";
    el.style.inset = "8px";
    el.style.height = "auto";
    el.append(document.createElement("till-floor-screen"));
    const footer = await vi.waitFor(() => {
      const footer = el.shadowRoot!.querySelector<HTMLElement>("[data-floor-bar]");
      expect(footer).not.toBeNull();
      return footer!;
    });
    for (const selector of ["[data-floor-zone-chooser]", ".floor-menu"]) {
      const menu = footer.querySelector<HTMLElement>(selector)!;
      const trigger = menu.shadowRoot!.querySelector("button")!;
      await userEvent.click(trigger);
      const popup = menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      const sheet = popup.querySelector<HTMLElement>('[part="sheet"]')!;
      const docked = (element: Element) =>
        expect(element.getBoundingClientRect().bottom).toBeCloseTo(
          footer.getBoundingClientRect().top,
          0,
        );
      docked(popup);
      await vi.waitFor(() => docked(sheet));
      if (width === 390) {
        const lastRow = menu.querySelector<HTMLElement>(
          selector === ".floor-menu" ? ".logout" : "[data-open-device-zones]",
        )!;
        expect(lastRow.getBoundingClientRect().width).toBe(width);
        expect([
          selector,
          getComputedStyle(sheet).borderBlockEndWidth,
          getComputedStyle(lastRow).borderBlockEndWidth,
          getComputedStyle(footer).borderBlockStartWidth,
        ]).toEqual([selector, "0px", "0px", "1px"]);
        const gutter = getComputedStyle(footer, "::after");
        expect(footer.getBoundingClientRect().bottom + parseFloat(gutter.height)).toBe(height);
        expect(gutter.backgroundColor).toBe(getComputedStyle(footer).backgroundColor);
      }
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      if (selector === "[data-floor-zone-chooser]") {
        await expect.element(page.elementLocator(sheet)).toHaveAccessibleName("Zones");
      }
      await page.viewport(width, height + 24);
      await vi.waitFor(() => docked(popup));
      await expectNoA11yViolations(host);
      await userEvent.click(footer.querySelector<HTMLElement>("[data-view-toggle]")!);
      expect(popup.matches(":popover-open")).toBe(false);
      await page.viewport(width, height);
    }
  } finally {
    await page.viewport(1280, 900);
  }
});
