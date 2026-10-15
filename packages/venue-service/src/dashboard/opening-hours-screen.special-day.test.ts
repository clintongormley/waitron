import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, NavigationGuard } from "@waitron/ui";
import type { HolidayFact } from "../hours-types.js";
import type { OpeningHoursYear, SeasonDays } from "../opening-hours-calendar.js";
import type { SpecialDayDetail, SpecialDayInput } from "../special-days.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { SpecialDayPainter } from "./special-day-painter.js";
import { monthModel } from "../testing/opening-hours-month-fixture.js";
import { frame, painterModel, settle, storedDay } from "../testing/special-day-painter-fixture.js";
import "./opening-hours-screen.js";

type Screen = HTMLElementTagNameMap["dashboard-opening-hours-screen"];

const fair = storedDay({
  id: "sd2",
  name: "Fair week",
  dates: [{ date: "2027-04-20", closedAllDay: false }],
});
const labourDay = storedDay({
  id: "sd3",
  name: "Labour Day",
  dates: [{ date: "2025-05-01", closedAllDay: false, holidayName: "Labour Day" }],
});
const holiday = (date: string, name: string): HolidayFact => ({
  id: `h-${date}`,
  date,
  name,
  scope: "national",
  sourceId: "official",
});
function yearRead(year: number): OpeningHoursYear {
  const day = (date: string, over: Partial<OpeningHoursYear["days"][number]>) => ({
    date,
    seasonId: null,
    specialDay: null,
    holidays: [],
    tone: "standard" as const,
    closed: false,
    ...over,
  });
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 4,
    currentBusinessDay: "2026-12-14",
    pending: null,
    year,
    timeZone: "Europe/Madrid",
    today: "2026-12-14",
    seasons: [],
    days:
      year === 2026
        ? [
            day("2026-12-14", {
              specialDay: { id: "sd1", name: "Christmas dinners" },
              tone: "special_day",
            }),
            day("2026-05-01", {
              holidays: [holiday("2026-05-01", "Labour Day")],
              tone: "public_holiday",
            }),
            day("2026-11-04", {
              holidays: [holiday("2026-11-04", "Town feast")],
              tone: "public_holiday",
            }),
          ]
        : [],
    publicHolidaysAvailable: true,
    missingHolidays: [],
    holidayCoverage: [],
    area: { addressKey: "a", readiness: "ready", options: [], required: false, chosen: null },
  };
}

interface Recorded {
  writes: unknown[][];
  months: string[];
  /** Months whose read fails. */
  failing: string[];
}
function request(recorded: Recorded): DashboardRequest {
  const days: Record<string, SpecialDayDetail> = { sd1: storedDay(), sd2: fair, sd3: labourDay };
  return (async (path: string, method: string, body: unknown) => {
    if (method !== "GET") {
      recorded.writes.push([path, method, body]);
      if (method === "DELETE") return undefined;
      const input = body as SpecialDayInput;
      return {
        id: method === "POST" ? "sd-new" : decodeURIComponent(path.split("/").pop()!),
        name: input.name,
        repeatsYearly: input.repeatsYearly,
        dates: [...input.dates],
        paint: [],
        zonePaint: [],
      } satisfies SpecialDayDetail;
    }
    const year = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
    if (year) return yearRead(Number(year[1]));
    const month = /\/opening-hours\/month\?month=([\d-]+)$/.exec(path);
    if (month) {
      recorded.months.push(month[1]!);
      if (recorded.failing.includes(month[1]!)) throw { code: "connection.failed" };
      // The fixture's December 2026, moved to the month asked for.
      return JSON.parse(JSON.stringify(monthModel()).replaceAll("2026-12", month[1]!));
    }
    if (path.endsWith("/special-days"))
      return Object.values(days).map(({ id, name, repeatsYearly, dates }) => ({
        id,
        name,
        repeatsYearly,
        dates,
      }));
    const day = /\/special-days\/([^/?]+)$/.exec(path);
    if (day) {
      const found = days[decodeURIComponent(day[1]!)];
      if (!found) throw { code: "special_day.not_found" };
      return structuredClone(found);
    }
    if (path.includes("/opening-hours/season-days?"))
      return {
        days: new URL(path, "http://x").searchParams
          .get("dates")!
          .split(",")
          .map((date) => ({ date, seasonId: "winter", dayCutover: "06:00", departments: [] })),
      } satisfies SeasonDays;
    return painterModel();
  }) as DashboardRequest;
}

const hosts: HTMLElement[] = [];
const originalUrl = location.href;
beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-14T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) host.remove();
  history.replaceState(null, "", originalUrl);
});

async function mount(address: string, readOnly = false, failing: string[] = []) {
  history.replaceState(null, "", address);
  const recorded: Recorded = { writes: [], months: [], failing };
  const el = document.createElement("dashboard-opening-hours-screen") as Screen;
  el.api = new OpeningHoursApi(request(recorded));
  el.readOnly = readOnly;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => el.shadowRoot?.querySelector("[data-test=view-switch]")).not.toBeNull();
  await el.updateComplete;
  return { el, ...recorded };
}
function pushedPaths() {
  const pushed = vi.spyOn(history, "pushState");
  return () => pushed.mock.calls.map((call) => new URL(String(call[2]), location.href).pathname);
}
const painterOf = (el: Screen) =>
  el.shadowRoot!.querySelector<SpecialDayPainter>("special-day-painter");
async function shownPainter(el: Screen) {
  await expect.poll(() => painterOf(el)?.shadowRoot?.querySelector("painter-frame")).toBeTruthy();
  const painter = painterOf(el)!;
  await expect.poll(() => painter.shadowRoot!.querySelector("[data-test=loading]")).toBeNull();
  await settle(painter);
  return painter;
}
const nameOf = (painter: SpecialDayPainter) =>
  painter.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")
    ?.value;
const chips = (painter: SpecialDayPainter) =>
  [...painter.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=date-chip]")].flatMap((chip) =>
    chip.dataset.dates!.split(" "),
  );
async function cancel(painter: SpecialDayPainter) {
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
  await settle(painter);
}
const checkedView = (el: Screen) =>
  el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=view-switch] input:checked")?.value;

describe("the special-day painter's address", () => {
  it("opens a stored special day over the Year on a direct load, fed the screen's model and api, and closes to the Year", async () => {
    const { el, writes } = await mount("/manage/opening-hours/view/special-day/special-day/sd1");
    const painter = await shownPainter(el);
    expect(painter.open).toBe(true);
    expect(painter.specialDayId).toBe("sd1");
    expect(painter.api).toBe(el.api);
    expect(painter.model.departments.map(({ id }) => id)).toEqual(["d1", "d2"]);
    expect(painter.readOnly).toBe(false);
    expect(nameOf(painter)).toBe("Christmas dinners");
    expect(checkedView(el)).toBe("year");
    await cancel(painter);
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("opening-hours-year")).not.toBeNull();
    expect(writes).toEqual([]);
  });

  it("opens a new empty special day when the address names none", async () => {
    const { el } = await mount("/manage/opening-hours/view/special-day");
    const painter = await shownPainter(el);
    expect([painter.specialDayId, painter.date]).toEqual([null, null]);
    expect(nameOf(painter)).toBe("");
    expect(chips(painter)).toEqual([]);
  });

  it("opens a new special day on the address's date, pre-filled from that month's read when it is a public holiday", async () => {
    const { el, months } = await mount("/manage/opening-hours/view/special-day/date/2027-01-08");
    const painter = await shownPainter(el);
    expect([painter.specialDayId, painter.date]).toEqual([null, "2027-01-08"]);
    expect(months).toEqual(["2027-01"]);
    expect(nameOf(painter)).toBe("Immaculate Conception");
    expect(chips(painter)).toEqual(["2027-01-08"]);
    await cancel(painter);
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/year");
  });

  it("pre-fills a public holiday in the year it already reads without reading its month", async () => {
    const { el, months } = await mount("/manage/opening-hours/view/special-day/date/2026-11-04");
    const painter = await shownPainter(el);
    expect(nameOf(painter)).toBe("Town feast");
    expect(months).toEqual([]);
  });

  it("opens a new special day unfilled when its month cannot be read", async () => {
    const { el, months } = await mount(
      "/manage/opening-hours/view/special-day/date/2027-01-08",
      false,
      ["2027-01"],
    );
    const painter = await shownPainter(el);
    expect(months).toContain("2027-01");
    expect(nameOf(painter)).toBe("");
    expect(chips(painter)).toEqual(["2027-01-08"]);
  });

  it("Back to a public holiday's address over the Month pre-fills it from the month already read", async () => {
    const { el, months } = await mount("/manage/opening-hours/view/month/month/2026-12");
    await expect
      .poll(() => el.shadowRoot!.querySelector("opening-hours-month")?.model?.month)
      .toBe("2026-12");
    el.shadowRoot!.querySelector("opening-hours-month")!.dispatchEvent(
      new CustomEvent("special-day-action", {
        detail: {
          kind: "open",
          date: "2026-12-14",
          specialDay: { id: "sd1", name: "Christmas dinners" },
          holidays: [],
          returnTo: () => null,
        },
        bubbles: true,
        composed: true,
      }),
    );
    const painter = await shownPainter(el);
    expect(nameOf(painter)).toBe("Christmas dinners");
    history.replaceState(null, "", "/manage/opening-hours/view/special-day/date/2026-12-08");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => nameOf(painter)).toBe("Immaculate Conception");
    expect(chips(painter)).toEqual(["2026-12-08"]);
    expect(months).toEqual(["2026-12"]);
  });

  it("opens a stored special day with the address's date added to its draft, saving nothing", async () => {
    const { el, writes } = await mount(
      "/manage/opening-hours/view/special-day/special-day/sd1/date/2026-12-20",
    );
    const painter = await shownPainter(el);
    expect([painter.specialDayId, painter.addDate]).toEqual(["sd1", "2026-12-20"]);
    await expect
      .poll(() => chips(painter))
      .toEqual(["2026-12-14", "2026-12-15", "2026-12-20", "2026-12-25"]);
    expect(writes).toEqual([]);
  });

  it("opens a stored special day at once when the date to add is in a month it has not read", async () => {
    const { el } = await mount(
      "/manage/opening-hours/view/special-day/special-day/sd1/date/2027-01-08",
    );
    const painter = await shownPainter(el);
    await expect
      .poll(() => chips(painter))
      .toEqual(["2026-12-14", "2026-12-15", "2026-12-25", "2027-01-08"]);
  });

  it("Back and Forward between two special days' addresses reseed the painter with the other day", async () => {
    const { el } = await mount("/manage/opening-hours/view/special-day/special-day/sd1");
    const painter = await shownPainter(el);
    expect(nameOf(painter)).toBe("Christmas dinners");
    history.replaceState(null, "", "/manage/opening-hours/view/special-day/special-day/sd2");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => nameOf(painter)).toBe("Fair week");
    expect(chips(painter)).toEqual(["2027-04-20"]);
    history.replaceState(null, "", "/manage/opening-hours/view/special-day/special-day/sd1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => nameOf(painter)).toBe("Christmas dinners");
    expect(painterOf(el)).toBe(painter);
  });

  it("gives a viewer a read-only painter", async () => {
    const { el } = await mount("/manage/opening-hours/view/special-day/special-day/sd1", true);
    expect((await shownPainter(el)).readOnly).toBe(true);
  });

  it.each([
    [
      "/manage/opening-hours/view/date/date/2026-12-14",
      "/manage/opening-hours/view/month/month/2026-12",
    ],
    ["/manage/opening-hours/view/date", "/manage/opening-hours/view/month"],
  ])("replaces an old date address %s with the Month view of its date", async (from, to) => {
    const { el } = await mount(from);
    await expect.poll(() => location.pathname).toBe(to);
    await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-month")).not.toBeNull();
    expect(checkedView(el)).toBe("month");
  });
});

class GuardedApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly recorded: Recorded = { writes: [], months: [], failing: [] };
  readonly api = new OpeningHoursApi(request(this.recorded));
  override render() {
    return html`<dashboard-opening-hours-screen .api=${this.api}></dashboard-opening-hours-screen
      >${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("special-day-guarded-test-app", GuardedApp);

describe("Back and Forward under the app's leave guard", () => {
  const at = (date: string) =>
    `/manage/opening-hours/view/special-day/special-day/sd1/date/${date}`;
  async function choose(app: GuardedApp, decision: "keep" | "discard") {
    await app.updateComplete;
    const question =
      app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
        "wt-unsaved-changes",
      )!;
    await expect.poll(() => question.open).toBe(true);
    question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
    await expect.poll(() => question.open).toBe(false);
  }

  it("to the same day with another date to add asks first: Keep stays, Discard opens it with that date alone, and Save sends that date", async () => {
    history.replaceState(null, "", "/manage/before");
    let app: GuardedApp | undefined;
    const guard = new NavigationGuard(window, {
      isDirty: () => app?.leave.coordinator.isDirty() ?? false,
      request: (proceed, signal) =>
        app!.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
    });
    try {
      await guard.write(at("2026-12-16"));
      await guard.write(at("2026-12-20"));
      app = document.createElement("special-day-guarded-test-app") as GuardedApp;
      applyTokens(app);
      hosts.push(app);
      document.body.append(app);
      await app.updateComplete;
      const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
      const painter = await shownPainter(el);
      await expect
        .poll(() => chips(painter))
        .toEqual(["2026-12-14", "2026-12-15", "2026-12-20", "2026-12-25"]);
      history.back();
      await choose(app, "keep");
      await expect.poll(() => location.pathname).toBe(at("2026-12-20"));
      expect(painter.addDate).toBe("2026-12-20");
      expect(chips(painter)).toEqual(["2026-12-14", "2026-12-15", "2026-12-20", "2026-12-25"]);
      history.back();
      await choose(app, "discard");
      await expect.poll(() => location.pathname).toBe(at("2026-12-16"));
      await expect.poll(() => painter.addDate).toBe("2026-12-16");
      await expect
        .poll(() => chips(painter))
        .toEqual(["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-25"]);
      frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
      await expect.poll(() => app!.recorded.writes.length).toBe(1);
      const [path, method, body] = app.recorded.writes[0]!;
      expect([path, method]).toEqual(["/management-api/venue-service/special-days/sd1", "PUT"]);
      expect((body as SpecialDayInput).dates.map(({ date }) => date)).toEqual([
        "2026-12-14",
        "2026-12-15",
        "2026-12-16",
        "2026-12-25",
      ]);
    } finally {
      guard.dispose();
    }
  });
});

describe("after the painter writes", () => {
  it("a new day once saved takes its own address without a new history entry", async () => {
    const { el, writes } = await mount("/manage/opening-hours/view/special-day/date/2026-12-10");
    const painter = await shownPainter(el);
    painter.shadowRoot!.querySelector("wt-input[name=name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Staff party" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(painter);
    const pushed = pushedPaths();
    frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/special-day/special-day/sd-new");
    expect(writes.map(([path, method]) => [path, method])).toEqual([
      ["/management-api/venue-service/special-days", "POST"],
    ]);
    expect(pushed()).toEqual([]);
    expect(painterOf(el)).toBe(painter);
    expect(painter.specialDayId).toBe("sd-new");
    expect(nameOf(painter)).toBe("Staff party");
  });

  it("Add to the same-named day takes that day's address without a new history entry", async () => {
    const { el, writes } = await mount("/manage/opening-hours/view/special-day/date/2026-05-01");
    const painter = await shownPainter(el);
    await expect.poll(() => painter.shadowRoot!.querySelector("[data-test=add-to]")).not.toBeNull();
    const pushed = pushedPaths();
    painter.shadowRoot!.querySelector<HTMLElement>("[data-test=add-to]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/special-day/special-day/sd3");
    expect(pushed()).toEqual([]);
    expect(painterOf(el)).toBe(painter);
    await expect.poll(() => chips(painter)).toEqual(["2025-05-01", "2026-05-01"]);
    expect(writes).toEqual([]);
  });

  it("a deleted special day closes the painter once, back to the view it opened over", async () => {
    history.replaceState(null, "", "/manage/before");
    history.pushState(null, "", "/manage/opening-hours/view/year/year/2026");
    const { el, writes } = await mount("/manage/opening-hours/view/year/year/2026");
    const year = el.shadowRoot!.querySelector("opening-hours-year")!;
    await expect
      .poll(() => year.shadowRoot!.querySelector("td[data-date='2026-12-14'] button"))
      .not.toBeNull();
    year.shadowRoot!.querySelector<HTMLElement>("td[data-date='2026-12-14'] button")!.click();
    await year.updateComplete;
    year.shadowRoot!.querySelector<HTMLElement>("[data-test=special-edit]")!.click();
    const painter = await shownPainter(el);
    painter.shadowRoot!.querySelector<HTMLElement>("[data-test=delete]")!.click();
    await settle(painter);
    const back = vi.spyOn(history, "back");
    const replaced = vi.spyOn(history, "replaceState");
    painter.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
    expect(replaced).not.toHaveBeenCalled();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2026");
    expect(writes.map(([path, method]) => [path, method])).toEqual([
      ["/management-api/venue-service/special-days/sd1", "DELETE"],
    ]);
    history.back();
    await expect.poll(() => location.pathname).toBe("/manage/before");
  });
});

describe("links into the special-day painter", () => {
  async function yearPanel(el: Screen, date: string, button: string) {
    const year = el.shadowRoot!.querySelector("opening-hours-year")!;
    await expect
      .poll(() => year.shadowRoot!.querySelector(`td[data-date='${date}'] button`))
      .not.toBeNull();
    year.shadowRoot!.querySelector<HTMLElement>(`td[data-date='${date}'] button`)!.click();
    await year.updateComplete;
    year.shadowRoot!.querySelector<HTMLElement>(`[data-test=${button}]`)!.click();
  }
  async function shownMonth(el: Screen) {
    await expect
      .poll(() => el.shadowRoot!.querySelector("opening-hours-month")?.model?.month)
      .toBe("2026-12");
    const month = el.shadowRoot!.querySelector("opening-hours-month")!;
    await month.updateComplete;
    return month;
  }
  const dateButton = (month: HTMLElementTagNameMap["opening-hours-month"], date: string) =>
    month.shadowRoot!.querySelector<HTMLElement>(`td[data-date="${date}"] button`)!;
  async function monthBox(el: Screen, date: string, test: string) {
    dateButton(await shownMonth(el), date).click();
    await expect
      .poll(() => el.shadowRoot!.querySelector(`calendar-day-box [data-test=${test}]`))
      .not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>(`calendar-day-box [data-test=${test}]`)!.click();
  }

  it("the Year's Edit on a special day's date opens the painter on it, and closing goes back to that year", async () => {
    const { el } = await mount("/manage/opening-hours/view/year/year/2026");
    const pushed = pushedPaths();
    await yearPanel(el, "2026-12-14", "special-edit");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/special-day/special-day/sd1");
    expect(pushed()).toEqual(["/manage/opening-hours/view/special-day/special-day/sd1"]);
    const painter = await shownPainter(el);
    expect(nameOf(painter)).toBe("Christmas dinners");
    expect(el.shadowRoot!.querySelector("opening-hours-year")!.year).toBe(2026);
    await cancel(painter);
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2026");
    await expect.poll(() => painterOf(el)).toBeNull();
  });

  it("the Year's Make on a public holiday opens a new day pre-filled from the holidays the Year sent", async () => {
    const { el, months } = await mount("/manage/opening-hours/view/year/year/2026");
    await yearPanel(el, "2026-11-04", "special-add");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/special-day/date/2026-11-04");
    const painter = await shownPainter(el);
    expect(nameOf(painter)).toBe("Town feast");
    expect(months).toEqual([]);
  });

  it("the Year's Delete still asks in its own confirmation and opens no painter", async () => {
    const { el } = await mount("/manage/opening-hours/view/year/year/2026");
    await yearPanel(el, "2026-12-14", "special-delete");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .not.toBeNull();
    expect(painterOf(el)).toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/year/year/2026");
  });

  it("the Month's special date opens the painter on its special day, and its public holiday a new day pre-filled", async () => {
    const { el } = await mount("/manage/opening-hours/view/month/month/2026-12");
    await monthBox(el, "2026-12-14", "special-edit");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/special-day/special-day/company");
    await cancel(await shownPainter(el));
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/month/2026-12");
    await expect.poll(() => painterOf(el)).toBeNull();
    await monthBox(el, "2026-12-08", "special-add");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/special-day/date/2026-12-08");
    expect(nameOf(await shownPainter(el))).toBe("Immaculate Conception");
  });

  it("the ordinary date's Make this a special day opens a new day on that date", async () => {
    const { el, writes } = await mount("/manage/opening-hours/view/month/month/2026-12");
    await monthBox(el, "2026-12-10", "special-add");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/special-day/date/2026-12-10");
    const painter = await shownPainter(el);
    expect(chips(painter)).toEqual(["2026-12-10"]);
    expect(nameOf(painter)).toBe("");
    expect(writes).toEqual([]);
  });
});
