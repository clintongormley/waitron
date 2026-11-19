import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import { openingHoursDay, dayNameLines } from "./opening-hours-day.js";
import { VENUE_SERVICE_STRINGS } from "./strings.js";

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

const ALL_DAY = "08:00–11:00 · 13:00–16:00 · 20:00–23:00";

describe("openingHoursDay", () => {
  it("reads a plain Winter Tuesday for every department, each followed by its zones", () => {
    expect(dayBox("2026-12-15")).toEqual({
      name: "",
      nameKind: "",
      line: "Winter standard hours",
      rows: [
        { name: "Restaurant", text: ALL_DAY, strong: true },
        { name: "Terrace", text: ALL_DAY, inheritedFrom: "Restaurant" },
        { name: "Bar", text: "10:00–02:00", strong: true },
      ],
    });
  });

  it("lists only a zone's opening ranges", () => {
    expect(dayBox("2026-12-01").rows[1]).toEqual({
      name: "Terrace",
      text: "08:00–11:00 · 13:00–16:00 · 22:00–23:00",
    });
  });

  it("names a special day and says it replaces its season's standard hours", () => {
    const box = dayBox("2026-12-14");
    expect(box).toMatchObject({
      name: "Company dinners",
      nameKind: "special",
      line: "Special day — replaces Winter's standard hours",
    });
  });

  it("names a public holiday with no special day, on its season's standard hours", () => {
    expect(dayBox("2026-12-08")).toMatchObject({
      name: "Immaculate Conception",
      nameKind: "holiday",
      line: "Winter standard hours",
    });
  });

  it("reads a day closed all day as closed departments and zones as their department", () => {
    expect(dayBox("2026-12-25").rows).toEqual([
      { name: "Restaurant", text: "Closed", strong: true },
      { name: "Terrace", text: "Closed", inheritedFrom: "Restaurant" },
      { name: "Bar", text: "Closed", strong: true },
    ]);
  });

  it("lists only the chosen department and its zones", () => {
    expect(dayBox("2026-12-06", "bar").rows).toEqual([
      { name: "Bar", text: "10:00–02:00", strong: true },
    ]);
    expect(dayBox("2026-12-15", "rest").rows.map((row) => row.name)).toEqual([
      "Restaurant",
      "Terrace",
    ]);
  });

  it("lists every department when the read does not carry the chosen one", () => {
    expect(dayBox("2026-12-15", "gone").rows.map((row) => row.name)).toEqual([
      "Restaurant",
      "Terrace",
      "Bar",
    ]);
  });

  it("says nothing about a season on a day no season holds", () => {
    const model = monthModel();
    model.days = model.days.map((d) => (d.date === "2026-12-15" ? { ...d, seasonId: null } : d));
    expect(dayBox("2026-12-15", "", model)).toMatchObject({ line: "" });
    model.days = model.days.map((d) => (d.date === "2026-12-14" ? { ...d, seasonId: null } : d));
    expect(dayBox("2026-12-14", "", model).line).toBe("Special day");
  });

  it("speaks Spanish", () => {
    setLocale("es");
    const box = dayBox("2026-12-14");
    expect(box.line).toBe("Día especial: sustituye el horario habitual de Winter");
    expect(dayBox("2026-12-15").line).toBe("Horario habitual de Winter");
    expect(dayBox("2026-12-15").rows[1]).toEqual({
      name: "Terrace",
      text: ALL_DAY,
      inheritedFrom: "Restaurant",
    });
    expect(dayBox("2026-12-25").rows[0]!.text).toBe(VENUE_SERVICE_STRINGS.es["hours.closed"]);
    expect(dayBox("2026-12-01").rows[1]!.text).toBe("08:00–11:00 · 13:00–16:00 · 22:00–23:00");
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
    });
  });

  it("reads an id the department list lacks as an empty name, as the Month does", () => {
    const model = monthModel();
    const day = model.days.find((d) => d.date === "2026-12-01")!;
    expect(openingHoursDay(day, model.seasons, [], "rest").rows).toEqual([
      { name: "", text: "08:00–11:00 · 13:00–16:00 · 20:00–23:00", strong: true },
      {
        name: "",
        text: "08:00–11:00 · 13:00–16:00 · 22:00–23:00",
      },
    ]);
  });

  it("lists only the part of a zone's closure inside its department's hours", () => {
    const model = terraceClosed("2026-12-15", [{ startsAt: "22:00", endsAt: "04:00" }]);
    expect(dayBox("2026-12-15", "", model).rows[1]).toEqual({
      name: "Terrace",
      text: "08:00–11:00 · 13:00–16:00 · 20:00–22:00",
    });
  });

  it("reads a zone closed only outside its department's hours as its department", () => {
    const model = terraceClosed("2026-12-15", [{ startsAt: "23:30", endsAt: "04:00" }]);
    expect(dayBox("2026-12-15", "", model).rows[1]).toEqual({
      name: "Terrace",
      text: ALL_DAY,
      inheritedFrom: "Restaurant",
    });
  });
});

it.each(["en", "es"])("uses %s for month, week and day-box holiday names", (locale) => {
  setLocale(locale);
  const model = monthModel();
  const day = model.days.find((day) => day.date === "2026-12-15")!;
  day.holidays = [
    {
      id: "holiday",
      date: day.date,
      name: "Official holiday",
      englishName: "English holiday",
      scope: "national",
      sourceId: "source",
    },
  ];
  expect(dayNameLines(day)).toEqual([
    { name: locale === "en" ? "English holiday" : "Official holiday", kind: "holiday" },
  ]);
  expect(openingHoursDay(day, model.seasons, DEPARTMENTS, "").name).toBe(
    locale === "en" ? "English holiday" : "Official holiday",
  );
});

it.each([
  ["en", "Official holiday", "English holiday"],
  ["en", "English holiday", "English holiday"],
  ["es", "Official holiday", "Official holiday"],
  ["es", "English holiday", "Official holiday"],
])("shows one holiday line in %s for a special day saved as %s", (locale, savedName, displayed) => {
  setLocale(locale!);
  const model = monthModel();
  const day = model.days.find((day) => day.date === "2026-12-15")!;
  day.holidays = [
    {
      id: "holiday",
      date: day.date,
      name: "Official holiday",
      englishName: "English holiday",
      scope: "national",
      sourceId: "source",
    },
  ];
  day.specialDay = { id: "special", name: savedName! };
  expect(dayNameLines(day)).toEqual([{ name: displayed, kind: "holiday" }]);
});

it.each(["en", "es"])("summarises open hours and inherited zones in %s", (locale) => {
  setLocale(locale);
  const model = monthModel();
  const day = model.days.find((d) => d.date === "2026-12-15")!;
  day.departments = [
    {
      departmentId: "rest",
      ranges: [
        { periodId: "breakfast", startsAt: "09:00", endsAt: "12:30" },
        { periodId: "lunch", startsAt: "12:30", endsAt: "23:15" },
        { periodId: "dinner", startsAt: "23:15", endsAt: "00:00" },
      ],
      zones: [{ zoneId: "terrace", closed: [] }],
    },
  ];
  expect(dayBox(day.date, "rest", model).rows).toEqual([
    { name: "Restaurant", text: "09:00–00:00", strong: true },
    { name: "Terrace", text: "09:00–00:00", inheritedFrom: "Restaurant" },
  ]);
  for (const [closures, text] of [
    [[{ startsAt: "23:00", endsAt: "00:00" }], "09:00–23:00"],
    [[{ startsAt: "15:00", endsAt: "17:00" }], "09:00–15:00 · 17:00–00:00"],
    [
      [{ startsAt: "09:00", endsAt: "00:00" }],
      locale === "en" ? "Closed" : VENUE_SERVICE_STRINGS.es["hours.closed"],
    ],
  ] as const) {
    day.departments[0]!.zones[0]!.closed = [...closures];
    expect(dayBox(day.date, "rest", model).rows[1]).toEqual({
      name: "Terrace",
      text,
    });
  }
});
