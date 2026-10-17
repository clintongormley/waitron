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
import { frame } from "../testing/season-painter-fixture.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import { emptyPageAtTop, resizeViewport } from "../testing/window-settled.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
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
      { id: "autumn", name: "Autumn", startsOn: "09-01" },
      { id: "winter", name: "Winter", startsOn: "12-01" },
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
beforeEach(() => {
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

/** Every month read is answered with the fixture's December, which holds 30 November to
 *  3 January, so it serves each week these tests draw; with `hold`, the opening-hours read never
 *  answers. */
async function mount(address: string, calendar?: Screen["calendar"], hold = false) {
  history.replaceState(null, "", address);
  const months: string[] = [];
  const request = (async (path: string) => {
    const month = /\/opening-hours\/month\?month=([\d-]+)$/.exec(path);
    if (month) {
      months.push(month[1]!);
      return monthModel({ month: month[1]! });
    }
    const year = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
    if (year) return yearRead(Number(year[1]));
    if (hold) return new Promise(() => {});
    return model();
  }) as DashboardRequest;
  const el = document.createElement("dashboard-opening-hours-screen") as Screen;
  el.api = new OpeningHoursApi(request);
  if (calendar) el.calendar = { ...calendar, ctx: { request } };
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  if (hold) await expect.poll(() => el.shadowRoot?.querySelector("h1")).not.toBeNull();
  else await expect.poll(() => week(el)?.model).toBeDefined();
  await el.updateComplete;
  return { el, months };
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
    const before = [innerWidth, innerHeight] as const;
    await resizeViewport(1280, 800);
    onTestFinished(() => resizeViewport(...before));
    expect(window.innerWidth).toBe(1280);
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
});
