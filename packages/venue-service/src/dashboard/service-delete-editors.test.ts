import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LiveData, currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController } from "@waitron/ui";
import { zonesModel } from "../testing/department-zones-fixture.js";
import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import { VenueServiceApi } from "./client.js";
import "./department-settings.js";
import "./venue-departments-shell.js";
import "./zone-edit-dialog.js";
import "./opening-hours-screen.js";
import { namedWeekModel } from "../testing/real-week-model.js";
import { everyDateSpecial } from "../testing/special-day-fixture.js";

const originalUrl = location.href;
class App extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<slot></slot
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("service-deleted-owner-app", App);
let app: App;
let originalLocale = currentLocale();
beforeEach(() => {
  originalLocale = currentLocale();
});
afterEach(() => {
  app?.remove();
  history.replaceState(null, "", originalUrl);
  setLocale(originalLocale);
  vi.useRealTimers();
});
async function mount() {
  setLocale("en");
  app = document.createElement("service-deleted-owner-app") as App;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
}
function emit(el: Element, name: string, detail: unknown) {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function settings(
  id: string,
  write: DashboardRequest = (async () => {}) as DashboardRequest,
) {
  const el = document.createElement("department-settings");
  el.model = structuredClone(zonesModel);
  el.departmentId = id;
  el.api = new VenueServiceApi(write);
  app.append(el);
  await el.updateComplete;
  emit(el.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: `Staged ${id}` });
  await el.updateComplete;
  return el;
}
it.each(["keep", "discard"] as const)(
  "department deletion cancels pending %s without touching a surviving draft",
  async (decision) => {
    await mount();
    const deleted = await settings("d1"),
      survivor = await settings("d2");
    const outcome = app.leave.coordinator.request({
      scopes: [deleted],
      reason: "navigation",
      proceed: () => {},
    });
    await app.updateComplete;
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    await question.updateComplete;
    const stale = question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!;
    deleted.model = {
      ...deleted.model!,
      departments: deleted.model!.departments.filter((d) => d.id !== "d1"),
    };
    await deleted.updateComplete;
    expect(deleted.shadowRoot!.querySelector("[name=name]")).toBeNull();
    expect(app.leave.coordinator.isDirty([deleted])).toBe(false);
    stale.click();
    expect(await outcome).toBe("stale");
    await deleted.updateComplete;
    expect(deleted.shadowRoot!.querySelector("[name=name]")).toBeNull();
    expect(
      survivor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
    ).toBe("Staged d2");
    expect(app.leave.coordinator.isDirty([survivor])).toBe(true);
  },
);
it("a late department save cannot emit saved after its owner disappears", async () => {
  await mount();
  let finish!: () => void;
  const events: unknown[] = [];
  const el = await settings("d1", (async (_path, method) => {
    if (method !== "GET")
      await new Promise<void>((done) => {
        finish = done;
      });
    else
      return _path.endsWith("/profiles")
        ? []
        : { receivingProfileId: null, destinationDepartmentIds: [] };
  }) as DashboardRequest);
  el.addEventListener("saved", (e) => events.push((e as CustomEvent).detail));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  el.model = { ...el.model!, departments: el.model!.departments.filter((d) => d.id !== "d1") };
  await el.updateComplete;
  finish();
  await new Promise((done) => setTimeout(done, 0));
  expect(events).toEqual([]);
  expect(app.leave.coordinator.isDirty([el])).toBe(false);
});
function hoursFixture(): OpeningHoursModel {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 0,
    currentBusinessDay: "2026-10-11",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    seasons: [{ id: "autumn", name: "Autumn", startsOn: "09-01" }],
    currentSeasonId: "autumn",
    menus: [{ id: "m1", name: "Menu", active: true, includes: [] }],
    departments: ["d1", "d2"].map((id, index) => ({
      id,
      name: id,
      active: true,
      zones: [{ id: `z${index + 1}`, name: `Zone ${index + 1}`, seasonWeeks: [] }],
      periods: [
        {
          id: `p${index + 1}`,
          name: "Lunch",
          colour: "blue",
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
          week: [
            {
              weekday: 1,
              slots: [{ periodId: `p${index + 1}`, startsAt: "10:00", endsAt: "14:00" }],
            },
          ],
        },
      ],
    })),
  };
}
async function hours(
  view: string,
  initial = hoursFixture(),
  write: () => Promise<unknown> = async () => undefined,
) {
  history.replaceState(null, "", `/manage/opening-hours/view/${view}/department/d1`);
  await mount();
  const live = new LiveData();
  let model = initial;
  const writes: unknown[][] = [];
  const api = new OpeningHoursApi(
    withOpeningStations((async (path, method, body) => {
      if (method === "GET")
        return (
          (view === "day" && everyDateSpecial(path)) ||
          (path.includes("/named-days?") ? namedWeekModel() : model)
        );
      writes.push([path, method, body]);
      return write();
    }) as DashboardRequest),
    live,
  );
  const screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = api;
  app.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("wt-tabs")).not.toBeNull();
  async function replace(next: OpeningHoursModel) {
    model = next;
    live.invalidate([{ type: "departments" }, { type: "floor_zones" }]);
    await new Promise((done) => setTimeout(done, 0));
    await screen.updateComplete;
  }
  return { screen, writes, model, replace };
}
const DAY_WRITE = "/management-api/venue-service/special-days/day-2026-10-12";
/** A write's path and the departments its paint names. */
const painted = ([path, , body]: unknown[]) => [
  path,
  (body as { paint: { departmentId: string }[] }).paint.map((entry) => entry.departmentId),
];
it.each(["department", "period"])(
  "remote %s deletion retires the dirty retained menu-period editor",
  async (kind) => {
    const { screen, model, replace, writes } = await hours("periods");
    const table = screen.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-period]")!.click();
    await screen.updateComplete;
    const editor = screen.shadowRoot!.querySelector("period-editor")!;
    await editor.updateComplete;
    emit(editor.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Staged lunch" });
    await editor.updateComplete;
    expect(app.leave.coordinator.isDirty()).toBe(true);
    await replace(
      kind === "department"
        ? { ...model, departments: model.departments.slice(1) }
        : {
            ...model,
            departments: model.departments.map((d) => (d.id === "d1" ? { ...d, periods: [] } : d)),
          },
    );
    expect(screen.shadowRoot!.querySelector("period-editor")).toBeNull();
    expect(editor.isConnected).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    emit(editor, "period-save", { periodId: "p1", input: { name: "Stale" } });
    await screen.updateComplete;
    expect(writes).toEqual([]);
  },
);
it("day deletion removes only the deleted department and preserves the surviving staged hours", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  const { screen, model, replace } = await hours("day");
  const day = screen.shadowRoot!.querySelector("opening-hours-day")!;
  await day.updateComplete;
  const grid = day.shadowRoot!.querySelector("service-grid")!;
  await grid.updateComplete;
  for (const id of ["d1", "d2"])
    emit(grid, "grid-block-change", {
      columnKey: id,
      index: 0,
      startsAt: "10:00",
      endsAt: "16:00",
    });
  await day.updateComplete;
  await replace({ ...model, departments: model.departments.slice(1) });
  await day.updateComplete;
  await grid.updateComplete;
  expect(grid.columns.map((c) => c.key)).toEqual(["d2", "zone:z2"]);
  expect(grid.columns[0]!.slots).toEqual([{ periodId: "p2", startsAt: "10:00", endsAt: "16:00" }]);
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
it("zone service deletion invalidates pending discard on the same retained component", async () => {
  await mount();
  const el = document.createElement("zone-edit-dialog");
  el.model = structuredClone(zonesModel);
  el.zoneId = "z1";
  el.api = new VenueServiceApi((async () => ({ tables: [] })) as DashboardRequest);
  app.append(el);
  await el.updateComplete;
  const fields = el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
  emit(fields, "service-settings-change", {
    value: { ...fields.value, receiptPrintMode: "on_request" },
  });
  await el.updateComplete;
  expect(app.leave.coordinator.isDirty([el])).toBe(true);
  const outcome = app.leave.coordinator.request({
    scopes: [el],
    reason: "navigation",
    proceed: () => {},
  });
  await app.updateComplete;
  el.model = { ...el.model!, departments: el.model!.departments.filter((d) => d.id !== "d1") };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")).toBeNull();
  expect(app.leave.coordinator.isDirty([el])).toBe(false);
  expect(await outcome).toBe("stale");
});
it.each(["week", "zone-week"])(
  "deletion disconnects the dirty retained %s and rejects its old controls",
  async (kind) => {
    const { screen, model, replace, writes } = await hours("week");
    if (kind === "zone-week") {
      history.replaceState(null, "", "/manage/opening-hours/view/week/department/d1/zone/z1");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await screen.updateComplete;
    }
    const tag = kind === "week" ? "opening-hours-week" : "opening-hours-zone-week";
    const owner = screen.shadowRoot!.querySelector<
      HTMLElementTagNameMap["opening-hours-week"] | HTMLElementTagNameMap["opening-hours-zone-week"]
    >(tag)!;
    await owner.updateComplete;
    const grid = owner.shadowRoot!.querySelector("service-grid")!;
    await grid.updateComplete;
    emit(grid, kind === "week" ? "grid-block-change" : "grid-range-select", {
      columnKey: "1",
      index: 0,
      startsAt: "10:00",
      endsAt: "16:00",
    });
    await owner.updateComplete;
    expect(app.leave.coordinator.isDirty()).toBe(true);
    const stale = owner.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!;
    await replace(
      kind === "week"
        ? { ...model, departments: model.departments.slice(1) }
        : {
            ...model,
            departments: model.departments.map((department) =>
              department.id === "d1" ? { ...department, zones: [] } : department,
            ),
          },
    );
    expect(owner.isConnected).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    stale.click();
    emit(grid, "grid-block-change", {
      columnKey: "1",
      index: 0,
      startsAt: "10:00",
      endsAt: "18:00",
    });
    await owner.updateComplete;
    expect(writes).toEqual([]);
  },
);
it("a live change to another department preserves the retained dirty period dialog", async () => {
  const { screen, model, replace } = await hours("periods");
  const table = screen.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-period]")!.click();
  await screen.updateComplete;
  const editor = screen.shadowRoot!.querySelector("period-editor")!;
  await editor.updateComplete;
  emit(editor.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Staged lunch" });
  await editor.updateComplete;
  await replace({ ...model, departments: model.departments.slice(0, 1) });
  expect(screen.shadowRoot!.querySelector("period-editor")).toBe(editor);
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Staged lunch");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
it("voluntary period close waits for the native close event after discarding its draft", async () => {
  const { screen } = await hours("periods");
  const table = screen.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-period]")!.click();
  await screen.updateComplete;
  const editor = screen.shadowRoot!.querySelector("period-editor")!;
  await editor.updateComplete;
  emit(editor.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Staged lunch" });
  await editor.updateComplete;
  const modal = editor.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  const closed = new Promise<void>((done) =>
    modal.addEventListener("wt-close", () => done(), { once: true }),
  );
  const result = modal.requestClose("cancel");
  await app.updateComplete;
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  expect(await result).toBe(true);
  await closed;
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("period-editor")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it.each(["keep", "discard"] as const)(
  "day deletion invalidates pending %s on the same day owner and keeps surviving staged hours",
  async (decision) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    const { screen, model, replace } = await hours("day");
    const day = screen.shadowRoot!.querySelector("opening-hours-day")!;
    await day.updateComplete;
    const grid = day.shadowRoot!.querySelector("service-grid")!;
    await grid.updateComplete;
    for (const id of ["d1", "d2"])
      emit(grid, "grid-block-change", {
        columnKey: id,
        index: 0,
        startsAt: "10:00",
        endsAt: "16:00",
      });
    await day.updateComplete;
    const outcome = app.leave.coordinator.request({
      scopes: [day],
      reason: "navigation",
      proceed: () => {},
    });
    await app.updateComplete;
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await question.updateComplete;
    expect(question.open).toBe(true);
    const stale = question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!;
    await replace({ ...model, departments: model.departments.slice(1) });
    stale.click();
    expect(await outcome).toBe("stale");
    await day.updateComplete;
    await grid.updateComplete;
    expect(screen.shadowRoot!.querySelector("opening-hours-day")).toBe(day);
    expect(grid.columns.map((c) => c.key)).toEqual(["d2", "zone:z2"]);
    expect(grid.columns[0]!.slots).toEqual([
      { periodId: "p2", startsAt: "10:00", endsAt: "16:00" },
    ]);
    expect(app.leave.coordinator.isDirty([day])).toBe(true);
  },
);
it("a late period save cannot revive the removed department's retained dialog", async () => {
  let finish!: () => void;
  const { screen, model, replace, writes } = await hours(
    "periods",
    hoursFixture(),
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  const table = screen.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-period]")!.click();
  await screen.updateComplete;
  const editor = screen.shadowRoot!.querySelector("period-editor")!;
  await editor.updateComplete;
  emit(editor.shadowRoot!.querySelector("[name=name]")!, "wt-change", { value: "Staged lunch" });
  await editor.updateComplete;
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-period]")!.click();
  await expect.poll(() => writes.length).toBe(1);
  await replace({ ...model, departments: model.departments.slice(1) });
  finish();
  await new Promise((done) => setTimeout(done, 0));
  await screen.updateComplete;
  expect(editor.isConnected).toBe(false);
  expect(screen.shadowRoot!.querySelector("period-editor")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it.each(["success", "refusal"] as const)(
  "a retired day save's late %s cannot release the same owner's surviving save",
  async (result) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    const pending: { resolve(): void; reject(reason: unknown): void }[] = [];
    const { screen, model, replace, writes } = await hours(
      "day",
      hoursFixture(),
      () => new Promise<void>((resolve, reject) => pending.push({ resolve, reject })),
    );
    const day = screen.shadowRoot!.querySelector("opening-hours-day")!;
    await day.updateComplete;
    const grid = day.shadowRoot!.querySelector("service-grid")!;
    await grid.updateComplete;
    for (const id of ["d1", "d2"])
      emit(grid, "grid-block-change", {
        columnKey: id,
        index: 0,
        startsAt: "10:00",
        endsAt: "16:00",
      });
    await day.updateComplete;
    const save =
      day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-day]")!;
    save.click();
    await expect.poll(() => pending.length).toBe(1);
    expect(writes.map(painted)).toEqual([[DAY_WRITE, ["d1", "d2"]]]);
    await replace({ ...model, departments: model.departments.slice(1) });
    await day.updateComplete;
    expect(screen.shadowRoot!.querySelector("opening-hours-day")).toBe(day);
    await grid.updateComplete;
    expect(grid.columns[0]!.slots).toEqual([
      { periodId: "p2", startsAt: "10:00", endsAt: "16:00" },
    ]);
    expect(save.disabled).toBe(false);
    save.click();
    await expect.poll(() => pending.length).toBe(2);
    expect(save.disabled).toBe(true);
    if (result === "success") pending[0]!.resolve();
    else
      pending[0]!.reject({
        code: "special_day.invalid",
        params: { field: "paint.0.ranges.0.endsAt" },
      });
    await new Promise((done) => setTimeout(done, 0));
    await day.updateComplete;
    expect(save.disabled).toBe(true);
    save.click();
    await day.updateComplete;
    expect(writes.map(painted)).toEqual([
      [DAY_WRITE, ["d1", "d2"]],
      [DAY_WRITE, ["d2"]],
    ]);
    pending[1]!.resolve();
    await new Promise((done) => setTimeout(done, 0));
    await day.updateComplete;
    emit(grid, "grid-block-change", {
      columnKey: "d2",
      index: 0,
      startsAt: "10:00",
      endsAt: "17:00",
    });
    await day.updateComplete;
    expect(save.disabled).toBe(false);
    save.click();
    await expect.poll(() => pending.length).toBe(3);
    expect(writes.map(painted)).toEqual([
      [DAY_WRITE, ["d1", "d2"]],
      [DAY_WRITE, ["d2"]],
      [DAY_WRITE, ["d2"]],
    ]);
    pending[2]!.resolve();
    await new Promise((done) => setTimeout(done, 0));
  },
);
it("a reconnected day owner can save its retained draft after an old pending write is retired", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  const pending: (() => void)[] = [];
  const { screen, writes } = await hours(
    "day",
    hoursFixture(),
    () => new Promise<void>((done) => pending.push(done)),
  );
  const day = screen.shadowRoot!.querySelector("opening-hours-day")!;
  await day.updateComplete;
  const grid = day.shadowRoot!.querySelector("service-grid")!;
  await grid.updateComplete;
  emit(grid, "grid-block-change", {
    columnKey: "d1",
    index: 0,
    startsAt: "10:00",
    endsAt: "16:00",
  });
  await day.updateComplete;
  const save =
    day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-day]")!;
  save.click();
  await expect.poll(() => pending.length).toBe(1);
  const parent = day.parentNode!;
  day.remove();
  parent.append(day);
  await day.updateComplete;
  expect(screen.shadowRoot!.querySelector("opening-hours-day")).toBe(day);
  expect(save.disabled).toBe(false);
  save.click();
  await expect.poll(() => pending.length).toBe(2);
  pending[0]!();
  await new Promise((done) => setTimeout(done, 0));
  await day.updateComplete;
  expect(save.disabled).toBe(true);
  save.click();
  await day.updateComplete;
  expect(writes.map(painted)).toEqual([
    [DAY_WRITE, ["d1"]],
    [DAY_WRITE, ["d1"]],
  ]);
  pending[1]!();
  await new Promise((done) => setTimeout(done, 0));
  await day.updateComplete;
  emit(grid, "grid-block-change", {
    columnKey: "d1",
    index: 0,
    startsAt: "10:00",
    endsAt: "17:00",
  });
  await day.updateComplete;
  expect(save.disabled).toBe(false);
});

it("department deletion removes its contributed receipt panel while another department draft survives", async () => {
  await mount();
  const survivor = await settings("d2");
  history.replaceState(null, "", "/manage/venue-operations/department/d1/view/receipt");
  const page = document.createElement("venue-departments-shell");
  page.api = new VenueServiceApi((async (path) =>
    path.endsWith("/profiles")
      ? []
      : { receivingProfileId: null, destinationDepartmentIds: [] }) as DashboardRequest);
  page.model = structuredClone(zonesModel);
  page.renderPanel = (panel, subject) =>
    html`<section data-test="contributed-receipt" data-department=${subject.id}>${panel}</section>`;
  app.append(page);
  await page.updateComplete;
  expect(
    page
      .shadowRoot!.querySelector("[data-test=contributed-receipt]")
      ?.getAttribute("data-department"),
  ).toBe("d1");
  page.model = { ...page.model, departments: page.model.departments.filter((d) => d.id !== "d1") };
  await page.updateComplete;
  expect(page.shadowRoot!.querySelector("[data-test=contributed-receipt]")).toBeNull();
  expect(
    survivor
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!
      .shadowRoot!.querySelector("input")!.value,
  ).toBe("Staged d2");
  expect(app.leave.coordinator.isDirty([survivor])).toBe(true);
});
