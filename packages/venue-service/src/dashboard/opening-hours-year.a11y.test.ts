import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { OpeningHoursYear, OpeningHoursYearDay } from "../opening-hours-calendar.js";
import { addDays } from "../hours-rules.js";
import type { OpeningHoursYearView } from "./opening-hours-year.js";
import "./opening-hours-year.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const seasons = [
  { id: "w", name: "Winter", startsOn: "12-01", lastDay: "02-28" },
  { id: "sp", name: "Spring", startsOn: "03-01", lastDay: "05-31" },
  { id: "su", name: "Summer", startsOn: "06-01", lastDay: "08-31" },
  { id: "a", name: "Autumn", startsOn: "09-01", lastDay: "11-30" },
];

function yearModel(overrides: Partial<OpeningHoursYear> = {}): OpeningHoursYear {
  const days: OpeningHoursYearDay[] = [];
  for (let date = "2027-01-01"; date <= "2027-12-31"; date = addDays(date, 1)) {
    const mmdd = date.slice(5);
    const holiday = date === "2027-01-06" || date === "2027-12-08" || date === "2027-12-20";
    const special = date >= "2027-12-13" && date <= "2027-12-24";
    const closed = date === "2027-12-25" || date === "2027-12-26";
    days.push({
      date,
      seasonId:
        mmdd >= "12-01" || mmdd < "03-01"
          ? "w"
          : mmdd < "06-01"
            ? "sp"
            : mmdd < "09-01"
              ? "su"
              : "a",
      specialDay: special ? { id: "xmas", name: "Christmas market" } : null,
      holidays: holiday
        ? [{ id: "e", date, name: "Epiphany", scope: "national", sourceId: "official" }]
        : [],
      tone: holiday ? "public_holiday" : special ? "special_day" : closed ? "closed" : "standard",
      closed,
    });
  }
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 1,
    currentBusinessDay: "2027-03-10",
    pending: null,
    year: 2027,
    timeZone: "Europe/Madrid",
    today: "2027-03-10",
    seasons,
    days,
    publicHolidaysAvailable: true,
    missingHolidays: [],
    holidayCoverage: [
      {
        year: 2027,
        country: "ES",
        provinceCode: "25",
        regionCode: "CT",
        nationalRegional: "complete",
        local: "none_entered",
        dataVersion: "ES-2027.1",
        sourceIds: ["boe"],
      },
    ],
    area: {
      readiness: "ready",
      addressKey: "city",
      options: [{ key: "aran", name: "Aran" }],
      required: true,
      chosen: null,
    },
    ...overrides,
  };
}

const states: Record<string, () => OpeningHoursYear> = {
  "a normal year": () => yearModel(),
  "a year with no list": () =>
    yearModel({
      publicHolidaysAvailable: false,
      days: yearModel().days.map((day) =>
        day.holidays.length ? { ...day, holidays: [], tone: "standard" } : day,
      ),
      holidayCoverage: [{ ...yearModel().holidayCoverage[0]!, nationalRegional: "missing_year" }],
    }),
  "a year with a warning": () =>
    yearModel({
      missingHolidays: [
        { specialDayId: "vs", name: "Viernes Santo", holidayName: "Viernes Santo" },
      ],
    }),
  "a year whose holiday coverage could not be read": () => yearModel({ holidayCoverage: [] }),
};

describe.each(["light", "dark"] as const)("Opening hours year accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("opening-hours-year") as OpeningHoursYearView;
    el.model = states[state]!();
    host.append(el);
    await el.updateComplete;
    if (state === "a year whose holiday coverage could not be read")
      expect(el.shadowRoot!.querySelector('[data-test="coverage"]')).not.toBeNull();
    for (const mark of ["public_holiday", "special_day"])
      if (state !== "a year with no list" || mark !== "public_holiday")
        expect(el.shadowRoot!.querySelector(`td[data-tone="${mark}"]`)).not.toBeNull();
    expect(el.shadowRoot!.querySelector("td[data-closed]")).not.toBeNull();
    if (state !== "a year with no list")
      expect(el.shadowRoot!.querySelector("td.mark-holiday.mark-special")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
