import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { HolidayCoverage, HolidaySource } from "../holiday-types.js";
import type {
  CalendarDay,
  HolidayFact,
  HoursModel,
  HoursModelSubject,
  LocalDate,
  SpecialDate,
  WeekCell,
  WeekDay,
} from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import { HoursApi } from "./hours-client.js";
import { addMonths, monthGrid, type CalendarAction, type HoursCalendar } from "./hours-calendar.js";
import "./hours-calendar.js";

const hosts: HTMLElement[] = [];
beforeEach(() => {
  setLocale("en");
});
afterEach(async () => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
  await page.viewport(1280, 800);
});

const week = (cell: (weekday: number) => WeekCell): WeekDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, cell: cell(weekday) }));
const subject = (
  kind: "station",
  id: string,
  name: string,
  extra: Partial<HoursModelSubject> = {},
): HoursModelSubject => ({ kind, id, name, active: true, isDefault: false, ...extra });

const FIESTA: SpecialDate = {
  id: "fiesta",
  date: "2026-10-12",
  name: "Fiesta Nacional",
  colour: "red",
  kind: "working_day" as const,
  repeats: false,
  ownHours: false,
  closeWholeVenue: false,
};
const STAFF: SpecialDate = {
  id: "staff",
  date: "2026-10-13",
  name: "Staff day off",
  colour: "grey",
  kind: "working_day" as const,
  repeats: false,
  ownHours: false,
  closeWholeVenue: true,
};
const AUTUMN: SpecialDate = {
  id: "autumn",
  date: "2026-11-20",
  name: "Late autumn",
  colour: "green",
  kind: "working_day" as const,
  repeats: false,
  ownHours: false,
  closeWholeVenue: false,
};
const SPECIALS = [FIESTA, STAFF, AUTUMN];
/** Ordinary dates the model's colour rule has already decided. */
const TONES: Record<LocalDate, CalendarDay["tone"]> = {
  "2026-10-12": "red",
  "2026-10-13": "closed",
  "2026-11-20": "green",
  "2026-10-20": "closed",
  "2026-10-27": "closed",
};
const HOLIDAYS: Record<LocalDate, string> = {
  "2026-10-14": "Invented feast",
  "2026-10-27": "Invented closing day",
};

/** The model a read of `from`–`to` answers: every date of the range, as the server sends it. */
function rangeModel(from: LocalDate, to: LocalDate): HoursModel {
  const days: CalendarDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const specialDate = SPECIALS.find((special) => special.date === date) ?? null;
    days.push({
      date,
      specialDate,
      holidays:
        HOLIDAYS[date] === undefined
          ? []
          : [{ id: `h-${date}`, date, name: HOLIDAYS[date]!, scope: "local", sourceId: "test" }],
      tone: TONES[date] ?? "standard",
    });
  }
  const inRange = SPECIALS.filter((special) => special.date >= from && special.date <= to);
  return {
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    civilDate: "2026-10-07",
    clockReadable: true,
    departments: [],
    subjects: [
      subject("station", "restaurant", "Restaurant"),
      subject("station", "deli", "Deli"),
      subject("station", "terrace", "Terrace", { active: false }),
      subject("station", "kitchen", "Kitchen", { isDefault: true }),
      subject("station", "bar", "Bar"),
    ],
    week: [
      {
        subject: { kind: "station", id: "restaurant" },
        days: week((d) =>
          d === 1
            ? { mode: "closed", periods: [] }
            : { mode: "periods", periods: [{ id: `r${d}`, opensAt: "12:00", closesAt: "16:00" }] },
        ),
      },
      {
        subject: { kind: "station", id: "deli" },
        days: week(() => ({ mode: "not_set", periods: [] })),
      },
      {
        subject: { kind: "station", id: "bar" },
        days: week(() => ({
          mode: "periods",
          periods: [{ id: "b", opensAt: "17:00", closesAt: "23:00" }],
        })),
      },
    ],
    days,
    specialDates: inRange,
    holidayCoverage: [],
    holidaySources: [],
    specialCells: inRange.map((special) => ({
      specialDateId: special.id,
      cells:
        special.id === "fiesta"
          ? [
              {
                subject: { kind: "station", id: "restaurant" },
                cell: {
                  mode: "periods",
                  periods: [{ id: "f1", opensAt: "12:00", closesAt: "23:00" }],
                },
              },
              {
                subject: { kind: "station", id: "deli" },
                cell: { mode: "closed", periods: [] },
              },
            ]
          : [],
    })),
  };
}

function server(
  options: { fail?: boolean; hold?: Promise<unknown>; edit?: (model: HoursModel) => void } = {},
) {
  const request = vi.fn<(path: string, method: string) => Promise<unknown>>(async (path) => {
    // Whether this read fails is decided when it is sent, however late it settles.
    const fail = options.fail;
    if (options.hold !== undefined) await options.hold;
    if (fail) throw { code: "connection.failed" };
    const query = new URL(path, location.origin).searchParams;
    const model = rangeModel(query.get("from")!, query.get("to")!);
    options.edit?.(model);
    return model;
  });
  const api = new HoursApi(request as unknown as DashboardRequest);
  const reads = () => request.mock.calls.map(([path]) => path.split("?")[1]);
  return { request, api, reads };
}

async function settle(el: HoursCalendar) {
  for (let turn = 0; turn < 3; turn++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await el.updateComplete;
}

async function mount(
  api: HoursApi,
  options: { readOnly?: boolean; today?: LocalDate | null } = {},
): Promise<HoursCalendar> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("hours-calendar");
  el.api = api;
  el.readOnly = options.readOnly ?? false;
  el.today = options.today === undefined ? "2026-10-07" : options.today;
  host.append(el);
  await settle(el);
  return el;
}

const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const day = (el: HoursCalendar, date: LocalDate) =>
  el.shadowRoot!.querySelector<HTMLElement>(`td[data-date="${date}"]`)!;
const dayButton = (el: HoursCalendar, date: LocalDate) =>
  day(el, date).querySelector<HTMLButtonElement>("button")!;
const shownDates = (el: HoursCalendar) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("td[data-date]")].map((td) => td.dataset.date);
const heading = (el: HoursCalendar) => text(el.shadowRoot!.querySelector('[data-test="month"]'));
const panel = (el: HoursCalendar) =>
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="date-panel"]')!;
async function press(el: HoursCalendar, test: string) {
  const button = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`);
  expect(button, test).not.toBeNull();
  button!.click();
  await settle(el);
}
async function open(el: HoursCalendar, date: LocalDate) {
  dayButton(el, date).click();
  await settle(el);
}
function token(el: Element, name: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  el.shadowRoot!.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

describe("monthGrid", () => {
  it("covers the month in whole weeks from Monday, with the real dates either side", () => {
    const october = monthGrid("2026-10");
    expect([october.length, october[0], october.at(-1)]).toEqual([35, "2026-09-28", "2026-11-01"]);
    const august = monthGrid("2026-08");
    expect([august.length, august[0], august.at(-1)]).toEqual([42, "2026-07-27", "2026-09-06"]);
    // February 2027 starts on a Monday and ends on a Sunday: four weeks and nothing either side.
    const february = monthGrid("2027-02");
    expect([february.length, february[0], february.at(-1)]).toEqual([
      28,
      "2027-02-01",
      "2027-02-28",
    ]);
    expect(monthGrid("2028-02")).toContain("2028-02-29");
    expect(monthGrid("2027-02")).not.toContain("2027-02-29");
    expect(
      new Set(monthGrid("2024-02").map((date) => new Date(`${date}T00:00Z`).getUTCDay())),
    ).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    expect(new Date(`${monthGrid("2024-02")[0]}T00:00Z`).getUTCDay()).toBe(1);
  });

  it("moves by months across a year's end", () => {
    expect([addMonths("2026-12", 1), addMonths("2026-01", -1), addMonths("2026-10", -12)]).toEqual([
      "2027-01",
      "2025-12",
      "2025-10",
    ]);
  });
});

describe("Hours calendar: the month", () => {
  it("reads the month's whole weeks once and shows them Monday first", async () => {
    const { api, reads } = server();
    const el = await mount(api);
    expect(reads()).toEqual(["from=2026-09-28&to=2026-11-01"]);
    expect(heading(el)).toBe("October 2026");
    expect([...el.shadowRoot!.querySelectorAll("thead th")].map(text)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(shownDates(el)).toEqual(monthGrid("2026-10"));
    // A day from the next month is still that real day, named with its month.
    expect(text(dayButton(el, "2026-11-01"))).toBe("1 Nov");
    expect(day(el, "2026-11-01").hasAttribute("data-outside")).toBe(true);
    expect(text(dayButton(el, "2026-10-01"))).toBe("1");
    expect(day(el, "2026-10-01").hasAttribute("data-outside")).toBe(false);
  });

  it("marks the venue's today, and only that date", async () => {
    const { api } = server();
    const el = await mount(api);
    const current = el.shadowRoot!.querySelectorAll('[aria-current="date"]');
    expect([...current]).toEqual([dayButton(el, "2026-10-07")]);
    expect(dayButton(el, "2026-10-07").getAttribute("aria-label")).toBe(
      "Wednesday, 7 October 2026, Today",
    );
  });

  it("names each special date in its own colour, and paints the reserved standard and Closed colours", async () => {
    const { api } = server();
    const el = await mount(api);
    expect(text(dayButton(el, "2026-10-12"))).toBe("12 Fiesta Nacional");
    const label = day(el, "2026-10-12").querySelector<HTMLElement>('[data-test="special-name"]')!;
    expect(getComputedStyle(label).backgroundColor).toBe(token(el, "--wt-color-palette-red"));
    expect(getComputedStyle(label).color).toBe(token(el, "--wt-color-on-palette-red"));
    expect(dayButton(el, "2026-10-12").getAttribute("aria-label")).toBe(
      "Monday, 12 October 2026, Fiesta Nacional",
    );

    // A whole-venue closure is Closed whatever its own colour, and says so in words.
    expect(day(el, "2026-10-13").dataset.tone).toBe("closed");
    expect(text(dayButton(el, "2026-10-13"))).toBe("13 Staff day off · Closed");
    expect(getComputedStyle(day(el, "2026-10-13")).backgroundColor).toBe(
      token(el, "--wt-color-day-closed"),
    );
    expect(getComputedStyle(dayButton(el, "2026-10-13")).color).toBe(
      token(el, "--wt-color-on-day-closed"),
    );
    expect(text(dayButton(el, "2026-10-20"))).toBe("20 Closed");
    expect(dayButton(el, "2026-10-20").getAttribute("aria-label")).toBe(
      "Tuesday, 20 October 2026, Closed",
    );
    // A date the model calls standard, the restaurant's Closed Monday included, is standard.
    expect([day(el, "2026-10-19").dataset.tone, text(dayButton(el, "2026-10-19"))]).toEqual([
      "standard",
      "19",
    ]);
    expect(getComputedStyle(day(el, "2026-10-19")).backgroundColor).toBe(
      token(el, "--wt-color-day-standard"),
    );
    expect(token(el, "--wt-color-day-standard")).not.toBe(token(el, "--wt-color-day-closed"));
  });

  it("shows a holiday with no special date as the holiday on standard hours", async () => {
    const { api } = server();
    const el = await mount(api);
    expect(text(dayButton(el, "2026-10-14"))).toBe("14 Invented feast · standard hours");
    expect(day(el, "2026-10-14").dataset.tone).toBe("standard");
    expect(dayButton(el, "2026-10-14").getAttribute("aria-label")).toBe(
      "Wednesday, 14 October 2026, Invented feast · standard hours",
    );
  });

  it("names a holiday on a Closed date without claiming standard hours", async () => {
    const { api } = server();
    const el = await mount(api);
    expect(text(dayButton(el, "2026-10-27"))).toBe("27 Closed Invented closing day");
    expect(dayButton(el, "2026-10-27").getAttribute("aria-label")).toBe(
      "Tuesday, 27 October 2026, Closed, Invented closing day",
    );
  });

  it("opens on the browser's month while the venue's date is unknown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 2, 15, 12));
    try {
      const { api, reads } = server();
      const el = await mount(api, { today: null });
      expect(heading(el)).toBe("March 2027");
      await press(el, "next-month");
      await press(el, "this-month");
      expect(heading(el)).toBe("March 2027");
      // Already on that month, This month reads nothing more.
      await press(el, "this-month");
      expect(reads()).toEqual([
        "from=2027-03-01&to=2027-04-04",
        "from=2027-03-29&to=2027-05-02",
        "from=2027-03-01&to=2027-04-04",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a failed read's message once a later read of the month succeeds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const options: { fail?: boolean } = { fail: true };
      const { api } = server(options);
      const el = await mount(api);
      expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
      options.fail = false;
      await vi.advanceTimersByTimeAsync(60_000);
      await settle(el);
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
      expect(text(dayButton(el, "2026-10-12"))).toBe("12 Fiesta Nacional");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads each month or year it moves to, once, and shows its real dates", async () => {
    const { api, reads } = server();
    const el = await mount(api);
    await press(el, "next-month");
    expect(heading(el)).toBe("November 2026");
    expect(shownDates(el)).toEqual(monthGrid("2026-11"));
    expect([shownDates(el)[0], shownDates(el).at(-1)]).toEqual(["2026-10-26", "2026-12-06"]);
    // Fiesta Nacional, read again for November's grid, is not in it.
    expect(el.shadowRoot!.textContent).not.toContain("Fiesta Nacional");
    await press(el, "next-year");
    expect(heading(el)).toBe("November 2027");
    await press(el, "previous-month");
    await press(el, "previous-year");
    expect(heading(el)).toBe("October 2026");
    expect(text(dayButton(el, "2026-10-12"))).toBe("12 Fiesta Nacional");
    expect(reads()).toEqual([
      "from=2026-09-28&to=2026-11-01",
      "from=2026-10-26&to=2026-12-06",
      "from=2027-11-01&to=2027-12-05",
      "from=2027-09-27&to=2027-10-31",
      "from=2026-09-28&to=2026-11-01",
    ]);
  });

  it("shows a leap day, and goes back to today's month", async () => {
    const { api } = server();
    const el = await mount(api, { today: "2028-02-10" });
    expect(heading(el)).toBe("February 2028");
    expect(text(dayButton(el, "2028-02-29"))).toBe("29");
    await press(el, "next-year");
    expect(heading(el)).toBe("February 2029");
    expect(shownDates(el)).not.toContain("2029-02-29");
    await press(el, "this-month");
    expect(heading(el)).toBe("February 2028");
  });

  it("keeps its month when moved elsewhere on the page, reading again only once back", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { api, reads } = server();
      const el = await mount(api);
      await press(el, "next-month");
      const parent = el.parentElement!;
      el.remove();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(reads()).toHaveLength(2);
      parent.append(el);
      await settle(el);
      expect(heading(el)).toBe("November 2026");
      expect(reads()).toEqual([
        "from=2026-09-28&to=2026-11-01",
        "from=2026-10-26&to=2026-12-06",
        "from=2026-10-26&to=2026-12-06",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when the month cannot be read", async () => {
    const { api } = server({ fail: true });
    const el = await mount(api);
    expect(text(el.shadowRoot!.querySelector('[role="alert"]'))).toBe("Hours could not be loaded.");
    // The month's real dates still show, so the operator can move to another month.
    expect(shownDates(el)).toEqual(monthGrid("2026-10"));
  });

  it("reads the shown month again when the page rereads its watches, and says when that read fails", async () => {
    const options: { fail?: boolean } = {};
    const { api, reads } = server(options);
    const el = await mount(api);
    options.fail = true;
    api.rereadWatches();
    await settle(el);
    expect(text(el.shadowRoot!.querySelector('[role="alert"]'))).toBe("Hours could not be loaded.");
    options.fail = false;
    api.rereadWatches();
    await settle(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(reads()).toEqual([
      "from=2026-09-28&to=2026-11-01",
      "from=2026-09-28&to=2026-11-01",
      "from=2026-09-28&to=2026-11-01",
    ]);
  });

  it("drops a reread that settles after the calendar has moved to another month", async () => {
    let release!: () => void;
    const options: { fail?: boolean; hold?: Promise<unknown> } = {};
    const { api } = server(options);
    const el = await mount(api);
    options.hold = new Promise((resolve) => (release = () => resolve(undefined)));
    api.rereadWatches();
    options.hold = undefined;
    await press(el, "next-month");
    expect(heading(el)).toBe("November 2026");
    expect(text(dayButton(el, "2026-11-20"))).toBe("20 Late autumn");
    release();
    await settle(el);
    // October's late answer, which has no 20 November, has not replaced November's.
    expect(text(dayButton(el, "2026-11-20"))).toBe("20 Late autumn");
    options.hold = new Promise((resolve) => (release = () => resolve(undefined)));
    options.fail = true;
    api.rereadWatches();
    options.hold = undefined;
    options.fail = false;
    await press(el, "previous-month");
    release();
    await settle(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("ignores a month's read that settles after the calendar has moved to another month", async () => {
    let release!: () => void;
    const held = () => new Promise((resolve) => (release = () => resolve(undefined)));
    const options: { fail?: boolean; hold?: Promise<unknown> } = { hold: held() };
    const { api } = server(options);
    const el = await mount(api);
    options.hold = undefined;
    await press(el, "next-month");
    expect(text(dayButton(el, "2026-11-20"))).toBe("20 Late autumn");
    release();
    await settle(el);
    // October's answer, which has no 20 November, has not replaced November's.
    expect(text(dayButton(el, "2026-11-20"))).toBe("20 Late autumn");

    options.hold = held();
    options.fail = true;
    await press(el, "next-month");
    options.hold = undefined;
    options.fail = false;
    await press(el, "previous-month");
    release();
    await settle(el);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const { api } = server();
    const el = await mount(api);
    expect(heading(el)).toBe("octubre de 2026");
    expect(text(el.shadowRoot!.querySelector("thead th"))).toBe("lun");
    expect(text(dayButton(el, "2026-10-13"))).toBe("13 Staff day off · Cerrado");
  });
});

describe("Hours calendar: the keyboard", () => {
  it("moves by a day and by a week, across into the next month, and opens the date", async () => {
    const { api, reads } = server();
    const el = await mount(api);
    const buttons = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("td button")];
    // One Tab stop, on today.
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([
      dayButton(el, "2026-10-07"),
    ]);
    dayButton(el, "2026-10-12").focus();
    const focused = () => (el.shadowRoot!.activeElement as HTMLElement).closest("td")!.dataset.date;
    await userEvent.keyboard("{ArrowRight}");
    expect(focused()).toBe("2026-10-13");
    await userEvent.keyboard("{ArrowDown}");
    expect(focused()).toBe("2026-10-20");
    await userEvent.keyboard("{ArrowLeft}");
    expect(focused()).toBe("2026-10-19");
    await userEvent.keyboard("{ArrowUp}");
    expect(focused()).toBe("2026-10-12");
    await userEvent.keyboard("{Enter}");
    await settle(el);
    expect(text(panel(el).querySelector("h2"))).toBe("Mon, 12 Oct 2026 · Fiesta Nacional");
    expect(el.shadowRoot!.activeElement).toBe(panel(el).querySelector("h2"));
    expect(dayButton(el, "2026-10-12").getAttribute("aria-pressed")).toBe("true");

    // Past the grid's last week the month turns, and focus lands on the real date.
    dayButton(el, "2026-10-29").focus();
    await userEvent.keyboard("{ArrowDown}");
    await settle(el);
    expect(heading(el)).toBe("November 2026");
    expect(focused()).toBe("2026-11-05");
    dayButton(el, "2026-10-26").focus();
    await userEvent.keyboard("{ArrowLeft}");
    await settle(el);
    expect(heading(el)).toBe("October 2026");
    expect(focused()).toBe("2026-10-25");
    expect(reads()).toHaveLength(3);
  });
});

describe("Hours calendar: a date's panel", () => {
  const rows = (el: HoursCalendar) =>
    [...panel(el).querySelectorAll("tbody tr")].map((row) => [
      text(row.querySelector("th")),
      text(row.querySelector("td")),
    ]);

  it("asks for a date before one is opened", async () => {
    const { api } = server();
    const el = await mount(api);
    expect(text(panel(el))).toBe("Choose a date to see its hours.");
  });

  it("lists a special date's own and inherited hours, and offers Edit, Duplicate and Delete", async () => {
    const { api } = server();
    const el = await mount(api);
    await open(el, "2026-10-12");
    expect(rows(el)).toEqual([
      ["Restaurant", "12:00–23:00"],
      ["Deli", "Closed"],
      ["Kitchen", "Always open"],
      ["Bar", "Standard hours: 17:00–23:00"],
    ]);
    const inherited = panel(el).querySelectorAll<HTMLElement>(".inherited");
    expect(inherited).toHaveLength(1);
    // Grey, with no badge: the prefix is for assistive technology only.
    expect(getComputedStyle(inherited[0]!).color).toBe(token(el, "--wt-color-text-muted"));
    const prefix = inherited[0]!.querySelector<HTMLElement>(".visually-hidden")!;
    expect(prefix.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    expect(text(inherited[0]!)).toBe("Standard hours: 17:00–23:00");

    const heard: CalendarAction[] = [];
    el.addEventListener("hours-calendar-action", (event) =>
      heard.push((event as CustomEvent<CalendarAction>).detail),
    );
    const actions = [...panel(el).querySelectorAll<HTMLElement>("wt-button")];
    expect(actions.map(text)).toEqual(["Edit", "Duplicate", "Delete"]);
    for (const action of actions) action.click();
    expect(heard.map(({ kind }) => kind)).toEqual(["edit", "duplicate", "delete"]);
    expect(heard.every((action) => action.special?.id === "fiesta")).toBe(true);
    expect(heard[0]!.cells).toEqual(rangeModel("2026-09-28", "2026-11-01").specialCells[0]!.cells);
    expect(heard[0]!.returnTo()).toBe(actions[0]);
  });

  it("shows a whole-venue closure Closed for everyone but the default station", async () => {
    const { api } = server();
    const el = await mount(api);
    await open(el, "2026-10-13");
    expect(rows(el)).toEqual([
      ["Restaurant", "Closed"],
      ["Deli", "Closed"],
      ["Kitchen", "Always open"],
      ["Bar", "Closed"],
    ]);
  });

  it("shows an ordinary date's standard hours, all inherited, and offers to make it special", async () => {
    const { api } = server();
    const el = await mount(api);
    await open(el, "2026-10-14");
    expect(text(panel(el).querySelector("h2"))).toBe("Wed, 14 Oct 2026");
    expect(text(panel(el).querySelector('[data-test="holidays"]'))).toBe(
      "Local holiday: Invented feast",
    );
    expect(rows(el)).toEqual([
      ["Restaurant", "Standard hours: 12:00–16:00"],
      ["Deli", "Standard hours: No hours restriction"],
      ["Kitchen", "Always open"],
      ["Bar", "Standard hours: 17:00–23:00"],
    ]);
    const heard: CalendarAction[] = [];
    el.addEventListener("hours-calendar-action", (event) =>
      heard.push((event as CustomEvent<CalendarAction>).detail),
    );
    const actions = [...panel(el).querySelectorAll<HTMLElement>("wt-button")];
    expect(actions.map(text)).toEqual(["Make this a special date"]);
    actions[0]!.click();
    expect(heard.map(({ kind, date, special }) => [kind, date, special])).toEqual([
      ["make_special", "2026-10-14", undefined],
    ]);
  });

  it("closes the panel when the month it moves to does not show the open date", async () => {
    const { api } = server();
    const el = await mount(api);
    await open(el, "2026-10-12");
    expect(text(panel(el).querySelector("h2"))).toBe("Mon, 12 Oct 2026 · Fiesta Nacional");
    await press(el, "next-month");
    expect(heading(el)).toBe("November 2026");
    expect(text(panel(el))).toBe("Choose a date to see its hours.");
    expect(panel(el).querySelector("wt-button")).toBeNull();
    await press(el, "previous-month");
    expect(text(panel(el))).toBe("Choose a date to see its hours.");
    expect(dayButton(el, "2026-10-12").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the open date across a month change when the new month still shows it", async () => {
    const { api } = server();
    const el = await mount(api);
    await open(el, "2026-11-01");
    await press(el, "next-month");
    expect(heading(el)).toBe("November 2026");
    expect(text(panel(el).querySelector("h2"))).toBe("Sun, 1 Nov 2026");
    expect(rows(el)[0]).toEqual(["Restaurant", "Standard hours: 12:00–16:00"]);
    expect(dayButton(el, "2026-11-01").getAttribute("aria-pressed")).toBe("true");
  });

  it("offers nothing to change to a read-only viewer", async () => {
    const { api } = server();
    const el = await mount(api, { readOnly: true });
    await open(el, "2026-10-12");
    expect(panel(el).querySelectorAll("wt-button")).toHaveLength(0);
    await open(el, "2026-10-15");
    expect(panel(el).querySelectorAll("wt-button")).toHaveLength(0);
  });

  it("never breaks a time range across lines beside a long name", async () => {
    const long = "Restaurante principal de la planta baja con terraza cubierta";
    const request = async (path: string) => {
      const query = new URL(path, location.origin).searchParams;
      const model = rangeModel(query.get("from")!, query.get("to")!);
      model.subjects[0] = { ...model.subjects[0]!, name: long };
      return model;
    };
    const el = await mount(new HoursApi(request as unknown as DashboardRequest));
    await open(el, "2026-10-12");
    const cell = panel(el).querySelector("tbody tr td")!;
    expect(text(cell)).toBe("12:00–23:00");
    const range = document.createRange();
    range.selectNodeContents(cell);
    const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
    expect(lines.size).toBe(1);
  });

  it("wraps a squeezed panel cell between its periods, never inside one", async () => {
    const request = async (path: string) => {
      const query = new URL(path, location.origin).searchParams;
      const model = rangeModel(query.get("from")!, query.get("to")!);
      for (const special of model.specialCells)
        for (const entry of special.cells)
          if (entry.subject.id === "restaurant")
            entry.cell = {
              mode: "periods",
              periods: [
                { id: "f1", opensAt: "12:00", closesAt: "16:00" },
                { id: "f2", opensAt: "20:00", closesAt: "23:30" },
              ],
            };
      return model;
    };
    const el = await mount(new HoursApi(request as unknown as DashboardRequest));
    await open(el, "2026-10-12");
    const cell = panel(el).querySelector<HTMLElement>("tbody tr td")!;
    cell.style.width = "1px";
    const ranges = [...cell.querySelectorAll(".range")];
    expect(ranges.map(text)).toEqual(["12:00–16:00,", "20:00–23:30"]);
    const textRects = (node: Element) => {
      const contents = document.createRange();
      contents.selectNodeContents(node);
      return [...contents.getClientRects()];
    };
    const lines = (rects: DOMRect[]) => new Set(rects.map((rect) => Math.round(rect.top))).size;
    for (const range of ranges) expect(lines(textRects(range))).toBe(1);
    expect(lines(textRects(cell))).toBe(2);
  });

  it("keeps the panel and its actions on screen at phone width, and names dates in words", async () => {
    await page.viewport(390, 800);
    const { api } = server();
    const el = await mount(api);
    await open(el, "2026-10-13");
    const grid = el.shadowRoot!.querySelector("table")!.getBoundingClientRect();
    const box = panel(el).getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(grid.bottom);
    expect(grid.right).toBeLessThanOrEqual(390);
    for (const action of panel(el).querySelectorAll("wt-button")) {
      const rect = action.getBoundingClientRect();
      expect([rect.left >= 0, rect.right <= 390, rect.width > 0]).toEqual([true, true, true]);
    }
    expect(text(dayButton(el, "2026-10-13"))).toBe("13 Staff day off · Closed");
    expect(text(dayButton(el, "2026-10-12"))).toBe("12 Fiesta Nacional");
  });
});

describe("Hours calendar: public holidays", () => {
  const fact = (
    id: string,
    date: LocalDate,
    name: string,
    scope: HolidayFact["scope"],
    sourceId: string,
  ): HolidayFact => ({ id, date, name, scope, sourceId });
  const BOE: HolidaySource = {
    id: "es-boe-2025-21667",
    kind: "official",
    title: "BOE-A-2025-21667",
    url: "https://www.boe.es/buscar/doc.php?id=BOE-A-2025-21667",
    sha256: "abc",
  };
  const OWNER: HolidaySource = {
    id: "owner:g1",
    kind: "owner",
    title: "Sevilla",
    url: null,
    sha256: null,
  };
  const coverage = (
    year: number,
    nationalRegional: HolidayCoverage["nationalRegional"],
    local: HolidayCoverage["local"],
  ): HolidayCoverage => ({
    year,
    country: "ES",
    provinceCode: "41",
    regionCode: "01",
    nationalRegional,
    local,
    dataVersion: nationalRegional === "complete" ? "ES-2026.1" : null,
    sourceIds: [],
  });
  /** 15 October holds three facts, two of them sharing a name; 16 October holds the special date. */
  function holidays(model: HoursModel) {
    const on15 = model.days.find((day) => day.date === "2026-10-15");
    on15?.holidays.push(
      fact("shipped:national", "2026-10-15", "Fiesta común", "national", BOE.id),
      fact("shipped:regional", "2026-10-15", "Día de la región", "regional", BOE.id),
      fact("local:e1", "2026-10-15", "Día de la región", "local", OWNER.id),
    );
    model.holidaySources = [BOE, OWNER];
    model.holidayCoverage = [coverage(2026, "complete", "owner_entered")];
  }

  it("joins a day's distinct labels once, on standard hours and the standard colour, and adds no colour of its own", async () => {
    const { api } = server({ edit: holidays });
    const el = await mount(api);
    expect(text(dayButton(el, "2026-10-15"))).toBe(
      "15 Fiesta común · Día de la región · standard hours",
    );
    expect(day(el, "2026-10-15").dataset.tone).toBe("standard");
    expect(getComputedStyle(day(el, "2026-10-15")).backgroundColor).toBe(
      token(el, "--wt-color-day-standard"),
    );
    expect(dayButton(el, "2026-10-15").querySelector("[data-colour]")).toBeNull();
    expect(dayButton(el, "2026-10-15").getAttribute("aria-label")).toBe(
      "Thursday, 15 October 2026, Fiesta común · Día de la región · standard hours",
    );
  });

  it("lists every applicable label with its scope and source in the panel, without saying Closed", async () => {
    const { api } = server({ edit: holidays });
    const el = await mount(api);
    await open(el, "2026-10-15");
    const items = [...panel(el).querySelectorAll('[data-test="holidays"] li')].map(text);
    expect(items).toEqual([
      "National holiday: Fiesta común Source: BOE-A-2025-21667",
      "Regional holiday: Día de la región Source: BOE-A-2025-21667",
      "Local holiday: Día de la región Entered by you for Sevilla",
    ]);
    const link = panel(el).querySelector<HTMLAnchorElement>('[data-test="holidays"] a')!;
    expect(link.href).toBe(BOE.url);
    expect(text(panel(el))).not.toMatch(/closed/i);
    expect([...panel(el).querySelectorAll('[data-test="coverage"] li')].map(text)).toEqual([
      "2026: official national and regional holidays are included.",
      "2026: local holidays are the ones you entered.",
    ]);
    const heard: CalendarAction[] = [];
    el.addEventListener("hours-calendar-action", (event) =>
      heard.push((event as CustomEvent<CalendarAction>).detail),
    );
    await press(el, "calendar-make_special");
    expect(heard[0]!.holidays!.map(({ id }) => id)).toEqual([
      "shipped:national",
      "shipped:regional",
      "local:e1",
    ]);
  });

  it("shows a holiday's facts beside a special date's own name and hours, and Delete removes only the special date", async () => {
    const { api } = server({
      edit: (model) => {
        model.days
          .find((day) => day.date === "2026-10-12")!
          .holidays.push(
            fact("shipped:pilar", "2026-10-12", "Fiesta Nacional de España", "national", BOE.id),
          );
        model.holidaySources = [BOE];
      },
    });
    const el = await mount(api);
    expect(text(dayButton(el, "2026-10-12"))).toBe("12 Fiesta Nacional Fiesta Nacional de España");
    expect(day(el, "2026-10-12").dataset.tone).toBe("red");
    await open(el, "2026-10-12");
    expect(text(panel(el).querySelector("h2"))).toBe("Mon, 12 Oct 2026 · Fiesta Nacional");
    expect(text(panel(el).querySelector('[data-test="holidays"]'))).toBe(
      "National holiday: Fiesta Nacional de España Source: BOE-A-2025-21667",
    );
    const heard: CalendarAction[] = [];
    el.addEventListener("hours-calendar-action", (event) =>
      heard.push((event as CustomEvent<CalendarAction>).detail),
    );
    await press(el, "calendar-delete");
    expect(heard.map(({ kind, special }) => [kind, special?.id])).toEqual([["delete", "fiesta"]]);
  });

  it.each([
    [
      "complete",
      "none_entered",
      [],
      [
        "2026: official national and regional holidays are included.",
        "2026: no local holidays entered.",
      ],
    ],
    [
      "missing_year",
      "none_entered",
      ["2026: official holidays are not available yet, so none are shown."],
      [
        "2026: official holidays are not available yet, so none are shown.",
        "2026: no local holidays entered.",
      ],
    ],
    [
      "unknown_region",
      "address_unresolved",
      ["2026: the venue's province is not recognised, so official holidays are not shown."],
      [
        "2026: the venue's province is not recognised, so official holidays are not shown.",
        "2026: local holidays need the venue's city and a recognised province; set them in Venue details.",
      ],
    ],
    [
      "area_required",
      "owner_entered",
      [
        "2026: only official holidays for the whole province are shown until the holiday area is chosen under Special dates.",
      ],
      [
        "2026: only official holidays for the whole province are shown until the holiday area is chosen under Special dates.",
        "2026: local holidays are the ones you entered.",
      ],
    ],
    [
      "unsupported_country",
      "unsupported_country",
      ["2026: official holidays are not available for this country."],
      [
        "2026: official holidays are not available for this country.",
        "2026: local holidays cannot be entered for a venue in this country.",
      ],
    ],
  ] as const)(
    "says coverage %s / %s on the month and on ordinary and special days alike, editing still offered",
    async (national, local, month, shown) => {
      const { api } = server({
        edit: (model) => {
          model.holidayCoverage = [coverage(2026, national, local)];
        },
      });
      const el = await mount(api);
      expect(
        [...el.shadowRoot!.querySelectorAll('[data-test="month-coverage"] li')].map(text),
      ).toEqual(month);
      for (const date of ["2026-10-15", "2026-10-12"]) {
        await open(el, date);
        expect([...panel(el).querySelectorAll('[data-test="coverage"] li')].map(text)).toEqual(
          shown,
        );
        expect(panel(el).querySelectorAll("wt-button").length).toBeGreaterThan(0);
      }
    },
  );

  it("keeps the server's Closed tone on a holiday", async () => {
    const { api } = server({
      edit: (model) => {
        model.days
          .find((day) => day.date === "2026-10-20")!
          .holidays.push(
            fact("shipped:a", "2026-10-20", "Fiesta común", "national", BOE.id),
            fact("shipped:b", "2026-10-20", "Día de la región", "regional", BOE.id),
          );
        model.holidaySources = [BOE];
      },
    });
    const el = await mount(api);
    expect(day(el, "2026-10-20").dataset.tone).toBe("closed");
    expect(getComputedStyle(day(el, "2026-10-20")).backgroundColor).toBe(
      token(el, "--wt-color-day-closed"),
    );
    expect(text(dayButton(el, "2026-10-20"))).toBe("20 Closed Fiesta común · Día de la región");
    await open(el, "2026-10-20");
    const items = [...panel(el).querySelectorAll('[data-test="holidays"] li')].map(text);
    expect(items).toEqual([
      "National holiday: Fiesta común Source: BOE-A-2025-21667",
      "Regional holiday: Día de la región Source: BOE-A-2025-21667",
    ]);
  });

  it("says local holidays are unavailable, not that the address needs fixing, in a country with no holidays", async () => {
    const { api } = server({
      edit: (model) => {
        model.holidayCoverage = [
          {
            ...coverage(2026, "unsupported_country", "address_unresolved"),
            country: "GB",
            provinceCode: null,
            regionCode: null,
          },
        ];
      },
    });
    const el = await mount(api);
    await open(el, "2026-10-15");
    expect([...panel(el).querySelectorAll('[data-test="coverage"] li')].map(text)).toEqual([
      "2026: official holidays are not available for this country.",
      "2026: local holidays cannot be entered for a venue in this country.",
    ]);
  });

  it("treats a year with no coverage as unknown, never as complete", async () => {
    const { api } = server();
    const el = await mount(api);
    expect(
      [...el.shadowRoot!.querySelectorAll('[data-test="month-coverage"] li')].map(text),
    ).toEqual(["2026: which official holidays apply could not be read."]);
  });

  it("says each year's coverage across December and January", async () => {
    const { api } = server({
      edit: (model) => {
        model.holidayCoverage = [
          coverage(2026, "complete", "none_entered"),
          coverage(2027, "missing_year", "none_entered"),
        ];
      },
    });
    const el = await mount(api, { today: "2026-12-20" });
    expect(
      [...el.shadowRoot!.querySelectorAll('[data-test="month-coverage"] li')].map(text),
    ).toEqual(["2027: official holidays are not available yet, so none are shown."]);
    await open(el, "2027-01-01");
    expect([...panel(el).querySelectorAll('[data-test="coverage"] li')].map(text)[0]).toBe(
      "2027: official holidays are not available yet, so none are shown.",
    );
    await open(el, "2026-12-31");
    expect([...panel(el).querySelectorAll('[data-test="coverage"] li')].map(text)[0]).toBe(
      "2026: official national and regional holidays are included.",
    );
    await press(el, "previous-month");
    expect(el.shadowRoot!.querySelector('[data-test="month-coverage"]')).toBeNull();
  });

  it("speaks Spanish about holidays and coverage, keeping official names as published", async () => {
    setLocale("es");
    const { api } = server({ edit: holidays });
    const el = await mount(api);
    expect(text(dayButton(el, "2026-10-15"))).toBe(
      "15 Fiesta común · Día de la región · horario habitual",
    );
    await open(el, "2026-10-15");
    expect([...panel(el).querySelectorAll('[data-test="holidays"] li')].map(text)).toEqual([
      "Festivo nacional: Fiesta común Fuente: BOE-A-2025-21667",
      "Festivo autonómico: Día de la región Fuente: BOE-A-2025-21667",
      "Festivo local: Día de la región Introducido por ti para Sevilla",
    ]);
    expect([...panel(el).querySelectorAll('[data-test="coverage"] li')].map(text)).toEqual([
      "2026: se incluyen los festivos oficiales nacionales y autonómicos.",
      "2026: los festivos locales son los que introdujiste.",
    ]);
  });
});
