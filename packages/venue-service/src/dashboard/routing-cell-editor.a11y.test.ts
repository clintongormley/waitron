import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { RoutingCellEditor } from "./routing-cell-editor.js";
import "./routing-cell-editor.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const dining = { departmentId: "dining", departmentName: "Dining", colour: "blue" as const };
const down = { kind: "station", stationId: "down" } as const;

describe.each(["light", "dark"] as const)("Routing cell editor (%s)", (theme) => {
  test.each(["empty", "two lines", "refusal"])("%s", async (state) => {
    setLocale("en");
    const el = (await mountThemed(
      "<routing-cell-editor></routing-cell-editor>",
      theme,
    )) as RoutingCellEditor;
    el.periods = [
      { id: "breakfast", ...dining, name: "Breakfast", productIds: ["mojito"] },
      { id: "lunch", ...dining, name: "Lunch", productIds: ["mojito"] },
      { id: "dinner", ...dining, name: "Dinner", productIds: ["bread"] },
    ];
    el.stations = [
      { id: "up", name: "Upstairs", active: true },
      { id: "down", name: "Downstairs", active: true },
    ];
    el.rowProductIds = ["mojito"];
    el.cell = {
      address: { row: { kind: "category", categoryId: "cocktails" }, zoneId: null },
      label: "Cocktails, Every zone",
      target: { kind: "station", stationId: "up" },
      ...(state === "empty"
        ? { inheritedFrom: "All categories", periods: [{ periodId: "dinner", target: down }] }
        : {
            periods: [
              { periodId: "breakfast", target: down },
              { periodId: "lunch", target: { kind: "no_preparation" } },
            ],
          }),
    };
    el.open = true;
    await el.updateComplete;
    if (state === "refusal")
      el.refusal = {
        code: "route.period_invalid",
        params: { periodId: "lunch", reason: "not_offered" },
      };
    await el.updateComplete;
    if (state === "refusal")
      expect(
        el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-combobox"]>(
          "[name=line-periods]",
        )[1]!.error,
      ).toBe("Lunch offers none of these products.");
    await expectNoA11yViolations(host);
  });
});
