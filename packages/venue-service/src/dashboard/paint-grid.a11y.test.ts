import { setLocale } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { CALENDAR_COLOURS } from "../hours-types.js";
import type { PaintGrid } from "./paint-grid.js";
import "./paint-grid.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

function channels(colour: string): number[] {
  return colour.match(/[\d.]+/g)!.map(Number);
}
function luminance(colour: string): number {
  const [r, g, b] = channels(colour).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** axe does not judge the faded blocks' names, so the zone state measures them itself. */
function expectReadableUnderlay(el: PaintGrid) {
  const names = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".underlay > span")];
  expect(names).toHaveLength(CALENDAR_COLOURS.length);
  for (const name of names) {
    const style = getComputedStyle(name);
    expect(channels(style.backgroundColor)[3] ?? 1, "an opaque background").toBe(1);
    const [light, dark] = [luminance(style.color), luminance(style.backgroundColor)].sort(
      (a, b) => b - a,
    );
    expect((light! + 0.05) / (dark! + 0.05), name.textContent!).toBeGreaterThanOrEqual(4.5);
  }
}

describe.each(["light", "dark"] as const)("paint grid (%s)", (theme) => {
  test.each([
    "empty",
    "painted",
    "selected",
    "dragging",
    "zone",
    "column-menu",
    "chooser",
    "refused",
    "read-only",
    "column-head",
  ])("%s", async (state) => {
    const el = (await mountThemed("<paint-grid></paint-grid>", theme)) as PaintGrid;
    const painted = state !== "empty";
    el.columns = [
      { key: "mon", label: "Monday" },
      { key: "tue", label: "Tuesday" },
    ];
    el.periods = CALENDAR_COLOURS.map((colour) => ({ id: colour, name: colour, colour }));
    el.cutover = "06:00";
    el.chosen = "blue";
    el.closedErases = state !== "zone";
    el.readOnly = state === "read-only";
    el.days = new Map([
      ["mon", []],
      [
        "tue",
        painted
          ? [
              ...CALENDAR_COLOURS.map((colour, i) => ({
                periodId: colour,
                startsAt: `${String(7 + i * 2).padStart(2, "0")}:00`,
                endsAt: `${String(9 + i * 2).padStart(2, "0")}:00`,
              })),
              { periodId: null, startsAt: "20:00", endsAt: "22:00" },
            ]
          : [],
      ],
    ]);
    if (state === "zone")
      el.underlay = new Map([
        [
          "mon",
          CALENDAR_COLOURS.map((colour, i) => ({
            periodId: colour,
            startsAt: `${String(7 + i * 2).padStart(2, "0")}:00`,
            endsAt: `${String(9 + i * 2).padStart(2, "0")}:00`,
          })),
        ],
      ]);
    if (state === "refused")
      el.columnErrors = new Map([["tue", "Check this day's time ranges and periods."]]);
    if (state === "column-head")
      el.insertAdjacentHTML(
        "beforeend",
        `<label slot="column-head-tue"><input type="checkbox" name="closed-tue" checked /> Closed</label>`,
      );
    await el.updateComplete;
    if (state === "column-head")
      expect(el.querySelector("label")!.getBoundingClientRect().height).toBeGreaterThan(0);
    if (state === "refused")
      expect(
        el.shadowRoot!.querySelector('.heading[data-column="tue"][data-error]'),
      ).not.toBeNull();
    if (state === "selected") {
      el.shadowRoot!.querySelector<HTMLButtonElement>("button.block")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".menu")!.matches(":popover-open")).toBe(true);
    }
    if (state === "dragging") {
      const day = el
        .shadowRoot!.querySelector<HTMLElement>('.day[data-column="tue"]')!
        .getBoundingClientRect();
      el.shadowRoot!.querySelector('.day[data-column="tue"]')!.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 12,
          bubbles: true,
          button: 0,
          clientY: day.top + (day.height * 3) / 24,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 12,
          clientY: day.top + (day.height * 6) / 24,
        }),
      );
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".preview")).not.toBeNull();
    }
    if (state === "column-menu" || state === "chooser") {
      const kebab = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        '.heading[data-column="tue"] wt-row-actions',
      )!;
      kebab.show();
      await kebab.updateComplete;
      expect(kebab.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
      if (state === "chooser") {
        kebab.querySelector<HTMLElement>("wt-button")!.click();
        await el.updateComplete;
        await el.updateComplete;
        const chooser = el.shadowRoot!.querySelector(".chooser")!;
        expect(chooser.matches(":popover-open")).toBe(true);
        const tick = chooser.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        tick.click();
        await el.updateComplete;
        expect(tick.checked).toBe(true);
      }
    }
    if (state === "zone") expectReadableUnderlay(el);
    await expectNoA11yViolations(host);
  });
});
