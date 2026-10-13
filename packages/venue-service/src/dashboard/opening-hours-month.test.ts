import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import type { SpecialDayAction } from "./special-day-action.js";
import type { OpeningHoursMonthView } from "./opening-hours-month.js";
import "./opening-hours-month.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
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
    expect(xmas.querySelectorAll(".track")).toHaveLength(0);
    expect(text(cell(el, "2026-12-09").querySelector('[data-test="name"]'))).toBe("");
  });

  it('draws a closed day with no name as "Closed"', async () => {
    const model = monthModel();
    const days = model.days.map((day) =>
      day.date === "2026-12-26" ? { ...day, closedAllDay: true } : day,
    );
    const el = await mount({ ...model, days });
    expect(text(cell(el, "2026-12-26").querySelector('[data-test="name"]'))).toBe("Closed");
  });

  it('reads "<department> closed" in place of the bar of a department with no hours that date', async () => {
    const el = await mount();
    const sunday = cell(el, "2026-12-06");
    expect([...sunday.querySelectorAll('[data-test="department-closed"]')].map(text)).toEqual([
      "Restaurant closed",
    ]);
    expect(sunday.querySelectorAll(".track")).toHaveLength(1);
    expect(cell(el, "2026-12-07").querySelectorAll('[data-test="department-closed"]')).toHaveLength(
      0,
    );
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
    expect(text(testId(el, "rows"))).toBe("Rows: Restaurant · Bar");
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
    expect(text(testId(el, "rows"))).toBe("Rows: Restaurant · Terrace");
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

  it("steps a month either way from the requested month, and goes back to the year", async () => {
    const el = await mount(monthModel(), { month: "2027-01" });
    const months = events<{ month: string }>(el, "month-change");
    testId(el, "previous-month")!.click();
    testId(el, "next-month")!.click();
    expect(months).toEqual([{ month: "2026-12" }, { month: "2027-02" }]);
    const years = events<{ year: number }>(el, "month-year-open");
    // The requested month's year, ahead of the model's while its read is pending.
    expect(text(testId(el, "year-back"))).toBe("‹ 2027");
    testId(el, "year-back")!.click();
    expect(years).toEqual([{ year: 2027 }]);
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

  it("opens the special day on a special date, as the year view does", async () => {
    const el = await mount();
    const sent = events<SpecialDayAction>(el, "special-day-action");
    const ordinary = events<unknown>(el, "ordinary-date-open");
    dayButton(el, "2026-12-14").click();
    expect(ordinary).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "open",
      date: "2026-12-14",
      specialDay: { id: "company", name: "Company dinners" },
      holidays: [],
    });
    expect(sent[0]!.visibleHolidays!.map((h) => h.name)).toEqual([
      "Immaculate Conception",
      "Christmas Day",
    ]);
    expect(sent[0]!.returnTo()).toBe(dayButton(el, "2026-12-14"));
  });

  it("opens the special-day dialog on a public holiday with no special day, with the holiday", async () => {
    const el = await mount();
    const sent = events<SpecialDayAction>(el, "special-day-action");
    dayButton(el, "2026-12-08").click();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "open", date: "2026-12-08", specialDay: null });
    expect(sent[0]!.holidays.map((h) => h.name)).toEqual(["Immaculate Conception"]);
  });

  it("opens an ordinary date with its season, faint neighbouring dates too", async () => {
    const el = await mount();
    const sent = events<{ date: string; seasonId: string | null; returnTo: () => unknown }>(
      el,
      "ordinary-date-open",
    );
    const special = events<unknown>(el, "special-day-action");
    dayButton(el, "2026-12-09").click();
    dayButton(el, "2026-11-30").click();
    expect(special).toEqual([]);
    expect(sent.map(({ date, seasonId }) => ({ date, seasonId }))).toEqual([
      { date: "2026-12-09", seasonId: "winter" },
      { date: "2026-11-30", seasonId: "autumn" },
    ]);
    expect(sent[0]!.returnTo()).toBe(dayButton(el, "2026-12-09"));
  });

  it('sends "+ Special day" as the year view does', async () => {
    const el = await mount();
    const sent = events<SpecialDayAction>(el, "special-day-action");
    testId(el, "add-special-day")!.click();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "open", date: "", specialDay: null, holidays: [] });
    expect(sent[0]!.returnTo()).toBe(testId(el, "add-special-day"));
  });

  it("read-only, hides the write actions and opens nothing from a date", async () => {
    const el = await mount(monthModel(), { readOnly: true });
    expect(testId(el, "add-special-day")).toBeNull();
    expect(root(el).querySelector("season-chips")!.readOnly).toBe(true);
    expect(root(el).querySelectorAll("button.day")).toHaveLength(0);
    expect(text(cell(el, "2026-12-14").querySelector('[data-test="name"]'))).toBe(
      "Company dinners",
    );
    expect(testId(el, "previous-month")).not.toBeNull();
  });

  it("passes the seasons the month touches to the chips", async () => {
    const el = await mount(monthModel({ clockRevision: 4 }));
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
    const special = events<SpecialDayAction>(el, "special-day-action");
    const ordinary = events<{ returnTo: () => HTMLElement | null }>(el, "ordinary-date-open");
    dayButton(el, "2026-12-14").click();
    dayButton(el, "2026-12-09").click();
    el.readOnly = true;
    await el.updateComplete;
    expect(special[0]!.returnTo()).toBeNull();
    expect(ordinary[0]!.returnTo()).toBeNull();
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
