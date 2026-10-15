import { setLocale } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, test } from "vitest";
import { CALENDAR_COLOURS } from "@waitron/venue-service/hours-types";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { StaffingGrid } from "./staffing-grid.js";
import "./staffing-grid.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

describe.each(["light", "dark"] as const)("staffing grid (%s)", (theme) => {
  test.each(["empty", "blocks", "menu", "chooser", "follows", "read-only", "column-error"])(
    "%s",
    async (state) => {
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
      if (painted)
        el.guides = new Map([
          [
            "tue",
            [
              { startsAt: "13:00", endsAt: "16:00" },
              { startsAt: "20:00", endsAt: "00:00" },
            ],
          ],
        ]);
      if (state === "column-error")
        el.columnErrors = new Map([["tue", "Check this day's blocks."]]);
      await el.updateComplete;
      if (state === "follows")
        expect(el.shadowRoot!.querySelector(".follows")!.textContent).toContain(
          "Follows the season",
        );
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
      if (state === "chooser") {
        const kebab = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
          '.heading[data-column="tue"] wt-row-actions',
        )!;
        kebab.show();
        await kebab.updateComplete;
        kebab.querySelector<HTMLElement>("wt-button")!.click();
        await el.updateComplete;
        await el.updateComplete;
        const chooser = el.shadowRoot!.querySelector(".chooser")!;
        expect(chooser.matches(":popover-open")).toBe(true);
        chooser.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        await el.updateComplete;
      }
      await expectNoA11yViolations(host);
    },
  );
});
