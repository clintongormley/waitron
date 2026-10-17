import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import type { TillShell } from "./till-shell.js";
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
  expect(labels()).toEqual(["Floor", "Order"]);
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
