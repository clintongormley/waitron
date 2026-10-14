import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import { monthModel } from "../testing/opening-hours-month-fixture.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { PrepStationTimes } from "./station-times-tab.js";
import "./station-times-tab.js";

const hosts: HTMLElement[] = [];
beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-10T10:00:00Z"));
});
afterEach(() => {
  DINNER = { periodId: "dinner", startsAt: "19:00", endsAt: "01:00" };
  vi.useRealTimers();
  hosts.splice(0).forEach((host) => host.remove());
  setLocale("en");
});

/** Off is first by display order but disabled; Kitchen and Pass share an order, so name decides. */
const STATIONS = [
  { id: "pass", name: "Pass", active: true, isDefault: false, displayOrder: 2 },
  { id: "kitchen", name: "Kitchen", active: true, isDefault: true, displayOrder: 2 },
  { id: "grill", name: "Grill", active: true, isDefault: false, displayOrder: 1 },
  { id: "off", name: "Off", active: false, isDefault: false, displayOrder: 0 },
];
const PERIODS = [
  {
    id: "lunch",
    departmentId: "rest",
    departmentName: "Restaurant",
    name: "Lunch",
    colour: "green",
  },
  {
    id: "dinner",
    departmentId: "rest",
    departmentName: "Restaurant",
    name: "Dinner",
    colour: "red",
  },
  { id: "allday", departmentId: "bar", departmentName: "Bar", name: "All day", colour: "purple" },
] as const;

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
const ALL_DAY = { periodId: "allday", startsAt: "10:00", endsAt: "02:00" };
/** The Grill makes the Restaurant's dinners, never on a Sunday; the Pass gets the Restaurant's
 *  dinners and the Bar's all-day orders. Neither gets anything on 25 December. */
function stationDay(stationId: string, date: LocalDate) {
  if (date === "2026-12-25") return [];
  if (stationId === "grill")
    return sunday(date) ? [] : [{ departmentId: "rest", ranges: [DINNER] }];
  return [
    { departmentId: "rest", ranges: [DINNER] },
    { departmentId: "bar", ranges: [ALL_DAY] },
  ];
}

type Kind = "month" | "times";
function harness() {
  const calls: { path: string; options: unknown }[] = [];
  const failing: Record<Kind, boolean> = { month: false, times: false };
  const held: Partial<Record<Kind, Promise<void>>> = {};
  const request = (async (path: string, _method: string, _body: unknown, options: unknown) => {
    calls.push({ path, options });
    const url = new URL(path, location.origin);
    const kind: Kind = url.pathname.endsWith("/opening-hours/month") ? "month" : "times";
    const wait = held[kind];
    if (wait) await wait;
    if (failing[kind]) throw new Error(`${kind} refused`);
    if (kind === "month") return meta(url.searchParams.get("month")!);
    const stationId = url.pathname.split("/").at(-2)!;
    if (stationId === "kitchen") return { always: "default", days: [] };
    const days = [];
    const to = url.searchParams.get("to")!;
    for (let date = url.searchParams.get("from")!; date <= to; date = addDays(date, 1))
      days.push({ date, departments: stationDay(stationId, date) });
    return { always: null, days };
  }) as DashboardRequest;
  const hold = (kind: Kind) => {
    let release!: () => void;
    held[kind] = new Promise<void>((resolve) => (release = resolve));
    return () => {
      delete held[kind];
      release();
    };
  };
  return { api: new OpeningHoursApi(request), calls, failing, hold };
}

async function mount(
  props: Partial<PrepStationTimes> = {},
  h: ReturnType<typeof harness> = harness(),
) {
  const el = document.createElement("prep-station-times");
  Object.assign(el, { api: h.api, stations: STATIONS, periods: PERIODS, stationId: "", ...props });
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await el.updateComplete;
  return { el, ...h };
}

const month = (el: PrepStationTimes) =>
  el.shadowRoot!.querySelector("opening-hours-month") ?? undefined;
const monthRoot = (el: PrepStationTimes) => month(el)?.shadowRoot;
const cell = (el: PrepStationTimes, date: LocalDate) =>
  monthRoot(el)?.querySelector<HTMLElement>(`[data-date="${date}"]`) ?? null;
const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const titles = (el: PrepStationTimes, date: LocalDate) =>
  [...(cell(el, date)?.querySelectorAll<HTMLElement>(".segment") ?? [])].map((s) => s.title);
const alerts = (el: PrepStationTimes) => [...el.shadowRoot!.querySelectorAll('[role="alert"]')];
const picker = (el: PrepStationTimes) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox");
const readsOf = (calls: { path: string }[], kind: "month?" | "service-times?") =>
  calls.filter(({ path }) => path.includes(kind)).map(({ path }) => path);
const drawn = (el: PrepStationTimes, date: LocalDate, row: string) =>
  expect.poll(() => cell(el, date)?.querySelector(`.track[data-row="${row}"]`) ?? null);

describe("Prep station times", () => {
  it("puts a station picker at the top listing the active stations in the Stations table's order", async () => {
    for (const locale of ["en", "es"] as const) {
      setLocale(locale);
      const { el } = await mount();
      const chooser = picker(el)!;
      expect(chooser.name).toBe("stationId");
      expect(chooser.search).toBe("never");
      expect(chooser.label).toBe(locale === "en" ? "Station" : "Estación");
      expect(chooser.options).toEqual([
        { value: "grill", label: "Grill" },
        { value: "kitchen", label: "Kitchen" },
        { value: "pass", label: "Pass" },
      ]);
      expect(chooser.value).toBe("grill");
      await expect.poll(() => month(el)).toBeDefined();
      expect(
        chooser.compareDocumentPosition(month(el)!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      el.remove();
    }
  });

  it("draws the chosen station's month read-only, one bar per day, from the month and station reads", async () => {
    const { el, calls } = await mount({ stationId: "grill" });
    await drawn(el, "2026-12-01", "grill").not.toBeNull();
    const view = month(el)!;
    expect(view.stationMode).toBe(true);
    expect(view.readOnly).toBe(true);
    expect(readsOf(calls, "month?")).toEqual([
      "/management-api/venue-service/opening-hours/month?month=2026-12",
    ]);
    expect(readsOf(calls, "service-times?")).toEqual([
      "/management-api/venue-service/stations/grill/service-times?from=2026-11-30&to=2027-01-03",
    ]);
    for (const { options } of calls) expect(options).toEqual({ passive: true });
    expect(text(monthRoot(el)!.querySelector('[data-test="month"]'))).toBe("December 2026");
    expect(monthRoot(el)!.querySelector('[data-test="rows"]')).toBeNull();
    expect(cell(el, "2026-12-01")!.querySelectorAll(".track")).toHaveLength(1);
    expect(titles(el, "2026-12-01")).toEqual(["Dinner 19:00–01:00"]);
    expect(cell(el, "2026-12-01")!.querySelector(".day")!.getAttribute("aria-label")).toContain(
      "Grill: Dinner 19:00–01:00",
    );
    // A Sunday the station gets nothing still carries its row.
    expect(text(cell(el, "2026-12-06")!.querySelector('[data-test="no-orders"]'))).toBe(
      "No orders",
    );
    expect(cell(el, "2026-12-25")!.hasAttribute("data-closed")).toBe(true);
    expect(text(cell(el, "2026-12-25")!.querySelector('[data-test="name"]'))).toBe(
      "Christmas Day · Closed",
    );
    expect(text(cell(el, "2026-12-14")!.querySelector('[data-test="name"]'))).toBe(
      "Company dinners",
    );
  });

  it("names each period's department on a station more than one department feeds", async () => {
    for (const locale of ["en", "es"] as const) {
      setLocale(locale);
      const { el } = await mount({ stationId: "pass" });
      await drawn(el, "2026-12-01", "pass").not.toBeNull();
      expect(cell(el, "2026-12-01")!.querySelectorAll(".track")).toHaveLength(1);
      expect(titles(el, "2026-12-01")).toEqual([
        "All day (Bar) 10:00–02:00",
        "Dinner (Restaurant) 19:00–01:00",
      ]);
      expect(cell(el, "2026-12-01")!.querySelector(".day")!.getAttribute("aria-label")).toContain(
        "Pass: All day (Bar) 10:00–02:00, Dinner (Restaurant) 19:00–01:00",
      );
      el.remove();
    }
  });

  it("steps to the next month and reads that month's whole weeks for the station", async () => {
    const { el, calls } = await mount({ stationId: "grill" });
    await drawn(el, "2026-12-01", "grill").not.toBeNull();
    monthRoot(el)!.querySelector<HTMLElement>('[data-test="next-month"]')!.click();
    await drawn(el, "2027-01-04", "grill").not.toBeNull();
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
      await drawn(el, "2026-12-01", "grill").not.toBeNull();
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
      expect(month(el)!.model).toBeUndefined();
      expect(monthRoot(el)!.querySelectorAll("[data-date]")).toHaveLength(0);
      release();
      await drawn(el, "2027-01-04", "grill").not.toBeNull();
      expect(monthRoot(el)!.querySelector('[data-date="2026-11-30"]')).toBeNull();
    });
  }

  it("redraws for a new station, and draws none of the old station's bars under its name meanwhile", async () => {
    const h = harness();
    const { el } = await mount({ stationId: "grill" }, h);
    await drawn(el, "2026-12-01", "grill").not.toBeNull();
    const release = h.hold("times");
    el.stationId = "pass";
    await el.updateComplete;
    await expect
      .poll(() => h.calls.filter(({ path }) => path.includes("/stations/pass/")).length)
      .toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(month(el)!.model).toBeUndefined();
    expect(monthRoot(el)!.querySelectorAll(".track")).toHaveLength(0);
    expect(picker(el)!.value).toBe("pass");
    release();
    await drawn(el, "2026-12-01", "pass").not.toBeNull();
    expect(monthRoot(el)!.querySelector('.track[data-row="grill"]')).toBeNull();
    expect(monthRoot(el)!.querySelector('[data-test="rows"]')).toBeNull();
  });

  it("asks for a chosen station with station-change and draws the first station for an unknown one", async () => {
    const { el } = await mount({ stationId: "gone" });
    await drawn(el, "2026-12-01", "grill").not.toBeNull();
    expect(picker(el)!.value).toBe("grill");
    const asked: unknown[] = [];
    el.addEventListener("station-change", (event) => asked.push((event as CustomEvent).detail));
    picker(el)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "pass" }, bubbles: true, composed: true }),
    );
    expect(asked).toEqual([{ stationId: "pass" }]);
  });

  it("says the default station is always open and draws no month", async () => {
    for (const locale of ["en", "es"] as const) {
      setLocale(locale);
      const { el } = await mount({ stationId: "kitchen" });
      await expect
        .poll(() => text(el.shadowRoot!.querySelector('[data-test="always-open"]')))
        .toBe(
          locale === "en"
            ? "Always open: this is the default station"
            : "Siempre abierta: es la estación predeterminada",
        );
      expect(month(el)).toBeUndefined();
      el.remove();
    }
  });

  it("says there are no stations and reads nothing when none is active", async () => {
    const { el, calls } = await mount({ stations: [STATIONS[3]!] });
    expect(text(el.shadowRoot!.querySelector("p"))).toBe("No prep stations yet");
    expect(picker(el)).toBeNull();
    expect(calls).toEqual([]);
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
            locale === "en"
              ? "This station's times could not be loaded. It will be tried again."
              : "No se han podido cargar los horarios de esta estación. Se volverá a intentar.",
          ]);
        expect(monthRoot(el)?.querySelectorAll("[data-date]").length ?? 0).toBe(0);
        h.failing[failed] = false;
        h.api.rereadWatches();
        await drawn(el, "2026-12-01", "grill").not.toBeNull();
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
    await drawn(el, "2026-12-01", "grill").not.toBeNull();
    expect(alerts(el)).toEqual([]);
  });

  it("reads both again when it is attached again, and draws the new answer", async () => {
    const { el, calls } = await mount({ stationId: "grill" });
    await drawn(el, "2026-12-01", "grill").not.toBeNull();
    expect(titles(el, "2026-12-01")).toEqual(["Dinner 19:00–01:00"]);
    el.remove();
    DINNER = { ...DINNER, startsAt: "20:00" };
    const before = calls.length;
    document.body.append(el);
    await expect.poll(() => calls.length).toBe(before + 2);
    expect(readsOf(calls.slice(before), "month?")).toHaveLength(1);
    expect(readsOf(calls.slice(before), "service-times?")).toHaveLength(1);
    await expect.poll(() => titles(el, "2026-12-01")).toEqual(["Dinner 20:00–01:00"]);
  });
});
