import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import {
  SCHEMA_MISMATCH_SQL_STATES,
  UNREACHABLE_SOCKET_CODES,
  UNREACHABLE_SQL_STATES,
  classifyBootFailure,
} from "./boot-failure.js";

/** The shape drizzle produces: the driver's error one level down under `cause`. */
function wrapped(code: string): Error {
  return new Error("Failed query", { cause: Object.assign(new Error("driver"), { code }) });
}

describe("classifyBootFailure", () => {
  it("keeps an AppError's own code — the existing classification is unchanged", () => {
    expect(classifyBootFailure(new AppError("server.config_missing", { variable: "X" }))).toBe(
      "server.config_missing",
    );
  });

  it("names every pinned socket code as an unreachable database", () => {
    // Walks the pinned list: a code added to the table without a mapping fails here.
    for (const code of UNREACHABLE_SOCKET_CODES) {
      expect(classifyBootFailure(Object.assign(new Error("connect"), { code }))).toBe(
        "provisioning.database_unreachable",
      );
      expect(classifyBootFailure(wrapped(code))).toBe("provisioning.database_unreachable");
    }
  });

  it("names every pinned connection SQLSTATE as an unreachable database", () => {
    for (const state of UNREACHABLE_SQL_STATES) {
      expect(classifyBootFailure(Object.assign(new Error("pg"), { code: state }))).toBe(
        "provisioning.database_unreachable",
      );
      expect(classifyBootFailure(wrapped(state))).toBe("provisioning.database_unreachable");
    }
  });

  it("names every pinned schema SQLSTATE as a schema mismatch", () => {
    for (const state of SCHEMA_MISMATCH_SQL_STATES) {
      expect(classifyBootFailure(Object.assign(new Error("pg"), { code: state }))).toBe(
        "provisioning.schema_mismatch",
      );
      expect(classifyBootFailure(wrapped(state))).toBe("provisioning.schema_mismatch");
    }
  });

  it("leaves a TypeError unknown", () => {
    expect(classifyBootFailure(new TypeError("x is not a function"))).toBe("unknown");
  });

  // The negative control the spec requires. `EPIPE` is five upper-case characters, so it passes
  // `sqlStateOf`'s SHAPE filter and arrives looking exactly like a SQLSTATE. It is not one, and it
  // must not be classified as a database failure — the tables are membership lists, not patterns.
  it("does not treat EPIPE as a database error, though it passes the SQLSTATE shape filter", () => {
    expect(classifyBootFailure(Object.assign(new Error("write"), { code: "EPIPE" }))).toBe(
      "unknown",
    );
  });

  it("classifies a non-error value as unknown rather than throwing", () => {
    expect(classifyBootFailure("boom")).toBe("unknown");
    expect(classifyBootFailure(undefined)).toBe("unknown");
  });

  // The same two guards `sql-state.test.ts` pins on its own walk, for the same reason: each is a
  // branch that only a deliberately adversarial input reaches.
  it("stops at the walk-depth bound rather than spinning down an unbounded chain", () => {
    let deep: Error = Object.assign(new Error("bottom"), { code: "ECONNREFUSED" });
    for (let i = 0; i < 8; i += 1) deep = new Error("wrap", { cause: deep });
    expect(classifyBootFailure(deep)).toBe("unknown");
  });

  it("stops rather than spinning on a self-referential cause", () => {
    const looped: { cause?: unknown } = new Error("loop");
    looped.cause = looped;
    expect(classifyBootFailure(looped)).toBe("unknown");
  });

  it("keeps the two SQLSTATE tables disjoint", () => {
    const overlap = UNREACHABLE_SQL_STATES.filter((state) =>
      SCHEMA_MISMATCH_SQL_STATES.includes(state),
    );
    expect(overlap).toEqual([]);
  });
});
