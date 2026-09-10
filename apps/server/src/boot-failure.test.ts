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

  /**
   * `22P02` was in the schema-mismatch table (spec §4.1 lists it) and was removed after it was RUN.
   * On real PostgreSQL 18 the same SQLSTATE comes from two unrelated causes:
   *
   *   select 'not-a-uuid'::uuid  →  22P02: invalid input syntax for type uuid: "not-a-uuid"
   *   create type t as enum ('a'); select 'b'::t  →  22P02: invalid input value for enum t: "b"
   *
   * Only the second is a schema mismatch. The first is a malformed VALUE, and this repository is
   * full of it — a non-uuid path parameter reaching a `uuid` column is the case dozens of route
   * guards exist to screen. Classifying it as `provisioning.schema_mismatch` gives the operator
   * "restore from a backup, or reinstall", which would destroy a perfectly good database over a bad
   * boot-time value. `unknown` is honest, and no longer a shrug: the installer's channel now carries
   * the driver's own message (finding 3), which distinguishes the two in one line.
   */
  it("leaves a malformed value's 22P02 unknown — it is not evidence of a schema mismatch", () => {
    const malformed = Object.assign(new Error('invalid input syntax for type uuid: "not-a-uuid"'), {
      code: "22P02",
    });
    expect(classifyBootFailure(malformed)).toBe("unknown");
    expect(SCHEMA_MISMATCH_SQL_STATES).not.toContain("22P02");
    // Control: the four that remain are unambiguously schema-shaped and still classify.
    expect(classifyBootFailure(Object.assign(new Error("pg"), { code: "42P01" }))).toBe(
      "provisioning.schema_mismatch",
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
