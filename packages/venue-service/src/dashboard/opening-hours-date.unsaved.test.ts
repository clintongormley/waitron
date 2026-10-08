import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
class DateLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly api = new OpeningHoursApi((async () => ({
    dayCutover: "06:00",
    menus: [],
    specialDates: [
      { id: "s1", date: "2026-10-12", name: "Holiday", colour: "red", closeWholeVenue: false },
      { id: "s2", date: "2026-10-13", name: "Party", colour: "blue", closeWholeVenue: false },
    ],
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
            weekdays: [1],
          },
        ],
        week: [{ weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] }],
        dates: [
          { specialDateId: "s1", slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "16:00" }] },
        ],
      },
    ],
  })) as DashboardRequest);
  override render() {
    return html`<dashboard-opening-hours-screen .api=${this.api}></dashboard-opening-hours-screen
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("date-leave-test-app", DateLeaveApp);
let app: DateLeaveApp;
const originalUrl = location.href;
beforeEach(() => {
  history.replaceState(null, "", "/manage/opening-hours");
});
afterEach(() => {
  app?.remove();
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
  await expect.poll(() => screen.shadowRoot?.querySelector("[name=weekMode]")).not.toBeNull();
  emit(screen.shadowRoot!.querySelector("[name=weekMode]")!, "wt-change", { value: "date" });
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=specialDateId]")).not.toBeNull();
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
describe.each(["en", "es"])("Special-date draft (%s)", (locale) => {
  it("asks before changing dates and Keep retains the date and staged closed day", async () => {
    setLocale(locale);
    const { screen, week } = await mount();
    week.shadowRoot!.querySelector<HTMLElement>("[data-test=close-date]")!.click();
    await week.updateComplete;
    expect(unload()).toBe(true);
    const picker =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
        "[name=specialDateId]",
      )!;
    emit(picker, "wt-change", { value: "s2" });
    await choose("keep");
    expect(picker.value).toBe("s1");
    expect(screen.shadowRoot!.querySelector("opening-hours-week")).toBe(week);
    expect(
      week.shadowRoot!.querySelector<HTMLElementTagNameMap["service-grid"]>("service-grid")!
        .columns[0]!.slots,
    ).toEqual([]);
    emit(picker, "wt-change", { value: "s2" });
    await choose("discard");
    await expect.poll(() => picker.value).toBe("s2");
    expect(unload()).toBe(false);
  });
  it.each(["before", "after"])("counts a follow-week edit made %s reconnect", async (when) => {
    setLocale(locale);
    const { screen, week } = await mount();
    if (when === "before")
      week.shadowRoot!.querySelector<HTMLElement>("[data-test=follow-week]")!.click();
    await week.updateComplete;
    const parent = screen.parentNode!;
    screen.remove();
    await week.updateComplete;
    expect(unload()).toBe(false);
    parent.appendChild(screen);
    await screen.updateComplete;
    await week.updateComplete;
    if (when === "after")
      week.shadowRoot!.querySelector<HTMLElement>("[data-test=follow-week]")!.click();
    await week.updateComplete;
    expect(unload()).toBe(true);
    emit(screen.shadowRoot!.querySelector("[name=weekMode]")!, "wt-change", { value: "week" });
    await choose("keep");
    expect(screen.shadowRoot!.querySelector("opening-hours-week")).toBe(week);
    expect(unload()).toBe(true);
  });
});
