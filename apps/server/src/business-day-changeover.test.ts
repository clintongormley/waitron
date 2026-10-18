import { describe, expect, it } from "vitest";
import { businessDayBounds, type BusinessDayClock } from "@waitron/shared";
import { clockTransitionAt, planBusinessDayStart } from "./business-day-changeover.js";

const MADRID: BusinessDayClock = {
  timeZone: "Europe/Madrid",
  dayCutover: "05:00",
  cutoverChanges: [],
};

function minutes(clock: BusinessDayClock, day: string): number {
  const { startAt, endAt } = businessDayBounds(clock, day);
  return (Date.parse(endAt) - Date.parse(startAt)) / 60000;
}

describe("planBusinessDayStart", () => {
  it.each(["03:00", "21:00"])(
    "a Save on Tue 22:00 for %s moves the changeover that ends Tuesday",
    (dayCutover) => {
      const plan = planBusinessDayStart(MADRID, dayCutover, new Date("2026-10-20T20:00:00Z"));
      expect(plan.today).toBe("2026-10-20");
      expect(plan.effectiveBusinessDay).toBe("2026-10-21");
      expect(plan.kept).toEqual([]);
      expect(plan.removed).toEqual([]);
      expect(plan.before).toEqual(MADRID);
      expect(plan.candidate).toEqual({
        ...MADRID,
        cutoverChanges: [{ effectiveBusinessDay: "2026-10-21", dayCutover }],
      });
    },
  );

  it("a start already passed tonight takes effect one changeover later", () => {
    const plan = planBusinessDayStart(MADRID, "00:30", new Date("2026-10-20T23:00:00Z"));
    expect(plan.today).toBe("2026-10-20");
    expect(plan.effectiveBusinessDay).toBe("2026-10-22");
    expect(plan.kept).toEqual([]);
    expect(plan.removed).toEqual([]);
    expect(plan.candidate.cutoverChanges).toEqual([
      { effectiveBusinessDay: "2026-10-22", dayCutover: "00:30" },
    ]);
  });

  it("a start still ahead tonight ends today", () => {
    const plan = planBusinessDayStart(MADRID, "03:00", new Date("2026-10-20T23:00:00Z"));
    expect(plan.effectiveBusinessDay).toBe("2026-10-21");
  });

  it("from 23:59 to 00:00 leaves a one-minute day", () => {
    const clock = { ...MADRID, dayCutover: "23:59" };
    const plan = planBusinessDayStart(clock, "00:00", new Date("2026-10-21T08:00:00Z"));
    expect(plan.effectiveBusinessDay).toBe("2026-10-22");
    expect(minutes(plan.candidate, "2026-10-21")).toBe(1);
  });

  it("from 00:00 to 23:59 leaves a day of 2879 minutes", () => {
    const clock = { ...MADRID, dayCutover: "00:00" };
    const plan = planBusinessDayStart(clock, "23:59", new Date("2026-10-21T08:00:00Z"));
    expect(plan.effectiveBusinessDay).toBe("2026-10-22");
    expect(minutes(plan.candidate, "2026-10-21")).toBe(2879);
  });

  describe("while a change waits and the old changeover has passed", () => {
    const waiting: BusinessDayClock = {
      ...MADRID,
      cutoverChanges: [{ effectiveBusinessDay: "2026-10-21", dayCutover: "21:00" }],
    };
    const wed13 = new Date("2026-10-21T11:00:00Z");

    it("(a) a later start replaces the waiting one tonight", () => {
      const plan = planBusinessDayStart(waiting, "23:00", wed13);
      expect(plan.today).toBe("2026-10-20");
      expect(plan.effectiveBusinessDay).toBe("2026-10-21");
      expect(plan.kept).toEqual([]);
      expect(plan.removed).toEqual(["2026-10-21"]);
      expect(plan.before).toEqual(MADRID);
      expect(plan.candidate.cutoverChanges).toEqual([
        { effectiveBusinessDay: "2026-10-21", dayCutover: "23:00" },
      ]);
      expect(businessDayBounds(plan.candidate, "2026-10-20").endAt).toBe(
        "2026-10-21T21:00:00.000Z",
      );
    });

    it("(b) an earlier start keeps the waiting one and follows it", () => {
      const plan = planBusinessDayStart(waiting, "10:00", wed13);
      expect(plan.effectiveBusinessDay).toBe("2026-10-22");
      expect(plan.kept).toEqual([{ effectiveBusinessDay: "2026-10-21", dayCutover: "21:00" }]);
      expect(plan.removed).toEqual([]);
      expect(plan.before).toEqual(waiting);
      expect(plan.candidate.cutoverChanges).toEqual([
        { effectiveBusinessDay: "2026-10-21", dayCutover: "21:00" },
        { effectiveBusinessDay: "2026-10-22", dayCutover: "10:00" },
      ]);
      expect(businessDayBounds(plan.candidate, "2026-10-21")).toEqual({
        startAt: "2026-10-21T19:00:00.000Z",
        endAt: "2026-10-22T08:00:00.000Z",
      });
      expect(minutes(plan.candidate, "2026-10-21")).toBe(13 * 60);
    });

    it("(c) the start in force keeps the waiting one and follows it", () => {
      const plan = planBusinessDayStart(waiting, "05:00", wed13);
      expect(plan.effectiveBusinessDay).toBe("2026-10-22");
      expect(plan.kept).toEqual([{ effectiveBusinessDay: "2026-10-21", dayCutover: "21:00" }]);
      expect(plan.removed).toEqual([]);
      expect(businessDayBounds(plan.candidate, "2026-10-21")).toEqual({
        startAt: "2026-10-21T19:00:00.000Z",
        endAt: "2026-10-22T03:00:00.000Z",
      });
    });

    it("(d) the waiting start again changes nothing", () => {
      const plan = planBusinessDayStart(waiting, "21:00", wed13);
      expect(plan.effectiveBusinessDay).toBe("2026-10-21");
      expect(plan.candidate).toEqual(waiting);
    });
  });

  it("an undo removes every waiting row and adds none", () => {
    const clock: BusinessDayClock = {
      ...MADRID,
      cutoverChanges: [
        { effectiveBusinessDay: "2026-10-19", dayCutover: "06:00" },
        { effectiveBusinessDay: "2026-11-04", dayCutover: "07:00" },
      ],
    };
    const plan = planBusinessDayStart(clock, "06:00", new Date("2026-10-20T20:00:00Z"));
    expect(plan.effectiveBusinessDay).toBe("2026-10-21");
    expect(plan.removed).toEqual(["2026-11-04"]);
    expect(plan.before.cutoverChanges).toEqual([
      { effectiveBusinessDay: "2026-10-19", dayCutover: "06:00" },
    ]);
    expect(plan.candidate).toEqual(plan.before);
  });
});

describe("clockTransitionAt", () => {
  it.each([
    [
      "2026-10-23T01:00:00Z",
      { clocksChangeOn: "2026-10-25", saveFrom: "2026-10-26T01:30:00.000Z" },
    ],
    [
      "2026-10-26T01:15:00Z",
      { clocksChangeOn: "2026-10-25", saveFrom: "2026-10-26T01:30:00.000Z" },
    ],
    ["2026-10-26T01:30:00Z", null],
    ["2026-10-26T02:00:00Z", null],
    [
      "2027-03-27T11:00:00Z",
      { clocksChangeOn: "2027-03-28", saveFrom: "2027-03-29T00:30:00.000Z" },
    ],
    ["2027-03-29T01:00:00Z", null],
  ])("02:30 saved at %s", (at, expected) => {
    expect(clockTransitionAt(MADRID, "02:30", new Date(at))).toEqual(expected);
  });

  it.each([
    "2026-10-23T01:00:00Z",
    "2026-10-26T01:15:00Z",
    "2026-10-26T01:30:00Z",
    "2026-10-26T02:00:00Z",
    "2027-03-27T11:00:00Z",
    "2027-03-29T01:00:00Z",
  ])("03:00 saved at %s meets no clocks change", (at) => {
    expect(clockTransitionAt(MADRID, "03:00", new Date(at))).toBeNull();
  });
});
