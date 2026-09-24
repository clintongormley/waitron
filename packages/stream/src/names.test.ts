import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { GENERATION_NAME, generationName, parseGenerationName, venuePrefix } from "./names.js";

const NODE = "3f1c2b9e-8d7a-4e21-9b0c-5a6d7e8f9012";

function thrown(fn: () => unknown): { code: string; params: unknown } {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, params: error.params };
    throw error;
  }
  throw new Error("expected a throw");
}

describe("venuePrefix", () => {
  it("puts a venue's objects under venues/<id>/", () => {
    expect(venuePrefix("loc-1")).toBe("venues/loc-1/");
    expect(venuePrefix(NODE)).toBe(`venues/${NODE}/`);
  });

  it.each(["", "a/b", "../x", "-leading", "a b", "a.b"])(
    "refuses %j, which is not one safe key segment",
    (bad) => {
      expect(thrown(() => venuePrefix(bad))).toEqual({
        code: "backup.stream_name_invalid",
        params: { field: "venueId", value: bad },
      });
    },
  );
});

describe("generationName", () => {
  it("names a generation by term, node and the UTC second it was opened", () => {
    expect(generationName(3, NODE, new Date("2026-09-23T10:11:12.345Z"))).toBe(
      `gen-3-${NODE}-20260923T101112Z`,
    );
  });

  it("gives a rebuilt box reusing its node id and term a different name a second later", () => {
    const first = generationName(4, NODE, new Date("2026-09-23T10:11:12Z"));
    const again = generationName(4, NODE, new Date("2026-09-23T10:11:13Z"));
    expect(again).not.toBe(first);
  });

  it("round-trips through parseGenerationName", () => {
    const name = generationName(12, NODE, new Date("2026-02-28T23:59:59.999Z"));
    expect(parseGenerationName(name)).toEqual({
      term: 12,
      nodeId: NODE,
      openedAt: new Date("2026-02-28T23:59:59Z"),
    });
    expect(GENERATION_NAME.test(name)).toBe(true);
  });

  it("names a generation at term 0, the term a venue's first membership document carries", () => {
    // `buildNextMembershipDocument` starts at 0 when no document is held
    // (packages/membership/src/build.ts:24), so the first box of every venue streams at term 0.
    expect(generationName(0, NODE, new Date("2026-09-23T10:11:12Z"))).toBe(
      `gen-0-${NODE}-20260923T101112Z`,
    );
    expect(parseGenerationName(`gen-0-${NODE}-20260923T101112Z`)).toMatchObject({ term: 0 });
  });

  it.each([
    [-1, "term"],
    [1.5, "term"],
    [Number.NaN, "term"],
    [Number.MAX_SAFE_INTEGER + 1, "term"],
  ])("refuses the term %s", (term, field) => {
    expect(thrown(() => generationName(term, NODE, new Date()))).toEqual({
      code: "backup.stream_name_invalid",
      params: { field, value: String(term) },
    });
  });

  it("refuses a node id that is not one safe key segment", () => {
    expect(thrown(() => generationName(1, "a/b", new Date()))).toEqual({
      code: "backup.stream_name_invalid",
      params: { field: "nodeId", value: "a/b" },
    });
  });

  it.each([new Date(Number.NaN), new Date("+010000-01-01T00:00:00Z")])(
    "refuses the opening time %s",
    (openedAt) => {
      expect(thrown(() => generationName(1, NODE, openedAt))).toEqual({
        code: "backup.stream_name_invalid",
        params: { field: "openedAt", value: String(openedAt.getTime()) },
      });
    },
  );
});

describe("parseGenerationName", () => {
  it.each([
    "current.json",
    `gen-00-${NODE}-20260923T101112Z`,
    `gen-01-${NODE}-20260923T101112Z`,
    `gen-1-${NODE}`,
    `gen-1-${NODE}-20260923T101112`,
    `gen-1-${NODE}-20261323T101112Z`,
    `gen-1-${NODE}-20260931T101112Z`,
    `gen-1-${NODE}-20260923T256000Z`,
    `gen-99999999999999999999-${NODE}-20260923T101112Z`,
    "gen-1--20260923T101112Z",
  ])("reads %j as not a generation", (name) => {
    expect(parseGenerationName(name)).toBeNull();
  });
});
