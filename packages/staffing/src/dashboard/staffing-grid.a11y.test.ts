import { setLocale } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, test } from "vitest";
import { CALENDAR_COLOURS } from "@waitron/venue-service/hours-types";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { StaffingGrid } from "./staffing-grid.js";
import "./staffing-grid.js";

const guideIdentity = {
  periodId: "lunch",
  periodName: "Lunch",
  periodColour: "blue" as const,
  departmentId: "dining",
  departmentName: "Dining room",
};

afterEach(() => {
  cleanup();
  setLocale("en");
});

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

describe.each(["light", "dark"] as const)("staffing grid (%s)", (theme) => {
  test.each([
    "empty",
    "blocks",
    "menu",
    "dragging",
    "column-menu",
    "chooser",
    "follows",
    "read-only",
    "column-error",
  ])("%s", async (state) => {
    const el = (await mountThemed("<staffing-grid></staffing-grid>", theme)) as StaffingGrid;
    el.columns = [
      { key: "mon", label: "Monday" },
      { key: "tue", label: "Tuesday" },
    ];
    el.staffRoles = CALENDAR_COLOURS.map((colour, position) => ({
      id: colour,
      name: `Role ${colour}`,
      colour,
      position,
      holderIds: [],
    }));
    el.cutover = "06:00";
    el.chosen = "blue";
    el.followable = true;
    el.readOnly = state === "read-only";
    const painted = state !== "empty" && state !== "follows";
    el.days = new Map([
      ["mon", state === "follows" ? null : []],
      [
        "tue",
        painted
          ? CALENDAR_COLOURS.map((colour, i) => ({
              staffRoleId: colour,
              headcount: i + 1,
              startsAt: hour(7 + i),
              endsAt: hour(12 + i),
            }))
          : [],
      ],
    ]);
    el.guideKind = "station";
    el.guideDepartmentIds = ["dining", "takeaway"];
    if (painted)
      el.guides = new Map([
        [
          "tue",
          CALENDAR_COLOURS.map((colour, i) => ({
            ...guideIdentity,
            periodId: `period-${colour}`,
            periodName: `Period ${colour}`,
            periodColour: colour,
            departmentId: i % 2 ? "takeaway" : "dining",
            departmentName: i % 2 ? "Takeaway" : "Dining room",
            startsAt: hour(8 + i),
            endsAt: hour(16 + i),
          })),
        ],
      ]);
    if (state === "column-error") el.columnErrors = new Map([["tue", "Check this day's blocks."]]);
    await el.updateComplete;
    if (state === "follows")
      expect(el.shadowRoot!.querySelector(".follows")!.textContent).toContain("Follows the season");
    if (state === "column-error")
      expect(
        el.shadowRoot!.querySelector('.heading[data-column="tue"][data-error]'),
      ).not.toBeNull();
    if (state === "menu") {
      el.shadowRoot!.querySelector<HTMLButtonElement>("button.block")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".menu")!.matches(":popover-open")).toBe(true);
      expect(el.shadowRoot!.querySelector(".menu wt-number-stepper")).not.toBeNull();
    }
    if (state === "dragging") {
      const monday = el.shadowRoot!.querySelector<HTMLElement>('.day[data-column="mon"]')!;
      const day = monday.getBoundingClientRect();
      monday.dispatchEvent(
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
      expect(el.shadowRoot!.querySelector(".preview[data-colour=blue]")).not.toBeNull();
    }
    if (state === "column-menu" || state === "chooser") {
      const kebab = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
        '.heading[data-column="tue"] wt-row-actions',
      )!;
      kebab.show();
      await kebab.updateComplete;
      expect(kebab.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
      if (state === "column-menu") expect(kebab.textContent).toContain("Follow the season");
      if (state === "chooser") {
        kebab.querySelector<HTMLElement>("wt-button")!.click();
        await el.updateComplete;
        await el.updateComplete;
        const chooser = el.shadowRoot!.querySelector(".chooser")!;
        expect(chooser.matches(":popover-open")).toBe(true);
        chooser.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        await el.updateComplete;
      }
    }
    await expectNoA11yViolations(host);
  });
});
