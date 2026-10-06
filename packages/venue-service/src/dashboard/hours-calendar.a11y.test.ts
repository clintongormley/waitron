import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import {
  CALENDAR_COLOURS,
  type CalendarDay,
  type HoursModel,
  type LocalDate,
  type SpecialDate,
} from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import { HoursApi } from "./hours-client.js";
import type { HoursCalendar } from "./hours-calendar.js";
import "./hours-calendar.js";

afterEach(async () => {
  cleanup();
  setLocale("en");
  await page.viewport(1280, 800);
});

/** One special date in each palette colour, 12 to 17 October, and a whole-venue closure on the 19th. */
const SPECIALS: SpecialDate[] = [
  ...CALENDAR_COLOURS.map((colour, index) => ({
    id: colour,
    date: addDays("2026-10-12", index),
    name: `${colour} day`,
    colour,
    closeWholeVenue: false,
  })),
  { id: "shut", date: "2026-10-19", name: "Staff day off", colour: "red", closeWholeVenue: true },
];

function rangeModel(from: LocalDate, to: LocalDate): HoursModel {
  const days: CalendarDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const specialDate = SPECIALS.find((special) => special.date === date) ?? null;
    days.push({
      date,
      specialDate,
      holidays:
        date === "2026-10-22"
          ? [{ id: "h", date, name: "Invented feast", scope: "local", sourceId: "test" }]
          : [],
      tone:
        specialDate?.closeWholeVenue || date === "2026-10-26"
          ? "closed"
          : (specialDate?.colour ?? "standard"),
    });
  }
  return {
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    civilDate: "2026-10-07",
    clockReadable: true,
    subjects: [
      { kind: "department", id: "restaurant", name: "Restaurant", active: true, isDefault: true },
      { kind: "station", id: "kitchen", name: "Kitchen", active: true, isDefault: true },
      { kind: "station", id: "bar", name: "Bar", active: true, isDefault: false },
    ],
    week: [
      {
        subject: { kind: "station", id: "bar" },
        days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          cell: {
            mode: "periods",
            periods: [{ id: `b${weekday}`, opensAt: "17:00", closesAt: "23:00" }],
          },
        })),
      },
    ],
    days,
    specialDates: SPECIALS,
    holidayCoverage: [],
    holidaySources: [],
    specialCells: SPECIALS.map((special) => ({
      specialDateId: special.id,
      cells: [
        {
          subject: { kind: "department", id: "restaurant" },
          cell: { mode: "closed", periods: [] },
        },
      ],
    })),
  };
}

/** 21 October gets three holidays, two sharing a name, sourced and covered as a whole year. */
function withHolidays(model: HoursModel): void {
  const on = (date: LocalDate) => model.days.find((day) => day.date === date);
  on("2026-10-21")?.holidays.push(
    { id: "n", date: "2026-10-21", name: "Fiesta común", scope: "national", sourceId: "boe" },
    { id: "r", date: "2026-10-21", name: "Día de la región", scope: "regional", sourceId: "boe" },
    { id: "l", date: "2026-10-21", name: "Día de la región", scope: "local", sourceId: "owner:g" },
  );
  on("2026-10-12")?.holidays.push({
    id: "p",
    date: "2026-10-12",
    name: "Fiesta Nacional de España",
    scope: "national",
    sourceId: "boe",
  });
  model.holidaySources = [
    {
      id: "boe",
      kind: "official",
      title: "BOE-A-2025-21667",
      url: "https://www.boe.es/buscar/doc.php?id=BOE-A-2025-21667",
      sha256: "abc",
    },
    { id: "owner:g", kind: "owner", title: "Sevilla", url: null, sha256: null },
  ];
  model.holidayCoverage = [
    {
      year: 2026,
      country: "ES",
      provinceCode: "41",
      regionCode: "01",
      nationalRegional: "area_required",
      local: "owner_entered",
      dataVersion: "ES-2026.1",
      sourceIds: ["boe"],
    },
  ];
}

async function mount(
  theme: "light" | "dark",
  options: { readOnly?: boolean; failRead?: boolean; holidays?: boolean } = {},
): Promise<HoursCalendar> {
  await mountThemed("<div></div>", theme);
  const request = async (path: string) => {
    if (options.failRead) throw { code: "connection.failed" };
    const query = new URL(path, location.origin).searchParams;
    const model = rangeModel(query.get("from")!, query.get("to")!);
    if (options.holidays) withHolidays(model);
    return model;
  };
  const el = document.createElement("hours-calendar");
  el.api = new HoursApi(request as unknown as DashboardRequest);
  el.readOnly = options.readOnly ?? false;
  el.today = "2026-10-07";
  host.append(el);
  await settle(el);
  return el;
}

async function settle(el: HoursCalendar) {
  for (let turn = 0; turn < 3; turn++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function open(el: HoursCalendar, date: LocalDate) {
  const button = el.shadowRoot!.querySelector<HTMLButtonElement>(`td[data-date="${date}"] button`);
  expect(button, date).not.toBeNull();
  button!.click();
  await settle(el);
}

const states: Record<string, (theme: "light" | "dark") => Promise<HoursCalendar>> = {
  "the month, every palette colour, Closed dates, a holiday and today, nothing chosen": (theme) =>
    mount(theme),
  "a special date's panel with an inherited value": async (theme) => {
    const el = await mount(theme);
    await open(el, "2026-10-12");
    return el;
  },
  "an ordinary date's panel with a holiday, offering to make it special": async (theme) => {
    const el = await mount(theme);
    await open(el, "2026-10-22");
    return el;
  },
  "a whole-venue closure's panel, read-only": async (theme) => {
    const el = await mount(theme, { readOnly: true });
    await open(el, "2026-10-19");
    return el;
  },
  "a failed read": (theme) => mount(theme, { failRead: true }),
  "a holiday with several labels, sources and coverage open": async (theme) => {
    const el = await mount(theme, { holidays: true });
    await open(el, "2026-10-21");
    return el;
  },
  "a special date on a holiday, open": async (theme) => {
    const el = await mount(theme, { holidays: true });
    await open(el, "2026-10-12");
    return el;
  },
  "a phone's width with a holiday open": async (theme) => {
    await page.viewport(390, 800);
    const el = await mount(theme, { holidays: true });
    expect(window.innerWidth).toBe(390);
    await open(el, "2026-10-21");
    return el;
  },
  "a phone's width with a date open": async (theme) => {
    await page.viewport(390, 800);
    const el = await mount(theme);
    await open(el, "2026-10-13");
    return el;
  },
};

describe.each(["light", "dark"] as const)("Hours calendar accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    setLocale("en");
    await states[state]!(theme);
    await expectNoA11yViolations(host);
  });
});
