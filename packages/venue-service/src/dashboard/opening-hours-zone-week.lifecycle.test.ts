import { afterEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import { realWeekModel } from "../testing/real-week-model.js";
import "./opening-hours-zone-week.js";

let week: HTMLElementTagNameMap["opening-hours-zone-week"];
afterEach(() => {
  week?.remove();
  setLocale("en");
});
async function mount(real = false, refusal?: unknown) {
  setLocale("en");
  const data = realWeekModel();
  const writes: unknown[][] = [];
  week = document.createElement("opening-hours-zone-week");
  week.department = data.departments[0]!;
  week.zone = week.department.zones[0]!;
  week.namedDays = data.namedDays;
  week.weekStart = real ? "2026-10-12" : "";
  week.api = new OpeningHoursApi((async (path, method, body) => {
    if (method === "GET") return data;
    writes.push([path, method, body]);
    if (refusal) throw refusal;
  }) as DashboardRequest);
  applyTokens(week);
  document.body.append(week);
  await week.updateComplete;
  return writes;
}
const grid = () => week.shadowRoot!.querySelector("service-grid")!;
const emit = (target: Element, name: string, detail: unknown = {}) =>
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
const ranges = (day = "2") => grid().columns.find((column) => column.key === day)!.closed;
async function open() {
  emit(grid(), "grid-block-open", { columnKey: "2", index: 0 });
  await week.updateComplete;
  const dialog = week.shadowRoot!.querySelector("range-dialog")!;
  await dialog.updateComplete;
  return dialog;
}

it("cancelling a range retains its hours and rejects events from that departed dialog", async () => {
  const writes = await mount();
  const old = await open();
  emit(old, "range-close");
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("range-dialog")).toBeNull();
  const current = await open();
  emit(old, "range-save", { input: { startsAt: "20:00", endsAt: "06:00" } });
  emit(old, "range-delete");
  emit(old, "range-close");
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("range-dialog")).toBe(current);
  expect(ranges()).toEqual([{ startsAt: "22:00", endsAt: "06:00" }]);
  expect(writes).toEqual([]);
});

it("a range dialog blocks grid changes, and becoming read-only blocks its retained Save and Delete", async () => {
  const writes = await mount();
  const dialog = await open();
  emit(grid(), "grid-range-select", { columnKey: "2", startsAt: "12:00", endsAt: "13:00" });
  emit(grid(), "grid-block-change", {
    columnKey: "2",
    index: 0,
    startsAt: "20:00",
    endsAt: "06:00",
  });
  emit(grid(), "grid-block-open", { columnKey: "2", index: 0 });
  week.readOnly = true;
  await week.updateComplete;
  emit(dialog, "range-save", { input: { startsAt: "20:00", endsAt: "06:00" } });
  emit(dialog, "range-delete");
  await week.updateComplete;
  expect(ranges()).toEqual([{ startsAt: "22:00", endsAt: "06:00" }]);
  expect(writes).toEqual([]);
});

it("editing one of two ranges preserves the other, sorts by the business day and deletes only the chosen range", async () => {
  await mount();
  emit(grid(), "grid-range-select", { columnKey: "2", startsAt: "10:00", endsAt: "11:00" });
  await week.updateComplete;
  emit(grid(), "grid-block-open", { columnKey: "2", index: 1 });
  await week.updateComplete;
  const dialog = week.shadowRoot!.querySelector("range-dialog")!;
  emit(dialog, "range-save", { input: { startsAt: "23:00", endsAt: "06:00" } });
  await week.updateComplete;
  expect(ranges()).toEqual([
    { startsAt: "10:00", endsAt: "11:00" },
    { startsAt: "23:00", endsAt: "06:00" },
  ]);
  emit(grid(), "grid-block-open", { columnKey: "2", index: 1 });
  await week.updateComplete;
  emit(week.shadowRoot!.querySelector("range-dialog")!, "range-delete");
  await week.updateComplete;
  expect(ranges()).toEqual([{ startsAt: "10:00", endsAt: "11:00" }]);
});

it.each(["cancel", "close"])(
  "%s abandons a copy selection and its departed controls cannot alter the reopened copy",
  async (kind) => {
    const writes = await mount();
    const trigger = week.shadowRoot!.querySelector<HTMLElement>(
      "[data-test=copy-day][data-day='2']",
    )!;
    trigger.click();
    await week.updateComplete;
    const old = week.shadowRoot!.querySelector("wt-modal")!;
    const check = old.querySelector<HTMLInputElement>("[name=copyDay1]")!;
    check.checked = true;
    check.dispatchEvent(new Event("change"));
    await week.updateComplete;
    check.checked = false;
    check.dispatchEvent(new Event("change"));
    await week.updateComplete;
    expect(
      old.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm-copy]")!.disabled,
    ).toBe(true);
    if (kind === "cancel") old.querySelector<HTMLElement>("[slot=cancel]")!.click();
    else emit(old, "wt-close");
    await week.updateComplete;
    expect(week.shadowRoot!.querySelector("wt-modal")).toBeNull();
    trigger.click();
    await week.updateComplete;
    const current = week.shadowRoot!.querySelector("wt-modal")!;
    check.checked = true;
    check.dispatchEvent(new Event("change"));
    old
      .querySelector<HTMLElement>("[data-test=confirm-copy]")!
      .dispatchEvent(new MouseEvent("click"));
    emit(old, "wt-close");
    await week.updateComplete;
    expect(week.shadowRoot!.querySelector("wt-modal")).toBe(current);
    expect(
      current.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm-copy]")!
        .disabled,
    ).toBe(true);
    expect(ranges("1")).toEqual([]);
    expect(writes).toEqual([]);
  },
);

it("copying blocks grid edits and a retained confirmation cannot copy after access becomes read-only", async () => {
  const writes = await mount();
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=copy-day][data-day='2']")!.click();
  await week.updateComplete;
  const check = week.shadowRoot!.querySelector<HTMLInputElement>("[name=copyDay1]")!;
  check.checked = true;
  check.dispatchEvent(new Event("change"));
  emit(grid(), "grid-range-select", { columnKey: "1", startsAt: "10:00", endsAt: "11:00" });
  emit(grid(), "grid-block-change", {
    columnKey: "2",
    index: 0,
    startsAt: "20:00",
    endsAt: "06:00",
  });
  emit(grid(), "grid-block-open", { columnKey: "2", index: 0 });
  week.readOnly = true;
  await week.updateComplete;
  week
    .shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-copy]")!
    .dispatchEvent(new MouseEvent("click"));
  await week.updateComplete;
  expect(ranges("1")).toEqual([]);
  expect(ranges()).toEqual([{ startsAt: "22:00", endsAt: "06:00" }]);
  expect(week.shadowRoot!.querySelector("range-dialog")).toBeNull();
  expect(writes).toEqual([]);
});

it.each(["ranges.0.endsAt", "specialDateId"])(
  "a dated refusal for %s marks its day and retains retry",
  async (field) => {
    const writes = await mount(true, { code: "zone_closed_time.invalid", params: { field } });
    emit(grid(), "grid-block-change", {
      columnKey: "2",
      index: 0,
      startsAt: "22:00",
      endsAt: "06:00",
    });
    await week.updateComplete;
    const save = week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-date][data-day='2']",
    )!;
    save.click();
    await expect
      .poll(() => week.shadowRoot!.querySelector("[data-day-error='2']")?.textContent)
      .toContain("These closed times overlap");
    expect(save.disabled).toBe(false);
    expect(ranges()).toEqual([{ startsAt: "22:00", endsAt: "06:00" }]);
    expect(writes).toEqual([
      [
        "/management-api/venue-service/special-dates/annual%2Fday/zone-closed-times/z1",
        "PUT",
        { ranges: [{ startsAt: "22:00", endsAt: "06:00" }] },
      ],
    ]);
  },
);

it("a clean dated snapshot can retire an own-hours Save and offers the existing day's own-hours editor", async () => {
  await mount(true);
  week.namedDays = week.namedDays.map((day) => ({ ...day, ownHours: false }));
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("[data-test=save-date]")).toBeNull();
  const events: unknown[] = [];
  week.addEventListener("named-calendar-action", (event) =>
    events.push((event as CustomEvent).detail),
  );
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=own-date][data-day='2']")!.click();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: "own", date: "2026-10-13", day: { id: "annual/day" } });
});

it("a real week ignores range events for plain and whole-venue-closed dates", async () => {
  const writes = await mount(true);
  const before = structuredClone(grid().columns);
  for (const columnKey of ["1", "4"]) {
    emit(grid(), "grid-range-select", { columnKey, startsAt: "10:00", endsAt: "11:00" });
    emit(grid(), "grid-block-open", { columnKey, index: 0 });
    emit(grid(), "grid-block-change", { columnKey, index: 0, startsAt: "10:00", endsAt: "11:00" });
  }
  await week.updateComplete;
  expect(grid().columns).toEqual(before);
  expect(week.shadowRoot!.querySelector("range-dialog")).toBeNull();
  expect(writes).toEqual([]);
});

it("a resized range preserves its neighbour and ignores events for a range that no longer exists", async () => {
  const writes = await mount();
  emit(grid(), "grid-range-select", { columnKey: "2", startsAt: "10:00", endsAt: "11:00" });
  await week.updateComplete;
  emit(grid(), "grid-block-change", {
    columnKey: "2",
    index: 1,
    startsAt: "23:00",
    endsAt: "06:00",
  });
  await week.updateComplete;
  expect(ranges()).toEqual([
    { startsAt: "10:00", endsAt: "11:00" },
    { startsAt: "23:00", endsAt: "06:00" },
  ]);
  for (const columnKey of ["2", "departed"]) {
    emit(grid(), "grid-block-open", { columnKey, index: 99 });
    emit(grid(), "grid-block-change", { columnKey, index: 99, startsAt: "20:00", endsAt: "06:00" });
  }
  emit(grid(), "grid-range-select", { columnKey: "departed", startsAt: "12:00", endsAt: "13:00" });
  await week.updateComplete;
  expect(ranges()).toEqual([
    { startsAt: "10:00", endsAt: "11:00" },
    { startsAt: "23:00", endsAt: "06:00" },
  ]);
  expect(week.shadowRoot!.querySelector("range-dialog")).toBeNull();
  expect(writes).toEqual([]);
});
