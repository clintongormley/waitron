import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement } from "lit";
import { applyTokens } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";

const originalUrl = location.href;
let screen: HTMLElementTagNameMap["dashboard-opening-hours-screen"];
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/opening-hours/view/week/department/d1/zone/z1");
});
afterEach(() => {
  screen?.remove();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
const model: OpeningHoursModel = {
  timeZone: "Europe/Madrid",
  clockReadable: true,
  dayCutover: "06:00",
  menus: [],
  namedDays: [],
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      active: true,
      zones: [
        {
          id: "z1",
          name: "Terrace",
          week: [{ weekday: 1, ranges: [{ startsAt: "10:00", endsAt: "11:00" }] }],
          dates: [],
        },
      ],
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
      week: [{ weekday: 1, slots: [{ periodId: "p1", startsAt: "09:00", endsAt: "14:00" }] }],
      dates: [],
    },
  ],
};
async function mount(
  write?: (path: string, method: string, body: unknown) => Promise<unknown>,
  readOnly = false,
) {
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.readOnly = readOnly;
  screen.api = new OpeningHoursApi(
    withOpeningStations((async (path, method, body) =>
      method === "GET" ? structuredClone(model) : write?.(path, method, body)) as DashboardRequest),
  );
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("wt-tabs")).not.toBeNull();
  const week = screen.shadowRoot!.querySelector("opening-hours-zone-week") as LitElement;
  expect(week, "zone normal week editor").not.toBeNull();
  await week.updateComplete;
  return week;
}
const grid = (week: LitElement) =>
  week.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!;
const save = (week: LitElement) =>
  week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!;
const emit = (target: Element, name: string, detail: unknown) =>
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
async function drag(week: LitElement) {
  emit(grid(week), "grid-range-select", { columnKey: "5", startsAt: "23:30", endsAt: "06:00" });
  await week.updateComplete;
}
it("draws seven closed-layer columns over the department's periods and leaves unchanged Save quiet", async () => {
  const week = await mount();
  expect(grid(week).columns.map((c) => [c.key, c.layer])).toEqual(
    [1, 2, 3, 4, 5, 6, 0].map((day) => [String(day), "closed"]),
  );
  expect(grid(week).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "09:00", endsAt: "14:00" },
  ]);
  expect(grid(week).columns[0]!.closed).toEqual([{ startsAt: "10:00", endsAt: "11:00" }]);
  expect(save(week).disabled).toBe(true);
  expect(save(week).variant).toBe("secondary");
});
it("a Friday drag through changeover stages closed times and Save sends all seven days without period ids", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  });
  await drag(week);
  expect(grid(week).columns.find((c) => c.key === "5")!.closed).toEqual([
    { startsAt: "23:30", endsAt: "06:00" },
  ]);
  expect(writes).toEqual([]);
  expect(save(week).disabled).toBe(false);
  save(week).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    [
      "/management-api/venue-service/zones/z1/closed-week",
      "PUT",
      {
        days: [
          { weekday: 0, ranges: [] },
          { weekday: 1, ranges: [{ startsAt: "10:00", endsAt: "11:00" }] },
          { weekday: 2, ranges: [] },
          { weekday: 3, ranges: [] },
          { weekday: 4, ranges: [] },
          { weekday: 5, ranges: [{ startsAt: "23:30", endsAt: "06:00" }] },
          { weekday: 6, ranges: [] },
        ],
      },
    ],
  ]);
  await expect.poll(() => save(week).disabled).toBe(true);
});
it("opens a closed block without a period field, stages edited times, then stages Delete", async () => {
  const week = await mount();
  emit(grid(week), "grid-block-open", { columnKey: "1", index: 0 });
  await week.updateComplete;
  let dialog =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
  await dialog.updateComplete;
  expect(dialog.shadowRoot!.querySelector("[name=periodId]")).toBeNull();
  emit(dialog.shadowRoot!.querySelector("[name=endsAt]")!, "wt-change", { value: "12:00" });
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
  expect(grid(week).columns[0]!.closed).toEqual([{ startsAt: "10:00", endsAt: "12:00" }]);
  emit(grid(week), "grid-block-open", { columnKey: "1", index: 0 });
  await week.updateComplete;
  dialog = week.shadowRoot!.querySelector("range-dialog")!;
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-range]")!.click();
  await week.updateComplete;
  expect(grid(week).columns[0]!.closed).toEqual([]);
});
it("copies one day's closed times without changing department slots and Clear removes only its day", async () => {
  const week = await mount();
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=copy-day][data-day='1']")!.click();
  await week.updateComplete;
  const target = week.shadowRoot!.querySelector<HTMLInputElement>("[name=copyDay2]")!;
  target.checked = true;
  target.dispatchEvent(new Event("change"));
  await week.updateComplete;
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-copy]")!.click();
  await week.updateComplete;
  expect(grid(week).columns[1]!.closed).toEqual([{ startsAt: "10:00", endsAt: "11:00" }]);
  expect(grid(week).columns[1]!.slots).toEqual([]);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=clear-day][data-day='1']")!.click();
  await week.updateComplete;
  expect(grid(week).columns[0]!.closed).toEqual([]);
  expect(grid(week).columns[1]!.closed).toEqual([{ startsAt: "10:00", endsAt: "11:00" }]);
  expect(grid(week).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "09:00", endsAt: "14:00" },
  ]);
});
it.each(["en", "es"])(
  "places a closed-time refusal beside the named day and keeps retry enabled (%s)",
  async (locale) => {
    setLocale(locale);
    const week = await mount(async () => {
      throw { code: "zone_closed_time.invalid", params: { field: "days.5.ranges.0.endsAt" } };
    });
    setLocale(locale);
    await drag(week);
    save(week).click();
    await expect
      .poll(() => week.shadowRoot!.querySelector("[data-day-error='5']")?.textContent)
      .toContain(
        locale === "en"
          ? "These closed times overlap or are not in 15-minute steps."
          : "Estas horas de cierre se solapan o no van de 15 en 15 minutos.",
      );
    expect(save(week).disabled).toBe(false);
    expect(grid(week).columns.find((c) => c.key === "5")!.closed).toEqual([
      { startsAt: "23:30", endsAt: "06:00" },
    ]);
  },
);
it("read-only and departed controls cannot stage or submit closed times", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  }, true);
  await drag(week);
  emit(grid(week), "grid-range-select", { columnKey: "5", startsAt: "23:30", endsAt: "06:00" });
  await week.updateComplete;
  expect(grid(week).columns.every((c) => !c.editable)).toBe(true);
  expect(grid(week).columns.find((c) => c.key === "5")!.closed).toEqual([]);
  expect(week.shadowRoot!.querySelector("[data-test=save-week]")).toBeNull();
  screen.remove();
  await drag(week);
  expect(writes).toEqual([]);
});
it("replaces the date placeholder with a real week whose plain dates cannot submit a normal-week change", async () => {
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  const writes: unknown[][] = [];
  const oldWeek = await mount(async (...args) => {
    writes.push(args);
  });
  emit(screen.shadowRoot!.querySelector("[name=realWeek]")!, "wt-change", { checked: true });
  await expect.poll(() => location.search).toBe("?week=2026-10-12");
  const week = screen.shadowRoot!.querySelector("opening-hours-zone-week")!;
  await week.updateComplete;
  expect(screen.shadowRoot!.querySelector("[data-test=zone-placeholder]")).toBeNull();
  expect(oldWeek.isConnected).toBe(false);
  expect(grid(week).columns.every((column) => !column.editable)).toBe(true);
  emit(grid(week), "grid-range-select", { columnKey: "5", startsAt: "23:30", endsAt: "06:00" });
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("[data-test=save-week]")).toBeNull();
  expect(week.shadowRoot!.querySelector("[data-test=save-date]")).toBeNull();
  expect(writes).toEqual([]);
});

it("unchanged and busy host clicks cannot send duplicate writes", async () => {
  let release!: () => void;
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  save(week).dispatchEvent(new MouseEvent("click"));
  expect(writes).toEqual([]);
  await drag(week);
  save(week).click();
  await week.updateComplete;
  save(week).dispatchEvent(new MouseEvent("click"));
  expect(writes).toHaveLength(1);
  const before = structuredClone(grid(week).columns.find((c) => c.key === "5")!.closed);
  emit(grid(week), "grid-block-change", {
    columnKey: "5",
    index: 0,
    startsAt: "22:00",
    endsAt: "06:00",
  });
  await week.updateComplete;
  expect(grid(week).columns.find((c) => c.key === "5")!.closed).toEqual(before);
  release();
  await expect.poll(() => save(week).disabled).toBe(true);
});
it.each(["success", "refusal"])(
  "ignores a late %s after the retained week disconnects and reconnects",
  async (outcome) => {
    let release!: () => void;
    const week = await mount(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (outcome === "refusal")
        throw { code: "zone_closed_time.invalid", params: { field: "days.5.ranges" } };
    });
    await drag(week);
    save(week).click();
    await week.updateComplete;
    const parent = screen.parentNode!;
    screen.remove();
    parent.appendChild(screen);
    await screen.updateComplete;
    await week.updateComplete;
    release();
    await expect.poll(() => save(week).disabled).toBe(false);
    expect(save(week).variant).toBe("primary");
    expect(week.shadowRoot!.querySelector("[data-day-error='5']")).toBeNull();
    expect(grid(week).columns.find((c) => c.key === "5")!.closed).toEqual([
      { startsAt: "23:30", endsAt: "06:00" },
    ]);
  },
);
