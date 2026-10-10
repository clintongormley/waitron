import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTokens, LeaveController } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
class DateLeaveApp extends LitElement {
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
      namedDays: [
        {
          id: "s1",
          date: "2026-10-12",
          name: "Holiday",
          kind: "working_day" as const,
          repeats: false,
          ownHours: true,
          hasStationHours: false,
          closeWholeVenue: false,
        },
        {
          id: "s2",
          date: "2026-10-20",
          name: "Party",
          kind: "working_day" as const,
          repeats: false,
          ownHours: true,
          hasStationHours: false,
          closeWholeVenue: false,
        },
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
              endOffsetMinutes: 0,
              weekdays: [1],
              routingUses: [],
            },
          ],
          week: [{ weekday: 1, slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }] }],
          dates: [
            {
              specialDateId: "s1",
              slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "16:00" }],
            },
          ],
        },
      ],
    };
  }) as DashboardRequest);
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
describe.each(["en", "es"])("Real-week date draft (%s)", (locale) => {
  it("asks before stepping weeks and Keep retains the week and staged closed day", async () => {
    setLocale(locale);
    const { screen, week } = await mount();
    week.shadowRoot!.querySelector<HTMLElement>("[data-test=close-date]")!.click();
    await week.updateComplete;
    expect(unload()).toBe(true);
    const next = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!;
    next.click();
    await choose("keep");
    expect(location.search).toBe("?week=2026-10-12");
    expect(screen.shadowRoot!.querySelector("opening-hours-week")).toBe(week);
    expect(week.shadowRoot!.querySelector("service-grid")!.columns[0]!.slots).toEqual([]);
    next.click();
    await choose("discard");
    await expect.poll(() => location.search).toBe("?week=2026-10-19");
    expect(unload()).toBe(false);
  });
  it.each(["before", "after"])("counts a range edit made %s reconnect", async (when) => {
    setLocale(locale);
    const { screen, week } = await mount();
    if (when === "before")
      emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
        columnKey: "1",
        index: 0,
        startsAt: "12:00",
        endsAt: "17:00",
      });
    await week.updateComplete;
    const parent = screen.parentNode!;
    screen.remove();
    await week.updateComplete;
    expect(unload()).toBe(false);
    parent.appendChild(screen);
    await screen.updateComplete;
    await week.updateComplete;
    if (when === "after")
      emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
        columnKey: "1",
        index: 0,
        startsAt: "12:00",
        endsAt: "17:00",
      });
    await week.updateComplete;
    expect(unload()).toBe(true);
    emit(screen.shadowRoot!.querySelector("[name=realWeek]")!, "wt-change", { checked: false });
    await choose("keep");
    expect(screen.shadowRoot!.querySelector("opening-hours-week")).toBe(week);
    expect(unload()).toBe(true);
  });
});

describe.each(["en", "es"])("Retained date save contract (%s)", (locale) => {
  it("commits the exact submitted body before a refresh fails", async () => {
    setLocale(locale);
    const { screen, week } = await mount();
    emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
      columnKey: "1",
      index: 0,
      startsAt: "12:00",
      endsAt: "17:00",
    });
    await week.updateComplete;
    expect(unload()).toBe(true);
    app.failRead = true;
    week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-date][data-day='1']")!.click();
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-test=read-error]"))
      .not.toBeNull();
    expect(app.writes).toEqual([
      [
        "/management-api/venue-service/special-dates/s1/menu-timetables/d1",
        "PUT",
        { slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "17:00" }] },
      ],
    ]);
    expect(unload()).toBe(false);
  });
  it("keeps the exact submitted draft protected after a refused save", async () => {
    setLocale(locale);
    const { week } = await mount();
    emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
      columnKey: "1",
      index: 0,
      startsAt: "12:00",
      endsAt: "17:00",
    });
    await week.updateComplete;
    app.failWrite = true;
    week.shadowRoot!.querySelector<HTMLElement>("[data-test=save-date][data-day='1']")!.click();
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
        "/management-api/venue-service/special-dates/s1/menu-timetables/d1",
        "PUT",
        { slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "17:00" }] },
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

it("discarding an inherited date restores its clean draft", async () => {
  setLocale("en");
  const { screen } = await mount();
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!.click();
  await expect.poll(() => location.search).toBe("?week=2026-10-19");
  const week =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["opening-hours-week"]>(
      "opening-hours-week",
    )!;
  await week.updateComplete;
  expect(unload()).toBe(false);
  week.shadowRoot!.querySelector<HTMLElement>("[data-test=close-date]")!.click();
  await week.updateComplete;
  expect(unload()).toBe(true);
  emit(week.shadowRoot!.querySelector("service-grid")!, "grid-range-select", {
    columnKey: "2",
    startsAt: "10:00",
    endsAt: "14:00",
  });
  await week.updateComplete;
  const dialog =
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["range-dialog"]>("range-dialog")!;
  await dialog.updateComplete;
  emit(dialog.shadowRoot!.querySelector("[name=periodId]")!, "wt-change", { value: "p1" });
  await dialog.updateComplete;
  dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=save-range]")!.click();
  await week.updateComplete;
  expect(unload()).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=previous-week]")!.click();
  await choose("discard");
  await expect.poll(() => unload()).toBe(false);
  expect(app.writes).toEqual([]);
});

it("a saved date stays dirty until its original own ranges are restored", async () => {
  setLocale("en");
  const { week } = await mount();
  expect(unload()).toBe(false);
  emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  await week.updateComplete;
  expect(unload()).toBe(true);
  emit(week.shadowRoot!.querySelector("service-grid")!, "grid-block-change", {
    columnKey: "1",
    index: 0,
    startsAt: "12:00",
    endsAt: "16:00",
  });
  await week.updateComplete;
  expect(unload()).toBe(false);
  expect(app.writes).toEqual([]);
});

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

it("keeps a real-date draft when a fresh snapshot is supplied before reconnect scopes register", async () => {
  const { week } = await mount();
  const grid = week.shadowRoot!.querySelector("service-grid")!;
  grid.dispatchEvent(
    new CustomEvent("grid-block-change", {
      detail: { columnKey: "1", index: 0, startsAt: "12:00", endsAt: "17:00" },
      bubbles: true,
      composed: true,
    }),
  );
  await week.updateComplete;
  const parent = week.parentNode!;
  week.remove();
  week.department = structuredClone(week.department);
  parent.appendChild(week);
  await week.updateComplete;
  expect(week.shadowRoot!.querySelector("service-grid")!.columns[0]!.slots).toEqual([
    { periodId: "p1", startsAt: "12:00", endsAt: "17:00" },
  ]);
  expect(
    week.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-date][data-day='1']",
    )!.disabled,
  ).toBe(false);
});
