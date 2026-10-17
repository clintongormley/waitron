import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { html } from "lit";
import { userEvent } from "vitest/browser";
import {
  registerCatalogue,
  setLocale,
  type DashboardCalendarView,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { applyTokens, NavigationGuard } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursYear } from "../opening-hours-calendar.js";
import { addDays } from "../hours-rules.js";
import { frame } from "../testing/season-painter-fixture.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import { emptyPageAtTop, resizeViewport } from "../testing/window-settled.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { StationShow } from "./station-show.js";
import { weekDates } from "./week-rows.js";
import "./opening-hours-screen.js";

type Screen = HTMLElementTagNameMap["dashboard-opening-hours-screen"];

function model(): OpeningHoursModel {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 7,
    currentBusinessDay: "2026-12-02",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [],
    seasons: [
      { id: "autumn", name: "Autumn", startsOn: "09-01", colour: "orange" },
      { id: "winter", name: "Winter", startsOn: "12-01", colour: "blue" },
    ],
    currentSeasonId: "winter",
    departments: DEPARTMENTS,
  };
}

function yearRead(year: number): OpeningHoursYear {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 7,
    currentBusinessDay: "2026-12-02",
    pending: null,
    year,
    timeZone: "Europe/Madrid",
    today: "2026-12-02",
    seasons: [],
    days: [],
    publicHolidaysAvailable: true,
    missingHolidays: [],
    holidayCoverage: [],
    area: {
      addressKey: "fixture-address",
      readiness: "ready",
      options: [],
      required: false,
      chosen: null,
    },
  };
}

const hosts: HTMLElement[] = [];
const originalUrl = location.href;
beforeEach(async () => {
  await resizeViewport(1280, 800);
  expect(window.innerWidth).toBe(1280);
  setLocale("en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-02T12:00:00Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await emptyPageAtTop(() => {
    for (const host of hosts.splice(0)) host.remove();
  });
  history.replaceState(null, "", originalUrl);
});

const STATIONS = [
  { id: "s2", name: "Default", active: true, isDefault: true, displayOrder: 0 },
  { id: "s1", name: "Grill", active: true, isDefault: false, displayOrder: 1 },
];
/** The Grill's days from `from` to `to`: the Restaurant sends it lunch, the Bar all day. The
 *  default station is always open. */
function stationTimes(stationId: string, from: string, to: string) {
  if (stationId === "s2") return { always: "default", days: [] };
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1))
    days.push({
      date,
      departments: [
        {
          departmentId: "rest",
          ranges: [{ periodId: "lunch", startsAt: "13:00", endsAt: "15:30" }],
        },
        {
          departmentId: "bar",
          ranges: [{ periodId: "allday", startsAt: "10:00", endsAt: "02:00" }],
        },
      ],
    });
  return { always: null, days };
}
interface Answers {
  stations?: typeof STATIONS;
  /** Thrown by the station list read, or by every station-times read. */
  stationsFail?: unknown;
  /** The station list never answers. */
  holdStations?: boolean;
  timesFail?: unknown;
  /** Stations whose times reads never answer. */
  holdTimes?: readonly string[];
  /** Month reads that never answer. */
  holdMonths?: readonly string[];
  /** Station-times reads answer December's dates, whatever they asked for. */
  timesAsDecember?: boolean;
  readOnly?: boolean;
}
const REFUSED = { code: "authorization.not_permitted", status: 403 };

/** Every month read is answered with the fixture's December, which holds 30 November to
 *  3 January, so it serves each week these tests draw; with `hold`, the opening-hours read never
 *  answers. The station list holds the Grill and the default station. */
async function mount(
  address: string,
  calendar?: Screen["calendar"],
  hold = false,
  answers: Answers = {},
) {
  history.replaceState(null, "", address);
  const months: string[] = [];
  const paths: string[] = [];
  const request = (async (path: string) => {
    paths.push(path);
    if (path === "/management-api/stations") {
      if (answers.stationsFail) throw answers.stationsFail;
      if (answers.holdStations) return new Promise(() => {});
      return answers.stations ?? STATIONS;
    }
    const times = /\/stations\/([^/]+)\/service-times\?from=([\d-]+)&to=([\d-]+)$/.exec(path);
    if (times) {
      if (answers.timesFail) throw answers.timesFail;
      if (answers.holdTimes?.includes(times[1]!)) return new Promise(() => {});
      return answers.timesAsDecember
        ? stationTimes(times[1]!, "2026-11-30", "2027-01-03")
        : stationTimes(times[1]!, times[2]!, times[3]!);
    }
    const month = /\/opening-hours\/month\?month=([\d-]+)$/.exec(path);
    if (month) {
      months.push(month[1]!);
      if (answers.holdMonths?.includes(month[1]!)) return new Promise(() => {});
      return monthModel({ month: month[1]! });
    }
    const year = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
    if (year) return yearRead(Number(year[1]));
    if (hold) return new Promise(() => {});
    return model();
  }) as DashboardRequest;
  const el = document.createElement("dashboard-opening-hours-screen") as Screen;
  el.api = new OpeningHoursApi(request);
  el.readOnly = answers.readOnly ?? false;
  if (calendar) el.calendar = { ...calendar, ctx: { request } };
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  if (hold) await expect.poll(() => el.shadowRoot?.querySelector("h1")).not.toBeNull();
  else await expect.poll(() => week(el)?.model).toBeDefined();
  await el.updateComplete;
  return { el, months, paths };
}
const week = (el: Screen) => el.shadowRoot!.querySelector("opening-hours-week");
const painter = (el: Screen) => el.shadowRoot!.querySelector("season-painter");
function pushedPaths() {
  const pushed = vi.spyOn(history, "pushState");
  return () => pushed.mock.calls.map((call) => new URL(String(call[2]), location.href).pathname);
}
const dayBox = (el: Screen) => el.shadowRoot!.querySelector("calendar-day-box");
const boxOpen = (el: Screen) =>
  dayBox(el)?.shadowRoot?.querySelector("[popover]")?.matches(":popover-open") ?? false;
const boxButtons = (el: Screen) =>
  [...(dayBox(el)?.querySelectorAll<HTMLElement>("wt-button") ?? [])].map((button) =>
    (button.textContent ?? "").trim(),
  );
const monthLink = (el: Screen, month: string) =>
  week(el)!.shadowRoot!.querySelector<HTMLElement>(
    `[data-test=week-month][data-month="${month}"]`,
  )!;
const yearLink = (el: Screen, year: number) =>
  week(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-test=week-year][data-year="${year}"]`)!;
const dayName = (el: Screen, date: string) =>
  week(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-test=day-name][data-date="${date}"]`)!;
const monthView = (el: Screen) => el.shadowRoot!.querySelector("opening-hours-month");
const yearView = (el: Screen) => el.shadowRoot!.querySelector("opening-hours-year");
const dayNames = (el: Screen) =>
  [...week(el)!.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=day-name]")].map(
    (name) => name.dataset["date"],
  );
/** Narrows the window to a phone's and waits for the Week to draw one day. */
async function toPhone(el?: Screen) {
  await resizeViewport(390, 800);
  expect(window.innerWidth).toBe(390);
  if (el) await expect.poll(() => week(el)?.narrow).toBe(true);
}
/** The element holding focus, through every shadow root. */
function focused() {
  let at = document.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  return at;
}
function closed(target: EventTarget, name: string) {
  return new Promise<void>((resolve) =>
    target.addEventListener(name, () => resolve(), { once: true }),
  );
}
function chooseShown(el: Screen, value: string) {
  const show = week(el)!.shadowRoot!.querySelector("wt-combobox")!;
  show.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

describe("the Week at its address", () => {
  it("/view/week/week/2026-12-09 draws that week from December's read", async () => {
    const { el, months } = await mount("/manage/opening-hours/view/week/week/2026-12-09");
    expect(months).toEqual(["2026-12"]);
    expect(week(el)!.date).toBe("2026-12-09");
    expect(painter(el)).toBeNull();
  });

  it("says when the week's month cannot be read", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/week/week/2026-12-09");
    const request = (async (path: string) => {
      if (path === "/management-api/stations") return [];
      if (/\/opening-hours\/month\?/.test(path)) throw { code: "connection.failed" };
      return model();
    }) as DashboardRequest;
    const el = document.createElement("dashboard-opening-hours-screen") as Screen;
    el.api = new OpeningHoursApi(request);
    applyTokens(el);
    hosts.push(el);
    document.body.append(el);
    const alert = () => el.shadowRoot!.querySelector("[data-test=month-read-error]")?.textContent;
    await expect.poll(alert).toBe("Opening hours could not be loaded. It will be tried again.");
    expect(week(el)!.date).toBe("2026-12-09");
    expect(week(el)!.model).toBeUndefined();
  });

  it("/view/week alone draws the week holding the venue's today", async () => {
    const { el, months } = await mount("/manage/opening-hours/view/week");
    expect(week(el)!.date).toBe("2026-12-02");
    expect(months).toEqual(["2026-11"]);
    expect(location.pathname).toBe("/manage/opening-hours/view/week");
  });

  it.each(["2026-13-40", "abc", "0099-12-28", "0100-01-15", "9999-01-15"])(
    "/view/week/week/%s draws the week holding the venue's today and leaves the address as written",
    async (value) => {
      const address = `/manage/opening-hours/view/week/week/${value}`;
      const pushed = pushedPaths();
      const replaced = vi.spyOn(history, "replaceState");
      const { el } = await mount(address);
      expect(week(el)!.date).toBe("2026-12-02");
      await el.updateComplete;
      expect(location.pathname).toBe(address);
      expect(pushed()).toEqual([]);
      expect(
        replaced.mock.calls.map((call) => new URL(String(call[2]), location.href).pathname),
      ).toEqual([address]);
      expect(painter(el)).toBeNull();
    },
  );

  it("a week across two years reads the month of its Monday", async () => {
    const { el, months } = await mount("/manage/opening-hours/view/week/week/2027-01-02");
    expect(week(el)!.date).toBe("2027-01-02");
    await el.updateComplete;
    expect(months).toEqual(["2026-12"]);
  });

  it("› pushes the next week", async () => {
    const { el } = await mount("/manage/opening-hours/view/week/week/2026-12-09");
    const pushed = pushedPaths();
    week(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!.click();
    await expect.poll(() => week(el)!.date).toBe("2026-12-16");
    expect(pushed()).toEqual(["/manage/opening-hours/view/week/week/2026-12-16"]);
    history.back();
    await expect.poll(() => week(el)?.date).toBe("2026-12-09");
    expect(location.pathname).toBe("/manage/opening-hours/view/week/week/2026-12-09");
  });

  it("Show writes the department and keeps the week", async () => {
    const { el } = await mount("/manage/opening-hours/view/week/week/2026-12-09");
    chooseShown(el, "bar");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/week/department/bar/week/2026-12-09");
    await expect.poll(() => week(el)!.departmentId).toBe("bar");
    chooseShown(el, "all");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/week/week/2026-12-09");
    await expect.poll(() => week(el)!.departmentId).toBe("");
  });

  it("a department the read does not carry draws All departments", async () => {
    const { el } = await mount("/manage/opening-hours/view/week/department/gone/week/2026-12-09");
    await week(el)!.updateComplete;
    expect(week(el)!.shadowRoot!.querySelector("wt-combobox")!.value).toBe("all");
    expect(painter(el)).toBeNull();
  });

  it.each([
    "/manage/opening-hours/view/week/department/d3",
    "/manage/opening-hours/view/week/department/d1/zone/z1/season/spring",
    "/manage/opening-hours/view/week/department/all",
  ])("an old Week address %s opens the Week", async (address) => {
    const pushed = pushedPaths();
    const { el } = await mount(address);
    expect(week(el)!.date).toBe("2026-12-02");
    expect(painter(el)).toBeNull();
    expect(pushed()).toEqual([]);
  });

  it("/view/week?station=s1 drops the query and draws the Week", async () => {
    const pushed = pushedPaths();
    const replaced = vi.spyOn(history, "replaceState");
    const { el } = await mount("/manage/opening-hours/view/week?station=s1");
    expect(location.search).toBe("");
    expect(
      replaced.mock.calls.some((call) =>
        String(call[2]).endsWith("/manage/opening-hours/view/week"),
      ),
    ).toBe(true);
    expect(location.pathname).toBe("/manage/opening-hours/view/week");
    expect(pushed()).toEqual([]);
    expect(week(el)).not.toBeNull();
  });
});

describe("at a phone's width", () => {
  it("› pushes the next day", async () => {
    await toPhone();
    const { el } = await mount("/manage/opening-hours/view/week/week/2026-12-09");
    await toPhone(el);
    await week(el)!.updateComplete;
    expect(dayNames(el)).toEqual(["2026-12-09"]);
    const pushed = pushedPaths();
    week(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=next-day]")!.click();
    await expect.poll(() => week(el)!.date).toBe("2026-12-10");
    expect(pushed()).toEqual(["/manage/opening-hours/view/week/week/2026-12-10"]);
  });

  it("a day crossing into the next month's read reads it", async () => {
    await toPhone();
    const { el, months } = await mount("/manage/opening-hours/view/week/week/2027-01-03");
    await toPhone(el);
    const pushed = pushedPaths();
    week(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=next-day]")!.click();
    await expect.poll(() => week(el)!.date).toBe("2027-01-04");
    expect(pushed()).toEqual(["/manage/opening-hours/view/week/week/2027-01-04"]);
    await expect.poll(() => months.filter((month) => month === "2027-01")).toEqual(["2027-01"]);
    await week(el)!.updateComplete;
    expect(months.filter((month) => month === "2027-01")).toEqual(["2027-01"]);
    expect(dayNames(el)).toEqual(["2027-01-04"]);
  });
});

describe("the Calendar switch from the Week", () => {
  registerCatalogue({
    en: { "test.view.staffing": "Staffing" },
    es: { "test.view.staffing": "Personal" },
  });
  const staffing: DashboardCalendarView = {
    id: "staffing",
    labelKey: "test.view.staffing",
    order: 10,
    requiresPermission: "staffing.write",
    create: (_ctx, host) => ({
      render: () => html`<p data-test="stub-staffing">${host.month}</p>`,
    }),
  };

  it("a module view's switch from the Week carries the week's month", async () => {
    const { el } = await mount("/manage/opening-hours/view/week/week/2027-01-02", {
      ctx: { request: (async () => undefined) as DashboardRequest },
      views: [{ view: staffing, canWrite: true }],
    });
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLInputElement>(
        "[data-test=calendar-switch] input[value=staffing]",
      )!,
    );
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/staffing/month/2026-12");
  });

  it("a module view's switch from a phone's day carries that day's month", async () => {
    await toPhone();
    const { el } = await mount("/manage/opening-hours/view/week/week/2026-12-01", {
      ctx: { request: (async () => undefined) as DashboardRequest },
      views: [{ view: staffing, canWrite: true }],
    });
    await toPhone(el);
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLInputElement>(
        "[data-test=calendar-switch] input[value=staffing]",
      )!,
    );
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/staffing/month/2026-12");
  });

  it("a module view chosen on the Week before the opening-hours read answers carries no month", async () => {
    const errors: unknown[] = [];
    const caught = (event: ErrorEvent) => errors.push(event.error);
    addEventListener("error", caught);
    onTestFinished(() => removeEventListener("error", caught));
    const { el } = await mount(
      "/manage/opening-hours/view/week/week/2027-01-02",
      {
        ctx: { request: (async () => undefined) as DashboardRequest },
        views: [{ view: staffing, canWrite: true }],
      },
      true,
    );
    await userEvent.click(
      el.shadowRoot!.querySelector<HTMLInputElement>(
        "[data-test=calendar-switch] input[value=staffing]",
      )!,
    );
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/staffing");
    expect(errors).toEqual([]);
  });
});

describe("from the Week to the Month, the Year and the day box", () => {
  const twoYears = "/manage/opening-hours/view/week/department/rest/week/2027-01-02";

  it("a month link opens that Month, keeping the department", async () => {
    const { el } = await mount(twoYears);
    const pushed = pushedPaths();
    monthLink(el, "2027-01").click();
    await expect.poll(() => monthView(el)?.model?.month).toBe("2027-01");
    expect(pushed()).toEqual(["/manage/opening-hours/view/month/department/rest/month/2027-01"]);
    expect(week(el)).toBeNull();
  });

  it("a year link opens that Year", async () => {
    const { el } = await mount(twoYears);
    const pushed = pushedPaths();
    yearLink(el, 2026).click();
    await expect.poll(() => yearView(el)?.model?.year).toBe(2026);
    expect(pushed()).toEqual(["/manage/opening-hours/view/year/department/rest/year/2026"]);
    expect(week(el)).toBeNull();
  });

  it.each([
    [2026, "2026-12"],
    [2027, "2027-01"],
  ])(
    "the year link %s pressed with the keyboard leaves focus on the week's month name %s once the Year has drawn it",
    async (year, month) => {
      const { el } = await mount(twoYears);
      yearLink(el, year).focus();
      expect(focused()).toBe(yearLink(el, year));
      await userEvent.keyboard("{Enter}");
      await expect
        .poll(() => location.pathname)
        .toBe(`/manage/opening-hours/view/year/department/rest/year/${year}`);
      const name = () =>
        yearView(el)?.shadowRoot?.querySelector<HTMLElement>(
          `[data-month="${month}"] [data-test=month-name]`,
        );
      await expect.poll(name).toBeTruthy();
      await expect.poll(focused).toBe(name());
    },
  );

  it("a month link pressed with the keyboard leaves focus on the Month's year link", async () => {
    const { el } = await mount(twoYears);
    monthLink(el, "2026-12").focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => monthView(el)?.model?.month).toBe("2026-12");
    await monthView(el)!.updateComplete;
    await expect
      .poll(focused)
      .toBe(monthView(el)!.shadowRoot!.querySelector("[data-test=month-year]"));
  });

  // A pointer press light-dismisses the box before the click lands; Enter does not.
  it.each([
    ["the Jan link onto the Month", "pointer", (el: Screen) => monthLink(el, "2027-01"), "month"],
    ["the 2026 link onto the Year", "pointer", (el: Screen) => yearLink(el, 2026), "year"],
    ["the Jan link onto the Month", "keyboard", (el: Screen) => monthLink(el, "2027-01"), "month"],
    ["the 2026 link onto the Year", "keyboard", (el: Screen) => yearLink(el, 2026), "year"],
  ] as const)(
    "a title link pressed with the day box open closes it for good: %s, by %s",
    async (_name, press, link, view) => {
      const { el } = await mount(twoYears);
      await week(el)!.updateComplete;
      await userEvent.click(dayName(el, "2026-12-30"));
      await expect.poll(() => boxOpen(el)).toBe(true);
      const close = closed(dayBox(el)!, "calendar-day-box-close");
      if (press === "pointer") await userEvent.click(link(el));
      else {
        link(el).focus();
        expect(boxOpen(el)).toBe(true);
        await userEvent.keyboard("{Enter}");
      }
      await close;
      if (view === "month") {
        await expect.poll(() => monthView(el)?.model?.month).toBe("2027-01");
        await monthView(el)!.updateComplete;
      } else {
        await expect.poll(() => yearView(el)?.model?.year).toBe(2026);
        await yearView(el)!.updateComplete;
      }
      await el.updateComplete;
      expect(dayBox(el)).toBeNull();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await el.updateComplete;
      expect(dayBox(el)).toBeNull();
      if (press === "keyboard") {
        const expected = () =>
          view === "month"
            ? monthView(el)!.shadowRoot!.querySelector("[data-test=month-year]")
            : yearView(el)!.shadowRoot!.querySelector(
                '[data-month="2026-12"] [data-test=month-name]',
              );
        await expect.poll(expected).toBeTruthy();
        await expect.poll(focused).toBe(expected());
      }
    },
  );

  it("a day's name opens the day box over the Week, with the Week's department", async () => {
    const { el } = await mount("/manage/opening-hours/view/week/department/rest/week/2026-12-09");
    await week(el)!.updateComplete;
    const button = dayName(el, "2026-12-09");
    await userEvent.click(button);
    await expect.poll(() => boxOpen(el)).toBe(true);
    const box = dayBox(el)!;
    await expect.poll(() => box.rows.map((row) => row.name)).toEqual(["Restaurant", "Terrace"]);
    await box.updateComplete;
    const popup = () => box.shadowRoot!.querySelector("[popover]")!.getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    expect(
      Math.abs(popup().top - anchor.bottom) <= 1 || Math.abs(popup().bottom - anchor.top) <= 1,
    ).toBe(true);
    expect(boxButtons(el)).toEqual(["Make a special day", "Edit Winter's standard week"]);
  });

  it("a painter opened from the Week's box closes back onto the Week", async () => {
    const { el } = await mount("/manage/opening-hours/view/week/department/rest/week/2026-12-09");
    await week(el)!.updateComplete;
    await userEvent.click(dayName(el, "2026-12-09"));
    await expect.poll(() => boxOpen(el)).toBe(true);
    await userEvent.click(dayBox(el)!.querySelector<HTMLElement>("[data-test=edit-week]")!);
    await expect.poll(() => painter(el)).not.toBeNull();
    const shown = painter(el)!;
    await shown.updateComplete;
    await expect
      .poll(() => frame(shown).shadowRoot?.querySelector("[data-test=cancel]"))
      .toBeTruthy();
    const close = closed(shown, "painter-close");
    frame(shown).shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    await close;
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/week/department/rest/week/2026-12-09");
    await expect.poll(() => painter(el)).toBeNull();
    expect(week(el)!.date).toBe("2026-12-09");
  });
});

describe("Open this week from the day box", () => {
  /** Mounts the Month or the Year; with `holdMonths`, no month read ever answers, and with
   *  `monthGate`, a month read answers once the gate settles. */
  async function mountView(
    address: string,
    {
      readOnly = false,
      holdMonths = false,
      monthGate,
    }: { readOnly?: boolean; holdMonths?: boolean; monthGate?: Promise<void> } = {},
  ) {
    history.replaceState(null, "", address);
    const request = (async (path: string) => {
      if (path === "/management-api/stations") return [];
      const month = /\/opening-hours\/month\?month=([\d-]+)$/.exec(path);
      if (month && monthGate) await monthGate;
      if (month) return holdMonths ? new Promise(() => {}) : monthModel({ month: month[1]! });
      const year = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
      if (year) return yearRead(Number(year[1]));
      return model();
    }) as DashboardRequest;
    const el = document.createElement("dashboard-opening-hours-screen") as Screen;
    el.api = new OpeningHoursApi(request);
    el.readOnly = readOnly;
    applyTokens(el);
    hosts.push(el);
    document.body.append(el);
    await expect.poll(() => (monthView(el) ?? yearView(el))?.model).toBeDefined();
    await el.updateComplete;
    await (monthView(el) ?? yearView(el))!.updateComplete;
    return el;
  }
  const dateIn = (view: HTMLElement, date: string) =>
    view.shadowRoot!.querySelector<HTMLElement>(`td[data-date="${date}"] button`)!;
  const openWeek = (el: Screen) => dayBox(el)!.querySelector<HTMLElement>("[data-test=open-week]");

  it("Open this week from the Month opens that date's week, keeping the department", async () => {
    const el = await mountView("/manage/opening-hours/view/month/department/rest/month/2026-12");
    await userEvent.click(dateIn(monthView(el)!, "2026-12-10"));
    await expect.poll(() => boxOpen(el)).toBe(true);
    const pushed = pushedPaths();
    const close = closed(dayBox(el)!, "calendar-day-box-close");
    await userEvent.click(openWeek(el)!);
    await close;
    await expect
      .poll(() => pushed().at(-1))
      .toBe("/manage/opening-hours/view/week/department/rest/week/2026-12-10");
    await expect.poll(() => week(el)?.model).toBeDefined();
    await week(el)!.updateComplete;
    expect(
      [...week(el)!.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=day-name]")].map(
        (name) => name.dataset["date"],
      ),
    ).toEqual([
      "2026-12-07",
      "2026-12-08",
      "2026-12-09",
      "2026-12-10",
      "2026-12-11",
      "2026-12-12",
      "2026-12-13",
    ]);
    await expect.poll(focused).toBe(dayName(el, "2026-12-10"));
  });

  it("Open this week from the Year, while the box's month still loads", async () => {
    const el = await mountView("/manage/opening-hours/view/year/year/2026", { holdMonths: true });
    await userEvent.click(dateIn(yearView(el)!, "2026-12-10"));
    await expect.poll(() => boxOpen(el)).toBe(true);
    expect(dayBox(el)!.message).toBe("Loading…");
    expect(boxButtons(el)).toEqual(["Make a special day", "Open this week"]);
    const pushed = pushedPaths();
    const close = closed(dayBox(el)!, "calendar-day-box-close");
    await userEvent.click(openWeek(el)!);
    await close;
    await expect
      .poll(() => pushed().at(-1))
      .toBe("/manage/opening-hours/view/week/week/2026-12-10");
    await expect.poll(() => week(el)?.date).toBe("2026-12-10");
  });

  /** Lets every update and animation frame the hand-off could wait on run. */
  async function settled(el: Screen) {
    for (let i = 0; i < 3; i++) {
      await el.updateComplete;
      await week(el)?.updateComplete;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  it("focus the user moves while the Week's month loads stays where they put it", async () => {
    let release!: () => void;
    const monthGate = new Promise<void>((resolve) => (release = resolve));
    const el = await mountView("/manage/opening-hours/view/year/year/2026", { monthGate });
    await userEvent.click(dateIn(yearView(el)!, "2026-12-10"));
    await expect.poll(() => boxOpen(el)).toBe(true);
    const close = closed(dayBox(el)!, "calendar-day-box-close");
    await userEvent.click(openWeek(el)!);
    await close;
    await expect.poll(() => week(el)?.date).toBe("2026-12-10");
    await week(el)!.updateComplete;
    expect(week(el)!.model).toBeUndefined();
    const link = monthLink(el, "2026-12");
    link.focus();
    expect(focused()).toBe(link);
    release();
    await expect.poll(() => week(el)?.model).toBeDefined();
    await settled(el);
    expect(dayName(el, "2026-12-10")).not.toBeNull();
    expect(focused()).toBe(link);
  });

  it("Back while the Week's month loads drops the focus hand-off", async () => {
    let release!: () => void;
    const monthGate = new Promise<void>((resolve) => (release = resolve));
    const el = await mountView("/manage/opening-hours/view/year/year/2026", { monthGate });
    await userEvent.click(dateIn(yearView(el)!, "2026-12-10"));
    await expect.poll(() => boxOpen(el)).toBe(true);
    const close = closed(dayBox(el)!, "calendar-day-box-close");
    await userEvent.click(openWeek(el)!);
    await close;
    await expect.poll(() => week(el)?.date).toBe("2026-12-10");
    history.back();
    await expect.poll(() => yearView(el)).not.toBeNull();
    await settled(el);
    history.forward();
    await expect.poll(() => week(el)?.date).toBe("2026-12-10");
    release();
    await expect.poll(() => week(el)?.model).toBeDefined();
    await settled(el);
    expect(dayName(el, "2026-12-10")).not.toBeNull();
    expect(focused()).not.toBe(dayName(el, "2026-12-10"));
  });

  it("Open this week refused by unsaved changes drops its focus hand-off", async () => {
    const el = await mountView("/manage/opening-hours/view/month/month/2026-12");
    await userEvent.click(dateIn(monthView(el)!, "2026-12-10"));
    await expect.poll(() => boxOpen(el)).toBe(true);
    let asked = 0;
    const guard = new NavigationGuard(window, {
      isDirty: () => true,
      request: async () => {
        asked++;
        return "kept";
      },
    });
    onTestFinished(() => guard.dispose());
    const close = closed(dayBox(el)!, "calendar-day-box-close");
    await userEvent.click(openWeek(el)!);
    await close;
    await expect.poll(() => asked).toBe(1);
    await settled(el);
    expect(location.pathname).toBe("/manage/opening-hours/view/month/month/2026-12");
    guard.dispose();
    // A later arrival at that week by another way must not take the refused hand-off's focus.
    history.pushState(null, "", "/manage/opening-hours/view/week/week/2026-12-10");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => week(el)?.model).toBeDefined();
    await settled(el);
    expect(dayName(el, "2026-12-10")).not.toBeNull();
    expect(focused()).not.toBe(dayName(el, "2026-12-10"));
  });

  it("a viewer's box offers Open this week too", async () => {
    const el = await mountView("/manage/opening-hours/view/month/month/2026-12", {
      readOnly: true,
    });
    await userEvent.click(dateIn(monthView(el)!, "2026-12-10"));
    await expect.poll(() => boxOpen(el)).toBe(true);
    await expect
      .poll(() => boxButtons(el))
      .toEqual(["Show Winter's standard week", "Open this week"]);
  });

  it("Open this week from a Month box at a phone's width shows that day", async () => {
    await toPhone();
    const el = await mountView("/manage/opening-hours/view/month/month/2026-12");
    await userEvent.click(dateIn(monthView(el)!, "2026-12-10"));
    await expect.poll(() => boxOpen(el)).toBe(true);
    const pushed = pushedPaths();
    const close = closed(dayBox(el)!, "calendar-day-box-close");
    await userEvent.click(openWeek(el)!);
    await close;
    await expect
      .poll(() => pushed().at(-1))
      .toBe("/manage/opening-hours/view/week/week/2026-12-10");
    await expect.poll(() => week(el)?.model).toBeDefined();
    await toPhone(el);
    await week(el)!.updateComplete;
    expect(week(el)!.date).toBe("2026-12-10");
    expect(dayNames(el)).toEqual(["2026-12-10"]);
  });
});

describe("a prep station in the Calendar", () => {
  const grillWeek = "/manage/opening-hours/view/week/station/s1/week/2026-12-09";
  const showValues = (el: Screen) =>
    week(el)!
      .shadowRoot!.querySelector("wt-combobox")!
      .options.map(({ value }) => value);
  const rowKeys = (el: Screen, date: string) =>
    [
      ...week(el)!.shadowRoot!.querySelectorAll<HTMLElement>(`section[data-date="${date}"] .row`),
    ].map((row) => row.dataset["row"]);
  const timesReads = (paths: readonly string[]) =>
    paths.filter((path) => path.includes("/service-times"));
  const STATION_LOAD_ERROR = "This station's times could not be loaded. It will be tried again.";

  it("A725 offers stations by name in Calendar Week and Month with Default in place", async () => {
    const { el } = await mount(grillWeek, undefined, false, {
      stations: [
        { ...STATIONS[0]!, name: "Zulu", displayOrder: 0 },
        { ...STATIONS[1]!, id: "alpha", name: "Alpha", displayOrder: 2 },
        { ...STATIONS[1]!, name: "Bar", displayOrder: 1 },
        { ...STATIONS[1]!, id: "gone", name: "A deleted", active: false },
      ],
    });
    await expect.poll(() => week(el)!.station?.state).toBe("ready");
    const expected = [
      { value: "station:alpha", label: "Alpha", group: "Prep stations" },
      { value: "station:s1", label: "Bar", group: "Prep stations" },
      { value: "station:s2", label: "Zulu", group: "Prep stations" },
    ];
    expect(
      week(el)!
        .shadowRoot!.querySelector("wt-combobox")!
        .options.filter(({ value }) => value.startsWith("station:")),
    ).toEqual(expected);
    monthLink(el, "2026-12").click();
    await expect.poll(() => monthView(el)?.station?.state).toBe("ready");
    await monthView(el)!.updateComplete;
    expect(
      monthView(el)!
        .shadowRoot!.querySelector("wt-combobox")!
        .options.filter(({ value }) => value.startsWith("station:")),
    ).toEqual(expected);
    expect(monthView(el)!.shadowRoot!.querySelector("wt-combobox")!.value).toBe("station:s1");
  });

  it("choosing a station in the Week's Show writes it and draws its rows", async () => {
    const { el } = await mount("/manage/opening-hours/view/week/week/2026-12-09");
    await expect.poll(() => showValues(el)).toContain("station:s1");
    chooseShown(el, "station:s1");
    await expect.poll(() => location.pathname).toBe(grillWeek);
    await expect.poll(() => week(el)!.station?.state).toBe("ready");
    await week(el)!.updateComplete;
    expect(rowKeys(el, "2026-12-09")).toEqual(["rest", "bar"]);
    expect(week(el)!.shadowRoot!.querySelector("wt-combobox")!.value).toBe("station:s1");
  });

  it("the Month keeps the station", async () => {
    const { el, paths } = await mount(grillWeek);
    await expect.poll(() => week(el)!.station?.state).toBe("ready");
    const pushed = pushedPaths();
    monthLink(el, "2026-12").click();
    await expect.poll(() => monthView(el)?.station?.state).toBe("ready");
    expect(pushed()).toEqual(["/manage/opening-hours/view/month/station/s1/month/2026-12"]);
    await monthView(el)!.updateComplete;
    expect(monthView(el)!.shadowRoot!.querySelector("wt-combobox")!.value).toBe("station:s1");
    expect(timesReads(paths)).toEqual([
      "/management-api/venue-service/stations/s1/service-times?from=2026-11-30&to=2027-01-03",
    ]);
  });

  it("choosing a department clears the station", async () => {
    const { el } = await mount(grillWeek);
    await expect.poll(() => week(el)!.station?.state).toBe("ready");
    chooseShown(el, "bar");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/week/department/bar/week/2026-12-09");
    await expect.poll(() => week(el)!.station).toBeUndefined();
    expect(week(el)!.departmentId).toBe("bar");
  });

  it("an unknown station shows All departments and is never read", async () => {
    const { el, paths } = await mount(
      "/manage/opening-hours/view/week/station/gone/week/2026-12-09",
    );
    await expect.poll(() => showValues(el)).toContain("station:s1");
    await week(el)!.updateComplete;
    expect(week(el)!.station).toBeUndefined();
    expect(week(el)!.shadowRoot!.querySelector("wt-combobox")!.value).toBe("all");
    expect(timesReads(paths)).toEqual([]);
  });

  it.each([
    ["a station", grillWeek],
    [
      "a station named beside a department",
      "/manage/opening-hours/view/week/department/rest/station/s1/week/2026-12-09",
    ],
  ])("the day box over %s still lists every department's hours", async (_, address) => {
    const { el } = await mount(address);
    await expect.poll(() => week(el)!.station?.state).toBe("ready");
    await week(el)!.updateComplete;
    await userEvent.click(dayName(el, "2026-12-09"));
    await expect.poll(() => boxOpen(el)).toBe(true);
    await expect
      .poll(() => dayBox(el)!.rows.map((row) => row.name))
      .toEqual(["Restaurant", "Terrace", "Bar"]);
  });

  it("a station waits for the station list before drawing anything", async () => {
    const { el, paths } = await mount(grillWeek, undefined, false, { holdStations: true });
    await expect.poll(() => paths).toContain("/management-api/stations");
    await week(el)!.updateComplete;
    expect(week(el)!.station).toEqual({ id: "s1", state: "loading" });
    expect(week(el)!.shadowRoot!.querySelector("section")).toBeNull();
    expect(timesReads(paths)).toEqual([]);
  });

  it("the default station reads Always open", async () => {
    const { el } = await mount("/manage/opening-hours/view/week/station/s2/week/2026-12-09");
    await expect.poll(() => week(el)!.station?.state).toBe("always");
    await week(el)!.updateComplete;
    expect(week(el)!.shadowRoot!.querySelector("[data-test=always-open]")).not.toBeNull();
  });

  it.each([
    ["fails", { code: "connection.failed" }],
    ["is refused", REFUSED],
  ])("a station-times read that %s shows the load error above the view", async (_, error) => {
    const { el } = await mount(grillWeek, undefined, false, { timesFail: error });
    const alert = () => el.shadowRoot!.querySelector("[data-test=station-read-error]");
    await expect.poll(() => alert()?.textContent).toBe(STATION_LOAD_ERROR);
    expect(alert()!.getAttribute("role")).toBe("alert");
    expect(alert()!.nextElementSibling).toBe(week(el));
    expect(week(el)!.station?.state).toBe("loading");
  });

  it.each([
    ["fails", { code: "connection.failed" }],
    ["is refused", REFUSED],
  ])(
    "a station list that %s leaves Show with departments only, and the page works",
    async (_, error) => {
      const { el, paths } = await mount(grillWeek, undefined, false, { stationsFail: error });
      await expect.poll(() => paths).toContain("/management-api/stations");
      await week(el)!.updateComplete;
      expect(showValues(el)).toEqual(["all", "rest", "bar"]);
      expect(week(el)!.station).toBeUndefined();
      expect(rowKeys(el, "2026-12-09")).toEqual(["rest", "bar"]);
      expect(
        week(el)!.shadowRoot!.querySelector(
          'section[data-date="2026-12-09"] .row[data-row="rest"]',
        )!.textContent,
      ).toContain("Lunch 13:00–16:00");
      expect(timesReads(paths)).toEqual([]);
      chooseShown(el, "bar");
      await expect.poll(() => week(el)!.departmentId).toBe("bar");
    },
  );

  it("a read-only Calendar offers no stations and reads none", async () => {
    const { el, paths } = await mount(grillWeek, undefined, false, { readOnly: true });
    await week(el)!.updateComplete;
    // Gives a station list a chance to have been asked for, had the screen wanted one.
    await new Promise((settled) => setTimeout(settled, 50));
    await week(el)!.updateComplete;
    expect(showValues(el)).toEqual(["all", "rest", "bar"]);
    expect(week(el)!.stations).toEqual([]);
    expect(week(el)!.station).toBeUndefined();
    expect(week(el)!.shadowRoot!.querySelector("wt-combobox")!.value).toBe("all");
    expect(paths.some((path) => path.startsWith("/management-api/stations"))).toBe(false);
    expect(paths.some((path) => path.includes("/service-times"))).toBe(false);
  });

  it.each(["pointer", "keyboard"] as const)(
    "a painter opened from a station's Week closes back onto the station's address (%s)",
    async (by) => {
      const press = async (target: HTMLElement) => {
        if (by === "pointer") return userEvent.click(target);
        target.focus();
        await userEvent.keyboard("{Enter}");
      };
      const { el } = await mount(grillWeek);
      await expect.poll(() => week(el)!.station?.state).toBe("ready");
      await week(el)!.updateComplete;
      await press(dayName(el, "2026-12-09"));
      await expect.poll(() => boxOpen(el)).toBe(true);
      const boxClosed = closed(dayBox(el)!, "calendar-day-box-close");
      await press(dayBox(el)!.querySelector<HTMLElement>("[data-test=edit-week]")!);
      await boxClosed;
      await expect.poll(() => painter(el)).not.toBeNull();
      const shown = painter(el)!;
      await shown.updateComplete;
      await expect
        .poll(() => frame(shown).shadowRoot?.querySelector("[data-test=cancel]"))
        .toBeTruthy();
      const close = closed(shown, "painter-close");
      await press(frame(shown).shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!);
      await close;
      await expect.poll(() => location.pathname).toBe(grillWeek);
      await expect.poll(() => painter(el)).toBeNull();
      expect(week(el)!.station?.state).toBe("ready");
    },
  );

  it("a station read for the next month, beside the last month's read, draws as loading", async () => {
    const { el, paths } = await mount(
      "/manage/opening-hours/view/week/station/s1/week/2026-12-28",
      undefined,
      false,
      { holdMonths: ["2027-01"], timesAsDecember: true },
    );
    await expect.poll(() => week(el)!.station?.state).toBe("ready");
    week(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!.click();
    await expect.poll(() => week(el)!.date).toBe("2027-01-04");
    await expect
      .poll(() => timesReads(paths))
      .toContain(
        "/management-api/venue-service/stations/s1/service-times?from=2026-12-28&to=2027-01-31",
      );
    await new Promise((settled) => setTimeout(settled, 50));
    await el.updateComplete;
    expect(week(el)!.model?.month).toBe("2026-12");
    expect(week(el)!.station?.state).toBe("loading");
  });

  it("a station whose times have not answered draws as loading, not with the last station's", async () => {
    const { el, paths } = await mount(grillWeek, undefined, false, { holdTimes: ["s2"] });
    await expect.poll(() => week(el)!.station?.state).toBe("ready");
    chooseShown(el, "station:s2");
    await expect
      .poll(() => timesReads(paths))
      .toContain(
        "/management-api/venue-service/stations/s2/service-times?from=2026-11-30&to=2027-01-03",
      );
    await el.updateComplete;
    await week(el)!.updateComplete;
    expect(week(el)!.station).toEqual({ id: "s2", state: "loading" });
  });

  it("a station list delivered again unchanged hands the Week the same station", async () => {
    const watched = vi.spyOn(OpeningHoursApi.prototype, "watchStations");
    const { el } = await mount(grillWeek);
    await expect.poll(() => week(el)!.station?.state).toBe("ready");
    const shown = week(el)!.station;
    // STATIONS holds only the fields the Calendar reads, as the mocked station list does.
    const deliver = watched.mock.calls[0]![0] as (stations: readonly object[]) => void;
    deliver(structuredClone(STATIONS));
    await el.updateComplete;
    expect(week(el)!.station).toBe(shown);
    deliver(STATIONS.map((station) => ({ ...station, name: `${station.name} renamed` })));
    await el.updateComplete;
    expect(week(el)!.station).not.toBe(shown);
  });

  it("a week across two months draws the station on every one of its days", async () => {
    const { el } = await mount("/manage/opening-hours/view/week/station/s1/week/2026-12-28");
    await expect.poll(() => week(el)!.station?.state).toBe("ready");
    await week(el)!.updateComplete;
    const dates = weekDates("2026-12-28");
    expect(dates).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    for (const date of dates) expect(rowKeys(el, date), date).toEqual(["rest", "bar"]);
    const station = week(el)!.station as Extract<StationShow, { state: "ready" }>;
    const read = monthModel();
    for (const date of dates) {
      const day = station.model.days.find((row) => row.date === date)!;
      const { endMinute, dayCutover, holidays, specialDay, seasonId, closedAllDay } =
        read.days.find((row) => row.date === date)!;
      expect(day, date).toMatchObject({
        endMinute,
        dayCutover,
        holidays,
        specialDay,
        seasonId,
        closedAllDay,
      });
    }
  });
});
