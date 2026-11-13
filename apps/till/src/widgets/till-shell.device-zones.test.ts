import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import type { ShellAffordance, TillShell } from "./till-shell.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./till-shell.js";

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
  // A popup shorter than its cap keeps its size when the cap moves, so its own size observer does
  // not place it again.
  const expectPopupUnderTriggerBelowCap = () =>
    vi.waitFor(() => {
      expect(popup.matches(":popover-open")).toBe(true);
      expect(popup.scrollHeight).toBe(popup.clientHeight);
      expect(popup.getBoundingClientRect().top).toBeCloseTo(
        trigger.getBoundingClientRect().bottom,
        0,
      );
    });
  return { resizeUntilTriggerMoves, expectPopupUnderTriggerBelowCap };
}

it("a short handheld More menu follows ☰ through a rotation and back", async () => {
  await page.viewport(390, 844);
  try {
    const more = await openHandheldMore([]);
    await more.resizeUntilTriggerMoves(844, 430);
    await more.expectPopupUnderTriggerBelowCap();
    await more.resizeUntilTriggerMoves(390, 844);
    await more.expectPopupUnderTriggerBelowCap();
  } finally {
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
