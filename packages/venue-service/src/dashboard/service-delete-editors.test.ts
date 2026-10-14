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
import { namedWeekModel } from "../testing/hours-models.js";
import { drag, frame, settle } from "../testing/season-painter-fixture.js";

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
      if (method === "GET" && path.includes("/opening-hours/year?"))
        return {
          businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
          clockRevision: 0,
          currentBusinessDay: "2026-10-07",
          pending: null,
          year: Number(new URL(path, location.href).searchParams.get("year")),
          timeZone: "Europe/Madrid",
          today: "2026-10-07",
          seasons: [],
          days: [],
          publicHolidaysAvailable: true,
          missingHolidays: [],
          holidayCoverage: [],
          area: {
            addressKey: "fixture",
            readiness: "ready",
            options: [],
            required: false,
            chosen: null,
          },
        };
      if (method === "GET") return path.includes("/named-days?") ? namedWeekModel() : model;
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
  "deletion drops the dirty painted %s and its Save writes nothing",
  async (kind) => {
    const { screen, model, replace, writes } = await hours("year");
    history.pushState(
      null,
      "",
      kind === "week"
        ? "/manage/opening-hours/view/season/season/autumn/department/d1"
        : "/manage/opening-hours/view/season/season/autumn/department/d1/zone/z1",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect
      .poll(() =>
        screen.shadowRoot!.querySelector("season-painter")?.shadowRoot?.querySelector("paint-grid"),
      )
      .toBeTruthy();
    const owner = screen.shadowRoot!.querySelector("season-painter")!;
    await settle(owner);
    await drag(owner, "1", 360, 600);
    expect(app.leave.coordinator.isDirty()).toBe(true);
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
    await settle(owner);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    expect(owner.edited()).toEqual({ departments: [], zones: [] });
    expect(frame(owner).refusal).toBe(
      kind === "week"
        ? "d1 was removed; its changes were dropped."
        : "Zone 1 was removed; its changes were dropped.",
    );
    frame(owner).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await settle(owner);
    expect(writes).toEqual([]);
  },
);

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
