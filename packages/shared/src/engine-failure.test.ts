import { describe, expect, it } from "vitest";
import { MAX_CAUSE_DEPTH } from "./cause-chain.js";
import { diskFullIn, sqliteFailureOf } from "./engine-failure.js";
import { AppError } from "./errors.js";

/**
 * Hand-built errors, deliberately: this package is browser-safe and cannot import `node:sqlite` to
 * make a real one (its tsconfig carries no node types, which is the guard).
 */
const driverError = (errcode: number, message: string) =>
  Object.assign(new Error(message), { errcode, code: "ERR_SQLITE_ERROR" });

describe("sqliteFailureOf", () => {
  it("reads the result code and the message together", () => {
    expect(sqliteFailureOf(driverError(1299, "NOT NULL constraint failed: t.v"))).toEqual({
      errcode: 1299,
      message: "NOT NULL constraint failed: t.v",
    });
  });

  it("reads the failure nested under .cause, where drizzle puts it", () => {
    const inner = driverError(1, "no such table: missing_table");
    expect(sqliteFailureOf(new Error("Failed query", { cause: inner }))).toEqual({
      errcode: 1,
      message: "no such table: missing_table",
    });
  });

  // Taking the message from the outer wrapper would hand a caller the wrapper's text
  // beside the driver's number, and the callers that read the text — `classifyBootFailure` is
  // one — would then classify on the wrong sentence.
  it("takes the message from the layer that carried the code, not from the wrapper", () => {
    const outer = new Error("Failed query: select legal_name from tenants", {
      cause: driverError(1, "no such column: legal_name"),
    });
    expect(sqliteFailureOf(outer)?.message).toBe("no such column: legal_name");
  });

  it("returns null when no layer carries a result code", () => {
    expect(sqliteFailureOf(new Error("wrapped", { cause: new Error("driver") }))).toBeNull();
  });

  it("returns null for a Node error code", () => {
    expect(sqliteFailureOf(Object.assign(new Error("not found"), { code: "ENOENT" }))).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(sqliteFailureOf("boom")).toBeNull();
    expect(sqliteFailureOf(undefined)).toBeNull();
  });

  // This function repeats the walk in `cause-chain.ts` rather than reusing it — that loop's
  // predicate returns a `code` string and cannot carry a number and a message out — so its own
  // bound is worth a case here rather than resting on the sibling's.
  it("gives up rather than walking a chain without end", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(sqliteFailureOf(cyclic)).toBeNull();
  });

  // Five levels deep is what `MAX_CAUSE_DEPTH` allows, so a code at the sixth is not found.
  it("stops at the depth bound rather than following a chain without end", () => {
    let error: unknown = driverError(1299, "NOT NULL constraint failed: t.v");
    for (let level = 0; level < 5; level += 1) error = new Error("wrapped", { cause: error });
    expect(sqliteFailureOf(error)).toBeNull();
    let reachable: unknown = driverError(1299, "NOT NULL constraint failed: t.v");
    for (let level = 0; level < 4; level += 1)
      reachable = new Error("wrapped", { cause: reachable });
    expect(sqliteFailureOf(reachable)?.errcode).toBe(1299);
  });

  it("answers with an empty message when the layer carries no string one", () => {
    expect(sqliteFailureOf({ errcode: 14 })).toEqual({ errcode: 14, message: "" });
  });
});

describe("diskFullIn", () => {
  it("recognises the engine's full-disk code", () => {
    expect(diskFullIn(driverError(13, "database or disk is full"))).toBe(true);
  });

  it("recognises the domain error", () => {
    expect(diskFullIn(new AppError("storage.disk_full", {}))).toBe(true);
  });

  it("recognises either one under a wrapper", () => {
    expect(
      diskFullIn(
        new Error("Failed to run the query 'ROLLBACK'", {
          cause: new AppError("storage.disk_full", {}),
        }),
      ),
    ).toBe(true);
    expect(
      diskFullIn(
        new Error("Failed to run the query 'ROLLBACK'", {
          cause: new Error("wrapped", { cause: driverError(13, "database or disk is full") }),
        }),
      ),
    ).toBe(true);
  });

  it("does not take a neighbouring code for a full disk", () => {
    expect(diskFullIn(driverError(12, "unknown operation"))).toBe(false);
    expect(diskFullIn(driverError(14, "unable to open database file"))).toBe(false);
    expect(diskFullIn(driverError(1, "no such table: t"))).toBe(false);
    expect(diskFullIn(new AppError("shared.invalid_id", { kind: "table", value: "x" }))).toBe(
      false,
    );
    expect(diskFullIn({ code: 13 })).toBe(false);
    expect(diskFullIn({ errcode: "13" })).toBe(false);
  });

  it("stops at the depth bound", () => {
    const chainWithFullDiskAt = (depth: number): unknown => {
      let error: unknown = driverError(13, "database or disk is full");
      for (let level = 0; level < depth; level += 1) error = new Error("wrapped", { cause: error });
      return error;
    };
    expect(diskFullIn(chainWithFullDiskAt(MAX_CAUSE_DEPTH))).toBe(false);
    expect(diskFullIn(chainWithFullDiskAt(MAX_CAUSE_DEPTH - 1))).toBe(true);
  });

  it("stops at a self-referencing error", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(diskFullIn(cyclic)).toBe(false);
  });

  it("answers false for values that are not objects", () => {
    expect(diskFullIn(null)).toBe(false);
    expect(diskFullIn(undefined)).toBe(false);
    expect(diskFullIn("storage.disk_full")).toBe(false);
    expect(diskFullIn(13)).toBe(false);
  });
});
