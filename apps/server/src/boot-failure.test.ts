import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { UNREACHABLE_RESULT_CODES, classifyBootFailure } from "./boot-failure.js";

function wrapped(errcode: number): Error {
  return new Error("Failed query", { cause: Object.assign(new Error("driver"), { errcode }) });
}

/** A real engine failure: a hand-built error would carry a number the test chose. */
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

  it("leaves an ordinary SQL error unknown, though it carries the same result code", () => {
    const error = realSqliteError((dir) => {
      const db = new DatabaseSync(join(dir, "venue.db"));
      db.exec("select from where");
    });
    expect(classifyBootFailure(error)).toBe("unknown");
  });

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
    for (const errcode of UNREACHABLE_RESULT_CODES) {
      expect(classifyBootFailure(Object.assign(new Error("sqlite"), { errcode }))).toBe(
        "provisioning.database_unreachable",
      );
      expect(classifyBootFailure(wrapped(errcode))).toBe("provisioning.database_unreachable");
    }
  });

  it("does not treat a refused connection as a database failure", () => {
    expect(classifyBootFailure(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe(
      "unknown",
    );
  });

  it("leaves a TypeError unknown", () => {
    expect(classifyBootFailure(new TypeError("x is not a function"))).toBe("unknown");
  });

  it("does not treat EPIPE as a database error", () => {
    expect(classifyBootFailure(Object.assign(new Error("write"), { code: "EPIPE" }))).toBe(
      "unknown",
    );
  });

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
});
