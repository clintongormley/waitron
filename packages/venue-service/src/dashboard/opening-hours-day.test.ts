import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";

let screen: HTMLElementTagNameMap["dashboard-opening-hours-screen"];
const originalUrl = location.href;
export function dayFixture(): OpeningHoursModel {
  return {
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [{ id: "m1", name: "Lunch menu", active: true, includes: [] }],
    namedDays: [
      {
        id: "s/1",
        date: "2026-10-13",
        name: "Party",
        kind: "working_day" as const,
        repeats: false,
        ownHours: true,
        closeWholeVenue: false,
      },
    ],
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
            weekdays: [1, 2],
            routingUses: [],
          },
        ],
        week: [
          { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
          { weekday: 2, slots: [{ periodId: "p1", startsAt: "11:00", endsAt: "15:00" }] },
        ],
        dates: [
          { specialDateId: "s/1", slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "16:00" }] },
        ],
      },
      {
        id: "d2",
        name: "Deli",
        active: true,
        zones: [],
        periods: [
          {
            id: "p2",
            name: "Open",
            colour: "blue",
            menuId: "m1",
            staffMenuIds: [],
            endOffsetMinutes: 0,
            weekdays: [1, 2],
            routingUses: [],
          },
        ],
        week: [
          { weekday: 1, slots: [{ periodId: "p2", startsAt: "09:00", endsAt: "18:00" }] },
          { weekday: 2, slots: [{ periodId: "p2", startsAt: "09:00", endsAt: "18:00" }] },
        ],
        dates: [],
      },
      {
        id: "disabled",
        name: "Closed counter",
        active: false,
        zones: [],
        periods: [],
        week: [],
        dates: [],
      },
    ],
  };
}
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/opening-hours/view/day");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T01:00:00Z"));
});
afterEach(() => {
  screen?.remove();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
export function emit(target: Element, name: string, detail: unknown) {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function mount(
  write: (url: string, method: string, body: unknown) => Promise<unknown> = async () => {},
  model = dayFixture(),
  readOnly = false,
) {
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.readOnly = readOnly;
  screen.api = new OpeningHoursApi((async (url, method, body) =>
    method === "GET" ? model : write(url, method, body)) as DashboardRequest);
  applyTokens(screen);
  document.body.append(screen);
  await expect
    .poll(() => screen.shadowRoot?.querySelector("opening-hours-day"), { timeout: 1500 })
    .not.toBeNull();
  const day =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-day"]>(
      "opening-hours-day",
    )!;
  await day.updateComplete;
  return day;
}
const grid = (day: HTMLElementTagNameMap["opening-hours-day"]) =>
  day.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!;
const save = (day: HTMLElementTagNameMap["opening-hours-day"]) =>
  day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-day]")!;
function resize(
  day: HTMLElementTagNameMap["opening-hours-day"],
  columnKey = "d1",
  endsAt = "15:00",
) {
  emit(grid(day), "grid-block-change", {
    columnKey,
    index: 0,
    startsAt: columnKey === "d1" ? "10:00" : "09:00",
    endsAt,
  });
}
it("starts on the venue business day before changeover, showing only active departments in one grid", async () => {
  const day = await mount();
  expect(day.shadowRoot!.querySelectorAll("service-grid")).toHaveLength(1);
  expect(day.shadowRoot!.querySelector("[data-test=day-date]")!.textContent).toContain(
    "Mon, 12 Oct 2026",
  );
  expect(grid(day).columns.map((c) => [c.key, c.label])).toEqual([
    ["d1", "Restaurant"],
    ["d2", "Deli"],
  ]);
  expect(grid(day).columns.map((c) => c.slots)).toEqual([
    [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }],
    [{ periodId: "p2", startsAt: "09:00", endsAt: "18:00" }],
  ]);
  expect(day.shadowRoot!.textContent).toContain("Changes every Monday");
  expect(screen.shadowRoot!.querySelector("[name=departmentId]")).toBeNull();
  expect(save(day).disabled).toBe(true);
  expect(save(day).variant).toBe("secondary");
});
it("starts on the next business day at the exact changeover", async () => {
  vi.setSystemTime(new Date("2026-10-13T04:00:00Z"));
  const day = await mount();
  expect(day.shadowRoot!.querySelector("[data-test=day-date]")!.textContent).toContain(
    "Tue, 13 Oct 2026",
  );
  expect(grid(day).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "12:00", endsAt: "16:00" },
  ]);
});
it("shows no invented date when the venue clock cannot be read", async () => {
  const day = await mount(undefined, { ...dayFixture(), clockReadable: false });
  expect(day.shadowRoot!.textContent).toContain("time zone or changeover cannot be read");
  expect(grid(day)).toBeNull();
  expect(save(day)).toBeNull();
});
it("stages a weekday edit and preserves every other day in its seven-day PUT", async () => {
  const writes: unknown[] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  });
  resize(day);
  await day.updateComplete;
  expect(writes).toEqual([]);
  expect(save(day).variant).toBe("primary");
  save(day).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    [
      "/management-api/venue-service/departments/d1/menu-week",
      "PUT",
      {
        days: [
          { weekday: 0, slots: [] },
          { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "15:00" }] },
          { weekday: 2, slots: [{ periodId: "p1", startsAt: "11:00", endsAt: "15:00" }] },
          { weekday: 3, slots: [] },
          { weekday: 4, slots: [] },
          { weekday: 5, slots: [] },
          { weekday: 6, slots: [] },
        ],
      },
    ],
  ]);
  await expect.poll(() => save(day).disabled).toBe(true);
});
it("navigates dates and writes a named date's ranges only, including an inherited department", async () => {
  const writes: unknown[] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  });
  day.shadowRoot!.querySelector<HTMLElement>("[data-test=next-day]")!.click();
  await day.updateComplete;
  await expect.poll(() => grid(day).columns[0]!.slots[0]!.startsAt).toBe("12:00");
  expect(day.shadowRoot!.textContent).not.toContain("Changes every");
  expect(day.shadowRoot!.textContent).toContain("Party");
  emit(grid(day), "grid-block-change", {
    columnKey: "d1",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  resize(day, "d2", "19:00");
  await day.updateComplete;
  save(day).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes).toEqual([
    [
      "/management-api/venue-service/special-dates/s%2F1/menu-timetables/d1",
      "PUT",
      { slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "17:00" }] },
    ],
    [
      "/management-api/venue-service/special-dates/s%2F1/menu-timetables/d2",
      "PUT",
      { slots: [{ periodId: "p2", startsAt: "09:00", endsAt: "19:00" }] },
    ],
  ]);
  day.shadowRoot!.querySelector<HTMLElement>("[data-test=previous-day]")!.click();
  await day.updateComplete;
  await expect.poll(() => day.shadowRoot!.textContent).toContain("Changes every Monday");
});
it("commits a successful department before a later refusal and retries only the remaining draft", async () => {
  const writes: unknown[] = [];
  let fail = true;
  const day = await mount(async (url, method, body) => {
    writes.push([url, method, body]);
    if (url.includes("d2") && fail)
      throw { code: "menu_timetable.invalid", params: { field: "days.1.slots.0.endsAt" } };
  });
  resize(day);
  resize(day, "d2", "19:00");
  await day.updateComplete;
  save(day).click();
  await expect
    .poll(() => day.shadowRoot!.querySelector("[data-department-error=d2]"))
    .not.toBeNull();
  expect(day.shadowRoot!.querySelector("[data-department-error=d1]")).toBeNull();
  expect(save(day).disabled).toBe(false);
  fail = false;
  save(day).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes.map((w) => (w as unknown[])[0])).toEqual([
    "/management-api/venue-service/departments/d1/menu-week",
    "/management-api/venue-service/departments/d2/menu-week",
    "/management-api/venue-service/departments/d2/menu-week",
  ]);
  await expect.poll(() => save(day).disabled).toBe(true);
});
it("keeps viewer grids read-only and ignores events for inactive departments", async () => {
  const writes: unknown[] = [];
  const day = await mount(
    async (...args) => {
      writes.push(args);
    },
    dayFixture(),
    true,
  );
  expect(grid(day).columns.every((c) => !c.editable)).toBe(true);
  expect(save(day)).toBeNull();
  emit(grid(day), "grid-range-select", { columnKey: "d1", startsAt: "15:00", endsAt: "16:00" });
  await day.updateComplete;
  expect(day.shadowRoot!.querySelector("range-dialog")).toBeNull();
  expect(writes).toEqual([]);
});
it("opens the clicked department's range dialog and stages its new range", async () => {
  const day = await mount();
  emit(grid(day), "grid-range-select", {
    columnKey: "disabled",
    startsAt: "15:00",
    endsAt: "16:00",
  });
  await day.updateComplete;
  expect(day.shadowRoot!.querySelector("range-dialog")).toBeNull();
  emit(grid(day), "grid-range-select", { columnKey: "d2", startsAt: "18:00", endsAt: "19:00" });
  await day.updateComplete;
  const range =
    day.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
  await range.updateComplete;
  expect(range.periods.map((p) => p.id)).toEqual(["p2"]);
  expect(range.businessDate).toBeUndefined();
  emit(range.shadowRoot!.querySelector("[name=periodId]")!, "wt-change", { value: "p2" });
  await range.updateComplete;
  range.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await day.updateComplete;
  expect(grid(day).columns[1]!.slots).toEqual([
    { periodId: "p2", startsAt: "09:00", endsAt: "18:00" },
    { periodId: "p2", startsAt: "18:00", endsAt: "19:00" },
  ]);
});

it("keeps a dirty ordinary day's write target when a new named date arrives in the background", async () => {
  const writes: unknown[] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  });
  resize(day);
  await day.updateComplete;
  day.model = {
    ...day.model,
    namedDays: [{ ...day.model.namedDays[0]!, date: "2026-10-12" }],
  };
  await day.updateComplete;
  expect(day.shadowRoot!.textContent).toContain("Changes every Monday");
  save(day).click();
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0] as unknown[])[0]).toBe(
    "/management-api/venue-service/departments/d1/menu-week",
  );
});
it("does not lose the pending baseline when a removed day receives a fresh model before reconnect", async () => {
  const day = await mount();
  resize(day);
  await day.updateComplete;
  const parent = day.parentNode!;
  day.remove();
  day.model = structuredClone(day.model);
  parent.appendChild(day);
  await day.updateComplete;
  expect(grid(day).columns[0]!.slots[0]!.endsAt).toBe("15:00");
  expect(save(day).disabled).toBe(false);
});

async function open(
  day: HTMLElementTagNameMap["opening-hours-day"],
  index?: number,
  columnKey = "d1",
) {
  emit(
    grid(day),
    index === undefined ? "grid-range-select" : "grid-block-open",
    index === undefined ? { columnKey, startsAt: "07:00", endsAt: "09:00" } : { columnKey, index },
  );
  await day.updateComplete;
  const range =
    day.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
  await range?.updateComplete;
  return range;
}
async function newPeriod(day: HTMLElementTagNameMap["opening-hours-day"]) {
  const range = await open(day);
  emit(range.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", { value: "new" });
  await day.updateComplete;
  const period =
    day.shadowRoot!.querySelector<HTMLElementTagNameMap["period-editor"]>("period-editor")!;
  await period.updateComplete;
  return { range, period };
}
const periodInput = { name: "Tea", colour: "amber", menuId: "m1", staffMenuIds: [] } as const;
it("edits and deletes an existing range through the same department's dialog", async () => {
  const day = await mount();
  const range = await open(day, 0);
  expect(range.occupied).toEqual([]);
  expect(range.deletable).toBe(true);
  emit(range.shadowRoot!.querySelector("[name=endsAt]")!, "wt-change", { value: "15:00" });
  await range.updateComplete;
  range.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await day.updateComplete;
  expect(grid(day).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "10:00", endsAt: "15:00" },
  ]);
  const editing = await open(day, 0);
  editing.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-range]")!.click();
  await day.updateComplete;
  expect(grid(day).columns[0]!.slots).toEqual([]);
  expect(save(day).disabled).toBe(false);
});
it("inserts a new range in business-day order and keeps unchanged values quiet regardless of key order", async () => {
  const day = await mount();
  let range = await open(day, 0);
  emit(range, "range-save", { input: { endsAt: "14:00", startsAt: "10:00", periodId: "p1" } });
  await day.updateComplete;
  expect(save(day).disabled).toBe(true);
  range = await open(day);
  emit(range.shadowRoot!.querySelector("[name=periodId]")!, "wt-change", { value: "p1" });
  await range.updateComplete;
  range.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await day.updateComplete;
  expect(grid(day).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "07:00", endsAt: "09:00" },
    { periodId: "p1", startsAt: "10:00", endsAt: "14:00" },
  ]);
});
it("creates a nested period once and selects it in the same range with its times intact", async () => {
  const writes: unknown[] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
    return { id: "tea" };
  });
  const { range, period } = await newPeriod(day);
  expect(save(day).disabled).toBe(true);
  emit(period.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Tea" });
  emit(period.shadowRoot!.querySelector("[name=menuId]")!, "wt-change", { value: "m1" });
  emit(period.shadowRoot!.querySelector("[name=colour]")!, "wt-change", { value: "amber" });
  await period.updateComplete;
  period.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect.poll(() => day.shadowRoot!.querySelector("period-editor")).toBeNull();
  await range.updateComplete;
  expect(writes).toEqual([
    [
      "/management-api/venue-service/departments/d1/menu-periods",
      "POST",
      { ...periodInput, endOffsetMinutes: 0 },
    ],
  ]);
  expect(
    range.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=periodId]")!.value,
  ).toBe("tea");
  expect(
    range.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=startsAt]")!.value,
  ).toBe("07:00");
  range.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await day.updateComplete;
  expect(grid(day).columns[0]!.slots[0]).toEqual({
    periodId: "tea",
    startsAt: "07:00",
    endsAt: "09:00",
  });
});
it("cancels a nested period without changing its parent and ignores departed child actions", async () => {
  const writes: unknown[] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  });
  const { range, period } = await newPeriod(day);
  emit(period, "period-close", {});
  await day.updateComplete;
  expect(day.shadowRoot!.querySelector("range-dialog")).toBe(range);
  emit(range.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", { value: "new" });
  await day.updateComplete;
  const next = day.shadowRoot!.querySelector("period-editor");
  emit(period, "period-save", { input: periodInput });
  emit(period, "period-close", {});
  await day.updateComplete;
  expect(day.shadowRoot!.querySelector("period-editor")).toBe(next);
  expect(writes).toEqual([]);
});
it("preserves field refusals from period creation and allows retry", async () => {
  let fail = true;
  const day = await mount(async () => {
    if (fail) throw { code: "menu_period.invalid", params: { field: "name" } };
    return { id: "tea" };
  });
  const { period } = await newPeriod(day);
  emit(period.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Tea" });
  emit(period.shadowRoot!.querySelector("[name=menuId]")!, "wt-change", { value: "m1" });
  emit(period.shadowRoot!.querySelector("[name=colour]")!, "wt-change", { value: "amber" });
  await period.updateComplete;
  period.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect
    .poll(() => period.refusal)
    .toEqual({ code: "menu_period.invalid", params: { field: "name" } });
  fail = false;
  period.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect.poll(() => day.shadowRoot!.querySelector("period-editor")).toBeNull();
});
it("freezes the range and parent during period creation and ignores a success from before reconnect", async () => {
  let done!: (value: unknown) => void;
  const writes: unknown[] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
    return new Promise((resolve) => {
      done = resolve;
    });
  });
  const { period, range } = await newPeriod(day);
  emit(period, "period-save", { input: periodInput });
  await expect.poll(() => done).toBeTypeOf("function");
  await day.updateComplete;
  expect(range.busy).toBe(true);
  emit(period, "period-save", { input: periodInput });
  emit(period, "period-close", {});
  emit(range, "range-close", {});
  emit(range, "range-save", { input: { periodId: "p1", startsAt: "07:00", endsAt: "09:00" } });
  await day.updateComplete;
  expect(day.shadowRoot!.querySelector("period-editor")).toBe(period);
  expect(writes).toHaveLength(1);
  const parent = day.parentNode!;
  day.remove();
  parent.appendChild(day);
  await day.updateComplete;
  done({ id: "late" });
  await expect.poll(() => period.busy).toBe(false);
  expect(range.periods.some((row) => row.id === "late")).toBe(false);
});
it("ignores a nested creation refusal from an earlier connection", async () => {
  let fail!: (error: unknown) => void;
  const day = await mount(
    async () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const { period } = await newPeriod(day);
  emit(period, "period-save", { input: periodInput });
  await expect.poll(() => fail).toBeTypeOf("function");
  const parent = day.parentNode!;
  day.remove();
  parent.appendChild(day);
  await day.updateComplete;
  fail({ code: "menu_period.invalid", params: { field: "name" } });
  await expect.poll(() => period.busy).toBe(false);
  expect(period.refusal).toBeUndefined();
});
it("ignores departed range saves, deletion and close after another range opens", async () => {
  const day = await mount();
  const old = await open(day, 0);
  emit(old, "range-close", {});
  await day.updateComplete;
  const next = await open(day);
  emit(old, "range-save", { input: { periodId: "p1", startsAt: "10:00", endsAt: "19:00" } });
  emit(old, "range-delete", {});
  emit(old, "range-close", {});
  emit(old, "range-new-period", {});
  await day.updateComplete;
  expect(day.shadowRoot!.querySelector("range-dialog")).toBe(next);
  expect(day.shadowRoot!.querySelector("period-editor")).toBeNull();
  expect(grid(day).columns[0]!.slots[0]!.endsAt).toBe("14:00");
});
it("ignores malformed grid indexes and dispatched disabled actions", async () => {
  const writes: unknown[] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  });
  save(day).dispatchEvent(new MouseEvent("click"));
  emit(grid(day), "grid-block-open", { columnKey: "d1", index: 999 });
  emit(grid(day), "grid-block-change", {
    columnKey: "disabled",
    index: 0,
    startsAt: "10:00",
    endsAt: "19:00",
  });
  emit(grid(day), "grid-block-change", {
    columnKey: "d1",
    index: 999,
    startsAt: "10:00",
    endsAt: "19:00",
  });
  await day.updateComplete;
  const range = await open(day);
  save(day).dispatchEvent(new MouseEvent("click"));
  day.shadowRoot!.querySelector("[data-test=next-day]")!.dispatchEvent(new MouseEvent("click"));
  emit(grid(day), "grid-block-open", { columnKey: "d1", index: 0 });
  resize(day);
  emit(range, "range-delete", {});
  await day.updateComplete;
  expect(writes).toEqual([]);
  expect(day.shadowRoot!.querySelector("range-dialog")).toBe(range);
  expect(grid(day).columns[0]!.slots[0]!.endsAt).toBe("14:00");
});
it.each(["success", "refusal"])(
  "does not apply a late %s to the reconnected Day draft or continue its request sequence",
  async (outcome) => {
    let done!: () => void, fail!: (error: unknown) => void;
    const writes: unknown[] = [];
    const day = await mount(async (...args) => {
      writes.push(args);
      await new Promise<void>((resolve, reject) => {
        done = resolve;
        fail = reject;
      });
    });
    resize(day);
    resize(day, "d2", "19:00");
    await day.updateComplete;
    save(day).click();
    await expect.poll(() => done).toBeTypeOf("function");
    await day.updateComplete;
    expect(grid(day).columns.every((c) => !c.editable)).toBe(true);
    save(day).dispatchEvent(new MouseEvent("click"));
    resize(day, "d2", "20:00");
    const parent = day.parentNode!;
    day.remove();
    parent.appendChild(day);
    await day.updateComplete;
    if (outcome === "success") done();
    else fail({ code: "menu_timetable.invalid", params: { field: "days.1.slots" } });
    await expect.poll(() => save(day).disabled).toBe(false);
    expect(writes).toHaveLength(1);
    expect(grid(day).columns[1]!.slots[0]!.endsAt).toBe("19:00");
    expect(
      day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).toBe("");
  },
);
it("shows a named-day clock-gap refusal beside its department with an independent bottom summary", async () => {
  vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
  const day = await mount(async () => {
    throw {
      code: "menu_timetable.invalid",
      params: { field: "slots.0.endsAt", reason: "clock_skips" },
    };
  });
  emit(grid(day), "grid-block-change", {
    columnKey: "d1",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  await day.updateComplete;
  save(day).click();
  await expect
    .poll(() => day.shadowRoot!.querySelector("[data-department-error=d1]"))
    .not.toBeNull();
  expect(day.shadowRoot!.querySelector("[data-department-error=d1]")!.textContent).toBe(
    "The clock skips this time on this date.",
  );
  expect(
    day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("Correct the highlighted fields to continue.");
  expect(save(day).disabled).toBe(false);
});
it.each([
  {},
  { code: "menu_timetable.invalid", params: { field: "days.2.slots" } },
  { code: "menu_timetable.invalid", params: { field: null } },
])("keeps refusals naming no shown field in the bottom message (%j)", async (refusal) => {
  const day = await mount(async () => {
    throw refusal;
  });
  resize(day);
  await day.updateComplete;
  save(day).click();
  await expect
    .poll(
      () =>
        day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
          .error,
    )
    .toBe("This could not be saved. Try again.");
  expect(day.shadowRoot!.querySelector("[data-department-error]")).toBeNull();
});
it("updates a clean model, preserves dirty drafts across disabled departments and reads Spanish recurrence", async () => {
  setLocale("es");
  const day = await mount();
  expect(day.shadowRoot!.textContent).toContain("Cambia cada lunes");
  const model = {
    ...day.model,
    departments: day.model.departments.map((department, i) =>
      i === 0
        ? {
            ...department,
            week: department.week.map((row) => ({
              ...row,
              slots: row.slots.map((slot) => ({ ...slot, endsAt: "16:00" })),
            })),
          }
        : department,
    ),
  };
  day.model = model;
  await day.updateComplete;
  expect(grid(day).columns[0]!.slots[0]!.endsAt).toBe("16:00");
  expect(save(day).disabled).toBe(true);
  resize(day);
  await day.updateComplete;
  day.model = { ...model, departments: model.departments.map((d) => ({ ...d, active: false })) };
  await day.updateComplete;
  expect(grid(day).columns.map((c) => c.key)).toEqual(["d1", "d2"]);
  expect(save(day).disabled).toBe(false);
});
it("shows an empty department state and recovers from an unreadable timezone", async () => {
  const model = { ...dayFixture(), timeZone: "bad/timezone", departments: [] };
  const day = await mount(undefined, model);
  expect(grid(day)).toBeNull();
  expect(save(day)).toBeNull();
  day.model = { ...model, timeZone: "UTC" };
  await day.updateComplete;
  expect(day.shadowRoot!.textContent).toContain("No departments yet.");
  expect(save(day)).toBeNull();
});

it("explains an offset timetable refusal beside its department and retains the retryable draft", async () => {
  const day = await mount(async () => {
    throw {
      code: "menu_timetable.invalid",
      params: { field: "days.1.slots.0.endsAt", reason: "end_offset", periodId: "p1" },
    };
  });
  resize(day);
  await day.updateComplete;
  const submitted = structuredClone(grid(day).columns[0]!.slots);
  save(day).click();
  await expect
    .poll(() => day.shadowRoot!.querySelector("[data-department-error=d1]")?.textContent)
    .toBe("Change this period’s end offset to fit these time ranges.");
  expect(grid(day).columns[0]!.slots).toEqual(submitted);
  expect(save(day).disabled).toBe(false);
});

it("keeps a created period's signed offset in its wire body and department range choice", async () => {
  const writes: unknown[] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
    return { id: "late" };
  });
  const { range, period } = await newPeriod(day);
  for (const [name, value] of [
    ["name", "Tea"],
    ["menuId", "m1"],
    ["endOffsetMinutes", "+14"],
  ])
    emit(period.shadowRoot!.querySelector(`[name=${name}]`)!, "wt-change", { value });
  await period.updateComplete;
  period.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect.poll(() => day.shadowRoot!.querySelector("period-editor")).toBeNull();
  await range.updateComplete;
  expect(writes).toEqual([
    [
      "/management-api/venue-service/departments/d1/menu-periods",
      "POST",
      { name: "Tea", colour: "red", menuId: "m1", staffMenuIds: [], endOffsetMinutes: 14 },
    ],
  ]);
  expect(
    range.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=periodId]")!.value,
  ).toBe("late");
});

it("applies an old repeating named day's own hours on the later occurrence", async () => {
  vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
  const model = dayFixture();
  model.namedDays = [
    { ...model.namedDays[0]!, date: "2025-10-13", kind: "holiday", repeats: true, ownHours: true },
  ];
  const writes: unknown[] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  }, model);
  expect(grid(day).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "12:00", endsAt: "16:00" },
  ]);
  emit(grid(day), "grid-block-change", {
    columnKey: "d1",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  await day.updateComplete;
  save(day).click();
  await expect
    .poll(() => writes)
    .toEqual([
      [
        "/management-api/venue-service/special-dates/s%2F1/menu-timetables/d1",
        "PUT",
        { slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "17:00" }] },
      ],
    ]);
});

it.each([true, false])(
  "saves the normal week for a named day without own hours (repeats: %s)",
  async (repeats) => {
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
    const model = dayFixture();
    model.namedDays = [
      {
        ...model.namedDays[0]!,
        date: repeats ? "2025-10-13" : "2026-10-13",
        repeats,
        ownHours: false,
      },
    ];
    model.departments[0]!.dates = [];
    const writes: unknown[] = [];
    const day = await mount(async (...args) => {
      writes.push(args);
    }, model);
    expect(day.shadowRoot!.querySelector("[data-test=day-date]")!.textContent).toContain("Party");
    expect(grid(day).columns[0]!.slots).toEqual([
      { periodId: "p1", startsAt: "11:00", endsAt: "15:00" },
    ]);
    emit(grid(day), "grid-block-change", {
      columnKey: "d1",
      index: 0,
      startsAt: "11:00",
      endsAt: "17:00",
    });
    await day.updateComplete;
    save(day).click();
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/departments/d1/menu-week",
          "PUT",
          {
            days: [
              { weekday: 0, slots: [] },
              { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
              { weekday: 2, slots: [{ periodId: "p1", startsAt: "11:00", endsAt: "17:00" }] },
              { weekday: 3, slots: [] },
              { weekday: 4, slots: [] },
              { weekday: 5, slots: [] },
              { weekday: 6, slots: [] },
            ],
          },
        ],
      ]);
    expect(day.shadowRoot!.textContent).toContain("Changes every Tuesday");
  },
);

it("ignores retained dated rows when the named day follows the normal week", async () => {
  vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
  const model = dayFixture();
  model.namedDays = [{ ...model.namedDays[0]!, ownHours: false }];
  const day = await mount(undefined, model);
  expect(grid(day).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "11:00", endsAt: "15:00" },
  ]);
});

it("shows a normal-week field refusal beside the department on a repeating named day", async () => {
  vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
  const model = dayFixture();
  model.namedDays = [
    { ...model.namedDays[0]!, date: "2025-10-13", repeats: true, ownHours: false },
  ];
  model.departments[0]!.dates = [];
  const day = await mount(async () => {
    throw { code: "menu_timetable.invalid", params: { field: "days.2.slots.0.endsAt" } };
  }, model);
  emit(grid(day), "grid-block-change", {
    columnKey: "d1",
    index: 0,
    startsAt: "11:00",
    endsAt: "17:00",
  });
  await day.updateComplete;
  save(day).click();
  await expect
    .poll(() => day.shadowRoot!.querySelector("[data-department-error=d1]")?.textContent)
    .toContain("Check this day");
});

it("uses the later occurrence's date for a repeating named day's clock warning", async () => {
  vi.setSystemTime(new Date("2027-10-30T10:00:00Z"));
  const model = dayFixture();
  model.namedDays = [{ ...model.namedDays[0]!, date: "2026-10-30", repeats: true, ownHours: true }];
  const day = await mount(undefined, model);
  const range = await open(day);
  emit(range.shadowRoot!.querySelector("[name=startsAt]")!, "wt-change", { value: "02:00" });
  emit(range.shadowRoot!.querySelector("[name=endsAt]")!, "wt-change", { value: "03:00" });
  await range.updateComplete;
  expect(range.shadowRoot!.querySelector("[data-test=repeat-note]")?.textContent).toContain(
    "02:00",
  );
  expect(range.businessDate).toBe("2027-10-30");
});
