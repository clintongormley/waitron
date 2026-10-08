import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";

class DayLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
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
              colour: "green",
              menuId: "m1",
              staffMenuIds: [],
              endOffsetMinutes: 0,
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
customElements.define("day-leave-test-app", DayLeaveApp);
let app: DayLeaveApp;
const originalUrl = location.href;
beforeEach(() => {
  history.replaceState(null, "", "/manage/opening-hours/view/day");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
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
  app = document.createElement("day-leave-test-app") as DayLeaveApp;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector<
    HTMLElementTagNameMap["dashboard-opening-hours-screen"]
  >("dashboard-opening-hours-screen")!;
  await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-day")).not.toBeNull();
  const day =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-day"]>(
      "opening-hours-day",
    )!;
  await day.updateComplete;
  return { screen, day };
}
function edit(day: HTMLElementTagNameMap["opening-hours-day"]) {
  emit(day.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
    columnKey: "d1",
    index: 0,
    startsAt: "10:00",
    endsAt: "15:00",
  });
}
async function choose(value: "keep" | "discard") {
  await app.updateComplete;
  const question =
    app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
      "wt-unsaved-changes",
    )!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${value}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
describe.each(["en", "es"])("Day draft (%s)", (locale) => {
  it("asks before stepping dates, Keep preserves the draft and Discard moves to the next date", async () => {
    setLocale(locale);
    const { day } = await mount();
    edit(day);
    await day.updateComplete;
    expect(unload()).toBe(true);
    day.shadowRoot!.querySelector<HTMLElement>("[data-test=next-day]")!.click();
    await choose("keep");
    expect(
      day.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!
        .columns[0]!.slots,
    ).toEqual([{ periodId: "p1", startsAt: "10:00", endsAt: "15:00" }]);
    day.shadowRoot!.querySelector<HTMLElement>("[data-test=next-day]")!.click();
    await choose("discard");
    await expect
      .poll(
        () =>
          day.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!
            .columns[0]!.slots,
      )
      .toEqual([]);
    expect(unload()).toBe(false);
  });
  it.each(["before", "after"])(
    "protects an edit made %s reconnect from a fresh background model",
    async (when) => {
      setLocale(locale);
      const { screen, day } = await mount();
      if (when === "before") {
        edit(day);
        await day.updateComplete;
      }
      const parent = screen.parentNode!;
      screen.remove();
      await day.updateComplete;
      expect(unload()).toBe(false);
      parent.appendChild(screen);
      await screen.updateComplete;
      await day.updateComplete;
      if (when === "after") {
        edit(day);
        await day.updateComplete;
      }
      app.api.rereadWatches();
      await expect.poll(() => unload()).toBe(true);
      expect(
        day.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!
          .columns[0]!.slots,
      ).toEqual([{ periodId: "p1", startsAt: "10:00", endsAt: "15:00" }]);
      day.shadowRoot!.querySelector<HTMLElement>("[data-test=next-day]")!.click();
      await choose("keep");
      expect(unload()).toBe(true);
    },
  );
  it("marks a successful write saved before reporting a failed refresh", async () => {
    setLocale(locale);
    const { screen, day } = await mount();
    edit(day);
    await day.updateComplete;
    app.failRead = true;
    day.shadowRoot!.querySelector<HTMLElement>("[data-test=save-day]")!.click();
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-test=read-error]"))
      .not.toBeNull();
    expect(app.writes[0]).toEqual([
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
    ]);
    expect(unload()).toBe(false);
  });
  it("keeps a refused write protected and available to retry", async () => {
    setLocale(locale);
    const { day } = await mount();
    edit(day);
    await day.updateComplete;
    app.failWrite = true;
    day.shadowRoot!.querySelector<HTMLElement>("[data-test=save-day]")!.click();
    await expect
      .poll(
        () =>
          day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
            "wt-form-actions",
          )!.error,
      )
      .not.toBe("");
    expect(unload()).toBe(true);
    expect(
      day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-day]")!
        .disabled,
    ).toBe(false);
    app.failWrite = false;
    day.shadowRoot!.querySelector<HTMLElement>("[data-test=save-day]")!.click();
    await expect.poll(() => unload()).toBe(false);
  });
});
