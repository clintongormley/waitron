import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { parseArea, parseBlocks } from "./paint-rules.js";

const ROLE = "0b6f2c1e-6a43-4f1b-9d3e-2f6c8a1b7e01";
const AREA = "5d2a9c3b-1e47-4c8f-a0b6-7e3d2f1c9a84";
const block = (over: Record<string, unknown> = {}) => ({
  staffRoleId: ROLE,
  headcount: 2,
  startsAt: "12:00",
  endsAt: "16:00",
  ...over,
});

function refusal(fn: () => unknown): { code: string; params: unknown } {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const { code, params } = error as AppError;
    return { code, params };
  }
  throw new Error("expected a refusal");
}

describe("parseBlocks", () => {
  it("accepts an empty array", () => {
    expect(parseBlocks([], "blocks", "06:00")).toEqual([]);
  });

  it("returns exactly the four fields of each block", () => {
    expect(parseBlocks([block(), block({ headcount: 50 })], "blocks", "06:00")).toEqual([
      block(),
      block({ headcount: 50 }),
    ]);
  });

  it("accepts a block past midnight that ends before the changeover", () => {
    expect(parseBlocks([block({ startsAt: "20:00", endsAt: "02:00" })], "blocks", "06:00")).toEqual(
      [block({ startsAt: "20:00", endsAt: "02:00" })],
    );
  });

  it("accepts a block that ends at the changeover", () => {
    expect(parseBlocks([block({ startsAt: "22:00", endsAt: "06:00" })], "blocks", "06:00")).toEqual(
      [block({ startsAt: "22:00", endsAt: "06:00" })],
    );
  });

  it.each([
    ["a non-array", { 0: block() }, "blocks"],
    ["null", null, "blocks"],
    ["a block that is not an object", [block(), block(), "x"], "blocks.2"],
    ["a null block", [null], "blocks.0"],
    ["an array block", [[]], "blocks.0"],
    ["a headcount of 0", [block(), block(), block({ headcount: 0 })], "blocks.2.headcount"],
    ["a headcount of 51", [block({ headcount: 51 })], "blocks.0.headcount"],
    ["a headcount of 1.5", [block({ headcount: 1.5 })], "blocks.0.headcount"],
    ["a text headcount", [block({ headcount: "2" })], "blocks.0.headcount"],
    ["a start off the 15-minute step", [block({ startsAt: "12:10" })], "blocks.0.startsAt"],
    ["an end off the 15-minute step", [block({ endsAt: "16:05" })], "blocks.0.endsAt"],
    ["a start that is not a time", [block({ startsAt: "24:00" })], "blocks.0.startsAt"],
    ["a start with seconds", [block({ startsAt: "12:00:00" })], "blocks.0.startsAt"],
    ["a numeric end", [block({ endsAt: 16 })], "blocks.0.endsAt"],
    [
      "a start equal to its end",
      [block({ startsAt: "12:00", endsAt: "12:00" })],
      "blocks.0.endsAt",
    ],
    [
      "a start equal to its end at the changeover",
      [block({ startsAt: "06:00", endsAt: "06:00" })],
      "blocks.0.endsAt",
    ],
    [
      "a block crossing the changeover",
      [block({ startsAt: "05:00", endsAt: "07:00" })],
      "blocks.0.endsAt",
    ],
    ["an unknown key", [block({ note: "x" })], "blocks.0.note"],
    [
      "a missing staff role",
      [{ headcount: 1, startsAt: "12:00", endsAt: "13:00" }],
      "blocks.0.staffRoleId",
    ],
    ["a non-uuid staff role", [block({ staffRoleId: "chef" })], "blocks.0.staffRoleId"],
    ["a numeric staff role", [block({ staffRoleId: 7 })], "blocks.0.staffRoleId"],
  ])("refuses %s as staffing.invalid naming the field", (_name, value, field) => {
    expect(refusal(() => parseBlocks(value, "blocks", "06:00"))).toEqual({
      code: "staffing.invalid",
      params: { field },
    });
  });

  it("folds an upper-case staff role id to lower case", () => {
    expect(parseBlocks([block({ staffRoleId: ROLE.toUpperCase() })], "blocks", "06:00")).toEqual([
      block(),
    ]);
  });

  it("names the field under the prefix it was given", () => {
    expect(
      refusal(() => parseBlocks([block({ headcount: 0 })], "edits.3.blocks", "06:00")),
    ).toEqual({ code: "staffing.invalid", params: { field: "edits.3.blocks.0.headcount" } });
  });
});

describe("parseArea", () => {
  it("accepts a department and a station", () => {
    expect(parseArea({ kind: "department", id: AREA }, "area")).toEqual({
      kind: "department",
      id: AREA,
    });
    expect(parseArea({ kind: "station", id: AREA }, "area")).toEqual({ kind: "station", id: AREA });
  });

  it("folds an upper-case id to lower case", () => {
    expect(parseArea({ kind: "station", id: AREA.toUpperCase() }, "area")).toEqual({
      kind: "station",
      id: AREA,
    });
  });

  it.each([
    ["a non-object", "department", "area"],
    ["null", null, "area"],
    ["an array", [], "area"],
    ["an unknown kind", { kind: "zone", id: AREA }, "area.kind"],
    ["a missing kind", { id: AREA }, "area.kind"],
    ["a non-uuid id", { kind: "station", id: "grill" }, "area.id"],
    ["a numeric id", { kind: "station", id: 3 }, "area.id"],
    ["an unknown key", { kind: "station", id: AREA, name: "Grill" }, "area.name"],
  ])("refuses %s as staffing.invalid naming the field", (_name, value, field) => {
    expect(refusal(() => parseArea(value, "area"))).toEqual({
      code: "staffing.invalid",
      params: { field },
    });
  });
});
