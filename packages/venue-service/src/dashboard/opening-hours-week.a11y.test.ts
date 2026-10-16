import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
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

/** December's model with the Restaurant's Lunch on 2 December a one-hour sliver. */
function sliverModel() {
  const model = monthModel();
  model.days = model.days.map((d) =>
    d.date === "2026-12-02"
      ? {
          ...d,
          departments: d.departments.map((dep) =>
            dep.departmentId === "rest"
              ? {
                  ...dep,
                  ranges: dep.ranges.map((r) =>
                    r.periodId === "lunch" ? { ...r, startsAt: "16:00", endsAt: "17:00" } : r,
                  ),
                }
              : dep,
          ),
        }
      : d,
  );
  return model;
}

const states: Record<
  string,
  { props: Partial<OpeningHoursWeekView>; shown: string[]; hover?: string }
> = {
  "All departments": { props: { date: "2026-12-02" }, shown: [".block"] },
  "a department and its zones with a closure": {
    props: { date: "2026-12-02", departmentId: "rest" },
    shown: [".block[data-faded]", '.block[data-kind="closed"]'],
  },
  "a day closed all day": { props: { date: "2026-12-25" }, shown: [".name.holiday", ".track"] },
  "a week across two years, with its four links": {
    props: { date: "2027-01-02" },
    shown: ['[data-test="week-month"]', '[data-test="week-year"]'],
  },
  "the tip shown over a sliver": {
    props: { date: "2026-12-02", model: sliverModel() },
    hover: 'section[data-date="2026-12-02"] .row[data-row="rest"] .block:nth-child(2)',
    shown: ['[data-test="block-tip"]:popover-open'],
  },
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
      const hover = states[state]!.hover;
      if (hover) await userEvent.hover(el.shadowRoot!.querySelector<HTMLElement>(hover)!);
      for (const shown of states[state]!.shown)
        expect(el.shadowRoot!.querySelector(shown), shown).not.toBeNull();
      await expectNoA11yViolations(host);
    } finally {
      setLocale("en");
    }
  });
});
