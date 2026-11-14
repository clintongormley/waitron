import { describe, expect, it } from "vitest";
import { causeLayers, firstCodeInCauseChain } from "./cause-chain.js";

/** Accepts anything, so these tests exercise the WALK rather than any caller's predicate. */
const any = (): boolean => true;

describe("firstCodeInCauseChain", () => {
  it("reads a code at depth 0", () => {
    const error = Object.assign(new Error("boom"), { code: "42710" });
    expect(firstCodeInCauseChain(error, any)).toBe("42710");
  });

  it("reads a code nested under .cause", () => {
    const inner = Object.assign(new Error("driver failure"), { code: "42704" });
    const outer = new Error("wrapped", { cause: inner });
    expect(firstCodeInCauseChain(outer, any)).toBe("42704");
  });

  it("returns null when no level of the chain carries a code", () => {
    const inner = new Error("driver failure");
    const outer = new Error("wrapped", { cause: inner });
    expect(firstCodeInCauseChain(outer, any)).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(firstCodeInCauseChain("boom", any)).toBeNull();
    expect(firstCodeInCauseChain(undefined, any)).toBeNull();
  });

  it("ignores a non-string code", () => {
    expect(firstCodeInCauseChain(Object.assign(new Error("x"), { code: 42 }), any)).toBeNull();
  });

  it("skips a code the predicate rejects and keeps walking", () => {
    const inner = Object.assign(new Error("driver"), { code: "wanted" });
    const outer = Object.assign(new Error("wrapper", { cause: inner }), { code: "unwanted" });
    expect(firstCodeInCauseChain(outer, (code) => code === "wanted")).toBe("wanted");
  });

  it("stops at the walk-depth bound rather than spinning down an unbounded chain", () => {
    let chain: Error = Object.assign(new Error("bottom"), { code: "42704" });
    for (let i = 0; i < 8; i += 1) chain = new Error(`level ${i}`, { cause: chain });
    expect(firstCodeInCauseChain(chain, any)).toBeNull();
  });

  it("stops rather than spinning on a self-referential .cause", () => {
    const error = new Error("cyclic") as Error & { cause?: unknown };
    error.cause = error;
    expect(firstCodeInCauseChain(error, any)).toBeNull();
  });
});

describe("causeLayers", () => {
  it("yields outer layers first, follows function causes and includes a primitive tail", () => {
    const fn = Object.assign(() => {}, { cause: "tail" });
    const outer = { cause: fn };
    expect([...causeLayers(outer)]).toEqual([outer, fn, "tail"]);
    expect([...causeLayers(null)]).toEqual([null]);
    expect([...causeLayers(undefined)]).toEqual([]);
  });
  it("yields at most five layers and stops a self-reference", () => {
    const fifth = { cause: { marker: "sixth" } };
    const fourth = { cause: fifth };
    const third = { cause: fourth };
    const second = { cause: third };
    const first = { cause: second };
    expect([...causeLayers(first)]).toEqual([first, second, third, fourth, fifth]);
    const self: { cause?: unknown } = {};
    self.cause = self;
    expect([...causeLayers(self)]).toEqual([self]);
  });
});
