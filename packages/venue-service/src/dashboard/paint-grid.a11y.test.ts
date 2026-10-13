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
      el.underlay = new Map([["mon", [{ periodId: "green", startsAt: "12:00", endsAt: "16:00" }]]]);
    if (state === "refused")
      el.columnErrors = new Map([["tue", "Check this day's time ranges and periods."]]);
    await el.updateComplete;
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
    await expectNoA11yViolations(host);
  });
});
