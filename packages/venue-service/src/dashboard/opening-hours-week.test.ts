import { afterEach, beforeEach, expect, it } from "vitest";
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
  history.replaceState(null, "", "/manage/opening-hours");
});
afterEach(() => {
  screen?.remove();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
export function fixture(): OpeningHoursModel {
  return {
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    specialDates: [],
    menus: [{ id: "m1", name: "Lunch menu", active: true, includes: [] }],
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
          },
        ],
        week: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          slots: weekday === 1 ? [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] : [],
        })),
        dates: [],
      },
    ],
  };
}
async function mount(
  write?: (url: string, method: string, body: unknown) => Promise<unknown>,
  readOnly = false,
  model = fixture(),
) {
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.readOnly = readOnly;
  screen.api = new OpeningHoursApi((async (url, method, body) =>
    method === "GET" ? model : write?.(url, method, body)) as DashboardRequest);
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("wt-tabs")).not.toBeNull();
  await screen.updateComplete;
  const week = screen.shadowRoot!.querySelector("opening-hours-week") as LitElement;
  expect(week, "normal week editor").not.toBeNull();
  await week.updateComplete;
  return week;
}
const grid = (week: LitElement) =>
  week.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!;
function emit(target: Element, name: string, detail: unknown) {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function range(week: LitElement, index?: number) {
  emit(
    grid(week),
    index === undefined ? "grid-range-select" : "grid-block-open",
    index === undefined
      ? { columnKey: "2", startsAt: "11:00", endsAt: "15:00" }
      : { columnKey: "1", index },
  );
  await week.updateComplete;
  const dialog =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
  expect(dialog).not.toBeNull();
  await dialog.updateComplete;
  return dialog;
}
async function add(week: LitElement) {
  const dialog = await range(week);
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-change", { value: "p1" });
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
}
it("draws Monday through Sunday with saved periods and a quiet unchanged Save", async () => {
  const week = await mount();
  expect(grid(week).columns.map((c) => c.key)).toEqual(["1", "2", "3", "4", "5", "6", "0"]);
  expect(grid(week).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "10:00", endsAt: "14:00" },
  ]);
  const save =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!;
  expect(save.disabled).toBe(true);
  expect(save.variant).toBe("secondary");
});
it("stages an added range and submits the seven days together only on Save", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (url, method, body) => {
    writes.push({ url, method, body });
  });
  await add(week);
  expect(writes).toEqual([]);
  expect(grid(week).columns[1]!.slots).toEqual([
    { periodId: "p1", startsAt: "11:00", endsAt: "15:00" },
  ]);
  const save =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!;
  expect(save.disabled).toBe(false);
  expect(save.variant).toBe("primary");
  save.click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    url: "/management-api/venue-service/departments/d1/menu-week",
    method: "PUT",
    body: {
      days: [
        { weekday: 0, slots: [] },
        { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
        { weekday: 2, slots: [{ periodId: "p1", startsAt: "11:00", endsAt: "15:00" }] },
        { weekday: 3, slots: [] },
        { weekday: 4, slots: [] },
        { weekday: 5, slots: [] },
        { weekday: 6, slots: [] },
      ],
    },
  });
  await expect.poll(() => save.disabled).toBe(true);
});
it("stages resize and delete without issuing requests", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  });
  emit(grid(week), "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "10:00",
    endsAt: "14:30",
  });
  await week.updateComplete;
  expect(grid(week).columns[0]!.slots[0]!.endsAt).toBe("14:30");
  const dialog = await range(week, 0);
  expect(dialog.deletable).toBe(true);
  expect(dialog.range.endsAt).toBe("14:30");
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-range]")!.click();
  await week.updateComplete;
  expect(grid(week).columns[0]!.slots).toEqual([]);
  expect(writes).toEqual([]);
});
it("refuses writes and range openings for a viewer", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  }, true);
  expect(grid(week).columns.every((c) => !c.editable)).toBe(true);
  expect(week.shadowRoot!.querySelector("[data-test=save-week]")).toBeNull();
  emit(grid(week), "grid-range-select", { columnKey: "2", startsAt: "11:00", endsAt: "15:00" });
  emit(grid(week), "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "10:00",
    endsAt: "15:00",
  });
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("range-dialog")).toBeNull();
  expect(grid(week).columns[0]!.slots[0]!.endsAt).toBe("14:00");
  expect(writes).toEqual([]);
});
it("keeps a refused draft retryable and marks the day carried by its field", async () => {
  let fail = true;
  const week = await mount(async () => {
    if (fail) throw { code: "menu_timetable.invalid", params: { field: "days.2.slots" } };
  });
  await add(week);
  const save =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!;
  save.click();
  await expect.poll(() => week.shadowRoot!.querySelector("[data-test=week-error]")).not.toBeNull();
  expect(week.shadowRoot!.querySelector("[data-day-error='2']")?.textContent).toContain("Tuesday");
  expect(save.disabled).toBe(false);
  expect(grid(week).columns[1]!.slots).toHaveLength(1);
  fail = false;
  save.click();
  await expect.poll(() => save.disabled).toBe(true);
});
it("returns from New period with the range times intact and the created period selected", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (url, method, body) => {
    writes.push({ url, method, body });
    return { id: "p2" };
  });
  const dialog = await range(week);
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", {
    value: "new",
  });
  await week.updateComplete;
  const period =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["period-editor"]>("period-editor")!;
  expect(period).not.toBeNull();
  await period.updateComplete;
  expect(dialog.busy).toBe(true);
  emit(period.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Tea" });
  emit(period.shadowRoot!.querySelector("[name=menuId]")!, "wt-change", { value: "m1" });
  await period.updateComplete;
  period.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect.poll(() => week.shadowRoot!.querySelector("period-editor")).toBeNull();
  await dialog.updateComplete;
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=startsAt]")!.value,
  ).toBe("11:00");
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=periodId]")!
      .value,
  ).toBe("p2");
  expect(dialog.busy).toBe(false);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    url: "/management-api/venue-service/departments/d1/menu-periods",
    method: "POST",
  });
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
  expect(grid(week).columns[1]!.slots).toEqual([
    { periodId: "p2", startsAt: "11:00", endsAt: "15:00" },
  ]);
});
it("copies a day to chosen weekdays and clears locally", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  });
  const copy = week.shadowRoot!.querySelector<HTMLElement>("[data-test=copy-day][data-day='1']");
  expect(copy).not.toBeNull();
  copy!.click();
  await week.updateComplete;
  const checkbox = week.shadowRoot!.querySelector<HTMLInputElement>("[name=copyDay2]")!;
  expect(checkbox).not.toBeNull();
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  await week.updateComplete;
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-copy]")!.click();
  await week.updateComplete;
  expect(grid(week).columns[1]!.slots).toEqual([
    { periodId: "p1", startsAt: "10:00", endsAt: "14:00" },
  ]);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=clear-day][data-day='1']")!.click();
  await week.updateComplete;
  expect(grid(week).columns[0]!.slots).toEqual([]);
  expect(grid(week).columns[1]!.slots).toHaveLength(1);
  expect(writes).toEqual([]);
});
it("cancelling New period keeps the proposed range without creating anything", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  });
  const dialog = await range(week);
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", {
    value: "new",
  });
  await week.updateComplete;
  const period =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["period-editor"]>("period-editor")!;
  await period.updateComplete;
  const modal = period.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
  await modal.requestClose("cancel");
  await week.updateComplete;
  await dialog.updateComplete;
  await expect.poll(() => week.shadowRoot!.querySelector("period-editor")).toBeNull();
  await dialog.updateComplete;
  expect(dialog.busy).toBe(false);
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=endsAt]")!.value,
  ).toBe("15:00");
  expect(writes).toEqual([]);
});
it("keeps a resized draft when a background snapshot arrives", async () => {
  const week = await mount();
  emit(grid(week), "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "10:00",
    endsAt: "16:00",
  });
  await week.updateComplete;
  screen.api.rereadWatches();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await screen.updateComplete;
  await week.updateComplete;
  expect(grid(week).columns[0]!.slots[0]!.endsAt).toBe("16:00");
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!
      .disabled,
  ).toBe(false);
});
it("ignores departed range controls after a new range opens", async () => {
  const week = await mount();
  const old = await range(week);
  emit(old, "range-close", {});
  await week.updateComplete;
  const next = await range(week, 0);
  emit(old, "range-save", { input: { startsAt: "09:00", endsAt: "18:00", periodId: "p1" } });
  emit(old, "range-delete", {});
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("range-dialog")).toBe(next);
  expect(grid(week).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "10:00", endsAt: "14:00" },
  ]);
});
it("does not mark a reconnected draft saved by a reply begun before removal", async () => {
  let resolve!: () => void;
  const week = await mount(
    async () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await add(week);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
  await expect.poll(() => typeof resolve).toBe("function");
  const parent = screen.parentNode!;
  screen.remove();
  parent.appendChild(screen);
  await screen.updateComplete;
  await week.updateComplete;
  resolve();
  await expect
    .poll(
      () =>
        week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!
          .disabled,
    )
    .toBe(false);
  expect(grid(week).columns[1]!.slots).toEqual([
    { periodId: "p1", startsAt: "11:00", endsAt: "15:00" },
  ]);
});
it("treats the same range values as unchanged regardless of object key order", async () => {
  const week = await mount();
  const dialog = await range(week, 0);
  emit(dialog, "range-save", { input: { startsAt: "10:00", endsAt: "14:00", periodId: "p1" } });
  await week.updateComplete;
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!
      .disabled,
  ).toBe(true);
});
it("makes no request when an unchanged Save handler receives a dispatched click", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
  });
  week
    .shadowRoot!.querySelector("[data-test=save-week]")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await week.updateComplete;
  expect(writes).toEqual([]);
});
it("holds the staged save and grid during an outstanding request", async () => {
  let release!: () => void;
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  await add(week);
  const save =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!;
  save.click();
  await week.updateComplete;
  expect(save.disabled).toBe(true);
  expect(grid(week).columns.every((column) => !column.editable)).toBe(true);
  save.dispatchEvent(new MouseEvent("click"));
  emit(grid(week), "grid-range-select", { columnKey: "3", startsAt: "09:00", endsAt: "12:00" });
  emit(grid(week), "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "10:00",
    endsAt: "16:00",
  });
  week
    .shadowRoot!.querySelector("[data-test=clear-day][data-day='1']")!
    .dispatchEvent(new MouseEvent("click"));
  await week.updateComplete;
  expect(writes).toHaveLength(1);
  expect(week.shadowRoot!.querySelector("range-dialog")).toBeNull();
  expect(grid(week).columns[0]!.slots[0]!.endsAt).toBe("14:00");
  release();
  await expect.poll(() => save.disabled).toBe(true);
});
it("keeps a failed nested period retryable without losing its range", async () => {
  let fail = true;
  const week = await mount(async () => {
    if (fail) throw { code: "menu_period.invalid", params: { field: "name" } };
    return { id: "p2" };
  });
  const dialog = await range(week);
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", {
    value: "new",
  });
  await week.updateComplete;
  const period =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["period-editor"]>("period-editor")!;
  await period.updateComplete;
  emit(period.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Tea" });
  emit(period.shadowRoot!.querySelector("[name=menuId]")!, "wt-change", { value: "m1" });
  await period.updateComplete;
  const save =
    period.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-period]",
    )!;
  save.click();
  await expect.poll(() => period.refusal?.code).toBe("menu_period.invalid");
  expect(save.disabled).toBe(false);
  expect(dialog.range.startsAt).toBe("11:00");
  fail = false;
  save.click();
  await expect.poll(() => week.shadowRoot!.querySelector("period-editor")).toBeNull();
});
it("replaces an existing range after editing and returns to quiet when undone", async () => {
  const week = await mount();
  let dialog = await range(week, 0);
  emit(dialog.shadowRoot!.querySelector("[name=startsAt]")!, "wt-change", { value: "10:15" });
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
  expect(grid(week).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "10:15", endsAt: "14:00" },
  ]);
  dialog = await range(week, 0);
  emit(dialog.shadowRoot!.querySelector("[name=startsAt]")!, "wt-change", { value: "10:00" });
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!
      .disabled,
  ).toBe(true);
});
it("requires a destination and keeps the week unchanged when copying is cancelled", async () => {
  const week = await mount();
  const copy = () =>
    week.shadowRoot!.querySelector<HTMLElement>("[data-test=copy-day][data-day='1']")!.click();
  copy();
  await week.updateComplete;
  const confirm = week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=confirm-copy]",
  )!;
  expect(confirm.disabled).toBe(true);
  confirm.dispatchEvent(new MouseEvent("click"));
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  const checkbox = week.shadowRoot!.querySelector<HTMLInputElement>("[name=copyDay2]")!;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  await week.updateComplete;
  expect(confirm.disabled).toBe(false);
  checkbox.checked = false;
  checkbox.dispatchEvent(new Event("change"));
  await week.updateComplete;
  expect(confirm.disabled).toBe(true);
  week.shadowRoot!.querySelector<HTMLElement>("wt-modal wt-button[slot=cancel]")!.click();
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(grid(week).columns[1]!.slots).toEqual([]);
  copy();
  await week.updateComplete;
  const modal = week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
  await modal.updateComplete;
  await modal.requestClose("escape");
  await expect.poll(() => week.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!
      .disabled,
  ).toBe(true);
});
it("closes an untouched range through its native Cancel", async () => {
  const week = await mount();
  const dialog = await range(week);
  const modal = dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
  await modal.updateComplete;
  await modal.requestClose("cancel");
  await expect.poll(() => week.shadowRoot!.querySelector("range-dialog")).toBeNull();
  expect(grid(week).columns[1]!.slots).toEqual([]);
});
it("rejects a nested creation reply from before reconnect", async () => {
  let release!: (value: { id: string }) => void;
  const week = await mount(
    async () =>
      new Promise<{ id: string }>((resolve) => {
        release = resolve;
      }),
  );
  const dialog = await range(week);
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", {
    value: "new",
  });
  await week.updateComplete;
  const period =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["period-editor"]>("period-editor")!;
  await period.updateComplete;
  emit(period.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Tea" });
  emit(period.shadowRoot!.querySelector("[name=menuId]")!, "wt-change", { value: "m1" });
  await period.updateComplete;
  period.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect.poll(() => typeof release).toBe("function");
  const parent = screen.parentNode!;
  screen.remove();
  parent.appendChild(screen);
  await screen.updateComplete;
  await week.updateComplete;
  release({ id: "p2" });
  await expect.poll(() => period.busy).toBe(false);
  expect(week.shadowRoot!.querySelector("period-editor")).toBe(period);
  expect(dialog.periods.some((p) => p.id === "p2")).toBe(false);
  expect(dialog.range.startsAt).toBe("11:00");
});
it("shows a request fault without guessing a day and retains it across a reread", async () => {
  const week = await mount(async () => {
    throw new Error("offline");
  });
  await add(week);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
  const actions =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!;
  await expect.poll(() => actions.error).toBe("This could not be saved. Try again.");
  expect(week.shadowRoot!.querySelector("[data-day-error]")).toBeNull();
  screen.api.rereadWatches();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await week.updateComplete;
  expect(actions.error).toBe("This could not be saved. Try again.");
});
it("inserts a second range in business-day order", async () => {
  const week = await mount();
  emit(grid(week), "grid-range-select", { columnKey: "1", startsAt: "07:00", endsAt: "09:00" });
  await week.updateComplete;
  const dialog =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
  await dialog.updateComplete;
  expect(dialog.occupied).toEqual([{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }]);
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-change", { value: "p1" });
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
  expect(grid(week).columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "07:00", endsAt: "09:00" },
    { periodId: "p1", startsAt: "10:00", endsAt: "14:00" },
  ]);
});
it("ignores grid indices for a block already cleared", async () => {
  const week = await mount();
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=clear-day][data-day='1']")!.click();
  await week.updateComplete;
  emit(grid(week), "grid-block-open", { columnKey: "1", index: 0 });
  emit(grid(week), "grid-block-open", { columnKey: "missing", index: 0 });
  emit(grid(week), "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "10:00",
    endsAt: "15:00",
  });
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("range-dialog")).toBeNull();
  expect(grid(week).columns[0]!.slots).toEqual([]);
});
it("does not show a departed save refusal after reconnect", async () => {
  let reject!: (error: unknown) => void;
  const week = await mount(
    async () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  await add(week);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
  await expect.poll(() => typeof reject).toBe("function");
  const parent = screen.parentNode!;
  screen.remove();
  parent.appendChild(screen);
  await screen.updateComplete;
  await week.updateComplete;
  reject({ code: "menu_timetable.invalid", params: { field: "days.2.slots" } });
  const save =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!;
  await expect.poll(() => save.disabled).toBe(false);
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("");
});
it("departed nested-period buttons cannot create again after cancellation", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
    return { id: "p2" };
  });
  const dialog = await range(week);
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", {
    value: "new",
  });
  await week.updateComplete;
  const old =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["period-editor"]>("period-editor")!;
  await old.updateComplete;
  emit(old, "period-close", {});
  await week.updateComplete;
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", {
    value: "new",
  });
  await week.updateComplete;
  emit(old, "period-save", {
    periodId: null,
    input: { name: "Tea", menuId: "m1", staffMenuIds: [] },
  });
  await week.updateComplete;
  expect(writes).toEqual([]);
  expect(week.shadowRoot!.querySelector("period-editor")).not.toBe(old);
});
it("freezes grid edits while the copy chooser is open", async () => {
  const week = await mount();
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=copy-day][data-day='1']")!.click();
  await week.updateComplete;
  expect(grid(week).columns.every((column) => !column.editable)).toBe(true);
  emit(grid(week), "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "10:00",
    endsAt: "16:00",
  });
  emit(grid(week), "grid-range-select", { columnKey: "2", startsAt: "09:00", endsAt: "10:00" });
  await week.updateComplete;
  expect(grid(week).columns[0]!.slots[0]!.endsAt).toBe("14:00");
  expect(week.shadowRoot!.querySelector("range-dialog")).toBeNull();
});
it("places a day refusal in that day's header with a different bottom summary", async () => {
  const week = await mount(async () => {
    throw { code: "menu_timetable.invalid", params: { field: "days.2.slots" } };
  });
  await add(week);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
  await expect.poll(() => week.shadowRoot!.querySelector("[data-day-error='2']")).not.toBeNull();
  const error = week.shadowRoot!.querySelector("[data-day-error='2']")!;
  expect(error.closest('[slot="header-2"]')).not.toBeNull();
  expect(error.textContent).toContain("Check this day's time ranges and periods.");
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe("Correct the highlighted fields to continue.");
});
it("departed copy controls cannot alter a reopened chooser", async () => {
  const week = await mount();
  const button = week.shadowRoot!.querySelector<HTMLElement>("[data-test=copy-day][data-day='1']")!;
  button.click();
  await week.updateComplete;
  const old = week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
  const cancel = old.querySelector<HTMLElement>("[slot=cancel]")!,
    checkbox = old.querySelector<HTMLInputElement>("[name=copyDay2]")!;
  cancel.click();
  await week.updateComplete;
  button.click();
  await week.updateComplete;
  const next = week.shadowRoot!.querySelector("wt-modal");
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  cancel.dispatchEvent(new MouseEvent("click"));
  emit(old, "wt-close", {});
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("wt-modal")).toBe(next);
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm-copy]")!
      .disabled,
  ).toBe(true);
  expect(grid(week).columns[1]!.slots).toEqual([]);
});
it("departed range close and New period cannot act on a later opening", async () => {
  const week = await mount();
  const old = await range(week);
  emit(old, "range-close", {});
  await week.updateComplete;
  const next = await range(week, 0);
  emit(old, "range-close", {});
  emit(old, "range-new-period", { input: { startsAt: "09:00", endsAt: "12:00", periodId: "" } });
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("range-dialog")).toBe(next);
  expect(week.shadowRoot!.querySelector("period-editor")).toBeNull();
});
it("a departed nested Cancel cannot close the next child editor", async () => {
  const week = await mount();
  const dialog = await range(week);
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", {
    value: "new",
  });
  await week.updateComplete;
  const old = week.shadowRoot!.querySelector("period-editor")!;
  emit(old, "period-close", {});
  await week.updateComplete;
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", {
    value: "new",
  });
  await week.updateComplete;
  const next = week.shadowRoot!.querySelector("period-editor");
  emit(old, "period-close", {});
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("period-editor")).toBe(next);
});

it("preserves all six other weekdays when staging a Sunday range", async () => {
  const model = fixture();
  model.departments[0]!.week = [
    { weekday: 0, slots: [] },
    { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
    { weekday: 2, slots: [{ periodId: "p1", startsAt: "11:00", endsAt: "15:00" }] },
    { weekday: 3, slots: [] },
    { weekday: 4, slots: [] },
    { weekday: 5, slots: [{ periodId: "p1", startsAt: "20:00", endsAt: "03:00" }] },
    { weekday: 6, slots: [{ periodId: "p1", startsAt: "09:00", endsAt: "12:00" }] },
  ];
  const writes: unknown[] = [];
  const week = await mount(
    async (...args) => {
      writes.push(args);
    },
    false,
    model,
  );
  emit(grid(week), "grid-range-select", { columnKey: "0", startsAt: "13:00", endsAt: "17:00" });
  await week.updateComplete;
  const dialog =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
  await dialog.updateComplete;
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-change", { value: "p1" });
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
  expect(writes).toEqual([]);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    [
      "/management-api/venue-service/departments/d1/menu-week",
      "PUT",
      {
        days: [
          { weekday: 0, slots: [{ periodId: "p1", startsAt: "13:00", endsAt: "17:00" }] },
          { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
          { weekday: 2, slots: [{ periodId: "p1", startsAt: "11:00", endsAt: "15:00" }] },
          { weekday: 3, slots: [] },
          { weekday: 4, slots: [] },
          { weekday: 5, slots: [{ periodId: "p1", startsAt: "20:00", endsAt: "03:00" }] },
          { weekday: 6, slots: [{ periodId: "p1", startsAt: "09:00", endsAt: "12:00" }] },
        ],
      },
    ],
  ]);
});

it("explains an offset timetable refusal beside its day and retains the retryable draft", async () => {
  const week = await mount(async () => {
    throw {
      code: "menu_timetable.invalid",
      params: { field: "days.2.slots.0.endsAt", reason: "end_offset", periodId: "p1" },
    };
  });
  await add(week);
  const submitted = structuredClone(grid(week).columns.find((column) => column.key === "2")!.slots);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
  await expect
    .poll(() => week.shadowRoot!.querySelector("[data-day-error='2']")?.textContent)
    .toBe("Tuesday: Change this period’s end offset to fit these time ranges.");
  expect(grid(week).columns.find((column) => column.key === "2")!.slots).toEqual(submitted);
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-week]")!
      .disabled,
  ).toBe(false);
});

it("keeps a created period's signed offset in its wire body and nested range choice", async () => {
  const writes: unknown[] = [];
  const week = await mount(async (...args) => {
    writes.push(args);
    return { id: "late" };
  });
  const dialog = await range(week);
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-combobox-action", {
    value: "new",
  });
  await week.updateComplete;
  const period =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["period-editor"]>("period-editor")!;
  await period.updateComplete;
  for (const [name, value] of [
    ["name", "Tea"],
    ["menuId", "m1"],
    ["endOffsetMinutes", "-15"],
  ])
    emit(period.shadowRoot!.querySelector(`[name=${name}]`)!, "wt-change", { value });
  await period.updateComplete;
  period.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect.poll(() => week.shadowRoot!.querySelector("period-editor")).toBeNull();
  await dialog.updateComplete;
  expect(writes).toEqual([
    [
      "/management-api/venue-service/departments/d1/menu-periods",
      "POST",
      { name: "Tea", colour: "red", menuId: "m1", staffMenuIds: [], endOffsetMinutes: -15 },
    ],
  ]);
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=periodId]")!
      .value,
  ).toBe("late");
});
