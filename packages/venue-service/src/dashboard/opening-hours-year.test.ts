import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { OpeningHoursYear, OpeningHoursYearDay } from "../opening-hours-calendar.js";
import type { HolidayFact, LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import type { SpecialDayAction } from "./special-day-action.js";
import type { OpeningHoursYearView } from "./opening-hours-year.js";
import "./opening-hours-year.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

const seasons = [
  { id: "w", name: "Winter", startsOn: "12-01", lastDay: "02-28" },
  { id: "sp", name: "Spring", startsOn: "03-01", lastDay: "05-31" },
  { id: "su", name: "Summer", startsOn: "06-01", lastDay: "08-31" },
  { id: "a", name: "Autumn", startsOn: "09-01", lastDay: "11-30" },
];
const holiday = (date: LocalDate, name: string): HolidayFact => ({
  id: `h-${date}`,
  date,
  name,
  scope: "national",
  sourceId: "official",
});

const everyHoliday = [
  holiday("2027-01-06", "Epiphany"),
  holiday("2027-12-08", "Immaculate Conception"),
];

/** 2027 with a public holiday on 6 January, a special day on 12 May, a special day on the public
 *  holiday of 8 December and a closed day on 26 December. */
function yearModel(overrides: Partial<OpeningHoursYear> = {}): OpeningHoursYear {
  const days: OpeningHoursYearDay[] = [];
  for (let date = "2027-01-01"; date <= "2027-12-31"; date = addDays(date, 1)) {
    const mmdd = date.slice(5);
    const seasonId =
      mmdd >= "12-01" || mmdd < "03-01" ? "w" : mmdd < "06-01" ? "sp" : mmdd < "09-01" ? "su" : "a";
    const holidays =
      date === "2027-01-06"
        ? [holiday(date, "Epiphany")]
        : date === "2027-12-08"
          ? [holiday(date, "Immaculate Conception")]
          : [];
    const specialDay =
      date === "2027-05-12"
        ? { id: "fair", name: "Town fair" }
        : date === "2027-12-08"
          ? { id: "market", name: "Christmas market" }
          : null;
    const closed = date === "2027-12-26";
    days.push({
      date,
      seasonId,
      specialDay,
      holidays,
      tone: holidays.length
        ? "public_holiday"
        : specialDay
          ? "special_day"
          : closed
            ? "closed"
            : "standard",
      closed,
    });
  }
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 7,
    currentBusinessDay: "2027-03-10",
    pending: null,
    year: 2027,
    timeZone: "Europe/Madrid",
    today: "2027-03-10",
    seasons,
    days,
    publicHolidaysAvailable: true,
    missingHolidays: [],
    holidayCoverage: [
      {
        year: 2027,
        country: "ES",
        provinceCode: "08",
        regionCode: "CT",
        nationalRegional: "complete",
        local: "none_entered",
        dataVersion: "ES-2027.1",
        sourceIds: ["boe"],
      },
    ],
    area: { readiness: "ready", addressKey: "city", options: [], required: false, chosen: null },
    ...overrides,
  };
}

async function mount(
  model: OpeningHoursYear = yearModel(),
  extra: Partial<OpeningHoursYearView> = {},
): Promise<OpeningHoursYearView> {
  const el = document.createElement("opening-hours-year");
  Object.assign(el, { model, ...extra });
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  return el;
}
const root = (el: OpeningHoursYearView) => el.shadowRoot!;
const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const cell = (el: OpeningHoursYearView, date: LocalDate) =>
  root(el).querySelector<HTMLElement>(`td[data-date="${date}"]`)!;
const dayButton = (el: OpeningHoursYearView, date: LocalDate) =>
  cell(el, date).querySelector<HTMLButtonElement>("button")!;
const panel = (el: OpeningHoursYearView) =>
  root(el).querySelector<HTMLElement>('[data-test="date-panel"]');
function actions(el: OpeningHoursYearView) {
  const sent: SpecialDayAction[] = [];
  el.addEventListener("special-day-action", (event) =>
    sent.push((event as CustomEvent<SpecialDayAction>).detail),
  );
  return sent;
}

describe("Opening hours year", () => {
  it("draws twelve Monday-first months holding only their own dates", async () => {
    const el = await mount();
    const months = [...root(el).querySelectorAll('[data-test="month-name"]')].map(text);
    expect(months).toEqual([
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ]);
    expect(root(el).querySelectorAll("td[data-date]")).toHaveLength(365);
    expect(text(root(el).querySelector('[data-test="year"]'))).toBe("2027");
    // 1 January 2027 is a Friday, so four empty cells come before it.
    const firstRow = root(el).querySelector('[data-month="2027-01"] tbody tr')!;
    expect([...firstRow.children].map((td) => (td as HTMLElement).dataset.date ?? "")).toEqual([
      "",
      "",
      "",
      "",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  it("draws every date of a year below 1000, whose dates carry four year digits", async () => {
    const days: OpeningHoursYearDay[] = [];
    for (let date = "0100-01-01"; date <= "0100-12-31"; date = addDays(date, 1))
      days.push({
        date,
        seasonId: "w",
        specialDay: null,
        holidays: [],
        tone: "standard",
        closed: false,
      });
    const el = await mount(
      yearModel({
        year: 100,
        days,
        today: "2027-03-10",
        holidayCoverage: [],
      }),
    );
    expect(root(el).querySelectorAll("td[data-date]")).toHaveLength(365);
    expect(cell(el, "0100-01-01")).not.toBeNull();
    expect(root(el).querySelector('[data-month="0100-02"]')).not.toBeNull();
    expect(root(el).querySelector("[tabindex='0']")?.closest("td")?.dataset.date).toBe(
      "0100-01-01",
    );
    dayButton(el, "0100-03-02").click();
    await el.updateComplete;
    expect(panel(el)).not.toBeNull();
    el.model = { ...el.model!, days: [...days] };
    await el.updateComplete;
    expect(panel(el)).not.toBeNull();
    expect(dayButton(el, "0100-03-02").getAttribute("aria-pressed")).toBe("true");
  });

  it("tints each day by its season's place in start order, cycling past the fourth", async () => {
    const el = await mount();
    expect(
      ["2027-01-15", "2027-04-10", "2027-07-01", "2027-10-01", "2027-12-01"].map(
        (date) => cell(el, date).dataset.tint,
      ),
    ).toEqual(["4", "1", "2", "3", "4"]);
    const five = await mount(
      yearModel({
        seasons: [...seasons, { id: "x", name: "Late", startsOn: "12-20", lastDay: "02-28" }],
        days: yearModel().days.map((day) =>
          day.date >= "2027-12-20" ? { ...day, seasonId: "x" } : day,
        ),
      }),
    );
    expect(cell(five, "2027-12-25").dataset.tint).toBe("1");
    expect(cell(five, "2027-12-01").dataset.tint).toBe("4");
    expect(
      root(five)
        .querySelector("season-chips")!
        .shadowRoot!.querySelector<HTMLElement>('[data-season="x"]')!.dataset.tint,
    ).toBe("1");
  });

  it("paints each tinted day with its season's colour tokens", async () => {
    const el = await mount();
    applyTokens(el);
    await el.updateComplete;
    const token = (name: string) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      root(el).append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const dates = { "1": "2027-04-10", "2": "2027-07-01", "3": "2027-10-01", "4": "2027-01-15" };
    for (const [tint, date] of Object.entries(dates)) {
      const painted = getComputedStyle(dayButton(el, date));
      expect([painted.backgroundColor, painted.color]).toEqual([
        token(`--wt-color-season-${tint}`),
        token(`--wt-color-on-season-${tint}`),
      ]);
    }
    expect(new Set(Object.keys(dates).map((tint) => token(`--wt-color-season-${tint}`))).size).toBe(
      4,
    );
  });

  it("marks public holidays, special days and closed days, with a legend of the three", async () => {
    const el = await mount();
    expect(cell(el, "2027-01-06").dataset.tone).toBe("public_holiday");
    expect(cell(el, "2027-05-12").dataset.tone).toBe("special_day");
    const marks = (date: LocalDate) =>
      ["mark-holiday", "mark-special"].filter((mark) => cell(el, date).classList.contains(mark));
    expect(marks("2027-01-06")).toEqual(["mark-holiday"]);
    expect(marks("2027-05-12")).toEqual(["mark-special"]);
    expect(marks("2027-12-08")).toEqual(["mark-holiday", "mark-special"]);
    expect(marks("2027-12-26")).toEqual([]);
    expect(cell(el, "2027-12-26").hasAttribute("data-closed")).toBe(true);
    expect(cell(el, "2027-12-27").hasAttribute("data-closed")).toBe(false);
    expect(cell(el, "2027-12-27").dataset.tone).toBe("standard");
    expect(dayButton(el, "2027-01-06").getAttribute("aria-label")).toBe(
      "Wednesday, 6 January 2027, Epiphany",
    );
    expect(dayButton(el, "2027-12-26").getAttribute("aria-label")).toBe(
      "Sunday, 26 December 2027, Closed",
    );
    expect([...root(el).querySelectorAll(".legend li")].map(text)).toEqual([
      "Public holiday",
      "Special day",
      "Closed",
    ]);
    expect(root(el).querySelector('[aria-current="date"]')?.closest("td")?.dataset.date).toBe(
      "2027-03-10",
    );
  });

  it("asks for the year either side", async () => {
    const el = await mount();
    const years: number[] = [];
    el.addEventListener("year-change", (event) =>
      years.push((event as CustomEvent<{ year: number }>).detail.year),
    );
    root(el).querySelector<HTMLElement>('[data-test="previous-year"]')!.click();
    root(el).querySelector<HTMLElement>('[data-test="next-year"]')!.click();
    expect(years).toEqual([2026, 2028]);
    expect(root(el).querySelector('[data-test="previous-year"]')!.getAttribute("aria-label")).toBe(
      "Previous year",
    );
  });

  it("asks for a month's first day when its name is chosen", async () => {
    const el = await mount();
    const opened: unknown[] = [];
    el.addEventListener("year-month-open", (event) => opened.push((event as CustomEvent).detail));
    root(el).querySelectorAll<HTMLElement>('[data-test="month-name"]')[2]!.click();
    expect(opened).toEqual([{ date: "2027-03-01" }]);
  });

  it("hands the seasons, the clock revision, the api and every special day to the chips", async () => {
    const api = {
      saveSeason: vi.fn(),
      addSeason: vi.fn(),
      deleteSeason: vi.fn(),
      readSeasonDeleteImpact: vi.fn(),
    };
    const specialDays = [
      { id: "fair", name: "Town fair" },
      { id: "later", name: "Next year's fair" },
    ];
    const el = await mount(yearModel(), { api, specialDays });
    const chips = root(el).querySelector("season-chips")!;
    expect(chips.seasons).toEqual(seasons);
    expect(chips.clockRevision).toBe(7);
    expect(chips.api).toBe(api);
    expect(chips.specialDays).toEqual(specialDays);
    expect(chips.readOnly).toBe(false);
    const changed = vi.fn();
    document.body.addEventListener("season-changed", changed);
    chips.dispatchEvent(new CustomEvent("season-changed", { bubbles: true, composed: true }));
    document.body.removeEventListener("season-changed", changed);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("opens an empty special day from + Special day", async () => {
    const el = await mount();
    const sent = actions(el);
    const add = root(el).querySelector<HTMLElement>('[data-test="add-special-day"]')!;
    expect(text(add)).toBe("+ Special day");
    add.click();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "open", date: "", specialDay: null, holidays: [] });
    expect(sent[0]!.visibleHolidays).toEqual(everyHoliday);
    expect(sent[0]!.returnTo()).toBe(add);
  });

  it("offers Edit and Delete on a special day's date, each sending the special day", async () => {
    const el = await mount();
    const sent = actions(el);
    expect(panel(el)).toBeNull();
    dayButton(el, "2027-05-12").click();
    await el.updateComplete;
    expect(dayButton(el, "2027-05-12").getAttribute("aria-pressed")).toBe("true");
    await vi.waitFor(() => expect(root(el).activeElement).toBe(panel(el)!.querySelector("h3")));
    expect(text(panel(el)!.querySelector("h3"))).toContain("Town fair");
    expect(panel(el)!.closest("[data-month]")?.getAttribute("data-month")).toBe("2027-05");
    const edit = panel(el)!.querySelector<HTMLElement>('[data-test="special-edit"]')!;
    edit.click();
    panel(el)!.querySelector<HTMLElement>('[data-test="special-delete"]')!.click();
    expect(panel(el)!.querySelector('[data-test="special-add"]')).toBeNull();
    expect(
      sent.map(({ kind, date, specialDay, holidays }) => [kind, date, specialDay, holidays]),
    ).toEqual([
      ["open", "2027-05-12", { id: "fair", name: "Town fair" }, []],
      ["delete", "2027-05-12", { id: "fair", name: "Town fair" }, []],
    ]);
    expect(sent[0]!.returnTo()).toBe(edit);
  });

  it("offers a public holiday's date as a special day, carrying the holiday", async () => {
    const el = await mount();
    const sent = actions(el);
    dayButton(el, "2027-01-06").click();
    await el.updateComplete;
    expect(text(panel(el))).toContain("Epiphany");
    panel(el)!.querySelector<HTMLElement>('[data-test="special-add"]')!.click();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "open",
      date: "2027-01-06",
      specialDay: null,
      holidays: [holiday("2027-01-06", "Epiphany")],
      visibleHolidays: everyHoliday,
    });
  });

  it("names the public holiday beside a special day on the same date, in the panel and the day's name", async () => {
    const el = await mount();
    expect(dayButton(el, "2027-12-08").getAttribute("aria-label")).toBe(
      "Wednesday, 8 December 2027, Christmas market, Immaculate Conception",
    );
    expect(text(dayButton(el, "2027-12-08"))).toBe("8");
    dayButton(el, "2027-12-08").click();
    await el.updateComplete;
    expect(text(panel(el)!.querySelector("h3"))).toContain("Christmas market");
    expect([...panel(el)!.querySelectorAll("p")].map(text)).toContain("Immaculate Conception");
  });

  it("offers an ordinary date as a special day; the panel closes on the same date", async () => {
    const el = await mount();
    const sent = actions(el);
    dayButton(el, "2027-08-03").click();
    await el.updateComplete;
    const make = panel(el)!.querySelector<HTMLElement>('[data-test="special-add"]')!;
    expect(text(make)).toBe("Make this a special day…");
    make.click();
    expect(sent[0]).toMatchObject({
      kind: "open",
      date: "2027-08-03",
      specialDay: null,
      holidays: [],
    });
    dayButton(el, "2027-08-03").click();
    await el.updateComplete;
    expect(panel(el)).toBeNull();
  });

  it("drops a chosen date the next year does not hold", async () => {
    const el = await mount();
    dayButton(el, "2027-08-03").click();
    await el.updateComplete;
    el.model = yearModel({ year: 2028, days: [] });
    await el.updateComplete;
    expect(panel(el)).toBeNull();
  });

  it("sends nothing and offers no actions when read-only", async () => {
    const el = await mount(yearModel(), { readOnly: true });
    const sent = actions(el);
    expect(root(el).querySelector('[data-test="add-special-day"]')).toBeNull();
    expect(root(el).querySelector("season-chips")!.readOnly).toBe(true);
    dayButton(el, "2027-05-12").click();
    await el.updateComplete;
    expect(text(panel(el))).toContain("Town fair");
    expect(panel(el)!.querySelector("wt-button")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("keeps one Tab stop in the year and moves it with the arrow keys", async () => {
    const el = await mount();
    const stops = [...root(el).querySelectorAll<HTMLElement>("td button")].filter(
      (button) => button.tabIndex === 0,
    );
    expect(stops.map((button) => button.closest("td")!.dataset.date)).toEqual(["2027-03-10"]);
    dayButton(el, "2027-03-10").focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(root(el).activeElement?.closest("td")?.dataset.date).toBe("2027-03-17");
    await userEvent.keyboard("{ArrowLeft}");
    expect(root(el).activeElement?.closest("td")?.dataset.date).toBe("2027-03-16");
    dayButton(el, "2027-12-31").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(root(el).activeElement?.closest("td")?.dataset.date).toBe("2027-12-31");
    await el.updateComplete;
    expect(dayButton(el, "2027-12-31").tabIndex).toBe(0);
  });

  it("states what the official lists cover, and that town holidays are not in them", async () => {
    const el = await mount();
    expect(text(root(el).querySelector('[data-test="coverage"]'))).toBe(
      "2027: official national and regional holidays are included.",
    );
    expect(text(root(el).querySelector('[data-test="town-holidays"]'))).toBe(
      "Town holidays are not in the official lists — add them as special days.",
    );
    expect(root(el).querySelector('[data-test="holidays-unavailable"]')).toBeNull();
    expect(root(el).querySelector('[data-test="missing-holiday"]')).toBeNull();
  });

  it("says town holidays are not in the official lists for each way the list lacks them", async () => {
    for (const local of ["none_entered", "address_unresolved", "unsupported_country"] as const) {
      const model = yearModel();
      model.holidayCoverage = [{ ...model.holidayCoverage[0]!, local }];
      const el = await mount(model);
      expect(root(el).querySelector('[data-test="town-holidays"]'), local).not.toBeNull();
    }
    const other = await mount(
      yearModel({
        holidayCoverage: [{ ...yearModel().holidayCoverage[0]!, year: 2028 }],
      }),
    );
    expect(root(other).querySelector('[data-test="town-holidays"]')).toBeNull();
  });

  it("says when the year's public holidays are not available yet, under the legend", async () => {
    const model = yearModel({ publicHolidaysAvailable: false });
    model.holidayCoverage = [{ ...model.holidayCoverage[0]!, nationalRegional: "missing_year" }];
    const el = await mount(model);
    const line = root(el).querySelector('[data-test="holidays-unavailable"]')!;
    expect(text(line)).toBe("Public holidays for 2027 are not available yet");
    expect(line.previousElementSibling?.classList.contains("legend")).toBe(true);
    const warned = await mount(
      yearModel({
        publicHolidaysAvailable: false,
        missingHolidays: [
          { specialDayId: "vs", name: "Good Friday", holidayName: "Viernes Santo" },
        ],
      }),
    );
    const under = root(warned).querySelector('[data-test="holidays-unavailable"]')!;
    expect(under.previousElementSibling?.classList.contains("legend")).toBe(true);
    expect(under.nextElementSibling?.querySelector('[data-test="missing-holiday"]')).not.toBeNull();
    expect(root(el).querySelector('[data-test="coverage"]')).toBeNull();
  });

  it("warns once per repeating date with no public holiday of its name this year", async () => {
    const el = await mount(
      yearModel({
        missingHolidays: [
          { specialDayId: "vs", name: "Viernes Santo", holidayName: "Viernes Santo" },
          { specialDayId: "cm", name: "Carnival closure", holidayName: "Carnaval" },
        ],
        area: {
          readiness: "ready",
          addressKey: "city",
          options: [{ key: "aran", name: "Aran" }],
          required: true,
          chosen: null,
        },
      }),
    );
    const lines = [...root(el).querySelectorAll('[data-test="missing-holiday"]')];
    expect(lines.map(text)).toEqual([
      "Viernes Santo (Every year) has no public holiday of that name in 2027.",
      "Carnaval (Every year) has no public holiday of that name in 2027.",
    ]);
    // Directly under the legend, before the holiday-area chooser and the coverage lines.
    expect(lines[0]!.parentElement!.previousElementSibling?.classList.contains("legend")).toBe(
      true,
    );
    for (const after of ["[name=holidayArea]", '[data-test="coverage"]'])
      expect(
        lines[1]!.compareDocumentPosition(root(el).querySelector(after)!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
  });

  it("asks for the holiday area when the province needs one", async () => {
    const model = yearModel({
      area: {
        readiness: "ready",
        addressKey: "city",
        options: [
          { key: "aran", name: "Aran" },
          { key: "rest", name: "Rest of Catalonia" },
        ],
        required: true,
        chosen: null,
      },
    });
    model.holidayCoverage = [{ ...model.holidayCoverage[0]!, nationalRegional: "area_required" }];
    const saveHolidayArea = vi.fn(async () => {});
    const rereadWatches = vi.fn();
    const el = await mount(model, { areaApi: { saveHolidayArea, rereadWatches } });
    expect(text(root(el).querySelector('[data-test="coverage"]'))).toContain("2027");
    const chooser =
      root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=holidayArea]")!;
    chooser.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "aran" }, bubbles: true, composed: true }),
    );
    await vi.waitFor(() => expect(rereadWatches).toHaveBeenCalledTimes(1));
    expect(saveHolidayArea).toHaveBeenCalledWith("aran");
  });

  it("shows a refused holiday area under the chooser", async () => {
    const saveHolidayArea = vi.fn(async () => {
      throw { code: "holiday.invalid", params: { field: "areaKey" } };
    });
    const el = await mount(
      yearModel({
        area: {
          readiness: "ready",
          addressKey: "city",
          options: [{ key: "aran", name: "Aran" }],
          required: true,
          chosen: null,
        },
      }),
      { areaApi: { saveHolidayArea, rereadWatches: vi.fn() } },
    );
    const chooser =
      root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=holidayArea]")!;
    chooser.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "aran" }, bubbles: true, composed: true }),
    );
    await vi.waitFor(() => expect(chooser.error).toBe("Choose one of the areas offered."));
  });

  it("explains an address that cannot choose a holiday area", async () => {
    const el = await mount(
      yearModel({
        area: {
          readiness: "missing_city",
          addressKey: "",
          options: [],
          required: false,
          chosen: null,
        },
      }),
    );
    expect(text(root(el).querySelector('[data-test="area-address"]'))).toBe(
      "The holiday area needs the venue's city. Add it in Venue details.",
    );
    expect(root(el).querySelector("[name=holidayArea]")).toBeNull();
  });

  it("names the weekdays atop every month, Monday first, in the language of each render", async () => {
    const el = await mount();
    const headers = () =>
      [...root(el).querySelectorAll("thead tr")].map((row) =>
        [...row.querySelectorAll("th")].map((th) => `${text(th)} ${th.getAttribute("abbr")}`),
      );
    expect(headers()).toHaveLength(12);
    expect(new Set(headers().map((row) => row.join()))).toEqual(
      new Set(["M Monday,T Tuesday,W Wednesday,T Thursday,F Friday,S Saturday,S Sunday"]),
    );
    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;
    expect(new Set(headers().map((row) => row.join()))).toEqual(
      new Set(["L lunes,M martes,X miércoles,J jueves,V viernes,S sábado,D domingo"]),
    );
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const el = await mount(
      yearModel({
        publicHolidaysAvailable: false,
        missingHolidays: [
          { specialDayId: "vs", name: "Viernes Santo", holidayName: "Viernes Santo" },
        ],
      }),
    );
    expect(text(root(el).querySelector('[data-test="month-name"]'))).toBe("enero");
    expect(text(root(el).querySelector('[data-test="add-special-day"]'))).toBe("+ Día especial");
    expect(text(root(el).querySelector('[data-test="holidays-unavailable"]'))).toBe(
      "Los festivos oficiales de 2027 aún no están disponibles",
    );
    expect(text(root(el).querySelector('[data-test="missing-holiday"]'))).toBe(
      "Viernes Santo (cada año): en 2027 no hay ningún festivo con ese nombre.",
    );
    expect(text(root(el).querySelector('[data-test="town-holidays"]'))).toBe(
      "Las fiestas locales no están en las listas oficiales: añádelas como días especiales.",
    );
    expect([...root(el).querySelectorAll(".legend li")].map(text)).toEqual([
      "Festivo oficial",
      "Día especial",
      "Cerrado",
    ]);
  });
});

describe("Opening hours year holiday area", () => {
  type Area = OpeningHoursYear["area"];
  const areaModel = (area: Partial<Area> = {}) =>
    yearModel({
      area: {
        readiness: "ready",
        addressKey: "old-city",
        options: [
          { key: "aran", name: "Aran" },
          { key: "rest", name: "Rest of province" },
        ],
        required: true,
        chosen: null,
        ...area,
      },
    });
  const chooser = (el: OpeningHoursYearView) =>
    root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=holidayArea]");
  const pick = (el: OpeningHoursYearView, value = "aran") =>
    chooser(el)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  const settle = async (el: OpeningHoursYearView) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  };
  /** A host stand-in: a re-read hands the view the server's current area. */
  function areaHost(
    save: (value: string) => Promise<void>,
    server: () => Partial<Area> = () => ({}),
  ) {
    let el!: OpeningHoursYearView;
    const saves: string[] = [];
    const rereadWatches = vi.fn(() => {
      el.model = areaModel(server());
    });
    const areaApi = {
      saveHolidayArea: vi.fn(async (value: string) => {
        saves.push(value);
        await save(value);
      }),
      rereadWatches,
    };
    return {
      saves,
      rereadWatches,
      async mount(model = areaModel()) {
        el = await mount(model, { areaApi });
        return el;
      },
    };
  }

  it("saves only an offered changed area and re-reads the year", async () => {
    let chosen: string | null = null;
    const host = areaHost(
      async (value) => {
        chosen = value;
      },
      () => ({ chosen }),
    );
    const el = await host.mount();
    pick(el);
    await vi.waitFor(() => expect(chooser(el)!.value).toBe("aran"));
    expect(host.saves).toEqual(["aran"]);
    expect(host.rereadWatches).toHaveBeenCalledTimes(1);
    pick(el, "missing");
    pick(el, "aran");
    await settle(el);
    expect(host.saves).toEqual(["aran"]);
  });

  it("ignores an old area refusal after detach and reconnect", async () => {
    let refuse!: (value: unknown) => void;
    const host = areaHost(
      () =>
        new Promise<void>((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const el = await host.mount();
    pick(el);
    await el.updateComplete;
    expect(chooser(el)!.disabled).toBe(true);
    el.remove();
    document.body.append(el);
    await el.updateComplete;
    refuse({ code: "holiday.invalid", params: { field: "areaKey" } });
    await settle(el);
    expect(chooser(el)!.error).toBe("");
    expect(chooser(el)!.disabled).toBe(false);
  });

  it("keeps an area refusal through a re-read of the same address, and allows a retry", async () => {
    let saves = 0;
    let chosen: string | null = null;
    const host = areaHost(
      async (value) => {
        if (++saves === 1) throw { code: "holiday.invalid" };
        chosen = value;
      },
      () => ({ chosen }),
    );
    const el = await host.mount();
    pick(el);
    await vi.waitFor(() => expect(chooser(el)!.error).toBe("The change could not be saved."));
    el.model = areaModel();
    await settle(el);
    expect(chooser(el)!.error).toBe("The change could not be saved.");
    expect(chooser(el)!.disabled).toBe(false);
    pick(el);
    await vi.waitFor(() => expect(chooser(el)!.value).toBe("aran"));
    expect(chooser(el)!.error).toBe("");
  });

  it.each(["settled refusal", "late refusal", "late success"])(
    "an address change clears area state and ignores the old address's %s",
    async (reply) => {
      let reject!: (value: unknown) => void;
      let resolve!: () => void;
      const host = areaHost(
        () =>
          new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      const el = await host.mount();
      pick(el);
      await vi.waitFor(() => expect(chooser(el)!.disabled).toBe(true));
      if (reply === "settled refusal") {
        reject({ code: "holiday.invalid" });
        await vi.waitFor(() => expect(chooser(el)!.error).toBe("The change could not be saved."));
      }
      el.model = areaModel({ addressKey: "new-city" });
      await el.updateComplete;
      expect(chooser(el)!.error).toBe("");
      expect(chooser(el)!.disabled).toBe(false);
      if (reply === "late refusal") reject({ code: "holiday.invalid" });
      if (reply === "late success") resolve();
      await settle(el);
      expect(chooser(el)!.error).toBe("");
      expect(chooser(el)!.disabled).toBe(false);
      expect(host.rereadWatches).not.toHaveBeenCalled();
    },
  );

  it.each(["en", "es"] as const)(
    "%s explains unresolved area addresses and sends no write",
    async (locale) => {
      setLocale(locale);
      const explanations =
        locale === "en"
          ? {
              missing_city: "The holiday area needs the venue's city. Add it in Venue details.",
              unresolved_province:
                "The holiday area needs a recognised province. Correct it in Venue details.",
              unresolved_address:
                "The holiday area needs the venue's city and a recognised province. Set them in Venue details.",
              unsupported_country: "Holiday areas are unavailable for this country.",
            }
          : {
              missing_city:
                "La zona de festivos necesita la ciudad del local. Añádela en Datos del local.",
              unresolved_province:
                "La zona de festivos necesita una provincia reconocida. Corrígela en Datos del local.",
              unresolved_address:
                "La zona de festivos necesita la ciudad y una provincia reconocida. Indícalas en Datos del local.",
              unsupported_country: "No hay zonas de festivos para este país.",
            };
      for (const [readiness, message] of Object.entries(explanations)) {
        const host = areaHost(async () => {
          throw new Error("Unexpected area write");
        });
        const el = await host.mount(
          areaModel({
            readiness: readiness as Area["readiness"],
            ...(readiness === "missing_city" ? {} : { options: [] }),
          }),
        );
        if (readiness === "missing_city") {
          const field = chooser(el)!;
          await field.updateComplete;
          expect(field.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
          pick(el);
          await settle(el);
        } else {
          expect(chooser(el)).toBeNull();
        }
        expect(text(root(el).querySelector('[data-test="area-address"]'))).toBe(message);
        expect(host.saves).toEqual([]);
        el.remove();
      }
    },
  );

  it.each(["en", "es"] as const)(
    "%s keeps actionable area refusals and a generic fallback, with retry",
    async (locale) => {
      setLocale(locale);
      const cases = [
        [
          { code: "holiday.invalid", params: { field: "geography" } },
          locale === "en"
            ? "The holiday area needs the venue's city and a recognised province. Set them in Venue details."
            : "La zona de festivos necesita la ciudad y una provincia reconocida. Indícalas en Datos del local.",
        ],
        [
          { code: "holiday.invalid", params: { field: "areaKey" } },
          locale === "en"
            ? "Choose one of the areas offered."
            : "Elige una de las zonas ofrecidas.",
        ],
        [
          { code: "unrelated.failure" },
          locale === "en" ? "The change could not be saved." : "No se pudo guardar el cambio.",
        ],
      ] as const;
      for (const [error, message] of cases) {
        let writes = 0;
        let chosen: string | null = null;
        const host = areaHost(
          async (value) => {
            if (++writes === 1) throw error;
            chosen = value;
          },
          () => ({ chosen }),
        );
        const el = await host.mount();
        pick(el);
        await vi.waitFor(() => expect(chooser(el)!.error).toBe(message));
        await chooser(el)!.updateComplete;
        expect(chooser(el)!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
          false,
        );
        pick(el);
        await vi.waitFor(() => expect(chooser(el)!.value).toBe("aran"));
        expect(chooser(el)!.error).toBe("");
        expect(writes).toBe(2);
        el.remove();
      }
    },
  );

  it("shows a viewer the saved area in words and no chooser, and the coverage asks for the area", async () => {
    const model = areaModel({ chosen: "aran" });
    model.holidayCoverage = [{ ...model.holidayCoverage[0]!, nationalRegional: "area_required" }];
    const el = await mount(model, { readOnly: true });
    expect(chooser(el)).toBeNull();
    expect(text(root(el).querySelector('[data-test="area-chosen"]'))).toBe("Aran");
    expect(text(root(el).querySelector('[data-test="coverage"]'))).toContain(
      "choose the holiday area here",
    );
    const none = await mount(areaModel(), { readOnly: true });
    expect(text(root(none).querySelector('[data-test="area-chosen"]'))).toBe(
      "Holiday area: not chosen",
    );
  });
});
