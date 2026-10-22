import { describe, expect, it } from "vitest";
import {
  liveSteps,
  servedTimes,
  type DishServing,
  type StepFacts,
  type StepRule,
} from "./service-step-reckoning.js";

const DAY = "2026-10-22";
const at = (time: string): number => Date.parse(`${DAY}T${time}:00.000Z`);
const iso = (time: string): string => new Date(at(time)).toISOString();

function rule(
  id: string,
  start: StepRule["start"],
  minutes: number,
  courseId: string | null = null,
): StepRule {
  return { id, name: id, start, courseId, minutes };
}

function facts(overrides: Partial<StepFacts> = {}): StepFacts {
  return {
    openedAt: at("20:30"),
    firstOrderAt: null,
    lastOrderAt: null,
    drafting: false,
    courseServedAt: new Map(),
    allServedAt: null,
    doneAt: new Map(),
    ...overrides,
  };
}

const live = (stepId: string, triggered: string, due: string) => ({
  stepId,
  name: stepId,
  triggeredAt: at(triggered),
  dueAt: at(due),
});

describe("liveSteps", () => {
  it("the worked example of the design's §8", () => {
    const rules = [
      rule("Set up", "seated", 0),
      rule("Take order", "after_previous", 2),
      rule("Dessert?", "course_served", 10, "mains"),
    ];
    expect(liveSteps(rules, facts(), at("20:30"))).toEqual([live("Set up", "20:30", "20:30")]);
    const setUpDone = new Map([["Set up", at("20:33")]]);
    expect(liveSteps(rules, facts({ doneAt: setUpDone }), at("20:34"))).toEqual([
      live("Take order", "20:33", "20:35"),
    ]);
    const ordered = { doneAt: setUpDone, firstOrderAt: at("20:36"), lastOrderAt: at("20:36") };
    expect(liveSteps(rules, facts(ordered), at("20:36"))).toEqual([]);
    const served = { ...ordered, courseServedAt: new Map([["mains", at("21:32")]]) };
    expect(liveSteps(rules, facts(served), at("21:41"))).toEqual([
      live("Dessert?", "21:32", "21:42"),
    ]);
    expect(liveSteps(rules, facts(served), at("21:42"))).toEqual([
      live("Dessert?", "21:32", "21:42"),
    ]);
    const dessertDone = new Map([...setUpDone, ["Dessert?", at("21:45")]]);
    expect(liveSteps(rules, facts({ ...served, doneAt: dessertDone }), at("21:46"))).toEqual([]);
  });

  it("a seated step is due its minutes after the party sat down", () => {
    expect(liveSteps([rule("Water", "seated", 5)], facts(), at("20:31"))).toEqual([
      live("Water", "20:30", "20:35"),
    ]);
  });

  it("after the step before is triggered by the Done of the step above, and never for the first step", () => {
    const rules = [rule("First", "after_previous", 0), rule("Second", "after_previous", 3)];
    expect(liveSteps(rules, facts(), at("21:00"))).toEqual([]);
    const doneAt = new Map([["First", at("20:40")]]);
    expect(liveSteps(rules, facts({ doneAt }), at("21:00"))).toEqual([
      live("Second", "20:40", "20:43"),
    ]);
  });

  it("a course served is triggered by its latest serving end once none of it is left, and never for a course not ordered", () => {
    const rules = [
      rule("Dessert?", "course_served", 10, "mains"),
      rule("Mains?", "course_served", 0, "starters"),
      rule("Nothing", "course_served", 0, null),
    ];
    const courseServedAt = new Map([["mains", at("21:32")]]);
    expect(liveSteps(rules, facts({ courseServedAt }), at("21:33"))).toEqual([
      live("Dessert?", "21:32", "21:42"),
    ]);
    expect(liveSteps(rules, facts(), at("21:33"))).toEqual([]);
  });

  it("everything served needs a dish and none left, and starts again after the next serving", () => {
    const rules = [rule("Anything else?", "all_served", 10)];
    expect(liveSteps(rules, facts(), at("21:00"))).toEqual([]);
    expect(liveSteps(rules, facts({ allServedAt: at("21:00") }), at("21:01"))).toEqual([
      live("Anything else?", "21:00", "21:10"),
    ]);
    const doneAt = new Map([["Anything else?", at("21:12")]]);
    expect(liveSteps(rules, facts({ allServedAt: at("21:00"), doneAt }), at("21:13"))).toEqual([]);
    expect(liveSteps(rules, facts({ allServedAt: at("21:30"), doneAt }), at("21:31"))).toEqual([
      live("Anything else?", "21:30", "21:40"),
    ]);
  });

  it("every N minutes since the last order repeats, a Done stops only the current repeat, and nothing comes before the first order", () => {
    const rules = [rule("Drinks?", "since_last_order", 20)];
    expect(liveSteps(rules, facts(), at("22:30"))).toEqual([]);
    const ordered = { firstOrderAt: at("21:00"), lastOrderAt: at("22:00") };
    expect(liveSteps(rules, facts(ordered), at("22:19"))).toEqual([
      live("Drinks?", "22:20", "22:20"),
    ]);
    expect(liveSteps(rules, facts(ordered), at("22:20"))).toEqual([
      live("Drinks?", "22:20", "22:20"),
    ]);
    const doneAt = new Map([["Drinks?", at("22:21")]]);
    expect(liveSteps(rules, facts({ ...ordered, doneAt }), at("22:21"))).toEqual([
      live("Drinks?", "22:40", "22:40"),
    ]);
    expect(liveSteps(rules, facts({ ...ordered, doneAt }), at("22:41"))).toEqual([
      live("Drinks?", "22:40", "22:40"),
    ]);
    expect(liveSteps(rules, facts({ ...ordered, doneAt }), at("23:05"))).toEqual([
      live("Drinks?", "23:00", "23:00"),
    ]);
    const reordered = { ...ordered, lastOrderAt: at("22:30"), doneAt };
    expect(liveSteps(rules, facts(reordered), at("22:31"))).toEqual([
      live("Drinks?", "22:50", "22:50"),
    ]);
  });

  it("a Done after a step's trigger clears it; one before its next trigger does not", () => {
    const rules = [rule("Check", "course_served", 5, "mains")];
    const ordered = { firstOrderAt: at("20:40"), lastOrderAt: at("20:40") };
    const doneAt = new Map([["Check", at("21:01")]]);
    const first = { ...ordered, doneAt, courseServedAt: new Map([["mains", at("21:00")]]) };
    expect(liveSteps(rules, facts(first), at("21:02"))).toEqual([]);
    const again = { ...first, courseServedAt: new Map([["mains", at("21:20")]]) };
    expect(liveSteps(rules, facts(again), at("21:21"))).toEqual([live("Check", "21:20", "21:25")]);
  });

  it("an order sent after a step is due clears it", () => {
    const rules = [rule("Anything else?", "all_served", 10)];
    const served = { firstOrderAt: at("20:40"), allServedAt: at("21:00") };
    expect(liveSteps(rules, facts({ ...served, lastOrderAt: at("21:10") }), at("21:11"))).toEqual([
      live("Anything else?", "21:00", "21:10"),
    ]);
    expect(liveSteps(rules, facts({ ...served, lastOrderAt: at("21:11") }), at("21:12"))).toEqual(
      [],
    );
  });

  it("an order sent while a step waits out its minutes leaves it, unless it is the party's first order", () => {
    const rules = [rule("Set up", "seated", 0), rule("Take order", "after_previous", 2)];
    const doneAt = new Map([["Set up", at("20:33")]]);
    const first = { doneAt, firstOrderAt: at("20:34"), lastOrderAt: at("20:34") };
    expect(liveSteps(rules, facts(first), at("20:36"))).toEqual([]);
    const second = { doneAt, firstOrderAt: at("20:31"), lastOrderAt: at("20:34") };
    expect(liveSteps(rules, facts(second), at("20:34"))).toEqual([
      live("Take order", "20:33", "20:35"),
    ]);
  });

  it("a first order at the same instant as a step's trigger does not clear it", () => {
    const rules = [rule("Set up", "seated", 0), rule("Take order", "after_previous", 2)];
    const doneAt = new Map([["Set up", at("20:34")]]);
    const ordered = { doneAt, firstOrderAt: at("20:34"), lastOrderAt: at("20:34") };
    expect(liveSteps(rules, facts(ordered), at("20:35"))).toEqual([
      live("Take order", "20:34", "20:36"),
    ]);
  });

  it("Dessert? survives a drinks round sent while it waits out its minutes", () => {
    const rules = [rule("Dessert?", "course_served", 10, "mains")];
    const served = {
      firstOrderAt: at("20:36"),
      lastOrderAt: at("21:35"),
      courseServedAt: new Map([["mains", at("21:32")]]),
    };
    expect(liveSteps(rules, facts(served), at("21:42"))).toEqual([
      live("Dessert?", "21:32", "21:42"),
    ]);
    expect(liveSteps(rules, facts({ ...served, lastOrderAt: at("21:43") }), at("21:43"))).toEqual(
      [],
    );
  });

  it("the Done that triggers the next step does not clear it", () => {
    const rules = [rule("Set up", "seated", 0), rule("Bread", "after_previous", 0)];
    const doneAt = new Map([["Set up", at("20:33")]]);
    expect(liveSteps(rules, facts({ doneAt }), at("20:33"))).toEqual([
      live("Bread", "20:33", "20:33"),
    ]);
  });

  it("before the first order an open draft hides every step; after it a draft hides none", () => {
    const rules = [rule("Set up", "seated", 0), rule("Anything else?", "all_served", 10)];
    expect(liveSteps(rules, facts({ drafting: true }), at("20:31"))).toEqual([]);
    expect(liveSteps(rules, facts({ drafting: false }), at("20:31"))).toEqual([
      live("Set up", "20:30", "20:30"),
    ]);
    const ordered = {
      drafting: true,
      firstOrderAt: at("20:40"),
      lastOrderAt: at("20:40"),
      allServedAt: at("21:00"),
    };
    expect(liveSteps(rules, facts(ordered), at("21:01"))).toEqual([
      live("Anything else?", "21:00", "21:10"),
    ]);
  });

  it("lists live steps soonest due first, ties in list order", () => {
    const rules = [rule("A", "seated", 10), rule("B", "seated", 0), rule("C", "seated", 0)];
    expect(liveSteps(rules, facts(), at("20:31")).map((step) => step.stepId)).toEqual([
      "B",
      "C",
      "A",
    ]);
  });
});

function dish(overrides: Partial<DishServing> = {}): DishServing {
  return {
    courseId: "mains",
    quantity: 1000,
    servedQuantity: 1000,
    servedAt: iso("21:00"),
    cancelledQuantity: 0,
    cancelledAt: null,
    ...overrides,
  };
}

describe("servedTimes", () => {
  it("takes the latest serving end per course and over everything", () => {
    const result = servedTimes([
      dish({ servedAt: iso("21:00") }),
      dish({ servedAt: iso("21:10") }),
      dish({ courseId: "starters", servedAt: iso("20:50") }),
    ]);
    expect(result.courseServedAt).toEqual(
      new Map([
        ["mains", at("21:10")],
        ["starters", at("20:50")],
      ]),
    );
    expect(result.allServedAt).toBe(at("21:10"));
  });

  it("gives a dish whose remainder was cancelled its cancellation time when that is later", () => {
    const result = servedTimes([
      dish({
        quantity: 3000,
        servedQuantity: 2000,
        servedAt: iso("21:00"),
        cancelledQuantity: 1000,
        cancelledAt: iso("21:05"),
      }),
    ]);
    expect(result.courseServedAt.get("mains")).toBe(at("21:05"));
    expect(result.allServedAt).toBe(at("21:05"));
  });

  it("gives a dish cancelled whole its cancellation time", () => {
    const result = servedTimes([
      dish({
        servedQuantity: 0,
        servedAt: null,
        cancelledQuantity: 1000,
        cancelledAt: iso("21:07"),
      }),
    ]);
    expect(result.courseServedAt.get("mains")).toBe(at("21:07"));
    expect(result.allServedAt).toBe(at("21:07"));
  });

  it("keeps a part-served dish's course, and everything served, unserved", () => {
    const result = servedTimes([
      dish({ courseId: "starters" }),
      dish({ quantity: 2000, servedQuantity: 1000 }),
    ]);
    expect(result.courseServedAt.has("mains")).toBe(false);
    expect(result.courseServedAt.get("starters")).toBe(at("21:00"));
    expect(result.allServedAt).toBeNull();
  });

  it("keeps a course unserved when a dish has nothing left to serve but no serving time", () => {
    const result = servedTimes([dish(), dish({ servedAt: null })]);
    expect(result.courseServedAt.has("mains")).toBe(false);
    expect(result.allServedAt).toBeNull();
  });

  it("counts dishes with no course only for everything served", () => {
    const served = servedTimes([dish({ courseId: null, servedAt: iso("21:20") }), dish()]);
    expect(served.courseServedAt).toEqual(new Map([["mains", at("21:00")]]));
    expect(served.allServedAt).toBe(at("21:20"));
    const unserved = servedTimes([dish({ courseId: null, servedQuantity: 0, servedAt: null })]);
    expect(unserved.courseServedAt.size).toBe(0);
    expect(unserved.allServedAt).toBeNull();
  });

  it("gives nothing served with no dish", () => {
    expect(servedTimes([])).toEqual({ courseServedAt: new Map(), allServedAt: null });
  });
});
