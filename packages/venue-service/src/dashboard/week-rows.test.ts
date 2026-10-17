import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import { monthNames, openingHoursDay } from "./opening-hours-day.js";
import { weekDates, weekDays, weekMonth, weekRows } from "./week-rows.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

const names = monthNames(DEPARTMENTS);

function rowsOn(date: LocalDate, chosen: string, model: OpeningHoursMonth = monthModel()) {
  return weekRows(
    model.days.find((d) => d.date === date)!,
    chosen,
    names,
  );
}

function terraceClosed(date: LocalDate, closed: { startsAt: string; endsAt: string }[]) {
  const model = monthModel();
  model.days = model.days.map((d) =>
    d.date === date
      ? {
          ...d,
          departments: d.departments.map((dep) =>
            dep.departmentId === "rest" ? { ...dep, zones: [{ zoneId: "terrace", closed }] } : dep,
          ),
        }
      : d,
  );
  return model;
}

describe("weekDates, weekMonth and weekDays", () => {
  it("finds Monday to Sunday of a date's week and the month read that holds it", () => {
    expect(weekDates("2026-12-02")).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
      "2026-12-05",
      "2026-12-06",
    ]);
    expect(weekDates("2027-01-03")[0]).toBe("2026-12-28");
    expect(weekMonth("2027-01-02")).toBe("2026-12");
    const days = weekDays(monthModel(), "2027-01-02")!;
    expect(days.map((d) => d.date)).toEqual(weekDates("2027-01-02"));
    expect(days.at(-1)!.date).toBe("2027-01-03");
    expect(weekDays(monthModel(), "2027-01-04")).toBeUndefined();
  });
});

describe("weekRows", () => {
  it("draws a department's ranges and a zone's own hours on 1 December", () => {
    const [rest, terrace, ...more] = rowsOn("2026-12-01", "rest");
    expect(more).toEqual([]);
    expect(rest!.key).toBe("rest");
    expect(rest!.zone).toBe(false);
    expect(rest!.strong).toBe(true);
    expect(rest!.blocks.map((b) => b.text)).toEqual([
      "Breakfast 08:00–11:00",
      "Lunch 13:00–16:00",
      "Dinner 20:00–23:00",
    ]);
    expect(rest!.blocks.some((b) => b.faded)).toBe(false);
    expect(rest!.blocks[0]!.label).toBe("Restaurant · Breakfast 08:00–11:00");

    expect(terrace!.key).toBe("terrace");
    expect(terrace!.zone).toBe(true);
    expect(terrace!.strong).toBe(true);
    const open = terrace!.blocks.filter((b) => b.kind === "open");
    expect(open.map((b) => [b.periodId, b.faded, b.text])).toEqual([
      ["breakfast", true, ""],
      ["lunch", true, ""],
      ["dinner", false, "Dinner 22:00–23:00"],
    ]);
    expect(open[2]!.start).toBe(960);
    const closed = terrace!.blocks.filter((b) => b.kind === "closed");
    expect(closed).toEqual([
      {
        kind: "closed",
        periodId: null,
        start: 840,
        end: 960,
        startsAt: "20:00",
        endsAt: "22:00",
        text: "Closed 20:00–22:00",
        label: "Terrace · Closed 20:00–22:00",
        faded: false,
      },
    ]);
    expect(terrace!.words).toBe(
      "Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 22:00–23:00 · closed 20:00–22:00",
    );
    expect(terrace!.empty).toBe("");
  });

  it("fades every piece of a zone that only follows its department", () => {
    const terrace = rowsOn("2026-12-02", "rest")[1]!;
    expect(terrace.blocks.length).toBe(3);
    expect(terrace.blocks.every((b) => b.faded && b.text === "")).toBe(true);
    expect(terrace.blocks[1]!.label).toBe("Terrace · Lunch 13:00–16:00");
    expect(terrace.words).toBe("as Restaurant");
    expect(terrace.strong).toBe(false);
  });

  it("leaves a department closed on an ordinary day as an empty track with no words in it", () => {
    const [rest, terrace] = rowsOn("2026-12-06", "rest");
    expect(rest!.blocks).toEqual([]);
    expect(rest!.empty).toBe("");
    expect(rest!.words).toBe("Closed");
    expect(terrace!.blocks).toEqual([]);
    expect(terrace!.empty).toBe("");
    expect(terrace!.words).toBe("as Restaurant");
  });

  it("writes Closed all day only in a department's track on a date closed all day", () => {
    const all = rowsOn("2026-12-25", "");
    expect(all.map((r) => r.key)).toEqual(["rest", "bar"]);
    expect(all.map((r) => r.empty)).toEqual(["Closed all day", "Closed all day"]);
    const [rest, terrace] = rowsOn("2026-12-25", "rest");
    expect(rest!.empty).toBe("Closed all day");
    expect(terrace!.empty).toBe("");
  });

  it("reads an id the day lacks as every department", () => {
    expect(rowsOn("2026-12-02", "nope").map((r) => r.key)).toEqual(["rest", "bar"]);
  });

  it("places a range that runs past midnight", () => {
    const [bar] = rowsOn("2026-12-02", "bar");
    expect(bar!.blocks).toHaveLength(1);
    expect(bar!.blocks[0]).toMatchObject({
      kind: "open",
      periodId: "allday",
      start: 240,
      end: 1200,
      startsAt: "10:00",
      endsAt: "02:00",
      label: "Bar · All day 10:00–02:00",
      faded: false,
    });
  });

  it("cuts a zone's closure to the times its department is open", () => {
    const late = rowsOn(
      "2026-12-02",
      "rest",
      terraceClosed("2026-12-02", [{ startsAt: "22:00", endsAt: "05:00" }]),
    )[1]!;
    const closed = late.blocks.filter((b) => b.kind === "closed");
    expect(closed.map((b) => [b.text, b.end])).toEqual([["Closed 22:00–23:00", 1020]]);
    expect(
      late.blocks.filter((b) => b.periodId === "dinner").map((b) => [b.faded, b.text]),
    ).toEqual([[false, "Dinner 20:00–22:00"]]);

    const whole = rowsOn(
      "2026-12-02",
      "rest",
      terraceClosed("2026-12-02", [{ startsAt: "07:00", endsAt: "05:00" }]),
    )[1]!;
    expect(whole.blocks).toEqual([]);
    expect(whole.empty).toBe("");
    expect(whole.words).toBe("Closed");
  });

  it("places a range on a 25-hour day up to the day's end", () => {
    const model = monthModel();
    model.days = model.days.map((d) =>
      d.date === "2026-12-02"
        ? {
            ...d,
            endMinute: 1500,
            departments: d.departments.map((dep) =>
              dep.departmentId === "bar"
                ? { ...dep, ranges: [{ periodId: "allday", startsAt: "22:00", endsAt: "07:00" }] }
                : dep,
            ),
          }
        : d,
    );
    const [bar] = rowsOn("2026-12-02", "bar", model);
    expect(bar!.blocks[0]).toMatchObject({ start: 960, end: 1500 });
  });

  it("puts the day box's words for each row beside it on every date of the month", () => {
    const model = monthModel();
    for (const day of model.days) {
      for (const chosen of ["", "rest"]) {
        const box = openingHoursDay(day, model.seasons, DEPARTMENTS, chosen);
        for (const row of weekRows(day, chosen, names)) {
          expect(row.words, `${day.date} ${chosen} ${row.name}`).toBe(
            box.rows.find((r) => r.name === row.name)!.text,
          );
        }
      }
    }
  });

  it("writes its words in Spanish", () => {
    setLocale("es");
    try {
      const terrace = rowsOn("2026-12-01", "rest")[1]!;
      expect(terrace.blocks.find((b) => b.kind === "closed")!.text).toBe("Cerrado 20:00–22:00");
      expect(rowsOn("2026-12-25", "")[0]!.empty).toBe("Cerrado todo el día");
    } finally {
      setLocale("en");
    }
  });
});
