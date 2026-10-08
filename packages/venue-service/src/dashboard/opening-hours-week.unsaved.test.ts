import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTokens, LeaveController, NavigationGuard } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
class WeekLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  private guard?: NavigationGuard;
  navigation?: Promise<unknown>;
  override connectedCallback() {
    super.connectedCallback();
    this.guard = new NavigationGuard(window, {
      isDirty: () => this.leave.coordinator.isDirty(),
      request: (proceed, signal) => {
        const result = this.leave.coordinator.request({
          scopes: "all",
          reason: "navigation",
          proceed,
          signal,
        });
        this.navigation = result;
        return result;
      },
    });
  }
  override disconnectedCallback() {
    this.guard?.dispose();
    super.disconnectedCallback();
  }
  writes: unknown[][] = [];
  failRead = false;
  failWrite = false;
  readonly api = new OpeningHoursApi((async (path, method, body) => {
    if (method !== "GET") {
      this.writes.push([path, method, body]);
      if (this.failWrite) throw new Error("offline");
      return;
    }
    if (this.failRead) throw new Error("offline");
    return {
      timeZone: "Europe/Madrid",
      clockReadable: true,
      dayCutover: "06:00",
      menus: [],
      specialDates: [],
      departments: [
        {
          id: "d1",
          name: "Restaurant",
          active: true,
          periods: [
            {
              id: "p1",
              name: "Lunch",
              colour: "blue",
              menuId: "m1",
              staffMenuIds: [],
              weekdays: [1],
            },
          ],
          week: [{ weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] }],
          dates: [],
        },
      ],
    };
  }) as DashboardRequest);
  override render() {
    return html`<dashboard-opening-hours-screen .api=${this.api}></dashboard-opening-hours-screen
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("week-leave-test-app", WeekLeaveApp);
let app: WeekLeaveApp;
const originalUrl = location.href;
beforeEach(() => {
  history.replaceState(null, "", "/manage/opening-hours");
});
afterEach(() => {
  app?.remove();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});
async function mount() {
  app = document.createElement("week-leave-test-app") as WeekLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector<
    HTMLElementTagNameMap["dashboard-opening-hours-screen"]
  >("dashboard-opening-hours-screen")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("opening-hours-week")).not.toBeNull();
  const week =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
      "opening-hours-week",
    )!;
  await week.updateComplete;
  return { screen, week };
}
async function change(week: HTMLElementTagNameMap["opening-hours-week"]) {
  week.shadowRoot!.querySelector("service-grid")!.dispatchEvent(
    new CustomEvent("grid-block-change", {
      detail: { columnKey: "1", index: 0, startsAt: "10:00", endsAt: "15:00" },
      bubbles: true,
      composed: true,
    }),
  );
  await week.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
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
  await app.navigation;
}
describe.each(["en", "es"])("Week draft (%s)", (locale) => {
  it("asks on tab navigation and Keep preserves the staged week", async () => {
    setLocale(locale);
    const { screen, week } = await mount();
    expect(unload()).toBe(false);
    await change(week);
    expect(unload()).toBe(true);
    const tabs = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!;
    tabs.dispatchEvent(
      new CustomEvent("wt-tab-change", {
        detail: { value: "periods" },
        bubbles: true,
        composed: true,
      }),
    );
    await choose("keep");
    expect(location.pathname).toBe("/manage/opening-hours");
    expect(screen.shadowRoot!.querySelector("opening-hours-week")).toBe(week);
    expect(
      week.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!
        .columns[0]!.slots[0]!.endsAt,
    ).toBe("15:00");
    tabs.dispatchEvent(
      new CustomEvent("wt-tab-change", {
        detail: { value: "periods" },
        bubbles: true,
        composed: true,
      }),
    );
    await choose("discard");
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/periods");
    expect(unload()).toBe(false);
  });
  it.each(["before", "after"])("counts an edit made %s reconnect", async (when) => {
    setLocale(locale);
    const { screen, week } = await mount();
    if (when === "before") await change(week);
    const parent = screen.parentNode!;
    screen.remove();
    await week.updateComplete;
    expect(unload()).toBe(false);
    parent.appendChild(screen);
    await screen.updateComplete;
    await week.updateComplete;
    if (when === "after") await change(week);
    expect(unload()).toBe(true);
    const request = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await choose("keep");
    expect(await request).toBe("kept");
    expect(unload()).toBe(true);
  });
});

describe.each(["en", "es"])("Retained week save contract (%s)", (locale) => {
  it("commits the exact submitted body before a refresh fails", async () => {
    setLocale(locale);
    const { screen, week } = await mount();
    await change(week);
    expect(unload()).toBe(true);
    app.failRead = true;
    week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-test=read-error]"))
      .not.toBeNull();
    expect(app.writes).toEqual([
      [
        "/management-api/venue-service/departments/d1/menu-week",
        "PUT",
        {
          days: [
            { weekday: 0, slots: [] },
            { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "15:00" }] },
            { weekday: 2, slots: [] },
            { weekday: 3, slots: [] },
            { weekday: 4, slots: [] },
            { weekday: 5, slots: [] },
            { weekday: 6, slots: [] },
          ],
        },
      ],
    ]);
    expect(unload()).toBe(false);
  });
  it("keeps the exact submitted draft protected after a refused save", async () => {
    setLocale(locale);
    const { week } = await mount();
    await change(week);
    app.failWrite = true;
    week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-week]")!.click();
    await expect
      .poll(
        () =>
          week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
            "wt-form-actions",
          )!.error,
      )
      .not.toBe("");
    expect(app.writes).toEqual([
      [
        "/management-api/venue-service/departments/d1/menu-week",
        "PUT",
        {
          days: [
            { weekday: 0, slots: [] },
            { weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "15:00" }] },
            { weekday: 2, slots: [] },
            { weekday: 3, slots: [] },
            { weekday: 4, slots: [] },
            { weekday: 5, slots: [] },
            { weekday: 6, slots: [] },
          ],
        },
      ],
    ]);
    expect(unload()).toBe(true);
    const request = app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {},
    });
    await choose("keep");
    expect(await request).toBe("kept");
    expect(unload()).toBe(true);
  });
});
