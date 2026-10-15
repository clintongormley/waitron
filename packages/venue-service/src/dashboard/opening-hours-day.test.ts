import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import { openingHoursDay } from "./opening-hours-day.js";

beforeEach(() => setLocale("en"));
afterEach(() => setLocale("en"));

function dayBox(date: LocalDate, departmentId = "", model: OpeningHoursMonth = monthModel()) {
  const day = model.days.find((d) => d.date === date)!;
  return openingHoursDay(day, model.seasons, DEPARTMENTS, departmentId);
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

const ALL_DAY = "Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 20:00–23:00";

describe("openingHoursDay", () => {
  it("reads a plain Winter Tuesday for every department, each followed by its zones", () => {
    expect(dayBox("2026-12-15")).toEqual({
      name: "",
      nameKind: "",
      line: "Winter standard hours",
      rows: [
        { name: "Restaurant", text: ALL_DAY, strong: true },
        { name: "Terrace", text: "as Restaurant" },
        { name: "Bar", text: "All day 10:00–02:00", strong: true },
      ],
      seasonId: "winter",
      specialDayId: null,
    });
  });

  it("lists a zone's own ranges, then each closed piece", () => {
    expect(dayBox("2026-12-01").rows[1]).toEqual({
      name: "Terrace",
      text: "Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 22:00–23:00 · closed 20:00–22:00",
      strong: true,
    });
  });

  it("names a special day and says it replaces its season's standard hours", () => {
    const box = dayBox("2026-12-14");
    expect(box).toMatchObject({
      name: "Company dinners",
      nameKind: "special",
      line: "Special day — replaces Winter's standard hours",
      seasonId: "winter",
      specialDayId: "company",
    });
  });

  it("names a public holiday with no special day, on its season's standard hours", () => {
    expect(dayBox("2026-12-08")).toMatchObject({
      name: "Immaculate Conception",
      nameKind: "holiday",
      line: "Winter standard hours",
      specialDayId: null,
    });
  });

  it("reads a day closed all day as closed departments and zones as their department", () => {
    expect(dayBox("2026-12-25").rows).toEqual([
      { name: "Restaurant", text: "Closed", strong: true },
      { name: "Terrace", text: "as Restaurant" },
      { name: "Bar", text: "Closed", strong: true },
    ]);
  });

  it("lists only the chosen department and its zones", () => {
    expect(dayBox("2026-12-06", "bar").rows).toEqual([
      { name: "Bar", text: "All day 10:00–02:00", strong: true },
    ]);
    expect(dayBox("2026-12-15", "rest").rows.map((row) => row.name)).toEqual([
      "Restaurant",
      "Terrace",
    ]);
  });

  it("says nothing about a season on a day no season holds", () => {
    const model = monthModel();
    model.days = model.days.map((d) => (d.date === "2026-12-15" ? { ...d, seasonId: null } : d));
    expect(dayBox("2026-12-15", "", model)).toMatchObject({ line: "", seasonId: null });
    model.days = model.days.map((d) => (d.date === "2026-12-14" ? { ...d, seasonId: null } : d));
    expect(dayBox("2026-12-14", "", model).line).toBe("Special day");
  });

  it("speaks Spanish", () => {
    setLocale("es");
    const box = dayBox("2026-12-14");
    expect(box.line).toBe("Día especial: sustituye el horario habitual de Winter");
    expect(dayBox("2026-12-15").line).toBe("Horario habitual de Winter");
    expect(dayBox("2026-12-15").rows[1]!.text).toBe("como Restaurant");
    expect(dayBox("2026-12-25").rows[0]!.text).toBe("Cerrado");
    expect(dayBox("2026-12-01").rows[1]!.text).toContain("cerrado 20:00–22:00");
  });

  it("reads a zone closed through all its department's hours as Closed, with no closed pieces", () => {
    const model = monthModel();
    model.days = model.days.map((d) =>
      d.date === "2026-12-15"
        ? {
            ...d,
            departments: d.departments.map((dep) =>
              dep.departmentId === "rest"
                ? {
                    ...dep,
                    zones: [
                      { zoneId: "terrace", closed: [{ startsAt: "07:00", endsAt: "05:00" }] },
                    ],
                  }
                : dep,
            ),
          }
        : d,
    );
    expect(dayBox("2026-12-15", "", model).rows[1]).toEqual({
      name: "Terrace",
      text: "Closed",
      strong: true,
    });
  });

  it("reads an id the department list lacks as an empty name, as the Month does", () => {
    const model = monthModel();
    const day = model.days.find((d) => d.date === "2026-12-01")!;
    expect(openingHoursDay(day, model.seasons, [], "rest").rows).toEqual([
      { name: "", text: "08:00–11:00 · 13:00–16:00 · 20:00–23:00", strong: true },
      {
        name: "",
        text: "08:00–11:00 · 13:00–16:00 · 22:00–23:00 · closed 20:00–22:00",
        strong: true,
      },
    ]);
  });

  it("lists only the part of a zone's closure inside its department's hours", () => {
    const model = terraceClosed("2026-12-15", [{ startsAt: "22:00", endsAt: "04:00" }]);
    expect(dayBox("2026-12-15", "", model).rows[1]).toEqual({
      name: "Terrace",
      text: "Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 20:00–22:00 · closed 22:00–23:00",
      strong: true,
    });
  });

  it("reads a zone closed only outside its department's hours as its department", () => {
    const model = terraceClosed("2026-12-15", [{ startsAt: "23:30", endsAt: "04:00" }]);
    expect(dayBox("2026-12-15", "", model).rows[1]).toEqual({
      name: "Terrace",
      text: "as Restaurant",
    });
  });
});
