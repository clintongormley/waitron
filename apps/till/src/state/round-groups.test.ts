import { describe, expect, it } from "vitest";
import { groupRound, heldGroupIds, inHeldGroup, sendsAlone } from "./round-groups.js";

// Listed out of display order, so a grouping that follows the list rather than `displayOrder` fails.
const courses = [
  { id: "mains", name: "Mains", displayOrder: 2 },
  { id: "starters", name: "Starters", displayOrder: 1 },
  { id: "desserts", name: "Desserts", displayOrder: 3 },
];

const line = (courseId: string | null, held = false) => ({ courseId, held });

describe("groupRound", () => {
  it("fires the earliest course and holds each later course as its own group, in course order", () => {
    expect(
      groupRound([line("desserts"), line("mains"), line("starters"), line("mains")], courses),
    ).toEqual([
      { release: "fire", lineIndexes: [2] },
      { release: "hold", lineIndexes: [1, 3] },
      { release: "hold", lineIndexes: [0] },
    ]);
  });

  it("holds every group when every line is held", () => {
    expect(groupRound([line("starters", true), line("mains", true)], courses)).toEqual([
      { release: "hold", lineIndexes: [0] },
      { release: "hold", lineIndexes: [1] },
    ]);
  });

  it("keeps a held line of the earliest course back in a held group of its own, after the fired one", () => {
    expect(groupRound([line("starters", true), line("starters"), line("mains")], courses)).toEqual([
      { release: "fire", lineIndexes: [1] },
      { release: "hold", lineIndexes: [0] },
      { release: "hold", lineIndexes: [2] },
    ]);
  });

  it("holds the later courses even when every line of the earliest course is held", () => {
    expect(groupRound([line("mains"), line("starters", true)], courses)).toEqual([
      { release: "hold", lineIndexes: [1] },
      { release: "hold", lineIndexes: [0] },
    ]);
  });

  it("puts a line with no course, or with a course the till does not list, with the earliest course", () => {
    expect(
      groupRound([line("mains"), line(null), line("retired"), line("desserts")], courses),
    ).toEqual([
      { release: "fire", lineIndexes: [0, 1, 2] },
      { release: "hold", lineIndexes: [3] },
    ]);
  });

  it("fires a round with no courses at all as one group, and holds its held lines as another", () => {
    expect(groupRound([line(null), line(null, true), line(null)], [])).toEqual([
      { release: "fire", lineIndexes: [0, 2] },
      { release: "hold", lineIndexes: [1] },
    ]);
  });

  it("makes no group for an empty round", () => {
    expect(groupRound([], courses)).toEqual([]);
  });
});

describe("sendsAlone", () => {
  const held = heldGroupIds([
    { id: "g-held", state: "held" },
    { id: "g-fired", state: "fired" },
  ]);
  const dish = {
    parentLineNo: null,
    firedAt: null,
    state: "queued" as const,
    groupId: null as string | null,
  };

  it("collects the ids of the held groups only", () => {
    expect([...held]).toEqual(["g-held"]);
  });

  it("sends a held dish with a ticket item in no group, or in a fired group, on its own", () => {
    expect(sendsAlone(dish, held)).toBe(true);
    expect(sendsAlone({ ...dish, groupId: "g-fired" }, held)).toBe(true);
  });

  it("leaves a dish in a held group to its group", () => {
    expect(inHeldGroup({ groupId: "g-held" }, held)).toBe(true);
    expect(inHeldGroup({ groupId: "g-fired" }, held)).toBe(false);
    expect(inHeldGroup({ groupId: null }, held)).toBe(false);
    expect(sendsAlone({ ...dish, groupId: "g-held" }, held)).toBe(false);
  });

  it("sends nothing for a fired dish, a dish with no ticket item, or an extras child", () => {
    expect(sendsAlone({ ...dish, firedAt: "2026-08-20T09:59:00.000Z" }, held)).toBe(false);
    expect(sendsAlone({ ...dish, state: null }, held)).toBe(false);
    expect(sendsAlone({ ...dish, parentLineNo: 1 }, held)).toBe(false);
  });

  it("reads an absent parent as a dish", () => {
    expect(sendsAlone({ firedAt: null, state: "queued", groupId: null }, held)).toBe(true);
  });
});
