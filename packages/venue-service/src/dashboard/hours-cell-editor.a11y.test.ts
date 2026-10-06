import { afterEach, describe, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { HoursCellEditor } from "./hours-cell-editor.js";
import "./hours-cell-editor.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const states: Record<string, Partial<HoursCellEditor>> = {
  "a blank special-date cell keeping its standard hours": {
    modes: ["inherit", "closed", "all_day", "periods"],
    inherited: "12:00–16:00",
    cell: { mode: "inherit", periods: [] },
  },
  "two periods with a refused time": {
    modes: ["closed", "all_day", "periods"],
    cell: {
      mode: "periods",
      periods: [
        { id: "a", opensAt: "12:00", closesAt: "16:00" },
        { id: "b", opensAt: "20:00", closesAt: "" },
      ],
    },
    errors: {
      "monday.mode": "These hours overlap Sunday's hours past midnight.",
      "monday.periods.1.closesAt": "Enter a time.",
    },
  },
  "locked by a whole-venue closure": {
    modes: ["inherit", "closed", "all_day", "periods"],
    cell: { mode: "periods", periods: [{ id: "a", opensAt: "09:00", closesAt: "13:00" }] },
    disabled: true,
  },
};

describe.each(["light", "dark"] as const)("hours cell editor accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("hours-cell-editor");
    Object.assign(el, { label: "Monday", fieldPrefix: "monday", ...states[state] });
    host.append(el);
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
