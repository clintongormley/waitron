import { render } from "lit";
import { showPicker } from "./calendar-show.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { PrepStation } from "./routing-client.js";
import { DEPARTMENTS } from "../testing/opening-hours-month-fixture.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import { monthModel } from "../testing/opening-hours-month-fixture.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./opening-hours-screen.js";
type Calendar = HTMLElementTagNameMap["dashboard-opening-hours-screen"];
const originalUrl = location.href;

const hosts: HTMLElement[] = [];
beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-10T10:00:00Z"));
});
afterEach(() => {
  DINNER = { periodId: "dinner", startsAt: "19:00", endsAt: "01:00" };
  ALL_DAY = { periodId: "allday", startsAt: "10:00", endsAt: "02:00" };
  vi.useRealTimers();
  hosts.splice(0).forEach((host) => host.remove());
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});

const STATIONS: PrepStation[] = [
  { id: "pass", name: "Pass", active: true, isDefault: false },
  { id: "kitchen", name: "Kitchen", active: true, isDefault: true },
  { id: "grill", name: "Grill", active: true, isDefault: false },
  { id: "off", name: "Off", active: false, isDefault: false },
].map((station) => ({
  ...station,
  colour: "red",
  printMovedSlips: true,
  ticketGrouping: "combined",
  printHeldWork: false,
  waitsForPass: false,
  bumpMode: "line",
  changesAfterSending: "held-or-waiting",
  whenClosedSendsTo: null,
  showsRestOfOrder: false,
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
  readyWarningAfterMinutes: 3,
}));
/** Each month's whole Monday-to-Sunday weeks, as the server reads them. */
const WEEKS: Record<string, [LocalDate, LocalDate]> = {
  "2026-12": ["2026-11-30", "2027-01-03"],
  "2027-01": ["2026-12-28", "2027-01-31"],
};
function meta(month: string): OpeningHoursMonth {
  const december = monthModel();
  if (month === "2026-12") return december;
  const [from, to] = WEEKS[month]!;
  const template = december.days[1]!;
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1))
    days.push({
      ...template,
      date,
      inMonth: date.startsWith(month),
      specialDay: null,
      holidays: [],
      closedAllDay: false,
    });
  return { ...december, month, days };
}

const sunday = (date: LocalDate) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
let DINNER = { periodId: "dinner", startsAt: "19:00", endsAt: "01:00" };
let ALL_DAY = { periodId: "allday", startsAt: "10:00", endsAt: "02:00" };
/** The Grill makes the Restaurant's dinners, never on a Sunday; the Pass gets the Restaurant's
 *  dinners, never on a Sunday, and the Bar's all-day orders, and nothing on 15 December. Neither
 *  gets anything on 25 December. The Pass's read lists the Bar first, so only the month read's
 *  department order puts the Restaurant's track first. */
function stationDay(stationId: string, date: LocalDate) {
  if (date === "2026-12-25") return [];
  if (stationId === "grill")
    return sunday(date) ? [] : [{ departmentId: "rest", ranges: [DINNER] }];
  if (date === "2026-12-15") return [];
  return [
    { departmentId: "bar", ranges: [ALL_DAY] },
    ...(sunday(date) ? [] : [{ departmentId: "rest", ranges: [DINNER] }]),
  ];
}

type Kind = "month" | "times";
function harness() {
  const state = { stations: STATIONS, readOnly: false, theme: "light" as "light" | "dark" };
  const calls: { path: string; options: unknown }[] = [];
  const failing: Record<Kind, boolean> = { month: false, times: false };
  const held: Partial<Record<Kind, Promise<void>>> = {};
  const request = (async (path: string, _method: string, _body: unknown, options: unknown) => {
    calls.push({ path, options });
    const url = new URL(path, location.origin);
    if (url.pathname === "/management-api/stations") return state.stations;
    if (url.pathname.endsWith("/opening-hours")) {
      const read = meta("2026-12");
      return {
        businessDayClock: read.businessDayClock,
        clockRevision: read.clockRevision,
        currentBusinessDay: "2026-12-10",
        pending: null,
        timeZone: "Europe/Madrid",
        clockReadable: true,
        dayCutover: "06:00",
        menus: [],
        seasons: read.seasons,
        currentSeasonId: "winter",
        departments: DEPARTMENTS,
      } satisfies OpeningHoursModel;
    }
    if (url.pathname.endsWith("/special-days")) return [];
    const kind: Kind = url.pathname.endsWith("/opening-hours/month") ? "month" : "times";
    const wait = held[kind];
    if (wait) await wait;
    if (failing[kind]) throw new Error(`${kind} refused`);
    if (kind === "month") return meta(url.searchParams.get("month")!);
    if (url.pathname.endsWith("/stations/service-times")) {
      return Object.fromEntries(
        state.stations
          .filter((row) => row.active)
          .map((station) => {
            const days = [];
            for (
              let date = url.searchParams.get("from")!;
              date <= url.searchParams.get("to")!;
              date = addDays(date, 1)
            )
              days.push({ date, departments: stationDay(station.id, date) });
            return [station.id, { days }];
          }),
      );
    }
    const stationId = url.pathname.split("/").at(-2)!;
    const days = [];
    const to = url.searchParams.get("to")!;
    for (let date = url.searchParams.get("from")!; date <= to; date = addDays(date, 1))
      days.push({ date, departments: stationDay(stationId, date) });
    return { days };
  }) as DashboardRequest;
  const hold = (kind: Kind) => {
    let release!: () => void;
    held[kind] = new Promise<void>((resolve) => (release = resolve));
    return () => {
      delete held[kind];
      release();
    };
  };
  return { api: new OpeningHoursApi(request), calls, failing, hold, state };
}

async function mount(
  props: { stationId?: string; stations?: PrepStation[]; show?: string } = {},
  h: ReturnType<typeof harness> = harness(),
) {
  if (props.stations) h.state.stations = props.stations;
  history.replaceState(
    null,
    "",
    `/opening-hours/view/month/${props.show ? `show/${props.show}` : `station/${props.stationId ?? "grill"}`}/month/2026-12`,
  );
  const el = document.createElement("dashboard-opening-hours-screen");
  el.api = h.api;
  el.readOnly = h.state.readOnly;
  applyTokens(el);
  el.setAttribute("data-theme", h.state.theme);
  el.style.background = "var(--wt-color-bg)";
  el.style.color = "var(--wt-color-text)";
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => month(el)).toBeDefined();
  await el.updateComplete;
  return { el, ...h };
}

const month = (el: Calendar) => el.shadowRoot!.querySelector("opening-hours-month") ?? undefined;
const monthRoot = (el: Calendar) => month(el)?.shadowRoot;
const cell = (el: Calendar, date: LocalDate) =>
  monthRoot(el)?.querySelector<HTMLElement>(`[data-date="${date}"]`) ?? null;
const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const titles = (el: Calendar, date: LocalDate) =>
  [...(cell(el, date)?.querySelectorAll<HTMLElement>(".segment") ?? [])].map((s) => s.title);
const alerts = (el: Calendar) => [...el.shadowRoot!.querySelectorAll('[role="alert"]')];
const picker = (el: Calendar) =>
  monthRoot(el)?.querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox");
const readsOf = (calls: { path: string }[], kind: "month?" | "service-times?") =>
  calls.filter(({ path }) => path.includes(kind)).map(({ path }) => path);
const segmentsOf = (track: Element) => [...track.querySelectorAll<HTMLElement>(".segment")];
const percent = (value: string) => Number.parseFloat(value);
const drawn = (el: Calendar, date: LocalDate, row: string) =>
  expect.poll(() => cell(el, date)?.querySelector(`.track[data-row="${row}"]`) ?? null);

describe("A725 Calendar station month, migrated from Times", () => {
  it.each(["en", "es"] as const)(
    "offers active stations in the Calendar Show picker in %s",
    async (locale) => {
      setLocale(locale);
      const { el } = await mount();
      await drawn(el, "2026-12-01", "rest").not.toBeNull();
      expect(picker(el)!.name).toBe("departmentId");
      expect(picker(el)!.label).toBe(locale === "en" ? "Show" : "Mostrar");
      expect(picker(el)!.search).toBe("never");
      expect(picker(el)!.options.filter(({ value }) => value.startsWith("station:"))).toEqual([
        {
          value: "station:grill",
          label: "Grill",
          depth: 1,
          icon: "prep-station",
          iconPosition: "end",
          iconLabel: locale === "en" ? "Prep station" : "Estación de preparación",
        },
        {
          value: "station:kitchen",
          label: "Kitchen",
          depth: 1,
          icon: "prep-station",
          iconPosition: "end",
          iconLabel: locale === "en" ? "Prep station" : "Estación de preparación",
        },
        {
          value: "station:pass",
          label: "Pass",
          depth: 1,
          icon: "prep-station",
          iconPosition: "end",
          iconLabel: locale === "en" ? "Prep station" : "Estación de preparación",
        },
      ]);
      expect(picker(el)!.value).toBe("station:grill");
      expect(
        picker(el)!.compareDocumentPosition(monthRoot(el)!.querySelector("table")!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it("draws one department's station ranges from passive month and station reads", async () => {
    const { el, calls } = await mount({ stationId: "grill" });
    await drawn(el, "2026-12-01", "rest").not.toBeNull();
    const view = month(el)!;
    expect(view.station?.state).toBe("ready");
    expect(view.readOnly).toBe(false);
    expect(readsOf(calls, "month?")).toEqual([
      "/management-api/venue-service/opening-hours/month?month=2026-12",
    ]);
    expect(readsOf(calls, "service-times?")).toEqual([
      "/management-api/venue-service/stations/grill/service-times?from=2026-11-30&to=2027-01-03",
    ]);
    for (const { options } of calls) expect(options).toEqual({ passive: true });
    expect(text(monthRoot(el)!.querySelector('[data-test="month"]'))).toBe("December 2026");
    expect(month(el)!.station).toMatchObject({
      state: "ready",
      departments: [{ id: "rest", name: "Restaurant" }],
    });
    expect(cell(el, "2026-12-01")!.querySelectorAll(".track")).toHaveLength(1);
    expect(titles(el, "2026-12-01")).toEqual(["Dinner (Restaurant) 19:00–01:00"]);
    expect(cell(el, "2026-12-01")!.querySelector(".day")!.textContent).toContain(
      "Restaurant: Dinner 19:00–01:00",
    );
    // A Sunday the station gets nothing still carries its row.
    expect(text(cell(el, "2026-12-06")!.querySelector('[data-test="no-orders"]'))).toBe("Closed");
    expect(cell(el, "2026-12-25")!.hasAttribute("data-closed")).toBe(true);
    expect(text(cell(el, "2026-12-25")!.querySelector('[data-test="name"]'))).toBe(
      "Christmas Day · Closed",
    );
    expect(text(cell(el, "2026-12-14")!.querySelector('[data-test="name"]'))).toBe(
      "Company dinners",
    );
  });

  it("draws and names each department's track in the month read's order", async () => {
    for (const locale of ["en", "es"] as const) {
      setLocale(locale);
      const { el } = await mount({ stationId: "pass" });
      await drawn(el, "2026-12-01", "rest").not.toBeNull();
      const tracks = [...cell(el, "2026-12-01")!.querySelectorAll<HTMLElement>(".track")];
      expect(tracks.map((track) => track.dataset.row)).toEqual(["rest", "bar"]);
      expect(segmentsOf(tracks[0]!).map((s) => s.title)).toEqual([
        "Dinner (Restaurant) 19:00–01:00",
      ]);
      expect(segmentsOf(tracks[1]!).map((s) => s.title)).toEqual(["All day (Bar) 10:00–02:00"]);
      expect(month(el)!.station).toMatchObject({
        state: "ready",
        departments: [
          { id: "rest", name: "Restaurant" },
          { id: "bar", name: "Bar" },
        ],
      });
      const label = cell(el, "2026-12-01")!.querySelector(".day")!.textContent!;
      expect(label).toContain("Restaurant: Dinner 19:00–01:00, Bar: All day 10:00–02:00");
      expect(label).not.toContain("Pass");
      expect(label).not.toContain("(");
      el.remove();
    }
  });

  it("draws two departments' ranges on their own tracks when they match, and each its own when they overlap", async () => {
    DINNER = { periodId: "dinner", startsAt: "10:00", endsAt: "02:00" };
    const same = await mount({ stationId: "pass" });
    await drawn(same.el, "2026-12-01", "rest").not.toBeNull();
    const matching = [...cell(same.el, "2026-12-01")!.querySelectorAll<HTMLElement>(".track")];
    expect(matching.map((track) => segmentsOf(track).map((s) => s.title))).toEqual([
      ["Dinner (Restaurant) 10:00–02:00"],
      ["All day (Bar) 10:00–02:00"],
    ]);
    same.el.remove();

    DINNER = { periodId: "dinner", startsAt: "19:00", endsAt: "02:00" };
    ALL_DAY = { periodId: "allday", startsAt: "10:00", endsAt: "00:00" };
    const { el } = await mount({ stationId: "pass" });
    await drawn(el, "2026-12-01", "rest").not.toBeNull();
    const [dinner, allDay] = [...cell(el, "2026-12-01")!.querySelectorAll<HTMLElement>(".track")]
      .map(segmentsOf)
      .map((segments) => {
        expect(segments).toHaveLength(1);
        return segments[0]!;
      });
    expect(dinner!.title).toBe("Dinner (Restaurant) 19:00–02:00");
    expect(allDay!.title).toBe("All day (Bar) 10:00–00:00");
    // From the 06:00 changeover: 19:00 is 13 hours in and runs 7; 10:00 is 4 hours in and runs 14.
    expect(percent(dinner!.style.left)).toBeCloseTo((13 / 24) * 100, 3);
    expect(percent(dinner!.style.width)).toBeCloseTo((7 / 24) * 100, 3);
    expect(percent(allDay!.style.left)).toBeCloseTo((4 / 24) * 100, 3);
    expect(percent(allDay!.style.width)).toBeCloseTo((14 / 24) * 100, 3);
  });

  it("keeps an empty track for a department that sends nothing that date, and reads Closed once when none sends", async () => {
    const { el } = await mount({ stationId: "pass" });
    await drawn(el, "2026-12-06", "bar").not.toBeNull();
    const sunday = cell(el, "2026-12-06")!;
    const tracks = [...sunday.querySelectorAll<HTMLElement>(".track")];
    expect(tracks.map((track) => track.dataset.row)).toEqual(["rest", "bar"]);
    expect(segmentsOf(tracks[0]!)).toHaveLength(0);
    expect(segmentsOf(tracks[1]!).map((s) => s.title)).toEqual(["All day (Bar) 10:00–02:00"]);
    expect(sunday.querySelector('[data-test="no-orders"]')).toBeNull();
    expect(text(sunday.querySelector(".day"))).toContain(
      "Restaurant: Closed, Bar: All day 10:00–02:00",
    );
    for (const date of ["2026-12-15", "2026-12-25"] as const) {
      const none = cell(el, date)!;
      expect([...none.querySelectorAll('[data-test="no-orders"]')].map(text)).toEqual(
        date === "2026-12-25" ? [] : ["Closed"],
      );
      expect(none.querySelectorAll(".track")).toHaveLength(0);
    }
    const label = text(cell(el, "2026-12-15")!.querySelector(".day"))!;
    await expect
      .element(cell(el, "2026-12-15")!.querySelector<HTMLElement>(".day")!, { timeout: 1000 })
      .toHaveAccessibleName(/^(?!.*Closed.*Closed).*Closed$/);
    expect(label).not.toContain("Restaurant");
    expect(label).not.toContain("Bar");
  });

  it("steps to the next month and reads that month's whole weeks for the station", async () => {
    const { el, calls } = await mount({ stationId: "grill" });
    await drawn(el, "2026-12-01", "rest").not.toBeNull();
    monthRoot(el)!.querySelector<HTMLElement>('[data-test="next-month"]')!.click();
    await drawn(el, "2027-01-04", "rest").not.toBeNull();
    expect(readsOf(calls, "month?").at(-1)).toBe(
      "/management-api/venue-service/opening-hours/month?month=2027-01",
    );
    expect(readsOf(calls, "service-times?").at(-1)).toBe(
      "/management-api/venue-service/stations/grill/service-times?from=2026-12-28&to=2027-01-31",
    );
    expect(text(monthRoot(el)!.querySelector('[data-test="month"]'))).toBe("January 2027");
    expect(monthRoot(el)!.querySelectorAll("[data-date]")).toHaveLength(35);
  });

  for (const pending of ["month", "times"] as const) {
    it(`draws no day of the old month while the new month's ${pending} read is pending`, async () => {
      const h = harness();
      const { el } = await mount({ stationId: "grill" }, h);
      await drawn(el, "2026-12-01", "rest").not.toBeNull();
      const release = h.hold(pending);
      monthRoot(el)!.querySelector<HTMLElement>('[data-test="next-month"]')!.click();
      await expect
        .poll(() => text(monthRoot(el)!.querySelector('[data-test="month"]')))
        .toBe("January 2027");
      await expect
        .poll(
          () =>
            h.calls.filter(
              ({ path }) => path.includes("month=2027-01") || path.includes("to=2027-01-31"),
            ).length,
        )
        .toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(month(el)!.station?.state).toBe("loading");
      expect(monthRoot(el)!.querySelectorAll("[data-date]")).toHaveLength(0);
      release();
      await drawn(el, "2027-01-04", "rest").not.toBeNull();
      expect(monthRoot(el)!.querySelector('[data-date="2026-11-30"]')).toBeNull();
    });
  }

  it("redraws for a new station, and draws none of the old station's bars under its name meanwhile", async () => {
    const h = harness();
    const { el } = await mount({ stationId: "grill" }, h);
    await drawn(el, "2026-12-01", "rest").not.toBeNull();
    const release = h.hold("times");
    picker(el)!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "station:pass" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    await expect
      .poll(() => h.calls.filter(({ path }) => path.includes("/stations/pass/")).length)
      .toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(month(el)!.station?.state).toBe("loading");
    expect(monthRoot(el)!.querySelectorAll(".track")).toHaveLength(0);
    expect(picker(el)!.value).toBe("station:pass");
    release();
    await drawn(el, "2026-12-01", "rest").not.toBeNull();
    expect(monthRoot(el)!.querySelector('.track[data-row="grill"]')).toBeNull();
    expect(
      [...cell(el, "2026-12-01")!.querySelectorAll<HTMLElement>(".track")].map(
        (track) => track.dataset.row,
      ),
    ).toEqual(["rest", "bar"]);
  });

  it("changes station through Show, supports Back, and reloads the chosen address", async () => {
    const { el } = await mount();
    await drawn(el, "2026-12-01", "rest").not.toBeNull();
    const push = vi.spyOn(history, "pushState");
    picker(el)!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "station:pass" },
        bubbles: true,
        composed: true,
      }),
    );
    await expect.poll(() => picker(el)!.value).toBe("station:pass");
    expect(location.pathname).toBe("/opening-hours/view/month/station/pass/month/2026-12");
    expect(push).toHaveBeenCalledTimes(1);
    history.back();
    await expect.poll(() => picker(el)!.value).toBe("station:grill");
    el.remove();
    const again = await mount({ stationId: "pass" });
    await drawn(again.el, "2026-12-01", "bar").not.toBeNull();
    expect(picker(again.el)!.value).toBe("station:pass");
  });

  it("drops a removed station's ranges and choice after a fresh station-list answer", async () => {
    const { el, api, state, calls } = await mount({ stationId: "pass" });
    await drawn(el, "2026-12-01", "bar").not.toBeNull();
    state.stations = STATIONS.filter((station) => station.id !== "pass");
    const before = calls.filter(({ path }) => path === "/management-api/stations").length;
    api.rereadWatches();
    await expect
      .poll(() => calls.filter(({ path }) => path === "/management-api/stations").length)
      .toBe(before + 1);
    await expect.poll(() => picker(el)!.value).toBe("all");
    expect(picker(el)!.options.map(({ value }) => value)).not.toContain("station:pass");
    expect(month(el)!.station).toBeUndefined();
    expect(titles(el, "2026-12-01")).toContain("13:00–16:00");
    expect(titles(el, "2026-12-01")).not.toContain("Dinner (Restaurant) 19:00–01:00");
  });

  it("draws the default station's dated demand in both languages", async () => {
    for (const locale of ["en", "es"] as const) {
      setLocale(locale);
      const { el } = await mount({ stationId: "kitchen" });
      await drawn(el, "2026-12-01", "rest").not.toBeNull();
      expect(titles(el, "2026-12-01")).toContain("Dinner (Restaurant) 19:00–01:00");
      expect(cell(el, "2026-12-25")!.querySelector(".segment")).toBeNull();
      expect(monthRoot(el)!.querySelector('[data-test="always-open"]')).toBeNull();
      el.remove();
    }
  });

  it("keeps departments available and makes no station read when no station is active", async () => {
    const { el, calls } = await mount({ stations: [STATIONS[3]!] });
    await expect.poll(() => cell(el, "2026-12-01")).not.toBeNull();
    expect(picker(el)!.options.map(({ value }) => value)).toEqual(["all", "rest", "bar"]);
    expect(picker(el)!.value).toBe("all");
    expect(month(el)!.station).toBeUndefined();
    expect(readsOf(calls, "service-times?")).toEqual([]);
  });

  for (const failed of ["month", "times"] as const) {
    it(`shows the ${failed} read's failure, then clears it and draws on a good reread`, async () => {
      for (const locale of ["en", "es"] as const) {
        setLocale(locale);
        const h = harness();
        h.failing[failed] = true;
        const { el } = await mount({ stationId: "grill" }, h);
        await expect
          .poll(() => alerts(el).map(text))
          .toEqual([
            failed === "month"
              ? locale === "en"
                ? "Opening hours could not be loaded. It will be tried again."
                : "No se ha podido cargar el horario de apertura. Se volverá a intentar."
              : locale === "en"
                ? "This station's times could not be loaded. It will be tried again."
                : "No se han podido cargar los horarios de esta estación. Se volverá a intentar.",
          ]);
        expect(monthRoot(el)?.querySelectorAll("[data-date]").length ?? 0).toBe(0);
        h.failing[failed] = false;
        h.api.rereadWatches();
        await drawn(el, "2026-12-01", "rest").not.toBeNull();
        expect(alerts(el)).toEqual([]);
        el.remove();
      }
    });
  }

  it("keeps the station read's failure shown after the month read recovers", async () => {
    const h = harness();
    h.failing.month = true;
    h.failing.times = true;
    const { el } = await mount({ stationId: "grill" }, h);
    await expect.poll(() => alerts(el)).toHaveLength(1);
    h.failing.month = false;
    // The station read waits, so only the month read answers.
    const release = h.hold("times");
    h.api.rereadWatches();
    await expect
      .poll(() => month(el)?.shadowRoot?.querySelector('[data-test="month"]'))
      .not.toBeNull();
    await expect.poll(() => h.calls.filter(({ path }) => path.includes("month?")).length).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alerts(el)).toHaveLength(1);
    release();
    h.failing.times = false;
    h.api.rereadWatches();
    await drawn(el, "2026-12-01", "rest").not.toBeNull();
    expect(alerts(el)).toEqual([]);
  });

  it("reads both again when it is attached again, and draws the new answer", async () => {
    const { el, calls } = await mount({ stationId: "grill" });
    await drawn(el, "2026-12-01", "rest").not.toBeNull();
    expect(titles(el, "2026-12-01")).toEqual(["Dinner (Restaurant) 19:00–01:00"]);
    el.remove();
    DINNER = { ...DINNER, startsAt: "20:00" };
    const before = calls.length;
    document.body.append(el);
    await expect.poll(() => readsOf(calls.slice(before), "month?")).toHaveLength(1);
    await expect.poll(() => readsOf(calls.slice(before), "service-times?")).toHaveLength(1);
    expect(readsOf(calls.slice(before), "month?")).toHaveLength(1);
    expect(readsOf(calls.slice(before), "service-times?")).toHaveLength(1);
    await expect.poll(() => titles(el, "2026-12-01")).toEqual(["Dinner (Restaurant) 20:00–01:00"]);
  });
});

describe.each(["en", "es"] as const)("A725 Calendar station accessibility (%s)", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([
      "one department",
      "several departments",
      "default",
      "error",
      "no stations",
      "all stations",
    ] as const)("%s", async (state) => {
      await page.viewport(1280, 900);
      setLocale(locale);
      const h = harness();
      h.state.theme = theme;
      if (state === "no stations") h.state.stations = [];
      if (state === "error") h.failing.times = true;
      const { el } = await mount(
        {
          show: state === "all stations" ? "stations" : undefined,
          stationId:
            state === "default" ? "kitchen" : state === "several departments" ? "pass" : "grill",
        },
        h,
      );
      const view = month(el)!;
      if (state === "error") {
        await expect.poll(() => alerts(el).length).toBe(1);
        expect(view.shadowRoot!.querySelector("table")).toBeNull();
      } else if (state === "default") {
        await drawn(el, "2026-12-01", "rest").not.toBeNull();
        expect(view.shadowRoot!.querySelector("table")).not.toBeNull();
      } else if (state === "no stations") {
        await expect.poll(() => cell(el, "2026-12-01")).not.toBeNull();
        expect(picker(el)!.options.map(({ value }) => value)).toEqual(["all", "rest", "bar"]);
        expect(readsOf(h.calls, "service-times?")).toEqual([]);
      } else if (state === "all stations") {
        await drawn(el, "2026-12-01", "pass:rest").not.toBeNull();
      } else {
        await drawn(el, "2026-12-01", "rest").not.toBeNull();
        if (state === "several departments") {
          expect(
            [...cell(el, "2026-12-01")!.querySelectorAll<HTMLElement>(".track")].map(
              (row) => row.dataset.row,
            ),
          ).toEqual(["rest", "bar"]);
          expect(
            cell(el, "2026-12-06")!.querySelector('.track[data-row="rest"] .segment'),
          ).toBeNull();
          expect(text(cell(el, "2026-12-15")!.querySelector('[data-test="no-orders"]'))).toBe(
            locale === "en" ? "Closed" : "Cerrada",
          );
        }
      }
      if (state === "one department" || state === "several departments") {
        await expect
          .element(
            cell(
              el,
              state === "one department" ? "2026-12-06" : "2026-12-15",
            )!.querySelector<HTMLElement>(".day")!,
            { timeout: 1000 },
          )
          .toHaveAccessibleName(
            locale === "en"
              ? /^(?!.*Closed.*Closed).*Closed$/
              : /^(?!.*Cerrada.*Cerrada).*Cerrada$/,
          );
      }
      await expectNoA11yViolations(el);
    });
  });
});

it("keeps All above named departments when there are no station groups", async () => {
  const host = document.createElement("div");
  hosts.push(host);
  document.body.append(host);
  render(
    showPicker({
      model: { days: [{ departments: [{ departmentId: "bar" }] }] } as unknown as OpeningHoursMonth,
      chosen: "",
      names: { name: () => "A bar" } as never,
      stations: [],
      stationId: "",
      onDepartment: () => {},
      onStation: () => {},
    }),
    host,
  );
  const field = host.querySelector("wt-combobox")!;
  await field.updateComplete;
  field.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await field.updateComplete;
  expect(
    [...field.shadowRoot!.querySelectorAll('[role="option"]')].map((row) =>
      row.textContent!.trim(),
    ),
  ).toEqual(["All departments", "A bar"]);
});

it("draws separate sender rows from one batch and keeps the default bounded on closed days", async () => {
  const { el, calls } = await mount({ show: "stations" });
  await drawn(el, "2026-12-01", "pass:rest").not.toBeNull();
  expect(readsOf(calls, "service-times?")).toEqual([
    "/management-api/venue-service/stations/service-times?from=2026-11-30&to=2027-01-03",
  ]);
  expect(
    [...cell(el, "2026-12-01")!.querySelectorAll<HTMLElement>(".track")].map(
      (row) => row.dataset.row,
    ),
  ).toEqual(["grill", "kitchen:rest", "kitchen:bar", "pass:rest", "pass:bar"]);
  expect(segmentsOf(cell(el, "2026-12-01")!.querySelector('[data-row="pass:rest"]')!)).toHaveLength(
    1,
  );
  expect(segmentsOf(cell(el, "2026-12-01")!.querySelector('[data-row="pass:bar"]')!)).toHaveLength(
    1,
  );
  expect([...cell(el, "2026-12-01")!.querySelectorAll(".station-heading")].map(text)).toEqual([
    "Kitchen",
    "Pass",
  ]);
  await expect
    .element(cell(el, "2026-12-01")!.querySelector<HTMLElement>(".day")!, { timeout: 1000 })
    .toHaveAccessibleName(/Prep station Grill/);
  expect(cell(el, "2026-12-25")!.querySelectorAll(".track")).toHaveLength(5);
  expect(cell(el, "2026-12-25")!.querySelectorAll(".segment")).toHaveLength(0);
  await expect
    .element(cell(el, "2026-12-25")!.querySelector<HTMLElement>(".day")!, { timeout: 1000 })
    .toHaveAccessibleName(/^(?!.*Closed.*Closed).*Closed/);
  expect(picker(el)!.value).toBe("show:stations");
  expect(picker(el)!.options.map(({ value }) => value)).toEqual([
    "show:all",
    "all",
    "rest",
    "bar",
    "show:stations",
    "station:grill",
    "station:kitchen",
    "station:pass",
  ]);
  cell(el, "2026-12-01")!.querySelector<HTMLElement>(".day")!.click();
  await expect.poll(() => el.shadowRoot!.querySelector("calendar-day-box")?.shown).toBe(true);
  const box = el.shadowRoot!.querySelector("calendar-day-box")!;
  expect(box.rows.map(({ name }) => name)).toEqual([
    "Restaurant",
    "Terrace",
    "Bar",
    "Prep stations",
    "Grill",
    "Kitchen",
    "Restaurant",
    "Bar",
    "Pass",
    "Restaurant",
    "Bar",
  ]);
  expect(box.querySelector('[data-test="special-add"]')).not.toBeNull();
  expect(box.querySelector('a[data-test="edit-week"]')).not.toBeNull();
  expect(box.querySelector('a[href="/periods"]')).toBeNull();
});

it("keeps batch loading and errors distinct from Closed and recovers on reread", async () => {
  const h = harness();
  h.failing.times = true;
  const { el } = await mount({ show: "stations" }, h);
  await expect.poll(() => alerts(el)).toHaveLength(1);
  expect(monthRoot(el)!.querySelector('[data-test="no-orders"]')).toBeNull();
  expect(monthRoot(el)!.querySelectorAll(".track")).toHaveLength(0);
  h.failing.times = false;
  h.api.rereadWatches();
  await drawn(el, "2026-12-01", "grill").not.toBeNull();
  expect(alerts(el)).toEqual([]);
});

it("keeps station row names and empty labels readable on a phone", async () => {
  await page.viewport(390, 1100);
  const { el } = await mount({ show: "stations" });
  await drawn(el, "2026-12-01", "grill").not.toBeNull();
  expect(text(monthRoot(el)!.querySelector('[data-test="rows"]'))).toBe(
    "Rows: Grill · Kitchen · Pass",
  );
  for (const label of monthRoot(el)!.querySelectorAll<HTMLElement>(".empty-track"))
    expect(label.scrollWidth, label.textContent).toBeLessThanOrEqual(label.clientWidth);
});

it("Month Show all keeps station period identities beside time-only department rows", async () => {
  const { el } = await mount({ show: "all" });
  await drawn(el, "2026-12-01", "pass:rest").not.toBeNull();
  const day = cell(el, "2026-12-01")!;
  const department = day.querySelector('[data-row="rest"] .segment')!;
  expect(department.getAttribute("title")).toBe("08:00–11:00");
  const station = day.querySelector('[data-row="pass:rest"] .segment')!;
  expect(station.getAttribute("title")).toBe("Dinner (Restaurant) 19:00–01:00");
  expect(station.getAttribute("data-colour")).toBe("red");
});

it("keeps a long grouped station name available in the Month heading", async () => {
  await page.viewport(390, 900);
  const h = harness();
  const long = "Kitchen for the restaurant and takeaway";
  h.state.stations = STATIONS.map((row) => (row.id === "kitchen" ? { ...row, name: long } : row));
  const { el } = await mount({ show: "stations" }, h);
  await drawn(el, "2026-12-01", "kitchen:rest").not.toBeNull();
  const heading = cell(el, "2026-12-01")!.querySelector<HTMLElement>(".station-heading")!;
  expect(heading.title).toBe(long);
  const text = heading.querySelector<HTMLElement>(".row-name")!;
  expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
  expect(text.getBoundingClientRect().right).toBeLessThanOrEqual(
    heading.getBoundingClientRect().right,
  );
});

it.each(["all", "stations"])(
  "names each grouped station sender in the spoken Month for %s",
  async (show) => {
    const { el } = await mount({ show });
    await drawn(el, "2026-12-01", "pass:rest").not.toBeNull();
    await expect
      .element(cell(el, "2026-12-01")!.querySelector<HTMLElement>(".day")!, { timeout: 1000 })
      .toHaveAccessibleName(
        /Prep station Kitchen: Restaurant: Dinner 19:00–01:00.*Prep station Kitchen: Bar: All day 10:00–02:00.*Prep station Pass: Restaurant: Dinner 19:00–01:00.*Prep station Pass: Bar: All day 10:00–02:00/,
      );
  },
);
