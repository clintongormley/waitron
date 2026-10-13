import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import "./opening-hours-screen.js";

let screen: HTMLElementTagNameMap["dashboard-opening-hours-screen"];
const originalUrl = location.href;
function fixture(): OpeningHoursModel {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 0,
    currentBusinessDay: "2026-10-12",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [{ id: "m1", name: "Lunch menu", active: true, includes: [] }],
    seasons: [{ id: "autumn", name: "Autumn", startsOn: "09-01" }],
    currentSeasonId: "autumn",
    departments: [
      {
        id: "d1",
        name: "Restaurant",
        active: true,
        zones: [],
        periods: [
          {
            id: "p1",
            name: "Lunch",
            colour: "green",
            menuId: "m1",
            staffMenuIds: [],
            endOffsetMinutes: 0,
            weekdays: [1],
            routingUses: [],
          },
        ],
        seasonWeeks: [
          {
            seasonId: "autumn",
            week: [{ weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] }],
          },
        ],
      },
    ],
  };
}
beforeEach(() => {
  setLocale("en");
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours");
});
afterEach(() => {
  screen?.remove();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
function emit(target: Element, name: string, detail: unknown) {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function mount(
  write: (url: string, method: string, body: unknown) => Promise<unknown> = async () => {},
) {
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi(
    withOpeningStations((async (url, method, body) =>
      method === "GET" ? fixture() : write(url, method, body)) as DashboardRequest),
  );
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-week")).not.toBeNull();
  const mode =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=realWeek]");
  expect(mode, "normal-week / real-week switch").not.toBeNull();
  emit(mode!, "wt-change", { checked: true });
  await expect.poll(() => location.search).toBe("?week=2026-10-12");
  await screen.updateComplete;
  const week =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
      "opening-hours-week",
    )!;
  await week.updateComplete;
  return week;
}
const grid = (week: HTMLElementTagNameMap["opening-hours-week"]) =>
  week.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!;
const save = (week: HTMLElementTagNameMap["opening-hours-week"]) =>
  week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=save-date][data-day='1']",
  )!;
it("ignores grid events for plain dates in a real week", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  });
  week.department = {
    ...week.department,
    seasonWeeks: [
      {
        seasonId: "autumn",
        week: [
          ...week.department.seasonWeeks[0]!.week,
          { weekday: 0, slots: [{ periodId: "p1", startsAt: "09:00", endsAt: "12:00" }] },
        ],
      },
    ],
  };
  await week.updateComplete;
  emit(grid(week), "grid-range-select", { columnKey: "3", startsAt: "11:00", endsAt: "15:00" });
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("range-dialog")).toBeNull();
  emit(grid(week), "grid-block-change", {
    columnKey: "0",
    index: 0,
    startsAt: "09:00",
    endsAt: "13:00",
  });
  await week.updateComplete;
  expect(grid(week).columns[6]!.slots).toEqual([
    { periodId: "p1", startsAt: "09:00", endsAt: "12:00" },
  ]);
  expect(save(week)).toBeNull();
  expect(writes).toEqual([]);
});
it("ignores controls from a departed real-week switch", async () => {
  await mount();
  const oldMode = screen.shadowRoot!.querySelector("[name=realWeek]")!;
  const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
  emit(tabs, "wt-tab-change", { value: "periods" });
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=realWeek]")).toBeNull();
  emit(oldMode, "wt-change", { checked: false });
  expect(location.search).toBe("?week=2026-10-12");
  emit(tabs, "wt-tab-change", { value: "week" });
  await expect
    .poll(
      () =>
        screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
          "opening-hours-week",
        )?.weekStart,
    )
    .toBe("2026-10-12");
});
it("paints the real-week switch label with the theme's readable text colour", async () => {
  await mount();
  const toggle =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=realWeek]")!;
  await toggle.updateComplete;
  const label = toggle.shadowRoot!.querySelector("label")!;
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-text)";
  screen.shadowRoot!.appendChild(probe);
  expect(getComputedStyle(label).color).toBe(getComputedStyle(probe).color);
});
