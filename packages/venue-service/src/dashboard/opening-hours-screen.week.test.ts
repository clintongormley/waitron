import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { html } from "lit";
import { userEvent } from "vitest/browser";
import {
  registerCatalogue,
  setLocale,
  type DashboardCalendarView,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
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
    seasons: [],
    currentSeasonId: null,
    departments: DEPARTMENTS,
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
 *  3 January, so it serves each week these tests draw. */
async function mount(address: string, calendar?: Screen["calendar"]) {
  history.replaceState(null, "", address);
  const months: string[] = [];
  const request = (async (path: string) => {
    const month = /\/opening-hours\/month\?month=([\d-]+)$/.exec(path);
    if (month) {
      months.push(month[1]!);
      return monthModel({ month: month[1]! });
    }
    if (path.includes("/opening-hours/year?")) return new Promise(() => {});
    return model();
  }) as DashboardRequest;
  const el = document.createElement("dashboard-opening-hours-screen") as Screen;
  el.api = new OpeningHoursApi(request);
  if (calendar) el.calendar = { ...calendar, ctx: { request } };
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => week(el)?.model).toBeDefined();
  await el.updateComplete;
  return { el, months };
}
const week = (el: Screen) => el.shadowRoot!.querySelector("opening-hours-week");
const painter = (el: Screen) => el.shadowRoot!.querySelector("season-painter");
function pushedPaths() {
  const pushed = vi.spyOn(history, "pushState");
  return () => pushed.mock.calls.map((call) => new URL(String(call[2]), location.href).pathname);
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

  it("/view/week alone draws the week holding the venue's today", async () => {
    const { el, months } = await mount("/manage/opening-hours/view/week");
    expect(week(el)!.date).toBe("2026-12-02");
    expect(months).toEqual(["2026-11"]);
    expect(location.pathname).toBe("/manage/opening-hours/view/week");
  });

  it.each(["2026-13-40", "abc", "0099-12-28"])(
    "/view/week/week/%s draws the week holding the venue's today and leaves the address as written",
    async (value) => {
      const pushed = pushedPaths();
      const replaced = vi.spyOn(history, "replaceState");
      const { el } = await mount(`/manage/opening-hours/view/week/week/${value}`);
      replaced.mockClear();
      expect(week(el)!.date).toBe("2026-12-02");
      await el.updateComplete;
      expect(location.pathname).toBe(`/manage/opening-hours/view/week/week/${value}`);
      expect(pushed()).toEqual([]);
      expect(replaced).not.toHaveBeenCalled();
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
});
