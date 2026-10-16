import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import { DEPARTMENTS, holiday, monthModel } from "../testing/opening-hours-month-fixture.js";
import type {
  CalendarDayOpen,
  CalendarDaysOpen,
  OpeningHoursMonthView,
} from "./opening-hours-month.js";
import "./opening-hours-month.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => commands.parkPointer());
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

async function mount(
  model: OpeningHoursMonth = monthModel(),
  extra: Partial<OpeningHoursMonthView> = {},
): Promise<OpeningHoursMonthView> {
  const el = document.createElement("opening-hours-month");
  Object.assign(el, {
    model,
    departments: DEPARTMENTS,
    ...extra,
  });
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  return el;
}
/** A station's month: one row, the Grill, getting the Restaurant's orders. */
const STATION = [
  {
    id: "grill",
    name: "Grill",
    zones: [],
    periods: DEPARTMENTS[0]!.periods.map(({ id, name, colour }) => ({ id, name, colour })),
  },
];
function stationModel(): OpeningHoursMonth {
  const model = monthModel();
  return {
    ...model,
    days: model.days.map((day) => ({
      ...day,
      departments: [{ departmentId: "grill", ranges: day.departments[0]!.ranges, zones: [] }],
    })),
  };
}
const root = (el: OpeningHoursMonthView) => el.shadowRoot!;
const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const cell = (el: OpeningHoursMonthView, date: LocalDate) =>
  root(el).querySelector<HTMLElement>(`[data-date="${date}"]`)!;
const dayButton = (el: OpeningHoursMonthView, date: LocalDate) =>
  cell(el, date).querySelector<HTMLButtonElement>("button.day")!;
const testId = (el: OpeningHoursMonthView, id: string) =>
  root(el).querySelector<HTMLElement>(`[data-test="${id}"]`);
function events<T>(el: OpeningHoursMonthView, name: string): T[] {
  const sent: T[] = [];
  el.addEventListener(name, (event) => sent.push((event as CustomEvent<T>).detail));
  return sent;
}
const percent = (value: string) => Number.parseFloat(value);
const pressed = (el: OpeningHoursMonthView) =>
  [...root(el).querySelectorAll<HTMLElement>('button.day[aria-pressed="true"]')].map(
    (button) => button.closest<HTMLElement>("[data-date]")!.dataset.date,
  );
const daySel = (date: LocalDate) => `opening-hours-month td[data-date="${date}"] button.day`;
const DRAG = ["2026-12-20", "2026-12-21", "2026-12-22", "2026-12-23"];

describe("Opening hours month", () => {
  it("heads the month with its name and year, and the columns with weekdays from Monday", async () => {
    const el = await mount();
    expect(text(testId(el, "month"))).toBe("December 2026");
    const columns = [...root(el).querySelectorAll('[data-test="weekday"]')].map(text);
    expect(columns).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;
    expect(text(testId(el, "month")).toLowerCase()).toBe("diciembre 2026");
    expect(
      [...root(el).querySelectorAll('[data-test="weekday"]')].map((th) => text(th).toLowerCase()),
    ).toEqual(["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]);
  });

  it("draws every returned date, its heading only its number, the neighbouring months' faint", async () => {
    for (const locale of ["en", "es"] as const) {
      setLocale(locale);
      const el = await mount();
      const cells = [...root(el).querySelectorAll<HTMLElement>("[data-date]")];
      expect(cells.map((c) => c.dataset.date)).toEqual(monthModel().days.map((day) => day.date));
      for (const c of cells) {
        const heading = text(c.querySelector('[data-test="date-heading"]'));
        expect(heading).toBe(String(Number(c.dataset.date!.slice(8))));
      }
      expect(cell(el, "2026-11-30").hasAttribute("data-outside")).toBe(true);
      expect(cell(el, "2027-01-01").hasAttribute("data-outside")).toBe(true);
      expect(cell(el, "2026-12-01").hasAttribute("data-outside")).toBe(false);
      el.remove();
    }
  });

  it("marks today, in words, on today's cell only", async () => {
    const el = await mount();
    const marked = [...root(el).querySelectorAll('[data-test="today"]')];
    expect(marked).toHaveLength(1);
    expect(marked[0]!.closest<HTMLElement>("[data-date]")!.dataset.date).toBe("2026-12-30");
    expect(text(marked[0])).toBe("Today");
    expect(dayButton(el, "2026-12-30").getAttribute("aria-current")).toBe("date");
    expect(dayButton(el, "2026-12-29").hasAttribute("aria-current")).toBe(false);
  });

  it("tints a cell's top edge by its season", async () => {
    const el = await mount();
    const autumn = cell(el, "2026-11-30").dataset.tint;
    const winter = cell(el, "2026-12-01").dataset.tint;
    expect(autumn).toBeTruthy();
    expect(winter).toBeTruthy();
    expect(autumn).not.toBe(winter);
  });

  it("names a special day, a public holiday with no special day, and draws a closed day closed", async () => {
    const el = await mount();
    expect(text(cell(el, "2026-12-14").querySelector('[data-test="name"]'))).toBe(
      "Company dinners",
    );
    expect(cell(el, "2026-12-14").querySelector('[data-test="name"]')!.className).toContain(
      "special",
    );
    const holidayName = cell(el, "2026-12-08").querySelector('[data-test="name"]')!;
    expect(text(holidayName)).toBe("Immaculate Conception");
    expect(holidayName.className).toContain("holiday");
    const xmas = cell(el, "2026-12-25");
    expect(xmas.hasAttribute("data-closed")).toBe(true);
    expect(text(xmas.querySelector('[data-test="name"]'))).toBe("Christmas Day · Closed");
    const xmasTracks = [...xmas.querySelectorAll<HTMLElement>(".track")];
    expect(xmasTracks.map((track) => track.dataset.row)).toEqual(["rest", "bar"]);
    for (const track of xmasTracks) expect(track.querySelectorAll(".segment")).toHaveLength(0);
    expect(text(cell(el, "2026-12-09").querySelector('[data-test="name"]'))).toBe("");
  });

  it("draws a public holiday's name after a special day of another name, in red unless the date is closed all day", async () => {
    const model = monthModel();
    const days = model.days.map((day) =>
      day.date === "2026-12-08"
        ? { ...day, specialDay: { id: "dinner", name: "Company dinner" } }
        : day.date === "2026-12-25"
          ? { ...day, specialDay: { id: "staff", name: "Staff party" } }
          : day,
    );
    const el = await mount({ ...model, days });
    const names = (date: LocalDate) =>
      [...cell(el, date).querySelectorAll('[data-test="name"]')].map((name) => [
        text(name),
        name.classList.contains("special")
          ? "special"
          : name.classList.contains("holiday")
            ? "holiday"
            : "",
      ]);
    expect(names("2026-12-08")).toEqual([
      ["Company dinner", "special"],
      ["Immaculate Conception", "holiday"],
    ]);
    expect(names("2026-12-25")).toEqual([
      ["Staff party · Closed", "special"],
      ["Christmas Day", "holiday"],
    ]);
    applyTokens(el);
    const colours = (date: LocalDate) => ({
      day: getComputedStyle(dayButton(el, date)).color,
      lines: [...cell(el, date).querySelectorAll('[data-test="name"]')].map(
        (name) => getComputedStyle(name).color,
      ),
    });
    const open = colours("2026-12-08");
    expect(new Set([open.day, ...open.lines]).size).toBe(3);
    const closed = colours("2026-12-25");
    expect(closed.lines).toEqual([closed.day, closed.day]);
  });

  it("names a special day once, as its public holiday, when the two share a name", async () => {
    const model = monthModel();
    const days = model.days.map((day) =>
      day.date === "2026-12-08"
        ? { ...day, specialDay: { id: "immaculate", name: "Immaculate Conception" } }
        : day,
    );
    const el = await mount({ ...model, days });
    for (const [date, line] of [
      ["2026-12-08", "Immaculate Conception"],
      ["2026-12-25", "Christmas Day · Closed"],
    ] as const) {
      const names = cell(el, date).querySelectorAll('[data-test="name"]');
      expect(names, date).toHaveLength(1);
      expect(text(names[0])).toBe(line);
      expect(names[0]!.classList.contains("holiday"), date).toBe(true);
    }
  });

  it('draws a closed day with no name as "Closed"', async () => {
    const model = monthModel();
    const days = model.days.map((day) =>
      day.date === "2026-12-26" ? { ...day, closedAllDay: true } : day,
    );
    const el = await mount({ ...model, days });
    expect(text(cell(el, "2026-12-26").querySelector('[data-test="name"]'))).toBe("Closed");
  });

  it("draws a department closed that date as an empty bar", async () => {
    const el = await mount();
    const sunday = cell(el, "2026-12-06");
    const tracks = [...sunday.querySelectorAll<HTMLElement>(".track")];
    expect(tracks.map((track) => track.dataset.row)).toEqual(["rest", "bar"]);
    expect(tracks[0]!.querySelectorAll(".segment")).toHaveLength(0);
    expect(text(sunday)).not.toContain("Restaurant closed");
  });

  it("still says a closed department in words", async () => {
    const el = await mount();
    expect(dayButton(el, "2026-12-06").getAttribute("aria-label")).toContain("Restaurant closed");
  });

  it("draws a bar per department, each range placed from changeover to changeover in its period's colour", async () => {
    const el = await mount();
    const tracks = [...cell(el, "2026-12-07").querySelectorAll<HTMLElement>(".track")];
    expect(tracks.map((track) => track.dataset.row)).toEqual(["rest", "bar"]);
    const segments = [...tracks[0]!.querySelectorAll<HTMLElement>(".segment")];
    expect(segments.map((s) => s.title)).toEqual([
      "Breakfast 08:00–11:00",
      "Lunch 13:00–16:00",
      "Dinner 20:00–23:00",
    ]);
    expect(segments.map((s) => s.dataset.colour)).toEqual(["amber", "green", "red"]);
    // 13:00 is 7 hours after the 06:00 changeover.
    expect(percent(segments[1]!.style.left)).toBeCloseTo((7 / 24) * 100, 3);
    expect(percent(segments[1]!.style.width)).toBeCloseTo((3 / 24) * 100, 3);
    const bar = tracks[1]!.querySelector<HTMLElement>(".segment")!;
    expect(bar.title).toBe("All day 10:00–02:00");
    expect(percent(bar.style.left)).toBeCloseTo((4 / 24) * 100, 3);
    expect(percent(bar.style.width)).toBeCloseTo((16 / 24) * 100, 3);
  });

  it("places each date's ranges from that date's own changeover, a longer day running past 24 hours", async () => {
    const model = monthModel();
    const days = model.days.map((day) =>
      day.date === "2026-12-09"
        ? {
            ...day,
            endMinute: 1500,
            departments: day.departments.map((d) =>
              d.departmentId === "bar"
                ? { ...d, ranges: [{ periodId: "allday", startsAt: "22:00", endsAt: "07:00" }] }
                : d,
            ),
          }
        : day.date >= "2026-12-10"
          ? { ...day, dayCutover: "07:00" }
          : day,
    );
    const el = await mount({ ...model, days });
    const lunch = cell(el, "2026-12-11").querySelectorAll<HTMLElement>(".segment")[1]!;
    expect(percent(lunch.style.left)).toBeCloseTo((6 / 24) * 100, 3);
    const before = cell(el, "2026-12-08").querySelectorAll<HTMLElement>(".segment")[1]!;
    expect(percent(before.style.left)).toBeCloseTo((7 / 24) * 100, 3);
    // 9 December runs 06:00 to the next day's 07:00, 25 hours.
    const late = cell(el, "2026-12-09").querySelector<HTMLElement>('[data-row="bar"] .segment')!;
    expect(percent(late.style.left)).toBeCloseTo((16 / 25) * 100, 3);
    expect(percent(late.style.width)).toBeCloseTo((9 / 25) * 100, 3);
  });

  it("with one department chosen, draws it and a bar per zone with the zone's closed time as a gap", async () => {
    const el = await mount(monthModel(), { departmentId: "rest" });
    const tracks = [...cell(el, "2026-12-01").querySelectorAll<HTMLElement>(".track")];
    expect(tracks.map((track) => track.dataset.row)).toEqual(["rest", "terrace"]);
    const gaps = [...tracks[1]!.querySelectorAll<HTMLElement>('[data-test="gap"]')];
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.title).toBe("Terrace closed 20:00–22:00");
    expect(percent(gaps[0]!.style.left)).toBeCloseTo((14 / 24) * 100, 3);
    expect(percent(gaps[0]!.style.width)).toBeCloseTo((2 / 24) * 100, 3);
    expect(tracks[1]!.querySelectorAll(".segment")).toHaveLength(3);
    expect(cell(el, "2026-12-02").querySelectorAll('[data-test="gap"]')).toHaveLength(0);
  });

  it("draws a zone's closure hatched, not as the bare track", async () => {
    const page = document.documentElement;
    const before = {
      root: page.getAttribute("data-wt-theme-root"),
      theme: page.getAttribute("data-theme"),
    };
    applyTokens(page);
    try {
      const el = await mount(monthModel(), { departmentId: "rest" });
      const terrace = cell(el, "2026-12-01").querySelector<HTMLElement>('[data-row="terrace"]')!;
      const gap = terrace.querySelector<HTMLElement>('[data-test="gap"]')!;
      const seen: string[] = [];
      for (const theme of ["light", "dark"] as const) {
        page.setAttribute("data-theme", theme);
        const track = getComputedStyle(terrace).backgroundColor;
        const image = getComputedStyle(gap).backgroundImage;
        expect(image, theme).toContain("repeating-linear-gradient");
        const stripes = image.match(/rgba?\([^)]*\)/g) ?? [];
        const visible = stripes.filter((colour) => colour !== track && !/,\s*0\)$/.test(colour));
        expect(visible, theme).not.toEqual([]);
        seen.push(`${track} ${image}`);
      }
      expect(new Set(seen).size).toBe(2);
    } finally {
      for (const [name, value] of [
        ["data-wt-theme-root", before.root],
        ["data-theme", before.theme],
      ] as const)
        if (value === null) page.removeAttribute(name);
        else page.setAttribute(name, value);
    }
  });

  it("draws a zone's blocks with the zone's own times", async () => {
    const el = await mount(monthModel(), { departmentId: "rest" });
    const terrace = cell(el, "2026-12-01").querySelector<HTMLElement>('[data-row="terrace"]')!;
    const segments = [...terrace.querySelectorAll<HTMLElement>(".segment")];
    expect(segments.map((segment) => segment.title)).toEqual([
      "Breakfast 08:00–11:00",
      "Lunch 13:00–16:00",
      "Dinner 22:00–23:00",
    ]);
    expect(percent(segments[2]!.style.left)).toBeCloseTo((16 / 24) * 100, 3);
  });

  it("places a zone's piece that starts past the changeover at the end of a 25-hour day", async () => {
    const model = monthModel();
    const days = model.days.map((day) =>
      day.date === "2026-12-09"
        ? {
            ...day,
            endMinute: 1500,
            departments: day.departments.map((d) =>
              d.departmentId === "rest"
                ? {
                    ...d,
                    ranges: [{ periodId: "dinner", startsAt: "22:00", endsAt: "07:00" }],
                    zones: [
                      { zoneId: "terrace", closed: [{ startsAt: "05:00", endsAt: "06:00" }] },
                    ],
                  }
                : d,
            ),
          }
        : day,
    );
    const el = await mount({ ...model, days }, { departmentId: "rest" });
    const terrace = cell(el, "2026-12-09").querySelector<HTMLElement>('[data-row="terrace"]')!;
    const segments = [...terrace.querySelectorAll<HTMLElement>(".segment")];
    expect(segments.map((segment) => segment.title)).toEqual([
      "Dinner 22:00–05:00",
      "Dinner 06:00–07:00",
    ]);
    // 06:00 tomorrow is 24 hours into the 25-hour day.
    expect(percent(segments[1]!.style.left)).toBeCloseTo((24 / 25) * 100, 3);
    expect(percent(segments[1]!.style.width)).toBeCloseTo((1 / 25) * 100, 3);
    const gap = terrace.querySelector<HTMLElement>('[data-test="gap"]')!;
    expect(gap.title).toBe("Terrace closed 05:00–06:00");
    expect(percent(gap.style.left)).toBeCloseTo((23 / 25) * 100, 3);
    expect(percent(gap.style.width)).toBeCloseTo((1 / 25) * 100, 3);
  });

  /** The Terrace on 2 December is closed 22:00–03:00, past the Restaurant's 23:00 close. */
  function lateClosureModel(): OpeningHoursMonth {
    const model = monthModel();
    return {
      ...model,
      days: model.days.map((day) =>
        day.date === "2026-12-02"
          ? {
              ...day,
              departments: day.departments.map((d) =>
                d.departmentId === "rest"
                  ? {
                      ...d,
                      zones: [
                        { zoneId: "terrace", closed: [{ startsAt: "22:00", endsAt: "03:00" }] },
                      ],
                    }
                  : d,
              ),
            }
          : day,
      ),
    };
  }

  it("draws a closure only where the department is open", async () => {
    const el = await mount(lateClosureModel(), { departmentId: "rest" });
    const terrace = cell(el, "2026-12-02").querySelector<HTMLElement>('[data-row="terrace"]')!;
    const gaps = [...terrace.querySelectorAll<HTMLElement>('[data-test="gap"]')];
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.title).toBe("Terrace closed 22:00–23:00");
    expect(percent(gaps[0]!.style.left)).toBeCloseTo((16 / 24) * 100, 3);
    expect(percent(gaps[0]!.style.width)).toBeCloseTo((1 / 24) * 100, 3);
    expect(terrace.querySelectorAll(".segment")).toHaveLength(3);
    const dinner = [...terrace.querySelectorAll<HTMLElement>(".segment")][2]!;
    expect(dinner.title).toBe("Dinner 20:00–22:00");
  });

  it("a zone closed for its department's whole day is an empty grey bar, spoken closed", async () => {
    const model = monthModel();
    const days = model.days.map((day) =>
      day.date === "2026-12-02"
        ? {
            ...day,
            departments: day.departments.map((d) =>
              d.departmentId === "rest"
                ? {
                    ...d,
                    zones: [
                      { zoneId: "terrace", closed: [{ startsAt: "07:00", endsAt: "05:00" }] },
                    ],
                  }
                : d,
            ),
          }
        : day,
    );
    const el = await mount({ ...model, days }, { departmentId: "rest" });
    const terrace = cell(el, "2026-12-02").querySelector<HTMLElement>('[data-row="terrace"]');
    expect(terrace).not.toBeNull();
    expect(terrace!.querySelectorAll(".segment")).toHaveLength(0);
    expect(terrace!.querySelectorAll('[data-test="gap"]')).toHaveLength(0);
    const label = dayButton(el, "2026-12-02").getAttribute("aria-label")!;
    expect(label).toMatch(/Terrace closed(,|$)/);
    expect(label).not.toMatch(/Terrace closed \d/);
  });

  it("says a zone's own hours to a screen reader", async () => {
    const el = await mount(lateClosureModel(), { departmentId: "rest" });
    expect(dayButton(el, "2026-12-02").getAttribute("aria-label")).toContain(
      "Terrace: Breakfast 08:00–11:00, Lunch 13:00–16:00, Dinner 20:00–22:00, Terrace closed 22:00–23:00",
    );
  });

  it("offers All departments and each department, and sends the choice", async () => {
    const el = await mount(monthModel(), { departmentId: "rest" });
    const picker = root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "wt-combobox[name=departmentId]",
    )!;
    expect(picker.options.map((option) => option.label)).toEqual([
      "All departments",
      "Restaurant",
      "Bar",
    ]);
    expect(picker.value).toBe("rest");
    const sent = events<{ departmentId: string }>(el, "month-department-change");
    for (const value of ["rest", "bar", "all"])
      picker.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
    expect(sent).toEqual([{ departmentId: "bar" }, { departmentId: "" }]);
    expect(picker.value).toBe("rest");
  });

  it("draws only ‹ month ›, the switch's slot and Show above the dates", async () => {
    const el = await mount();
    for (const id of ["year-back", "add-special-day", "rows"])
      expect(testId(el, id), id).toBeNull();
    expect(root(el).querySelector("season-chips")).toBeNull();
    const parts = [
      '[data-test="previous-month"]',
      '.fixed-title:has(> [data-test="month"])',
      '[data-test="next-month"]',
      'slot[name="switch"]',
      'wt-combobox[name="departmentId"]',
    ];
    const head = root(el).querySelector(".head")!;
    expect([...head.children].map((child) => parts.find((part) => child.matches(part)))).toEqual(
      parts,
    );
  });

  it("keeps ‹ and › in place whatever month and year it shows, in every language", async () => {
    const months = [
      ...Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`),
      "2011-05",
      "2088-05",
    ];
    const lefts: [string, number][] = [];
    for (const locale of ["en", "es"] as const) {
      setLocale(locale);
      const el = document.createElement("opening-hours-month");
      applyTokens(el);
      document.body.append(el);
      hosts.push(el);
      for (const month of months) {
        el.month = month;
        await el.updateComplete;
        lefts.push([`${locale} ${month}`, testId(el, "next-month")!.getBoundingClientRect().left]);
      }
      el.remove();
    }
    expect(lefts).toEqual(lefts.map(([shown]) => [shown, lefts[0]![1]]));
  });

  it("keeps station mode as it was", async () => {
    const el = await mount(monthModel(), {
      readOnly: true,
      stationMode: true,
      departments: DEPARTMENTS.map(({ id, name, periods }) => ({
        id,
        name,
        zones: [],
        periods: periods.map(({ id, name, colour }) => ({ id, name, colour })),
      })),
    });
    expect(root(el).querySelector("season-chips")!.keyOnly).toBe(true);
    expect(text(testId(el, "rows"))).toBe("Rows: Restaurant · Bar");
  });

  it("steps a month either way from the requested month", async () => {
    const el = await mount(monthModel(), { month: "2027-01" });
    const months = events<{ month: string }>(el, "month-change");
    testId(el, "previous-month")!.click();
    testId(el, "next-month")!.click();
    expect(months).toEqual([{ month: "2026-12" }, { month: "2027-02" }]);
  });

  it("draws no dates under a requested month whose read is pending, keeping ‹ › and focus", async () => {
    const el = await mount();
    testId(el, "next-month")!.focus();
    el.month = "2027-01";
    await el.updateComplete;
    expect(text(testId(el, "month"))).toBe("January 2027");
    expect(root(el).querySelector("td[data-date]")).toBeNull();
    expect(root(el).activeElement).toBe(testId(el, "next-month"));
    const months = events<{ month: string }>(el, "month-change");
    testId(el, "next-month")!.click();
    expect(months).toEqual([{ month: "2027-02" }]);
    el.model = monthModel({ month: "2027-01" });
    await el.updateComplete;
    expect(root(el).querySelector("td[data-date]")).not.toBeNull();
    expect(root(el).activeElement).toBe(testId(el, "next-month"));
  });

  it("draws the heading and ‹ › of a requested month with no read yet", async () => {
    const el = await mount(undefined, { month: "2027-01" });
    el.model = undefined;
    await el.updateComplete;
    expect(text(testId(el, "month"))).toBe("January 2027");
    expect(root(el).querySelector("table, wt-combobox, season-chips")).toBeNull();
  });

  it("steps across a year from December and January", async () => {
    const el = await mount();
    const months = events<{ month: string }>(el, "month-change");
    testId(el, "next-month")!.click();
    el.month = "2027-01";
    await el.updateComplete;
    testId(el, "previous-month")!.click();
    expect(months).toEqual([{ month: "2027-01" }, { month: "2026-12" }]);
  });

  it("does not step outside the months the read serves", async () => {
    const el = await mount(monthModel({ month: "0100-02" }));
    expect(testId(el, "previous-month")!.hasAttribute("disabled")).toBe(true);
    expect(testId(el, "next-month")!.hasAttribute("disabled")).toBe(false);
    const sent = events<{ month: string }>(el, "month-change");
    testId(el, "previous-month")!.click();
    el.month = "9998-12";
    await el.updateComplete;
    expect(testId(el, "previous-month")!.hasAttribute("disabled")).toBe(false);
    expect(testId(el, "next-month")!.hasAttribute("disabled")).toBe(true);
    testId(el, "next-month")!.click();
    expect(sent).toEqual([]);
  });

  it("sends calendar-day-open for every date, neighbours too", async () => {
    const el = await mount();
    const sent = events<CalendarDayOpen>(el, "calendar-day-open");
    const dates = ["2026-12-14", "2026-12-08", "2026-12-09", "2026-11-30"];
    for (const date of dates) dayButton(el, date).click();
    expect(sent.map(({ date }) => date)).toEqual(dates);
    sent.forEach(({ date, returnTo }) => expect(returnTo()).toBe(dayButton(el, date)));
  });

  it("read-only, draws no season chips and keeps each date a button, its name, and ‹ ›", async () => {
    const el = await mount(monthModel(), { readOnly: true });
    expect(root(el).querySelector("season-chips")).toBeNull();
    expect(root(el).querySelectorAll("button.day")).toHaveLength(
      root(el).querySelectorAll("td[data-date]").length,
    );
    expect(text(cell(el, "2026-12-14").querySelector('[data-test="name"]'))).toBe(
      "Company dinners",
    );
    expect(testId(el, "previous-month")).not.toBeNull();
  });

  it("a viewer's dates are buttons too", async () => {
    const el = await mount(monthModel(), { readOnly: true });
    const cells = root(el).querySelectorAll("td[data-date]").length;
    expect(cells).toBeGreaterThan(0);
    expect(root(el).querySelectorAll("button.day")).toHaveLength(cells);
    const sent = events<CalendarDayOpen>(el, "calendar-day-open");
    dayButton(el, "2026-12-14").click();
    expect(sent.map(({ date }) => date)).toEqual(["2026-12-14"]);
  });

  it("in station mode over one row, draws only the month's steps, its dates and the season key, with no Rows legend", async () => {
    const el = await mount(stationModel(), {
      readOnly: true,
      stationMode: true,
      departments: STATION,
    });
    expect(testId(el, "year-back")).toBeNull();
    expect(root(el).querySelector("wt-combobox")).toBeNull();
    expect(testId(el, "add-special-day")).toBeNull();
    expect(root(el).querySelector("season-chips")!.keyOnly).toBe(true);
    expect(root(el).querySelectorAll("button")).toHaveLength(0);
    expect(cell(el, "2026-12-09").querySelector(".day")!.getAttribute("role")).toBe("group");
    expect(testId(el, "rows")).toBeNull();
    const months = events<{ month: string }>(el, "month-change");
    testId(el, "previous-month")!.click();
    testId(el, "next-month")!.click();
    expect(months).toEqual([{ month: "2026-11" }, { month: "2027-01" }]);
  });

  it('in station mode, reads "No orders" for a date the station gets nothing', async () => {
    for (const [locale, words] of [
      ["en", "No orders"],
      ["es", "Sin pedidos"],
    ] as const) {
      setLocale(locale);
      const el = await mount(stationModel(), {
        readOnly: true,
        stationMode: true,
        departments: STATION,
      });
      const sunday = cell(el, "2026-12-06");
      expect([...sunday.querySelectorAll('[data-test="no-orders"]')].map(text)).toEqual([words]);
      expect(sunday.querySelector(".day")!.getAttribute("aria-label")).toContain(words);
      expect(sunday.querySelector(".day")!.getAttribute("aria-label")).not.toContain("Grill");
      expect(cell(el, "2026-12-07").querySelector('[data-test="no-orders"]')).toBeNull();
      expect(cell(el, "2026-12-07").querySelectorAll(".track")).toHaveLength(1);
      el.remove();
    }
  });

  it("in station mode with a row per department, keys the rows and names each period's department on hover", async () => {
    for (const [locale, rows] of [
      ["en", "Rows: Restaurant · Bar"],
      ["es", "Filas: Restaurant · Bar"],
    ] as const) {
      setLocale(locale);
      const model = monthModel();
      const days = model.days.map((day) => ({
        ...day,
        departments: day.departments.map((d) => ({
          ...d,
          ranges: day.date === "2026-12-15" ? [] : d.ranges,
          zones: [],
        })),
      }));
      const el = await mount(
        { ...model, days },
        {
          readOnly: true,
          stationMode: true,
          departments: DEPARTMENTS.map(({ id, name, periods }) => ({
            id,
            name,
            zones: [],
            periods: periods.map(({ id, name, colour }) => ({ id, name, colour })),
          })),
        },
      );
      expect(text(testId(el, "rows"))).toBe(rows);
      const tracks = [...cell(el, "2026-12-07").querySelectorAll<HTMLElement>(".track")];
      expect(tracks.map((track) => track.dataset.row)).toEqual(["rest", "bar"]);
      expect(
        tracks.map((track) =>
          [...track.querySelectorAll<HTMLElement>(".segment")].map((s) => s.title),
        ),
      ).toEqual([
        [
          "Breakfast (Restaurant) 08:00–11:00",
          "Lunch (Restaurant) 13:00–16:00",
          "Dinner (Restaurant) 20:00–23:00",
        ],
        ["All day (Bar) 10:00–02:00"],
      ]);
      expect(cell(el, "2026-12-07").querySelector(".day")!.getAttribute("aria-label")).toContain(
        "Restaurant: Breakfast 08:00–11:00, Lunch 13:00–16:00, Dinner 20:00–23:00, Bar: All day 10:00–02:00",
      );
      const words = locale === "en" ? "No orders" : "Sin pedidos";
      const sunday = cell(el, "2026-12-06");
      expect([...sunday.querySelectorAll<HTMLElement>(".track")].map((t) => t.dataset.row)).toEqual(
        ["rest", "bar"],
      );
      expect(sunday.querySelectorAll('.track[data-row="rest"] .segment')).toHaveLength(0);
      expect(sunday.querySelector('[data-test="no-orders"]')).toBeNull();
      expect(sunday.querySelector(".day")!.getAttribute("aria-label")).toContain(
        `Restaurant: ${words}, Bar: All day 10:00–02:00`,
      );
      const none = cell(el, "2026-12-15");
      expect([...none.querySelectorAll('[data-test="no-orders"]')].map(text)).toEqual([words]);
      expect(none.querySelectorAll(".track")).toHaveLength(0);
      const label = none.querySelector(".day")!.getAttribute("aria-label")!;
      expect(label.split(words)).toHaveLength(2);
      expect(label).not.toContain("Restaurant");
      expect(cell(el, "2026-12-25").querySelectorAll('[data-test="no-orders"]')).toHaveLength(1);
      el.remove();
    }
  });

  it("passes the seasons the month touches to the chips", async () => {
    const el = await mount(
      { ...stationModel(), clockRevision: 4 },
      { readOnly: true, stationMode: true, departments: STATION },
    );
    const chips = root(el).querySelector("season-chips")!;
    expect(chips.seasons.map((season) => season.id)).toEqual(["autumn", "winter"]);
    expect(chips.clockRevision).toBe(4);
  });

  it("moves between dates with the arrow keys, holding one Tab stop", async () => {
    const el = await mount();
    const stops = () =>
      [...root(el).querySelectorAll<HTMLElement>('button.day[tabindex="0"]')].map(
        (b) => b.closest<HTMLElement>("[data-date]")!.dataset.date,
      );
    expect(stops()).toEqual(["2026-12-30"]);
    dayButton(el, "2026-12-30").focus();
    await userEvent.keyboard("{ArrowUp}");
    await el.updateComplete;
    expect(stops()).toEqual(["2026-12-23"]);
    expect(el.shadowRoot!.activeElement).toBe(dayButton(el, "2026-12-23"));
    await userEvent.keyboard("{ArrowRight}");
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(dayButton(el, "2026-12-24"));
  });

  it("a drag picks a run and a double-click asks to open it", async () => {
    const el = await mount();
    const opened = events<CalendarDayOpen>(el, "calendar-day-open");
    const runs = events<CalendarDaysOpen>(el, "calendar-days-open");
    await commands.mouseDrag(DRAG.map(daySel));
    await el.updateComplete;
    expect(pressed(el)).toEqual(DRAG);
    expect(opened).toEqual([]);
    await userEvent.dblClick(dayButton(el, "2026-12-22"));
    await el.updateComplete;
    expect(runs).toEqual([{ date: "2026-12-22", from: "2026-12-20", to: "2026-12-23" }]);
    expect(pressed(el)).toEqual(DRAG);
  });

  it("a viewer's drag and double-click pick no run and open nothing", async () => {
    const el = await mount(monthModel(), { readOnly: true });
    const runs = events<CalendarDaysOpen>(el, "calendar-days-open");
    await commands.mouseDrag(DRAG.map(daySel));
    await el.updateComplete;
    expect(pressed(el)).toEqual([]);
    await userEvent.dblClick(dayButton(el, "2026-12-22"));
    await el.updateComplete;
    expect(pressed(el)).toEqual(["2026-12-22"]);
    expect(runs).toEqual([]);
  });

  it("Enter opens, Space shows the day box", async () => {
    const el = await mount();
    const opened = events<CalendarDayOpen>(el, "calendar-day-open");
    const runs = events<CalendarDaysOpen>(el, "calendar-days-open");
    await commands.mouseDrag(["2026-12-20", "2026-12-23"].map(daySel));
    dayButton(el, "2026-12-22").focus();
    await userEvent.keyboard("{Enter}");
    expect(runs).toEqual([{ date: "2026-12-22", from: "2026-12-20", to: "2026-12-23" }]);
    expect(opened).toEqual([]);
    await userEvent.keyboard("{ }");
    expect(opened.map(({ date }) => date)).toEqual(["2026-12-22"]);
    expect(runs).toHaveLength(1);
  });

  it("a viewer's Enter shows the day box and opens no run", async () => {
    const el = await mount(monthModel(), { readOnly: true });
    const opened = events<CalendarDayOpen>(el, "calendar-day-open");
    const runs = events<CalendarDaysOpen>(el, "calendar-days-open");
    dayButton(el, "2026-12-22").focus();
    await userEvent.keyboard("{Enter}");
    expect(opened.map(({ date }) => date)).toEqual(["2026-12-22"]);
    expect(runs).toEqual([]);
  });

  it("a run crosses into the next month's faint dates", async () => {
    const el = await mount();
    const runs = events<CalendarDaysOpen>(el, "calendar-days-open");
    const run = ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"];
    await commands.mouseDrag(run.map(daySel));
    await el.updateComplete;
    expect(pressed(el)).toEqual(run);
    await userEvent.dblClick(dayButton(el, "2027-01-01"));
    expect(runs).toEqual([{ date: "2027-01-01", from: "2026-12-30", to: "2027-01-02" }]);
  });

  it("forgets a picked run when the month changes", async () => {
    const el = await mount();
    await commands.mouseDrag(["2026-12-30", "2027-01-02"].map(daySel));
    await el.updateComplete;
    expect(pressed(el)).toHaveLength(4);
    el.model = monthModel();
    await el.updateComplete;
    expect(pressed(el)).toHaveLength(4);
    el.model = monthModel({
      month: "2027-01",
      days: monthModel().days.map((day) => ({ ...day, date: addDays(day.date, 35) })),
    });
    await el.updateComplete;
    el.model = monthModel();
    await el.updateComplete;
    expect(pressed(el)).toEqual([]);
  });

  it("in station mode, a drag or a double-click picks and opens nothing", async () => {
    const el = await mount(stationModel(), { stationMode: true, departments: STATION });
    const opened = events<CalendarDayOpen>(el, "calendar-day-open");
    const runs = events<CalendarDaysOpen>(el, "calendar-days-open");
    const sel = (date: LocalDate) => `opening-hours-month td[data-date="${date}"] .day`;
    await commands.mouseDrag(DRAG.map(sel));
    await userEvent.dblClick(cell(el, "2026-12-22").querySelector<HTMLElement>(".day")!);
    expect(root(el).querySelector("[aria-pressed]")).toBeNull();
    expect(opened).toEqual([]);
    expect(runs).toEqual([]);
  });

  it("fits a phone's width without scrolling sideways", async () => {
    for (const departmentId of ["", "rest"]) {
      const frame = document.createElement("div");
      frame.style.width = "390px";
      document.body.append(frame);
      applyTokens(frame);
      hosts.push(frame);
      const el = await mount(monthModel(), { departmentId });
      frame.append(el);
      await el.updateComplete;
      expect(el.scrollWidth).toBeLessThanOrEqual(390);
      for (const part of el.shadowRoot!.querySelectorAll<HTMLElement>("table, .head, .sub, .day"))
        expect(part.getBoundingClientRect().right).toBeLessThanOrEqual(
          frame.getBoundingClientRect().right + 0.5,
        );
    }
  });

  /** The month's width on a 390 px phone (the screen's own padding taken off), or on a desktop. */
  const PHONE = 302;
  const DESKTOP = 900;
  async function mountAt(
    width: number,
    model: OpeningHoursMonth = monthModel(),
    extra: Partial<OpeningHoursMonthView> = {},
  ) {
    const frame = document.createElement("div");
    frame.style.width = `${width}px`;
    document.body.append(frame);
    applyTokens(frame);
    hosts.push(frame);
    const el = await mount(model, extra);
    frame.append(el);
    await el.updateComplete;
    return el;
  }
  /** Shown whole: no line or letter of its text is cut off. */
  const whole = (node: HTMLElement) =>
    node.scrollWidth <= node.clientWidth + 0.5 && node.scrollHeight <= node.clientHeight + 0.5;

  it("marks today with a ring and a mark that is never cut off, at a phone's width and a desktop's", async () => {
    for (const locale of ["en", "es"] as const)
      for (const width of [PHONE, DESKTOP]) {
        setLocale(locale);
        const el = await mountAt(width);
        const today = dayButton(el, "2026-12-30");
        expect(getComputedStyle(today).boxShadow, `${locale} ${width}`).not.toBe("none");
        expect(getComputedStyle(dayButton(el, "2026-12-29")).boxShadow).toBe("none");
        expect(today.getAttribute("aria-label")).toContain(locale === "en" ? "Today" : "Hoy");
        const marker = cell(el, "2026-12-30").querySelector<HTMLElement>('[data-test="today"]')!;
        expect(text(marker)).toBe(locale === "en" ? "Today" : "Hoy");
        const box = marker.getBoundingClientRect();
        if (width === DESKTOP) {
          expect(box.width, `${locale} ${width}`).toBeGreaterThan(1);
          expect(whole(marker), `${locale} ${width}`).toBe(true);
          expect(box.right).toBeLessThanOrEqual(today.getBoundingClientRect().right + 0.5);
        } else {
          // Too narrow for the word: it is kept for a screen reader, and the number is marked.
          expect(box.width, `${locale} ${width}`).toBeLessThanOrEqual(1);
          const number = cell(el, "2026-12-30").querySelector<HTMLElement>(
            '[data-test="date-heading"]',
          )!;
          expect(getComputedStyle(number).backgroundColor).not.toBe(
            getComputedStyle(today).backgroundColor,
          );
        }
      }
  });

  it("shows special-day, holiday and closed names whole at a phone's width, wrapping them", async () => {
    for (const locale of ["en", "es"] as const) {
      setLocale(locale);
      const el = await mountAt(PHONE);
      for (const date of ["2026-12-08", "2026-12-14", "2026-12-25"]) {
        const name = cell(el, date).querySelector<HTMLElement>('[data-test="name"]')!;
        expect(whole(name), `${locale} ${date}: ${text(name)}`).toBe(true);
      }
    }
  });

  it('reads "<name> · Closed" and an empty bar per row on a date closed all day', async () => {
    const long = "Lunes siguiente al Día de la Constitución Española";
    const model = monthModel();
    const days = model.days.map((day) =>
      day.date === "2026-12-07" ? { ...day, holidays: [holiday(day.date, long)] } : day,
    );
    const el = await mountAt(DESKTOP, { ...model, days });
    const xmas = cell(el, "2026-12-25");
    const name = xmas.querySelector<HTMLElement>('[data-test="name"]')!;
    expect(text(name)).toBe("Christmas Day · Closed");
    expect(whole(name)).toBe(true);
    const emptyRows = () =>
      [...xmas.querySelectorAll<HTMLElement>(".track")]
        .filter((track) => !track.querySelector(".segment"))
        .map((track) => track.dataset.row);
    expect(emptyRows()).toEqual(["rest", "bar"]);
    const holidayName = cell(el, "2026-12-07").querySelector<HTMLElement>('[data-test="name"]')!;
    expect(text(holidayName)).toBe(long);
    expect(whole(holidayName)).toBe(true);
    el.departmentId = "rest";
    await el.updateComplete;
    expect(emptyRows()).toEqual(["rest", "terrace"]);
  });

  it("keeps every date of a row the same height", async () => {
    const el = await mountAt(DESKTOP);
    const [sunday, monday] = ["2026-12-06", "2026-12-07"].map((date) => cell(el, date));
    expect(sunday!.querySelectorAll(".track")).toHaveLength(
      monday!.querySelectorAll(".track").length,
    );
    expect(sunday!.querySelector<HTMLElement>(".day")!.getBoundingClientRect().height).toBe(
      monday!.querySelector<HTMLElement>(".day")!.getBoundingClientRect().height,
    );
    // Both boxes sit at their min-height, so the drawn content's own extent is what can differ.
    const contentHeight = (td: HTMLElement) => {
      const day = td.querySelector<HTMLElement>(".day")!;
      return (
        day.lastElementChild!.getBoundingClientRect().bottom -
        day.firstElementChild!.getBoundingClientRect().top
      );
    };
    expect(contentHeight(sunday!)).toBe(contentHeight(monday!));
  });

  it('in station mode at a phone\'s width, drops "No orders" from a date closed all day only', async () => {
    const el = await mountAt(PHONE, stationModel(), {
      readOnly: true,
      stationMode: true,
      departments: STATION,
    });
    const shown = (date: LocalDate) => {
      const line = cell(el, date).querySelector<HTMLElement>('[data-test="no-orders"]')!;
      return getComputedStyle(line).display !== "none" && line.getBoundingClientRect().height > 0;
    };
    expect(shown("2026-12-25")).toBe(false);
    expect(shown("2026-12-06")).toBe(true);
  });

  it("draws a date closed all day with a bar per row, at a phone's width too", async () => {
    const el = await mountAt(PHONE);
    const xmas = cell(el, "2026-12-25");
    const tracks = [...xmas.querySelectorAll<HTMLElement>(".track")];
    expect(tracks.map((track) => track.dataset.row)).toEqual(["rest", "bar"]);
    for (const track of tracks) {
      expect(track.querySelectorAll(".segment")).toHaveLength(0);
      expect(track.getBoundingClientRect().height).toBeGreaterThan(0);
    }
    expect(text(xmas.querySelector('[data-test="name"]'))).toBe("Christmas Day · Closed");
  });

  it("draws every date of a week row the row's full height", async () => {
    const zones = ["Terrace", "Dining room", "Downstairs", "Upstairs", "Patio"].map((name, i) => ({
      id: i ? `zone-${i}` : "terrace",
      name,
      seasonWeeks: [],
    }));
    const departments = DEPARTMENTS.map((d) => (d.id === "rest" ? { ...d, zones } : d));
    const model = monthModel();
    const days = model.days.map((day) => ({
      ...day,
      departments: day.departments.map((d) =>
        d.departmentId === "rest"
          ? { ...d, zones: zones.map((zone) => ({ zoneId: zone.id, closed: [] })) }
          : d,
      ),
    }));
    for (const departmentId of ["", "rest"]) {
      const el = await mountAt(DESKTOP, { ...model, days }, { departments, departmentId });
      for (const date of ["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-13"]) {
        const td = cell(el, date).getBoundingClientRect();
        const card = dayButton(el, date).getBoundingClientRect();
        expect(card.height, `${departmentId || "all"} ${date}`).toBeCloseTo(td.height, 0);
      }
    }
  });

  it("runs a range that ends at the changeover to the bar's end", async () => {
    const model = monthModel();
    const days = model.days.map((day) => ({
      ...day,
      dayCutover: "08:00",
      departments: day.departments.map((d) =>
        d.departmentId === "bar"
          ? { ...d, ranges: [{ periodId: "allday", startsAt: "22:00", endsAt: "08:00" }] }
          : d,
      ),
    }));
    const el = await mount({ ...model, days });
    const [rest, bar] = [...cell(el, "2026-12-07").querySelectorAll<HTMLElement>(".track")];
    const lunch = rest!.querySelectorAll<HTMLElement>(".segment")[1]!;
    expect(percent(lunch.style.left)).toBeCloseTo((5 / 24) * 100, 3);
    const late = bar!.querySelector<HTMLElement>(".segment")!;
    expect(percent(late.style.left)).toBeCloseTo((14 / 24) * 100, 3);
    expect(percent(late.style.width)).toBeCloseTo((10 / 24) * 100, 3);
  });

  it("reads an empty name and no colour for an id the department list lacks, and no tint without a season", async () => {
    const model = monthModel();
    const days = model.days.map((day) =>
      day.date === "2026-12-07" ? { ...day, seasonId: null } : day,
    );
    const el = await mount({ ...model, days }, { departments: [] });
    const segment = cell(el, "2026-12-09").querySelector<HTMLElement>(".segment")!;
    expect(segment.hasAttribute("data-colour")).toBe(false);
    expect(segment.title).toBe(" 08:00–11:00");
    expect(cell(el, "2026-12-07").hasAttribute("data-tint")).toBe(false);
  });

  it("returns focus to the date's button while it is drawn, and to nothing once it is gone", async () => {
    const el = await mount();
    const sent = events<CalendarDayOpen>(el, "calendar-day-open");
    dayButton(el, "2026-12-14").click();
    dayButton(el, "2026-12-09").click();
    expect(sent[0]!.returnTo()).toBe(dayButton(el, "2026-12-14"));
    el.model = monthModel({
      month: "2027-03",
      days: monthModel().days.map((day) => ({ ...day, date: addDays(day.date, 91) })),
    });
    await el.updateComplete;
    expect(sent[0]!.returnTo()).toBeNull();
    expect(sent[1]!.returnTo()).toBeNull();
  });

  it("keeps focus where it is on a key that does not move, and at the grid's edge", async () => {
    const el = await mount();
    dayButton(el, "2026-12-02").focus();
    await userEvent.keyboard("a");
    await userEvent.keyboard("{ArrowUp}");
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(dayButton(el, "2026-12-02"));
  });

  it("holds the Tab stop on today's date in a new month the focused date is not in", async () => {
    const el = await mount();
    dayButton(el, "2026-12-02").focus();
    await el.updateComplete;
    const stop = () =>
      root(el)
        .querySelector<HTMLElement>('button.day[tabindex="0"]')!
        .closest<HTMLElement>("[data-date]")!.dataset.date;
    expect(stop()).toBe("2026-12-02");
    const model = monthModel();
    el.model = {
      ...model,
      month: "2027-01",
      today: "2027-01-20",
      days: model.days.map((day) => ({ ...day, date: addDays(day.date, 35) })),
    };
    await el.updateComplete;
    expect(stop()).toBe("2027-01-20");
  });

  it("draws nothing before its first read, and puts the Tab stop on the 1st without a today", async () => {
    const el = document.createElement("opening-hours-month");
    document.body.append(el);
    hosts.push(el);
    await el.updateComplete;
    expect(el.shadowRoot!.childElementCount).toBe(0);
    el.departments = DEPARTMENTS;
    el.model = monthModel({ today: null });
    await el.updateComplete;
    expect(
      [...root(el).querySelectorAll<HTMLElement>('button.day[tabindex="0"]')].map(
        (b) => b.closest<HTMLElement>("[data-date]")!.dataset.date,
      ),
    ).toEqual(["2026-12-01"]);
    expect(root(el).querySelector('[data-test="today"]')).toBeNull();
  });

  it("names each date in full for a screen reader, with its hours", async () => {
    const el = await mount();
    const label = dayButton(el, "2026-12-06").getAttribute("aria-label")!;
    expect(label).toContain("Sunday, 6 December 2026");
    expect(label).toContain("Restaurant closed");
    expect(label).toContain("All day 10:00–02:00");
  });
});
