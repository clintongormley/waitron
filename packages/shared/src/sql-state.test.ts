import { describe, expect, it } from "vitest";
import { sqlStateOf } from "./sql-state.js";

describe("sqlStateOf", () => {
  it("reads a SQLSTATE code at depth 0", () => {
    const error = Object.assign(new Error("boom"), { code: "42710" });
    expect(sqlStateOf(error)).toBe("42710");
  });

  it("reads a SQLSTATE code nested under .cause", () => {
    const inner = Object.assign(new Error("driver failure"), { code: "42704" });
    const outer = new Error("wrapped", { cause: inner });
    expect(sqlStateOf(outer)).toBe("42704");
  });

  it("returns null when there is no SQLSTATE anywhere in the chain", () => {
    const inner = new Error("driver failure");
    const outer = new Error("wrapped", { cause: inner });
    expect(sqlStateOf(outer)).toBeNull();
  });

  it("returns null for a non-SQLSTATE code (e.g. Node's ENOENT)", () => {
    const error = Object.assign(new Error("not found"), { code: "ENOENT" });
    expect(sqlStateOf(error)).toBeNull();
  });

  it("stops at the walk-depth bound rather than spinning down an unbounded chain", () => {
    let chain = new Error("bottom");
    for (let i = 0; i < 8; i += 1) chain = new Error(`level ${i}`, { cause: chain });
    expect(sqlStateOf(chain)).toBeNull();
  });

  it("stops rather than spinning on a self-referential .cause", () => {
    const error = new Error("cyclic") as Error & { cause?: unknown };
    error.cause = error;
    expect(sqlStateOf(error)).toBeNull();
  });
});
