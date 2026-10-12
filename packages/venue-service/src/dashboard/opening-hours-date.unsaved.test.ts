import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
class DateLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  writes: unknown[][] = [];
  readonly api = new OpeningHoursApi(
    withOpeningStations((async (path, method, body) => {
      if (method !== "GET") {
        this.writes.push([path, method, body]);
        return;
      }
      return {
        businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
        clockRevision: 0,
        currentBusinessDay: "2026-10-12",
        pending: null,
        timeZone: "Europe/Madrid",
        clockReadable: true,
        seasons: [{ id: "autumn", name: "Autumn", startsOn: "09-01" }],
        currentSeasonId: "autumn",
        dayCutover: "06:00",
        menus: [],
        departments: [
          {
            id: "d1",
            name: "Restaurant",
            active: true,
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
                week: [
                  { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] },
                ],
              },
            ],
          },
        ],
      };
    }) as DashboardRequest),
  );
  override render() {
    return html`<dashboard-opening-hours-screen .api=${this.api}></dashboard-opening-hours-screen
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("date-leave-test-app", DateLeaveApp);
let app: DateLeaveApp;
const originalUrl = location.href;
beforeEach(() => {
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours?week=2026-10-12");
});
afterEach(() => {
  app?.remove();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
function emit(target: Element, name: string, detail: unknown) {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
async function mount() {
  app = document.createElement("date-leave-test-app") as DateLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector<
    HTMLElementTagNameMap["dashboard-opening-hours-screen"]
  >("dashboard-opening-hours-screen")!;
  await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-week")).not.toBeNull();
  const week =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
      "opening-hours-week",
    )!;
  await week.updateComplete;
  return { screen, week };
}
async function choose(value: "keep" | "discard") {
  await app.updateComplete;
  const q =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await expect.poll(() => q.open).toBe(true);
  await q.updateComplete;
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${value}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
it("Keep preserves a staged normal week when the Real week switch is selected", async () => {
  const { screen } = await mount();
  emit(screen.shadowRoot!.querySelector("[name=realWeek]")!, "wt-change", { checked: false });
  await expect.poll(() => location.search).toBe("");
  const week = screen.shadowRoot!.querySelector("opening-hours-week")!;
  await week.updateComplete;
  emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "10:00",
    endsAt: "15:00",
  });
  await week.updateComplete;
  emit(screen.shadowRoot!.querySelector("[name=realWeek]")!, "wt-change", { checked: true });
  await choose("keep");
  expect(location.search).toBe("");
  expect(screen.shadowRoot!.querySelector("opening-hours-week")).toBe(week);
  expect(week.shadowRoot!.querySelector("service-grid")!.columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "10:00", endsAt: "15:00" },
  ]);
  expect(unload()).toBe(true);
  expect(app.writes).toEqual([]);
});
