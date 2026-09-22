import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { UNREACHABLE_RESULT_CODES, classifyBootFailure } from "./boot-failure.js";

/** The shape drizzle produces: the driver's error one level down under `cause`. */
function wrapped(errcode: number): Error {
  return new Error("Failed query", { cause: Object.assign(new Error("driver"), { errcode }) });
}

/**
 * A REAL failure from the engine the box runs, never a hand-built stand-in: these cases are the
 * whole reason the classifier was rewritten, so a synthetic error carrying a number I chose would
 * prove exactly nothing about what a box produces.
 */
function realSqliteError(build: (dir: string) => void): unknown {
  const dir = mkdtempSync(join(tmpdir(), "boot-failure-"));
  try {
    build(dir);
    throw new Error("the probe did not fail — this case is measuring nothing");
  } catch (error) {
    return error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("classifyBootFailure on the engine the box runs", () => {
  it("names a database file it cannot open as an unreachable database", () => {
    const error = realSqliteError((dir) => {
      new DatabaseSync(join(dir, "missing", "venue.db"), { readOnly: true });
    });
    expect(classifyBootFailure(error)).toBe("provisioning.database_unreachable");
  });

  it("names a missing table as a schema mismatch", () => {
    const error = realSqliteError((dir) => {
      const db = new DatabaseSync(join(dir, "venue.db"));
      db.exec("select * from tenants");
    });
    expect(classifyBootFailure(error)).toBe("provisioning.schema_mismatch");
  });

  it("names a missing column as a schema mismatch", () => {
    const error = realSqliteError((dir) => {
      const db = new DatabaseSync(join(dir, "venue.db"));
      db.exec("create table tenants (id integer primary key)");
      db.exec("select legal_name from tenants");
    });
    expect(classifyBootFailure(error)).toBe("provisioning.schema_mismatch");
  });

  // The control in the other direction, and the reason the missing-table branch reads the MESSAGE
  // rather than the result code: an ordinary mistake in a query arrives with the SAME errcode 1.
  // Classifying on the number alone would send an operator to restore a healthy database over a
  // typo.
  it("leaves an ordinary SQL error unknown, though it carries the same result code", () => {
    const error = realSqliteError((dir) => {
      const db = new DatabaseSync(join(dir, "venue.db"));
      db.exec("select from where");
    });
    expect(classifyBootFailure(error)).toBe("unknown");
  });

  // Wrapped one level down, the shape drizzle produces.
  it("reads the engine's failure through a wrapper", () => {
    const inner = realSqliteError((dir) => {
      const db = new DatabaseSync(join(dir, "venue.db"));
      db.exec("select * from tenants");
    });
    expect(classifyBootFailure(new Error("Failed query", { cause: inner }))).toBe(
      "provisioning.schema_mismatch",
    );
  });
});

describe("classifyBootFailure", () => {
  it("keeps an AppError's own code — the existing classification is unchanged", () => {
    expect(classifyBootFailure(new AppError("server.config_missing", { variable: "X" }))).toBe(
      "server.config_missing",
    );
  });

  it("names every pinned result code as an unreachable database", () => {
    // Walks the pinned list, so a code added to the table without a mapping fails here. The list is
    // the only synthetic part of this file: the case above drives a REAL `unable to open database
    // file` through the same branch.
    for (const errcode of UNREACHABLE_RESULT_CODES) {
      expect(classifyBootFailure(Object.assign(new Error("sqlite"), { errcode }))).toBe(
        "provisioning.database_unreachable",
      );
      expect(classifyBootFailure(wrapped(errcode))).toBe("provisioning.database_unreachable");
    }
  });

  // A socket failure was classified as an unreachable database while the database was a cluster
  // this process dialled. It is a file now, so nothing the database does can be refused by a socket,
  // and this pins that the old mapping is gone rather than merely unused: a boot failure from
  // somewhere else on the path must not tell the operator to go and check the database.
  it("does not treat a refused connection as a database failure", () => {
    expect(classifyBootFailure(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe(
      "unknown",
    );
  });

  it("leaves a TypeError unknown", () => {
    expect(classifyBootFailure(new TypeError("x is not a function"))).toBe("unknown");
  });

  // The negative control the spec requires, in the shape this engine gives it: a Node error carries
  // a string `code` and no `errcode` at all, so nothing about it can reach a database classification.
  it("does not treat EPIPE as a database error", () => {
    expect(classifyBootFailure(Object.assign(new Error("write"), { code: "EPIPE" }))).toBe(
      "unknown",
    );
  });

  /**
   * The same case this file used to make against PostgreSQL's `22P02`, in this engine's terms: a
   * refusal is not evidence of a missing schema, and this code's operator action is "restore from a
   * backup, or reinstall". A real unique-index refusal is the nearest thing a boot-time write can
   * produce, and it must stay `unknown` — `unknown` is honest here, and the installer's channel
   * carries the driver's own message beside it.
   */
  it("leaves a real constraint refusal unknown — it is not evidence of a schema mismatch", () => {
    const refusal = realSqliteError((dir) => {
      const db = new DatabaseSync(join(dir, "venue.db"));
      db.exec("create table tenants (id integer primary key)");
      db.exec("insert into tenants values (1)");
      db.exec("insert into tenants values (1)");
    });
    expect(classifyBootFailure(refusal)).toBe("unknown");
  });

  it("classifies a non-error value as unknown rather than throwing", () => {
    expect(classifyBootFailure("boom")).toBe("unknown");
    expect(classifyBootFailure(undefined)).toBe("unknown");
  });

  // The walk-depth bound and the self-reference exit are `firstCodeInCauseChain`'s, pinned once in
  // `packages/shared/src/cause-chain.test.ts`. Both classification branches reach them through it.

  // What the disjointness case that stood here guarded is now structural: there is one list of
  // result codes and the schema branch is a message pattern, so the two cannot overlap by a code
  // appearing in both. The pair that CAN still disagree is this file's list and
  // `dev-migration-hint.ts`'s, which its own suite checks.
});
