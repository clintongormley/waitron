import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import type { OpeningHoursMonthView } from "./opening-hours-month.js";
import "./opening-hours-month.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const states: Record<string, Partial<OpeningHoursMonthView>> = {
  "every department": {},
  "one department and its zones": { departmentId: "rest" },
  "read-only": { readOnly: true },
  "read-only, one department": { readOnly: true, departmentId: "rest" },
};

describe.each(["light", "dark"] as const)("Opening hours month accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("opening-hours-month");
    Object.assign(el, {
      model: monthModel(),
      departments: DEPARTMENTS,
      ...states[state],
    });
    host.append(el);
    await el.updateComplete;
    const root = el.shadowRoot!;
    for (const shown of [
      "[data-outside]",
      "[data-closed]",
      '[data-test="today"]',
      ".name.special",
      ".name.holiday",
      '[data-test="department-closed"]',
    ])
      expect(root.querySelector(shown), shown).not.toBeNull();
    if (states[state]!.departmentId) expect(root.querySelector('[data-test="gap"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
