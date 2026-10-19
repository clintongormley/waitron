import { describe, expect, it } from "vitest";
import type { ServiceStep } from "../service-steps.js";
import {
  stepsEqual,
  toStepDrafts,
  toStepInputs,
  withSavedIds,
  type ServiceStepDraft,
} from "./service-step-draft.js";

const rows: ServiceStep[] = [
  {
    id: "s1",
    departmentId: "d1",
    name: "Set up",
    start: "seated",
    courseId: null,
    minutes: 0,
  },
  {
    id: "s2",
    departmentId: "d1",
    name: "Dessert?",
    start: "course_served",
    courseId: "c1",
    minutes: 10,
  },
];
const drafts = (): ServiceStepDraft[] => toStepDrafts(rows);

describe("toStepDrafts", () => {
  it("keys each row by its id and turns minutes into text", () => {
    expect(toStepDrafts(rows)).toEqual([
      { key: "s1", id: "s1", name: "Set up", start: "seated", courseId: null, minutes: "0" },
      {
        key: "s2",
        id: "s2",
        name: "Dessert?",
        start: "course_served",
        courseId: "c1",
        minutes: "10",
      },
    ]);
  });
});

describe("stepsEqual", () => {
  const changed = (edit: (list: ServiceStepDraft[]) => void) => {
    const list = drafts();
    edit(list);
    return stepsEqual(drafts(), list);
  };
  it("is true for the same rows", () => {
    expect(stepsEqual(drafts(), drafts())).toBe(true);
  });
  it("is false for a renamed, moved, added or removed row", () => {
    expect(changed((l) => (l[0]!.name = "Lay the table"))).toBe(false);
    expect(changed((l) => l.reverse())).toBe(false);
    expect(
      changed((l) =>
        l.push({
          key: "k",
          id: null,
          name: "More",
          start: "all_served",
          courseId: null,
          minutes: "5",
        }),
      ),
    ).toBe(false);
    expect(changed((l) => l.pop())).toBe(false);
  });
  it("is false for a changed start, course, id or minutes", () => {
    expect(changed((l) => (l[0]!.start = "after_previous"))).toBe(false);
    expect(changed((l) => (l[1]!.courseId = "c2"))).toBe(false);
    expect(changed((l) => (l[1]!.id = null))).toBe(false);
    expect(changed((l) => (l[0]!.minutes = "2"))).toBe(false);
    const a = drafts(),
      b = drafts();
    a[0]!.minutes = "2";
    b[0]!.minutes = "3";
    expect(stepsEqual(a, b)).toBe(false);
  });
  it("reads minutes as the numbers they spell and names without outer spaces", () => {
    const a = drafts(),
      b = drafts();
    a[0]!.minutes = "2";
    b[0]!.minutes = "02";
    b[1]!.name = "  Dessert? ";
    expect(stepsEqual(a, b)).toBe(true);
  });
  it("compares minutes that are not whole numbers as trimmed text", () => {
    const a = drafts(),
      b = drafts();
    a[0]!.minutes = " 1.5";
    b[0]!.minutes = "1.5 ";
    expect(stepsEqual(a, b)).toBe(true);
    b[0]!.minutes = "1.50";
    expect(stepsEqual(a, b)).toBe(false);
    a[0]!.minutes = "";
    b[0]!.minutes = "0";
    expect(stepsEqual(a, b)).toBe(false);
  });
});

describe("withSavedIds", () => {
  const saved = () => {
    const list = drafts();
    list[1] = { ...list[1]!, key: "new", id: null };
    return list;
  };
  it("gives each id-less row the id the model holds at its place, keeping its key", () => {
    expect(withSavedIds(saved(), drafts())).toEqual([drafts()[0], { ...drafts()[1], key: "new" }]);
  });
  it("gives none when the model differs in anything but those ids", () => {
    const moved = drafts().reverse();
    expect(withSavedIds(saved(), moved)).toBeUndefined();
    const other = drafts();
    other[0]!.id = "s9";
    expect(withSavedIds(saved(), other)).toBeUndefined();
    const renamed = drafts();
    renamed[1]!.name = "Pudding?";
    expect(withSavedIds(saved(), renamed)).toBeUndefined();
    expect(withSavedIds(saved(), drafts().slice(0, 1))).toBeUndefined();
  });
});

describe("toStepInputs", () => {
  it("leaves out a null id, trims names and turns minutes into numbers", () => {
    expect(
      toStepInputs([
        { key: "s1", id: "s1", name: " Set up ", start: "seated", courseId: null, minutes: "02" },
        {
          key: "new",
          id: null,
          name: "More ",
          start: "course_served",
          courseId: "c1",
          minutes: "10",
        },
      ]),
    ).toEqual([
      { id: "s1", name: "Set up", start: "seated", courseId: null, minutes: 2 },
      { name: "More", start: "course_served", courseId: "c1", minutes: 10 },
    ]);
  });
});
