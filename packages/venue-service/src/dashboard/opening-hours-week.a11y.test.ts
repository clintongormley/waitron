import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import type { OpeningHoursWeekView } from "./opening-hours-week.js";
import "./opening-hours-week.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const states: Record<string, { props: Partial<OpeningHoursWeekView>; shown: string[] }> = {
  "All departments": { props: { date: "2026-12-02" }, shown: [".block"] },
  "a department and its zones with a closure": {
    props: { date: "2026-12-02", departmentId: "rest" },
    shown: [".block[data-faded]", '.block[data-kind="closed"]'],
  },
  "a day closed all day": { props: { date: "2026-12-25" }, shown: [".name.holiday", ".track"] },
  Spanish: { props: { date: "2026-12-08", departmentId: "rest" }, shown: [".name.holiday"] },
};

describe.each(["light", "dark"] as const)("Opening hours week accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    if (state === "Spanish") setLocale("es");
    try {
      await mountThemed("<div></div>", theme);
      const el = document.createElement("opening-hours-week");
      Object.assign(el, { model: monthModel(), departments: DEPARTMENTS, ...states[state]!.props });
      host.append(el);
      await el.updateComplete;
      for (const shown of states[state]!.shown)
        expect(el.shadowRoot!.querySelector(shown), shown).not.toBeNull();
      await expectNoA11yViolations(host);
    } finally {
      setLocale("en");
    }
  });
});
