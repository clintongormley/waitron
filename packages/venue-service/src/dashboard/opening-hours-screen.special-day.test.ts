import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { commands, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, NavigationGuard } from "@waitron/ui";
import type { HolidayFact, LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
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
function everyDate2026(
  day: (
    date: string,
    over: Partial<OpeningHoursYear["days"][number]>,
  ) => OpeningHoursYear["days"][number],
) {
  const facts: Record<string, Partial<OpeningHoursYear["days"][number]>> = {
    "2026-12-14": { specialDay: { id: "sd1", name: "Christmas dinners" }, tone: "special_day" },
    "2026-05-01": { holidays: [holiday("2026-05-01", "Labour Day")], tone: "public_holiday" },
    "2026-10-20": { holidays: [holiday("2026-10-20", "Harvest day")], tone: "public_holiday" },
    "2026-11-04": { holidays: [holiday("2026-11-04", "Town feast")], tone: "public_holiday" },
  };
  const days: OpeningHoursYear["days"][number][] = [];
  for (let date = "2026-01-01"; date <= "2026-12-31"; date = addDays(date, 1))
    days.push(day(date, facts[date] ?? {}));
  return days;
}
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
    days: year === 2026 ? everyDate2026(day) : [],
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
  /** Months whose read never answers: this file's year read and its December disagree on 14
   *  December, so a Year date's box is held to what the year read says. */
  holding?: string[];
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
    if (path === "/management-api/stations") return [];
    const year = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
    if (year) return yearRead(Number(year[1]));
    const month = /\/opening-hours\/month\?month=([\d-]+)$/.exec(path);
    if (month) {
      recorded.months.push(month[1]!);
      if (recorded.failing.includes(month[1]!)) throw { code: "connection.failed" };
      if (recorded.holding?.includes(month[1]!)) return new Promise(() => {});
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
    if (path.endsWith("/menu-periods/painted-in")) return [];
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
afterEach(() => commands.parkPointer());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) host.remove();
  history.replaceState(null, "", originalUrl);
});

async function mount(
  address: string,
  readOnly = false,
  failing: string[] = [],
  holding: string[] = [],
) {
  history.replaceState(null, "", address);
  const recorded: Recorded = { writes: [], months: [], failing, holding };
  const el = document.createElement("dashboard-opening-hours-screen") as Screen;
  el.api = new OpeningHoursApi(request(recorded));
  el.readOnly = readOnly;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => drawnView(el)).toBeDefined();
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
/** Which Opening hours view is drawn, known by its own heading. */
const drawnView = (el: Screen) =>
  el.shadowRoot!.querySelector("opening-hours-year")?.shadowRoot?.querySelector("[data-test=year]")
    ? "year"
    : el
          .shadowRoot!.querySelector("opening-hours-month")
          ?.shadowRoot?.querySelector("[data-test=month]")
      ? "month"
      : undefined;

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
    expect(drawnView(el)).toBe("year");
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
    history.pushState(null, "", "/manage/opening-hours/view/special-day/special-day/sd1");
    window.dispatchEvent(new PopStateEvent("popstate"));
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
    expect(drawnView(el)).toBe("month");
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

describe("a run picked on the Year", () => {
  const daySel = (date: LocalDate) => `opening-hours-year td[data-date="${date}"] button`;
  const yearOf = (el: Screen) => el.shadowRoot!.querySelector("opening-hours-year")!;
  const dayButton = (el: Screen, date: LocalDate) =>
    yearOf(el).shadowRoot!.querySelector<HTMLButtonElement>(`td[data-date="${date}"] button`)!;
  async function yearShown(address = "/manage/opening-hours/view/year") {
    const mounted = await mount(address);
    await expect.poll(() => yearOf(mounted.el)?.model?.year).toBe(2026);
    await yearOf(mounted.el).updateComplete;
    return mounted;
  }
  const run = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
  /** The real mouse presses where the dates are drawn, so they are scrolled into view first. */
  async function drag(el: Screen, dates: LocalDate[]) {
    dayButton(el, dates[0]!).scrollIntoView({ block: "center" });
    await commands.mouseDrag(dates.map(daySel));
  }

  /** Whether a day box was drawn at all, and whether one was still drawn as the painter was. */
  function watchBox(el: Screen) {
    const seen = { box: false, boxBesidePainter: false };
    const observer = new MutationObserver(() => {
      const root = el.shadowRoot!;
      if (root.querySelector("calendar-day-box")) seen.box = true;
      if (root.querySelector("special-day-painter") && root.querySelector("calendar-day-box"))
        seen.boxBesidePainter = true;
    });
    observer.observe(el.shadowRoot!, { childList: true, subtree: true });
    return { seen, stop: () => observer.disconnect() };
  }

  it("a double-click on a run in the Year opens a new day holding it", async () => {
    const { el, writes } = await yearShown();
    await drag(el, run);
    const watched = watchBox(el);
    await userEvent.dblClick(dayButton(el, "2026-10-22"));
    const painter = await shownPainter(el);
    watched.stop();
    expect(watched.seen).toEqual({ box: true, boxBesidePainter: false });
    expect(location.pathname).toBe(
      "/manage/opening-hours/view/special-day/date/2026-10-20/to/2026-10-23",
    );
    expect([painter.specialDayId, painter.date, painter.lastDate]).toEqual([
      null,
      "2026-10-20",
      "2026-10-23",
    ]);
    expect(chips(painter)).toEqual(run);
    expect(nameOf(painter)).toBe("Harvest day");
    await expect.poll(() => el.shadowRoot!.querySelector("calendar-day-box")).toBeNull();
    expect(writes).toEqual([]);
  });

  it("a double-click on a special day's date opens that day, whatever is picked", async () => {
    const { el, writes } = await yearShown();
    await drag(el, ["2026-12-12", "2026-12-13", "2026-12-14", "2026-12-15"]);
    await userEvent.dblClick(dayButton(el, "2026-12-14"));
    const painter = await shownPainter(el);
    expect(location.pathname).toBe("/manage/opening-hours/view/special-day/special-day/sd1");
    expect(painter.specialDayId).toBe("sd1");
    expect(nameOf(painter)).toBe("Christmas dinners");
    await expect.poll(() => el.shadowRoot!.querySelector("calendar-day-box")).toBeNull();
    expect(writes).toEqual([]);
  });

  it("Back from the painter returns to the Year with the address it had", async () => {
    const address = "/manage/opening-hours/view/year/year/2026";
    const { el } = await yearShown(address);
    await drag(el, run);
    await userEvent.dblClick(dayButton(el, "2026-10-22"));
    await shownPainter(el);
    history.back();
    await expect.poll(() => location.pathname).toBe(address);
    await expect.poll(() => painterOf(el)).toBeNull();
    expect(drawnView(el)).toBe("year");
  });

  it("a run of 366 dates read from an address opens whole, and a longer one opens on its first date alone", async () => {
    const whole = await mount(
      "/manage/opening-hours/view/special-day/date/2026-01-01/to/2027-01-01",
    );
    const painter = await shownPainter(whole.el);
    expect(painter.lastDate).toBe("2027-01-01");
    expect(chips(painter)).toHaveLength(366);
    whole.el.remove();
    const longer = await mount(
      "/manage/opening-hours/view/special-day/date/2026-01-01/to/2027-01-03",
    );
    const single = await shownPainter(longer.el);
    expect([single.date, single.lastDate]).toEqual(["2026-01-01", null]);
    expect(chips(single)).toEqual(["2026-01-01"]);
  });

  it("a run of 367 dates read from an address opens on its first date alone", async () => {
    const { el } = await mount(
      "/manage/opening-hours/view/special-day/date/2026-01-01/to/2027-01-02",
    );
    const painter = await shownPainter(el);
    expect([painter.date, painter.lastDate]).toEqual(["2026-01-01", null]);
    expect(chips(painter)).toEqual(["2026-01-01"]);
  });

  it("a run in the year 9999 read from an address opens whole", async () => {
    const { el } = await mount(
      "/manage/opening-hours/view/special-day/date/9999-01-01/to/9999-01-03",
    );
    const painter = await shownPainter(el);
    expect([painter.date, painter.lastDate]).toEqual(["9999-01-01", "9999-01-03"]);
    expect(chips(painter)).toEqual(["9999-01-01", "9999-01-02", "9999-01-03"]);
  });

  it("a run ending on 9999-12-31 read from an address opens whole", async () => {
    const { el } = await mount(
      "/manage/opening-hours/view/special-day/date/9999-12-30/to/9999-12-31",
    );
    const painter = await shownPainter(el);
    expect([painter.date, painter.lastDate]).toEqual(["9999-12-30", "9999-12-31"]);
    expect(chips(painter)).toEqual(["9999-12-30", "9999-12-31"]);
  });

  it("a direct load of a run's address opens it", async () => {
    const { el } = await mount(
      "/manage/opening-hours/view/special-day/date/2026-10-20/to/2026-10-23",
    );
    const painter = await shownPainter(el);
    expect([painter.date, painter.lastDate]).toEqual(["2026-10-20", "2026-10-23"]);
    expect(chips(painter)).toEqual(run);
    expect(nameOf(painter)).toBe("Harvest day");
  });
});

describe("a run picked on the Month", () => {
  const monthOf = (el: Screen) => el.shadowRoot!.querySelector("opening-hours-month")!;
  const daySel = (date: LocalDate) => `opening-hours-month [data-date="${date}"] button`;

  it("a double-click on a run in the Month opens a new day holding it", async () => {
    const { el, writes } = await mount("/manage/opening-hours/view/month/month/2026-12");
    await expect.poll(() => monthOf(el)?.model?.month).toBe("2026-12");
    await monthOf(el).updateComplete;
    const run = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"];
    const button = (date: LocalDate) =>
      monthOf(el).shadowRoot!.querySelector<HTMLButtonElement>(`[data-date="${date}"] button`)!;
    button(run[0]!).scrollIntoView({ block: "center" });
    await commands.mouseDrag(run.map(daySel));
    await userEvent.dblClick(button("2026-12-03"));
    const painter = await shownPainter(el);
    expect(location.pathname).toBe(
      "/manage/opening-hours/view/special-day/date/2026-12-01/to/2026-12-04",
    );
    expect(chips(painter)).toEqual(run);
    await expect.poll(() => el.shadowRoot!.querySelector("calendar-day-box")).toBeNull();
    expect(writes).toEqual([]);
  });

  it("a double-click on a special day's date in the Month opens that day", async () => {
    const { el, writes } = await mount("/manage/opening-hours/view/month/month/2026-12");
    await expect.poll(() => monthOf(el)?.model?.month).toBe("2026-12");
    await monthOf(el).updateComplete;
    const button = monthOf(el).shadowRoot!.querySelector<HTMLButtonElement>(
      `[data-date="2026-12-14"] button`,
    )!;
    button.scrollIntoView({ block: "center" });
    await userEvent.dblClick(button);
    const painter = await shownPainter(el);
    expect(location.pathname).toBe("/manage/opening-hours/view/special-day/special-day/company");
    expect(painter.specialDayId).toBe("company");
    await expect.poll(() => el.shadowRoot!.querySelector("calendar-day-box")).toBeNull();
    expect(writes).toEqual([]);
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
    const { el, writes } = await mount(
      "/manage/opening-hours/view/year/year/2026",
      false,
      [],
      ["2026-12"],
    );
    const year = el.shadowRoot!.querySelector("opening-hours-year")!;
    await expect
      .poll(() => year.shadowRoot!.querySelector("td[data-date='2026-12-14'] button"))
      .not.toBeNull();
    year.shadowRoot!.querySelector<HTMLElement>("td[data-date='2026-12-14'] button")!.click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("calendar-day-box [data-test=special-edit]"))
      .not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("calendar-day-box [data-test=special-edit]")!.click();
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
  async function yearBox(el: Screen, date: string, button: string) {
    const year = el.shadowRoot!.querySelector("opening-hours-year")!;
    await expect
      .poll(() => year.shadowRoot!.querySelector(`td[data-date='${date}'] button`))
      .not.toBeNull();
    year.shadowRoot!.querySelector<HTMLElement>(`td[data-date='${date}'] button`)!.click();
    await expect
      .poll(() => el.shadowRoot!.querySelector(`calendar-day-box [data-test=${button}]`))
      .not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>(`calendar-day-box [data-test=${button}]`)!.click();
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

  it("the Year's box's Edit special day on a special day's date opens the painter on it, and closing goes back to that year", async () => {
    const { el } = await mount("/manage/opening-hours/view/year/year/2026", false, [], ["2026-12"]);
    const pushed = pushedPaths();
    await yearBox(el, "2026-12-14", "special-edit");
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

  it("the Year's box's Make a special day on a public holiday opens a new day pre-filled from the holidays the box sent", async () => {
    const { el, months } = await mount(
      "/manage/opening-hours/view/year/year/2026",
      false,
      [],
      ["2026-11"],
    );
    await yearBox(el, "2026-11-04", "special-add");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/special-day/date/2026-11-04");
    const painter = await shownPainter(el);
    expect(nameOf(painter)).toBe("Town feast");
    expect(months).toEqual(["2026-11"]);
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

  it("an ordinary date's Make a special day opens a new day on that date", async () => {
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

describe("the special-day painter's Periods link", () => {
  const base = "/manage/opening-hours/view/special-day/special-day/sd1";
  const link = (painter: SpecialDayPainter) =>
    painter.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=periods-link]")!;
  const periodsWindow = (el: Screen) =>
    el.shadowRoot!.querySelector("[data-test=calendar-window][data-window=periods] periods-list");

  it("the special-day painter's Periods link opens the window over it and keeps its unsaved day", async () => {
    history.replaceState(null, "", base);
    const app = document.createElement("special-day-guarded-test-app") as GuardedApp;
    applyTokens(app);
    hosts.push(app);
    document.body.append(app);
    await app.updateComplete;
    const el = app.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
    const painter = await shownPainter(el);
    painter.shadowRoot!.querySelector("wt-input[name=name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Staff party" },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(painter);
    expect(app.leave.coordinator.isDirty()).toBe(true);
    const question =
      app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-unsaved-changes"]>(
        "wt-unsaved-changes",
      )!;
    const pushes = pushedPaths();
    await userEvent.click(link(painter));
    await expect.poll(() => location.pathname).toBe(`${base}/window/periods`);
    await expect.poll(() => periodsWindow(el)).not.toBeNull();
    expect(pushes()).toEqual([`${base}/window/periods`]);
    expect(question.open).toBe(false);
    expect(painterOf(el)).toBe(painter);
    expect(nameOf(painter)).toBe("Staff party");
    expect(app.leave.coordinator.isDirty()).toBe(true);
    history.back();
    await expect.poll(() => location.pathname).toBe(base);
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=calendar-window]")).toBeNull();
    expect(question.open).toBe(false);
    expect(painterOf(el)).toBe(painter);
    expect(nameOf(painter)).toBe("Staff party");
    expect(app.leave.coordinator.isDirty()).toBe(true);
    expect(app.recorded.writes).toEqual([]);
  });

  it("a modified click on its Periods link is left to the browser", async () => {
    const { el } = await mount(base);
    const painter = await shownPainter(el);
    const seen: boolean[] = [];
    // Bubbling on window runs after the screen's own listener, so it sees what the screen did.
    const record = (event: Event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", record);
    try {
      const press = (init: MouseEventInit) =>
        link(painter).dispatchEvent(
          new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ...init }),
        );
      press({ ctrlKey: true });
      await el.updateComplete;
      expect(seen).toEqual([false]);
      expect(location.pathname).toBe(base);
      press({});
      expect(seen).toEqual([false, true]);
      await expect.poll(() => location.pathname).toBe(`${base}/window/periods`);
    } finally {
      window.removeEventListener("click", record);
    }
  });
});
