import { afterEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { businessDateToday } from "./opening-hours-day.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import "./service-grid.js";
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  vi.useRealTimers();
});
async function grid() {
  const el = document.createElement("service-grid");
  Object.assign(el, {
    dayCutover: "05:00",
    columns: [
      {
        key: "old",
        label: "Nov 2",
        slots: [{ periodId: "lunch", startsAt: "09:00", endsAt: "17:00" }],
        periods: [{ id: "lunch", name: "Lunch", colour: "green" }],
        editable: true,
        clock: { dayCutover: "05:00", endMinute: 1440 },
      },
      {
        key: "short",
        label: "Nov 3 short",
        slots: [],
        periods: [],
        editable: true,
        clock: { dayCutover: "05:00", endMinute: 1320 },
      },
      {
        key: "long",
        label: "Nov 3 long",
        slots: [],
        periods: [],
        editable: true,
        clock: { dayCutover: "05:00", endMinute: 1560 },
      },
      {
        key: "new",
        label: "Nov 4",
        slots: [],
        periods: [],
        editable: true,
        clock: { dayCutover: "07:00", endMinute: 1440 },
      },
    ],
  });
  applyTokens(el);
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  return el;
}
it("stops the shorter column at its own end and draws the longer closed tail without editable duplicates", async () => {
  const el = await grid();
  const short = el.shadowRoot!.querySelector('[data-column="short"]')!;
  expect(short.querySelector('[data-minute="1320"]')).toBeNull();
  expect(short.querySelector('[data-minute="1305"]')).toBeTruthy();
  const long = el.shadowRoot!.querySelector('[data-column="long"]')!;
  expect(long.querySelector('[data-minute="1440"]')).toBeNull();
  expect(long.querySelector('[data-test="closed-tail"]')).toBeTruthy();
  expect(long.querySelector('[data-test="closed-tail"]')!.textContent).toBeTruthy();
});
it("uses each column's start for keyboard range selection", async () => {
  const el = await grid();
  const ranges: unknown[] = [];
  el.addEventListener("grid-range-select", (event) => ranges.push(event.detail));
  const cell = el.shadowRoot!.querySelector<HTMLElement>('[data-column="new"] [data-minute="0"]')!;
  cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  expect(ranges).toEqual([{ columnKey: "new", startsAt: "07:00", endsAt: "07:15" }]);
});
it("Today keeps chronological ownership in a repeated hour instead of applying today's scalar start", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T00:45:00Z"));
  const model = {
    clockReadable: true,
    clockRevision: 4,
    currentBusinessDay: "2026-10-24",
    pending: null,
    menus: [],
    namedDays: [],
    departments: [],
    timeZone: "Europe/Madrid",
    dayCutover: "02:30",
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "02:30", cutoverChanges: [] },
  } as OpeningHoursModel;
  expect(businessDateToday(model)).toBe("2026-10-24");
  vi.setSystemTime(new Date("2026-10-25T01:45:00Z"));
  expect(businessDateToday(model)).toBe("2026-10-25");
});
it("dated department columns carry their own historical, transition and future clock", async () => {
  const { OpeningHoursApi } = await import("./opening-hours-client.js");
  await import("./opening-hours-week.js");
  const el = document.createElement("opening-hours-week");
  const clock = {
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    cutoverChanges: [{ effectiveBusinessDay: "2026-11-04", dayCutover: "07:00" }],
  };
  Object.assign(el, {
    api: new OpeningHoursApi(async () => ({}) as never),
    businessDayClock: clock,
    clockRevision: 4,
    weekStart: "2026-11-02",
    dayCutover: "07:00",
    readOnly: true,
    department: { id: "d", name: "Restaurant", active: true, week: [], dates: [], periods: [] },
  });
  applyTokens(el);
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  const columns = el.shadowRoot!.querySelector("service-grid")!.columns;
  expect(columns.find((column) => column.key === "1")!.clock).toMatchObject({
    dayCutover: "05:00",
    endMinute: 1440,
  });
  expect(columns.find((column) => column.key === "2")!.clock).toMatchObject({
    dayCutover: "05:00",
    endMinute: 1560,
  });
  expect(columns.find((column) => column.key === "3")!.clock).toMatchObject({
    dayCutover: "07:00",
    endMinute: 1440,
  });
});
it("normal-week columns keep their explicit reference instead of choosing a historical date", async () => {
  await import("./opening-hours-all.js");
  const el = document.createElement("opening-hours-all");
  Object.assign(el, {
    dayCutover: "07:00",
    businessDayClock: {
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      cutoverChanges: [{ effectiveBusinessDay: "2026-11-04", dayCutover: "07:00" }],
    },
    departments: [{ id: "d", name: "Restaurant", active: true, week: [], dates: [], periods: [] }],
  });
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  const grid = el.shadowRoot!.querySelector("service-grid")!;
  expect(grid.dayCutover).toBe("07:00");
  expect(grid.columns.every((column) => column.clock === undefined)).toBe(true);
});
it("the range editor refuses an endpoint beyond the selected short column's boundary", async () => {
  await import("./range-dialog.js");
  const el = document.createElement("range-dialog");
  Object.assign(el, {
    open: true,
    dayCutover: "05:00",
    endMinute: 1320,
    range: { periodId: "lunch", startsAt: "22:00", endsAt: "03:00" },
    periods: [{ id: "lunch", name: "Lunch", colour: "green" }],
  });
  applyTokens(el);
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  el.shadowRoot!.querySelector("[name=endsAt]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "04:00" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  const saved: unknown[] = [];
  el.addEventListener("range-save", (event) => saved.push((event as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-range"]')!.click();
  await el.updateComplete;
  expect(saved).toEqual([]);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=endsAt]")!.error,
  ).toBeTruthy();
});
it("the Day view uses its selected business date for every department and zone column", async () => {
  const { OpeningHoursApi } = await import("./opening-hours-client.js");
  const el = document.createElement("opening-hours-day");
  const model: OpeningHoursModel = {
    businessDayClock: {
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      cutoverChanges: [{ effectiveBusinessDay: "2026-11-04", dayCutover: "03:00" }],
    },
    clockRevision: 4,
    currentBusinessDay: "2026-11-01",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "03:00",
    menus: [],
    namedDays: [],
    departments: [
      {
        id: "d",
        name: "Restaurant",
        active: true,
        periods: [],
        week: [],
        dates: [],
        zones: [{ id: "z", name: "Terrace", week: [], dates: [] }],
      },
    ],
  };
  Object.assign(el, {
    api: new OpeningHoursApi(async () => ({ days: [] }) as never),
    model,
    date: "2026-11-03",
    readOnly: true,
  });
  applyTokens(el);
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  const columns = el.shadowRoot!.querySelector("service-grid")!.columns;
  expect(columns.map((column) => column.clock)).toEqual([
    expect.objectContaining({ dayCutover: "05:00", endMinute: 1320 }),
    expect.objectContaining({ dayCutover: "05:00", endMinute: 1320 }),
  ]);
});

it("labels actual dated column bounds and both transition lengths without labelling a normal-week reference", async () => {
  const el = await grid();
  const columns = el.columns.map((column) => ({
    ...column,
    clock: {
      ...column.clock!,
      startAt: "2026-11-03T04:00:00.000Z",
      endAt: column.key === "short" ? "2026-11-04T02:00:00.000Z" : "2026-11-04T06:00:00.000Z",
    },
  }));
  el.columns = [
    ...columns,
    { key: "reference", label: "Normal week", slots: [], periods: [], editable: false },
  ];
  await el.updateComplete;
  const headings = el.shadowRoot!.querySelectorAll(".heading");
  expect(headings[2]!.textContent).toContain("22");
  expect(headings[2]!.querySelector('time[datetime="2026-11-04T02:00:00.000Z"]')).toBeTruthy();
  expect(headings[3]!.textContent).toContain("26");
  expect(headings[3]!.querySelector('time[datetime="2026-11-04T06:00:00.000Z"]')).toBeTruthy();
  expect(headings[1]!.textContent).toContain("05:00");
  expect(headings[4]!.textContent).toContain("07:00");
  expect(headings[5]!.textContent?.trim()).toBe("Normal week");
});

for (const kind of ["all", "station"] as const) {
  it(`${kind} renders the historical start, transition end and future start in actual dated columns`, async () => {
    const { OpeningHoursApi } = await import("./opening-hours-client.js");
    await import("./opening-hours-all.js");
    await import("./opening-hours-station.js");
    const el = document.createElement(
      kind === "all" ? "opening-hours-all" : "opening-hours-station",
    );
    const clock = {
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
      cutoverChanges: [{ effectiveBusinessDay: "2026-11-04", dayCutover: "07:00" }],
    };
    const departments = [
      { id: "d", name: "Restaurant", active: true, week: [], dates: [], periods: [] },
    ];
    Object.assign(el, {
      weekStart: "2026-11-02",
      dayCutover: "07:00",
      businessDayClock: clock,
      departments,
      stationId: "station",
      model: { dayCutover: "07:00", businessDayClock: clock, departments },
      api: new OpeningHoursApi(async () => ({ always: null, days: [] }) as never),
    });
    applyTokens(el);
    hosts.push(el);
    document.body.append(el);
    await el.updateComplete;
    await expect.poll(() => el.shadowRoot!.querySelector("service-grid")).toBeTruthy();
    const rendered = el.shadowRoot!.querySelector("service-grid")!;
    await rendered.updateComplete;
    const headings = rendered.shadowRoot!.querySelectorAll(".heading");
    expect(headings[1]!.querySelector('time[datetime="2026-11-02T04:00:00.000Z"]')).toBeTruthy();
    expect(headings[2]!.textContent).toContain("26");
    expect(headings[2]!.querySelector('time[datetime="2026-11-04T06:00:00.000Z"]')).toBeTruthy();
    expect(headings[3]!.textContent).toContain("07:00");
    expect(headings[3]!.querySelector('time[datetime="2026-11-04T06:00:00.000Z"]')).toBeTruthy();
    expect(rendered.shadowRoot!.querySelectorAll("[data-editable]")).toHaveLength(0);
  });
}

it("keeps dated headings concise while exposing their precise boundary instants", async () => {
  const el = await grid();
  el.columns = [
    {
      ...el.columns[1]!,
      clock: {
        dayCutover: "05:00",
        endMinute: 1320,
        startAt: "2026-11-03T04:00:00.000Z",
        endAt: "2026-11-04T02:00:00.000Z",
      },
    },
  ];
  await el.updateComplete;
  const bounds = el.shadowRoot!.querySelector(".bounds")!;
  expect(bounds.textContent?.replace(/\s+/g, " ").trim()).toBe("05:00 → 03:00");
  expect(bounds.querySelector('time[datetime="2026-11-03T04:00:00.000Z"]')).toBeTruthy();
  expect(bounds.querySelector('time[datetime="2026-11-04T02:00:00.000Z"]')).toBeTruthy();
});
