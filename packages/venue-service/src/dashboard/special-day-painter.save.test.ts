import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import type { SpecialDayDetail, SpecialDayInput } from "../special-days.js";
import { formatDate } from "./hours-view.js";
import { t } from "./strings.js";
import type { SpecialDayPainter } from "./special-day-painter.js";
import {
  drag,
  frame,
  grid,
  painterModel,
  part,
  pick,
  settle,
  specialDayApi,
  storedDay,
  type SpecialDayAnswers,
  type Write,
} from "../testing/special-day-painter-fixture.js";
import "./special-day-painter.js";

let painter: SpecialDayPainter | undefined;
beforeEach(() => setLocale("en"));
afterEach(() => {
  painter?.remove();
  painter = undefined;
});

const DEC_14 = "2026-12-14";
const DEC_15 = "2026-12-15";
const DEC_25 = "2026-12-25";
const dinner = (startsAt: string, endsAt: string) => ({ periodId: "p2", startsAt, endsAt });
const lunch = (startsAt: string, endsAt: string) => ({ periodId: "p1", startsAt, endsAt });
/** Minutes after the 06:00 changeover. */
const at = (clock: string) =>
  (Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)) - 360 + 1440) % 1440;
const FACTS = {
  name: "Christmas dinners",
  repeatsYearly: false,
  dates: [
    { date: DEC_14, closedAllDay: false },
    { date: DEC_15, closedAllDay: false },
    { date: DEC_25, closedAllDay: true },
  ],
  expectedClockRevision: 4,
};
type Body = SpecialDayInput & { expectedClockRevision: number };

interface Options extends SpecialDayAnswers {
  /** Thrown (or, when a promise, awaited) in turn by the save; once they run out it succeeds. */
  refusals?: unknown[];
}
async function mount({ refusals = [], ...answers }: Options = {}) {
  const writes: Write[] = [];
  const saved: SpecialDayDetail[] = [];
  painter = document.createElement("special-day-painter");
  painter.api = specialDayApi(writes, {
    days: { sd1: storedDay() },
    season: () => ({ ranges: [dinner("20:00", "23:30")] }),
    answer: () => {
      if (!refusals.length) return undefined;
      const next = refusals.shift();
      if (next instanceof Promise) return next;
      throw next;
    },
    ...answers,
  });
  painter.model = painterModel();
  painter.specialDayId = "sd1";
  painter.open = true;
  painter.addEventListener("special-day-saved", (event) =>
    saved.push((event as CustomEvent<{ detail: SpecialDayDetail }>).detail.detail),
  );
  applyTokens(painter);
  document.body.append(painter);
  await settle(painter);
  await expect.poll(() => part(painter!, "loading")).toBeNull();
  await expect.poll(() => grid(painter!).underlay.size).toBeGreaterThan(0);
  await settle(painter);
  return { painter, writes, saved };
}
const chip = (el: SpecialDayPainter, test: string) => part<HTMLButtonElement>(el, test)!;
const saveButton = (el: SpecialDayPainter) =>
  frame(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
const pickerValue = (el: SpecialDayPainter) =>
  el.shadowRoot!.querySelector<HTMLElement & { value: string }>("[name=department]")!.value;
async function save(el: SpecialDayPainter, writes: Write[]) {
  const before = writes.length;
  saveButton(el).click();
  await expect.poll(() => writes.length).toBe(before + 1);
  await expect.poll(() => frame(el).busy).toBe(false);
  await settle(el);
}
const body = (write: Write) => write.body as Body;
async function paintDinner(el: SpecialDayPainter, date: LocalDate) {
  chip(el, "paint-p2").click();
  await settle(el);
  await drag(el, date, at("19:00"), at("22:00"));
}
async function clear(el: SpecialDayPainter, date: LocalDate) {
  grid(el).dispatchEvent(
    new CustomEvent("paint-change", {
      detail: { key: date, day: [] },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(el);
}

describe("Save sends only the paint the draft changed", () => {
  it("a draft that edits only Restaurant on one date sends exactly one paint entry", async () => {
    const { painter, writes } = await mount();
    await paintDinner(painter, DEC_14);
    await save(painter, writes);
    expect(body(writes[0]!)).toEqual({
      ...FACTS,
      paint: [{ departmentId: "d1", date: DEC_14, ranges: [dinner("19:00", "22:00")] }],
    });
    expect(Object.keys(body(writes[0]!))).not.toContain("zonePaint");
  });

  it("Restaurant on two dates and Terrace on one send exactly those three entries", async () => {
    const { painter, writes } = await mount();
    await paintDinner(painter, DEC_14);
    await drag(painter, DEC_25, at("19:00"), at("22:00"));
    await pick(painter, "zone:z2");
    await drag(painter, DEC_15, at("21:00"), at("22:00"));
    await save(painter, writes);
    expect(body(writes[0]!)).toEqual({
      ...FACTS,
      paint: [
        { departmentId: "d1", date: DEC_14, ranges: [dinner("19:00", "22:00")] },
        { departmentId: "d1", date: DEC_25, ranges: [dinner("19:00", "22:00")] },
      ],
      zonePaint: [
        {
          zoneId: "z2",
          date: DEC_15,
          ranges: [{ kind: "closed", startsAt: "21:00", endsAt: "22:00" }],
        },
      ],
    });
  });

  it("a zone's Open stretch is sent as open", async () => {
    const { painter, writes } = await mount();
    await pick(painter, "zone:z1");
    chip(painter, "paint-open").click();
    await settle(painter);
    await drag(painter, DEC_14, at("12:00"), at("16:00"));
    await save(painter, writes);
    expect(body(writes[0]!).zonePaint).toEqual([
      {
        zoneId: "z1",
        date: DEC_14,
        ranges: [{ kind: "open", startsAt: "12:00", endsAt: "16:00" }],
      },
    ]);
    expect(body(writes[0]!).paint).toBeUndefined();
  });

  it("clearing a stored date's paint sends it with no ranges", async () => {
    const { painter, writes } = await mount({
      days: {
        sd1: storedDay({
          paint: [
            { departmentId: "d1", date: DEC_14, ranges: [dinner("20:00", "21:00")] },
            { departmentId: "d1", date: DEC_15, ranges: [lunch("13:00", "15:00")] },
          ],
        }),
      },
    });
    await clear(painter, DEC_15);
    await save(painter, writes);
    expect(body(writes[0]!).paint).toEqual([{ departmentId: "d1", date: DEC_15, ranges: [] }]);
  });

  it("keeps a stored Dinner 20:00–21:00 in the sent entry when Lunch is painted on that date", async () => {
    const { painter, writes } = await mount({
      season: () => ({ ranges: [dinner("20:00", "23:30")] }),
      days: {
        sd1: storedDay({
          paint: [{ departmentId: "d1", date: DEC_14, ranges: [dinner("20:00", "21:00")] }],
        }),
      },
    });
    chip(painter, "paint-p1").click();
    await settle(painter);
    await drag(painter, DEC_14, at("13:00"), at("15:00"));
    await save(painter, writes);
    expect(body(writes[0]!).paint).toEqual([
      {
        departmentId: "d1",
        date: DEC_14,
        ranges: [lunch("13:00", "15:00"), dinner("20:00", "21:00")],
      },
    ]);
  });

  it("a removed date sends no paint, whether stored or painted", async () => {
    const { painter, writes } = await mount({
      days: {
        sd1: storedDay({
          paint: [{ departmentId: "d1", date: DEC_25, ranges: [dinner("20:00", "21:00")] }],
        }),
      },
    });
    await paintDinner(painter, DEC_15);
    for (const date of [DEC_15, DEC_25])
      painter
        .shadowRoot!.querySelector<HTMLElement>(`[data-date="${date}"] [data-test=remove-date]`)!
        .click();
    await settle(painter);
    await save(painter, writes);
    expect(body(writes[0]!)).toEqual({ ...FACTS, dates: [FACTS.dates[0]] });
    expect(Object.keys(body(writes[0]!))).not.toContain("paint");
  });

  it("a season move while a draft is open still sends only the edited paint", async () => {
    const { painter, writes } = await mount();
    await paintDinner(painter, DEC_14);
    const moved = painterModel();
    painter.model = {
      ...moved,
      seasons: [{ ...moved.seasons[0]! }, { ...moved.seasons[1]!, startsOn: "11-15" }],
    };
    await settle(painter);
    await save(painter, writes);
    expect(body(writes[0]!)).toEqual({
      ...FACTS,
      paint: [{ departmentId: "d1", date: DEC_14, ranges: [dinner("19:00", "22:00")] }],
    });
  });

  it("sends nothing for a zone deleted while its paint was unsaved", async () => {
    const { painter, writes } = await mount();
    await pick(painter, "zone:z2");
    await drag(painter, DEC_14, at("21:00"), at("22:00"));
    const model = painterModel();
    painter.model = {
      ...model,
      departments: model.departments.map((department) => ({
        ...department,
        zones: department.zones.filter(({ id }) => id !== "z2"),
      })),
    };
    await settle(painter);
    await save(painter, writes);
    expect(body(writes[0]!)).toEqual(FACTS);
  });
});

describe("after a save", () => {
  it("the answer becomes the saved state, so Save is quiet and the next save sends only the next edit", async () => {
    const { painter, writes, saved } = await mount();
    await paintDinner(painter, DEC_14);
    await save(painter, writes);
    expect(saved).toHaveLength(1);
    expect(frame(painter).dirty).toBe(false);
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
    await drag(painter, DEC_15, at("19:00"), at("22:00"));
    await save(painter, writes);
    expect(body(writes[1]!).paint).toEqual([
      { departmentId: "d1", date: DEC_15, ranges: [dinner("19:00", "22:00")] },
    ]);
  });

  it("a paint made while a save is in flight is kept, and is still unsaved once the save lands", async () => {
    let succeed!: () => void;
    const late = new Promise<void>((resolve) => {
      succeed = resolve;
    });
    const { painter, writes } = await mount({ refusals: [late] });
    await paintDinner(painter, DEC_14);
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    await settle(painter);
    expect(grid(painter).readOnly).toBe(false);
    await drag(painter, DEC_15, at("19:00"), at("22:00"));
    succeed();
    await expect.poll(() => frame(painter).busy).toBe(false);
    await settle(painter);
    expect(body(writes[0]!).paint).toHaveLength(1);
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
    expect(grid(painter).days.get(DEC_15)).toEqual([dinner("19:00", "22:00")]);
    expect(frame(painter).dirty).toBe(true);
    await save(painter, writes);
    expect(body(writes[1]!).paint).toEqual([
      { departmentId: "d1", date: DEC_15, ranges: [dinner("19:00", "22:00")] },
    ]);
    expect(frame(painter).dirty).toBe(false);
  });

  it("drops an answer that lands after the painter moved to another special day", async () => {
    let succeed!: () => void;
    const late = new Promise<void>((resolve) => {
      succeed = resolve;
    });
    const other = storedDay({
      id: "sd2",
      name: "New Year",
      dates: [{ date: "2026-12-31", closedAllDay: false }],
    });
    const { painter, writes, saved } = await mount({
      refusals: [late],
      days: { sd1: storedDay(), sd2: other },
    });
    await paintDinner(painter, DEC_14);
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    painter.specialDayId = "sd2";
    await settle(painter);
    await expect.poll(() => frame(painter).heading).toBe("New Year");
    succeed();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settle(painter);
    expect(saved).toEqual([]);
    expect(frame(painter).heading).toBe("New Year");
    expect(grid(painter).columns.map(({ key }) => key)).toEqual(["2026-12-31"]);
    expect(frame(painter).dirty).toBe(false);
  });
});

describe("a refused save", () => {
  it("naming no field shows beside Save only, keeps the draft, and a retry sends the same body", async () => {
    const { painter, writes } = await mount({
      refusals: [{ code: "special_day.invalid", params: {} }],
    });
    await paintDinner(painter, DEC_14);
    await save(painter, writes);
    expect(frame(painter).refusal).toBe("This could not be saved. Try again.");
    expect(grid(painter).columnErrors.size).toBe(0);
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
    await save(painter, writes);
    expect(writes[1]!.body).toEqual(writes[0]!.body);
    expect(frame(painter).refusal).toBe("");
    expect(frame(painter).dirty).toBe(false);
  });

  it("naming a department's paint entry shows that department and marks that date's heading", async () => {
    const { painter, writes } = await mount({
      refusals: [
        {
          code: "special_day.invalid",
          params: { field: "paint.1.ranges.0.startsAt", reason: "clock_skips", date: DEC_25 },
        },
      ],
    });
    await paintDinner(painter, DEC_14);
    await drag(painter, DEC_25, at("19:00"), at("22:00"));
    await pick(painter, "zone:z2");
    await drag(painter, DEC_15, at("21:00"), at("22:00"));
    await save(painter, writes);
    const message = `Restaurant, ${formatDate(DEC_25)}: The clock skips this time on this date.`;
    expect(frame(painter).refusal).toBe(message);
    expect(pickerValue(painter)).toBe("d1");
    expect([...grid(painter).columnErrors]).toEqual([
      [DEC_25, "The clock skips this time on this date."],
    ]);
    await pick(painter, "zone:z2");
    expect(grid(painter).columnErrors.size).toBe(0);
    expect(frame(painter).refusal).toBe(message);
  });

  it("naming a zone's paint entry shows that zone and marks its date", async () => {
    const { painter, writes } = await mount({
      refusals: [{ code: "special_day.invalid", params: { field: "zonePaint.0.ranges.0.kind" } }],
    });
    await pick(painter, "zone:z2");
    await drag(painter, DEC_15, at("21:00"), at("22:00"));
    await pick(painter, "d1");
    await save(painter, writes);
    expect(frame(painter).refusal).toBe(
      `Terrace, ${formatDate(DEC_15)}: Check this day's time ranges and periods.`,
    );
    expect(pickerValue(painter)).toBe("zone:z2");
    expect([...grid(painter).columnErrors.keys()]).toEqual([DEC_15]);
  });

  it("naming a kept entry's end offset names the period, the department and the date", async () => {
    const { painter, writes } = await mount({
      refusals: [
        {
          code: "special_day.invalid",
          params: {
            field: "paint",
            reason: "end_offset",
            departmentId: "d1",
            periodId: "p2",
            date: DEC_14,
          },
        },
      ],
    });
    await pick(painter, "zone:z1");
    painter.shadowRoot!.querySelector<HTMLInputElement>(`input[name="closed.${DEC_15}"]`)!.click();
    await settle(painter);
    await save(painter, writes);
    expect(frame(painter).refusal).toBe(
      `Restaurant, ${formatDate(DEC_14)}: Change the end offset of Dinner to fit these times.`,
    );
    expect(pickerValue(painter)).toBe("d1");
    expect([...grid(painter).columnErrors.keys()]).toEqual([DEC_14]);
  });

  it.each([
    [undefined, "Terrace: Check this day's time ranges and periods."],
    ["2027-12-15", "Terrace, Wed, 15 Dec 2027: Check this day's time ranges and periods."],
  ])("naming a kept zone entry on %s shows that zone and marks no column", async (date, text) => {
    const { painter, writes } = await mount({
      refusals: [
        { code: "special_day.invalid", params: { field: "zonePaint", zoneId: "z2", date } },
      ],
    });
    await paintDinner(painter, DEC_14);
    await save(painter, writes);
    expect(frame(painter).refusal).toBe(text);
    expect(pickerValue(painter)).toBe("zone:z2");
    expect(grid(painter).columnErrors.size).toBe(0);
  });

  it("a date already taken marks its column, and not when it is a later year's date", async () => {
    const taken = (date: string) => ({
      code: "special_day.date_taken",
      params: { date, name: "Fiesta", specialDayId: "sd9" },
    });
    const { painter, writes } = await mount({
      refusals: [taken(DEC_15), taken("2027-12-15")],
    });
    await paintDinner(painter, DEC_14);
    await save(painter, writes);
    expect(frame(painter).refusal).toBe(`Fiesta already holds ${formatDate(DEC_15)}.`);
    expect([...grid(painter).columnErrors.keys()]).toEqual([DEC_15]);
    await save(painter, writes);
    expect(frame(painter).refusal).toBe(`Fiesta already holds ${formatDate("2027-12-15")}.`);
    expect(grid(painter).columnErrors.size).toBe(0);
  });

  it("a date's own refusal marks its column", async () => {
    const { painter, writes } = await mount({
      refusals: [{ code: "special_day.invalid", params: { field: "dates.2.closedAllDay" } }],
    });
    await paintDinner(painter, DEC_14);
    await save(painter, writes);
    expect([...grid(painter).columnErrors.keys()]).toEqual([DEC_25]);
  });

  it.each([
    [
      { code: "department.not_found", params: { departmentId: "d1" } },
      "This department no longer exists.",
    ],
    [{ code: "service_zone.not_found", params: { zoneId: "z2" } }, "This zone no longer exists."],
    [{ code: "hours.clock_changed", params: {} }, "hours.clock_changed"],
  ])("%o shows beside Save only and keeps the draft", async (refusal, text) => {
    const { painter, writes } = await mount({ refusals: [refusal] });
    await paintDinner(painter, DEC_14);
    await save(painter, writes);
    expect(frame(painter).refusal).toBe(
      text.startsWith("hours.") ? t(text as "hours.clock_changed") : text,
    );
    expect(grid(painter).columnErrors.size).toBe(0);
    expect(grid(painter).days.get(DEC_14)).toEqual([dinner("19:00", "22:00")]);
    expect(frame(painter).dirty).toBe(true);
  });

  it("a refusal naming an entry it did not send shows beside Save only", async () => {
    const { painter, writes } = await mount({
      refusals: [{ code: "special_day.invalid", params: { field: "zonePaint.3.kind" } }],
    });
    await paintDinner(painter, DEC_14);
    await save(painter, writes);
    expect(frame(painter).refusal).toBe("This could not be saved. Try again.");
    expect(grid(painter).columnErrors.size).toBe(0);
  });
});
