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

/** A station's month: one row, the Grill, getting the Restaurant's orders. */
function stationMonth(): Partial<OpeningHoursMonthView> {
  const model = monthModel();
  return {
    readOnly: true,
    stationMode: true,
    departments: [{ id: "grill", name: "Grill", zones: [], periods: DEPARTMENTS[0]!.periods }],
    model: {
      ...model,
      days: model.days.map((day) => ({
        ...day,
        departments: [{ departmentId: "grill", ranges: day.departments[0]!.ranges, zones: [] }],
      })),
    },
  };
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

describe.each(["light", "dark"] as const)("Opening hours month accessibility (%s)", (theme) => {
  // axe scores no contrast for a shape with no text; light's track against its date, about 1.4,
  // is the bar dark must match.
  test("draws a bar's empty track apart from its date", async () => {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("opening-hours-month");
    Object.assign(el, { model: monthModel(), departments: DEPARTMENTS });
    host.append(el);
    await el.updateComplete;
    const date = el.shadowRoot!.querySelector<HTMLElement>('[data-date="2026-12-09"] .day')!;
    const track = date.querySelector<HTMLElement>(".track")!;
    expect(
      contrastRatio(
        getComputedStyle(track).backgroundColor,
        getComputedStyle(date).backgroundColor,
      ),
    ).toBeGreaterThanOrEqual(1.4);
  });

  test.each(["en", "es"] as const)("station mode (%s)", async (locale) => {
    setLocale(locale);
    await mountThemed("<div></div>", theme);
    const el = document.createElement("opening-hours-month");
    Object.assign(el, stationMonth());
    host.append(el);
    await el.updateComplete;
    const root = el.shadowRoot!;
    for (const shown of ['[data-test="no-orders"]', "season-chips", ".track", "[data-closed]"])
      expect(root.querySelector(shown), shown).not.toBeNull();
    await expectNoA11yViolations(host);
  });

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
