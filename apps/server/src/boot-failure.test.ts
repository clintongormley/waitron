import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AppError, MAX_CAUSE_DEPTH, sqliteFailureOf } from "@waitron/shared";
import {
  UNREACHABLE_RESULT_CODES,
  classifyBootFailure,
  classifyStartFailure,
  fullDiskFailure,
  startFailureCode,
} from "./boot-failure.js";

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

  it("leaves a venue file that is not a database unknown", () => {
    const error = realSqliteError((dir) => {
      const file = join(dir, "venue.db");
      writeFileSync(file, "these bytes are not a database");
      new DatabaseSync(file).exec("select * from tenants");
    });
    expect(sqliteFailureOf(error)?.errcode).toBe(26);
    expect(classifyBootFailure(error)).toBe("unknown");
  });

  it("leaves an ordinary SQL error unknown, though it carries the same result code", () => {
    const error = realSqliteError((dir) => {
      const db = new DatabaseSync(join(dir, "venue.db"));
      db.exec("select from where");
    });
    expect(classifyBootFailure(error)).toBe("unknown");
  });

  it("names a database at its page limit as a full disk", () => {
    const error = realSqliteError((dir) => {
      const db = new DatabaseSync(join(dir, "venue.db"));
      db.exec("create table filler (data blob)");
      const { page_count } = db.prepare("pragma page_count").get() as { page_count: number };
      db.exec(`pragma max_page_count = ${page_count + 2}`);
      db.exec("insert into filler values (zeroblob(65536))");
    });
    expect(sqliteFailureOf(error)?.errcode).toBe(13);
    expect(classifyBootFailure(error)).toBe("storage.disk_full");
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

  it("names a full disk under a wrapper", () => {
    expect(
      classifyBootFailure(
        new Error("Failed to run the query 'ROLLBACK'", {
          cause: new AppError("storage.disk_full", {}),
        }),
      ),
    ).toBe("storage.disk_full");
  });

  it("names a full disk before the migration failure that wraps it", () => {
    const failed = (cause: Error) =>
      Object.assign(new AppError("migrations.apply_failed", { set: "__drizzle_migrations" }), {
        cause,
      });
    expect(
      classifyBootFailure(
        failed(Object.assign(new Error("database or disk is full"), { errcode: 13 })),
      ),
    ).toBe("storage.disk_full");
    expect(
      classifyBootFailure(failed(Object.assign(new Error("no such table: t"), { errcode: 1 }))),
    ).toBe("migrations.apply_failed");
  });

  it("pins the unreachable-database codes to SQLITE_CANTOPEN alone", () => {
    expect(UNREACHABLE_RESULT_CODES).toEqual([14]);
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

const MIB = 1024 * 1024;

function missingFolderError(): unknown {
  return realSqliteError((dir) => {
    new DatabaseSync(join(dir, "missing", "venue.db"), { readOnly: true });
  });
}

function engineError(errcode: number, message: string): Error {
  return Object.assign(new Error(message), { errcode, code: "ERR_SQLITE_ERROR" });
}

/** The engine error a nearly full disk raised at start, measured on HFS+, APFS and Linux on 2026-10-21. */
function diskIoError(): Error {
  return engineError(4874, "disk I/O error");
}

describe("fullDiskFailure", () => {
  it("takes the engine's own full-disk code whatever the free space", () => {
    expect(fullDiskFailure(engineError(13, "database or disk is full"), 1_000_000_000)).toBe(true);
    expect(fullDiskFailure(new AppError("storage.disk_full", {}), null)).toBe(true);
  });

  it("takes 14, the I/O family and ENOSPC only under 16 MiB", () => {
    const missing = missingFolderError();
    expect(sqliteFailureOf(missing)?.errcode).toBe(14);
    expect(fullDiskFailure(missing, 16_777_215)).toBe(true);
    expect(fullDiskFailure(missing, 16_777_216)).toBe(false);

    const io = new Error("Failed query", { cause: diskIoError() });
    expect(fullDiskFailure(io, 0)).toBe(true);
    expect(fullDiskFailure(io, 100 * MIB)).toBe(false);

    const enospc = new Error("start", {
      cause: new Error("open", {
        cause: Object.assign(new Error("ENOSPC: no space left on device, open"), {
          code: "ENOSPC",
        }),
      }),
    });
    expect(fullDiskFailure(enospc, 0)).toBe(true);
    expect(fullDiskFailure(enospc, null)).toBe(false);
  });

  it("does not take a permission refusal or a busy lock for a full disk", () => {
    expect(fullDiskFailure(engineError(1544, "attempt to write a readonly database"), 0)).toBe(
      false,
    );
    expect(fullDiskFailure(Object.assign(new Error("open"), { code: "EACCES" }), 0)).toBe(false);
    expect(fullDiskFailure(engineError(5, "database is locked"), 0)).toBe(false);
    expect(fullDiskFailure(engineError(26, "file is not a database"), 0)).toBe(false);
  });

  it("does not look for ENOSPC past the cause-chain depth limit", () => {
    const chainWithEnospcAt = (depth: number): Error => {
      let error: Error = Object.assign(new Error("ENOSPC: no space left on device"), {
        code: "ENOSPC",
      });
      for (let i = 0; i < depth; i += 1) error = new Error(`layer ${i}`, { cause: error });
      return error;
    };
    expect(fullDiskFailure(chainWithEnospcAt(MAX_CAUSE_DEPTH - 1), 0)).toBe(true);
    expect(fullDiskFailure(chainWithEnospcAt(MAX_CAUSE_DEPTH), 0)).toBe(false);
  });

  it("returns false on a self-referencing cause", () => {
    const looped = new Error("loop");
    (looped as { cause?: unknown }).cause = looped;
    expect(fullDiskFailure(looped, 0)).toBe(false);
  });
});

describe("classifyStartFailure", () => {
  it("names a missing folder by its own code when there is room", () => {
    const missing = missingFolderError();
    expect(classifyStartFailure(missing, 100 * MIB)).toBe("provisioning.database_unreachable");
    expect(classifyStartFailure(missing, null)).toBe("provisioning.database_unreachable");
  });

  it("names a database refused on a nearly full disk a full disk", () => {
    expect(classifyStartFailure(missingFolderError(), 4096)).toBe("storage.disk_full");
    expect(classifyStartFailure(diskIoError(), 8192)).toBe("storage.disk_full");
    expect(classifyStartFailure(diskIoError(), 100 * MIB)).toBe("unknown");
  });

  it("leaves every other failure as it was", () => {
    const noTable = realSqliteError((dir) => {
      const db = new DatabaseSync(join(dir, "venue.db"));
      db.exec("select * from tenants");
    });
    expect(classifyStartFailure(noTable, 0)).toBe("provisioning.schema_mismatch");
    const migration = Object.assign(
      new AppError("migrations.apply_failed", { set: "__drizzle_migrations" }),
      { cause: diskIoError() },
    );
    expect(classifyStartFailure(migration, 0)).toBe("migrations.apply_failed");
    expect(classifyStartFailure(new Error("boom"), 0)).toBe("unknown");
  });

  it("keeps a full disk the engine already named", () => {
    expect(classifyStartFailure(engineError(13, "database or disk is full"), 1_000_000_000)).toBe(
      "storage.disk_full",
    );
  });
});

describe("startFailureCode", () => {
  it("reads the free space of the lowest folder", async () => {
    const roomy = "/roomy";
    const full = "/full";
    const statfs = (lowFor: string | null) => (path: string) =>
      Promise.resolve({ bavail: path === lowFor ? 4096 : 100 * MIB, frsize: 1 });
    expect(await startFailureCode(diskIoError(), [roomy, full], statfs(full))).toBe(
      "storage.disk_full",
    );
    expect(await startFailureCode(diskIoError(), [roomy, full], statfs(null))).toBe("unknown");
  });
});
