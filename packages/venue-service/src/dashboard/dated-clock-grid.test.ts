import { afterEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
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
it("the All departments week draws undated columns at the venue's changeover", async () => {
  await import("./opening-hours-all.js");
  const el = document.createElement("opening-hours-all");
  Object.assign(el, {
    dayCutover: "07:00",
    departments: [
      {
        id: "d",
        name: "Restaurant",
        active: true,
        seasonWeeks: [],
        periods: [],
      },
    ],
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
