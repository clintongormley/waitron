import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import { flatParent } from "./flat-tree.js";
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

function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgba?\(/);
    const [r, g, bl] = rgb
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => Number(part) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** The colour painted behind `at`: the first box it is drawn inside with a background. */
function behind(at: Element): string {
  for (let box = flatParent(at); box !== null; box = flatParent(box)) {
    const colour = getComputedStyle(box).backgroundColor;
    if (colour !== "rgba(0, 0, 0, 0)") return colour;
  }
  throw new Error("nothing painted behind");
}

async function mountWeek(theme: "light" | "dark", props: Partial<OpeningHoursWeekView>) {
  await mountThemed("<div></div>", theme);
  const el = document.createElement("opening-hours-week");
  Object.assign(el, { model: monthModel(), departments: DEPARTMENTS, ...props });
  host.append(el);
  await el.updateComplete;
  return el;
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
  beforeEach(async () => {
    await page.viewport(1280, 800);
    expect(window.innerWidth).toBe(1280);
  });

  // axe scores no contrast for a shape with no text; light's track against the page, about 1.3,
  // is the bar dark must match.
  test("draws a bar's empty track apart from the page", async () => {
    const el = await mountWeek(theme, { date: "2026-12-02" });
    const track = el.shadowRoot!.querySelector<HTMLElement>(".track")!;
    expect(
      contrastRatio(getComputedStyle(track).backgroundColor, behind(track)),
    ).toBeGreaterThanOrEqual(1.3);
  });

  // axe leaves text over a gradient unscored, so a closed block's words are read against each of
  // its hatch's colours.
  test("writes a closed block's words apart from both colours of its hatch", async () => {
    const el = await mountWeek(theme, { date: "2026-12-02", departmentId: "rest" });
    const block = el.shadowRoot!.querySelector<HTMLElement>('.block[data-kind="closed"]')!;
    const hatch = new Set(getComputedStyle(block).backgroundImage.match(/rgba?\([^)]*\)/g));
    expect(hatch.size).toBe(2);
    const words = getComputedStyle(block.querySelector(".text")!).color;
    for (const colour of hatch)
      expect(contrastRatio(words, colour), colour).toBeGreaterThanOrEqual(4.5);
  });

  test.each(Object.keys(states))("%s", async (state) => {
    if (state === "Spanish") setLocale("es");
    try {
      const el = await mountWeek(theme, states[state]!.props);
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

const phoneStates: Record<
  string,
  { props: Partial<OpeningHoursWeekView>; shown: string[]; spanish?: true }
> = {
  "a day on a phone": {
    props: { date: "2026-12-08" },
    shown: ['[data-test="day-card"]', ".name.holiday"],
  },
  "a day on a phone with a closed zone": {
    props: { date: "2026-12-01", departmentId: "rest" },
    shown: [
      '[data-test="day-card"] .block[data-faded]',
      '[data-test="day-card"] .block[data-kind="closed"]',
    ],
  },
  "a day on a phone with a zone that follows its department": {
    props: { date: "2026-12-02", departmentId: "rest" },
    shown: ['[data-test="day-card"] .row-name:not(.strong) + .words'],
  },
  "a day on a phone, Spanish": {
    props: { date: "2026-12-01" },
    shown: ['[data-test="day-name"]', '[data-test="week-month"]'],
    spanish: true,
  },
};

describe.each(["light", "dark"] as const)(
  "Opening hours week on a phone accessibility (%s)",
  (theme) => {
    test.each(Object.keys(phoneStates))("%s", async (state) => {
      await page.viewport(390, 800);
      expect(window.innerWidth).toBe(390);
      if (phoneStates[state]!.spanish) setLocale("es");
      try {
        const el = await mountWeek(theme, phoneStates[state]!.props);
        for (const shown of phoneStates[state]!.shown)
          expect(el.shadowRoot!.querySelector(shown), shown).not.toBeNull();
        await expectNoA11yViolations(host);
      } finally {
        setLocale("en");
      }
    });
  },
);
