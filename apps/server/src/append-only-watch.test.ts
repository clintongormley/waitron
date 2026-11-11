import { beforeEach, vi } from "vitest";
import { createJobRunner, type JobRunner } from "./job-runner.js";
import { fakeTimerDelay } from "./testing/fake-timer-delay.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { applyMigrations } from "@waitron/migrations";
import { installAppendOnlyTriggers } from "@waitron/store";
import { missingBeforeMigration, refuseTrading, tamperWatchJob } from "./append-only-watch.js";
import type { Logger, LogLevel } from "./logger.js";
import { withRecoveryLock } from "./recovery-lock.js";
import {
  FRESH,
  readRecoveryState,
  writeRecoveryState,
  type RecoveryState,
} from "./recovery-state.js";

const at = new Date("2026-10-11T10:00:00Z");
const faults = { missing: ["sales_append_only_delete"], altered: ["sales_append_only_update"] };

describe("refuseTrading", () => {
  it("logs the faults, writes the refusal, then stops the process, in that order", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "wt-refuse-"));
    await writeRecoveryState(stateDir, { ...FRESH, failures: 1 });
    const calls: unknown[][] = [];
    await refuseTrading({
      stateDir,
      now: () => at,
      log: (...args) => calls.push(["log", ...args]),
      kill: () => calls.push(["kill"]),
      store: {
        lock: withRecoveryLock,
        read: readRecoveryState,
        write: async (dir: string, state: RecoveryState) => {
          await writeRecoveryState(dir, state);
          calls.push(["write", state]);
        },
      },
    })(faults);
    const refused: RecoveryState = {
      failures: 1,
      level: "recovery",
      lastErrorCode: "append_only.triggers_changed",
      lastFailureAt: at.toISOString(),
      clears: 0,
      refused: true,
      refusedTriggers: faults,
    };
    expect(calls).toEqual([
      ["log", "error", "append_only.triggers_changed", faults],
      ["write", refused],
      ["kill"],
    ]);
    expect(await readRecoveryState(stateDir)).toStrictEqual(refused);
  });

  it("still stops the process when the refusal cannot be written", async () => {
    const calls: unknown[][] = [];
    await refuseTrading({
      stateDir: await mkdtemp(join(tmpdir(), "wt-refuse-")),
      now: () => at,
      log: (...args) => calls.push(["log", ...args]),
      kill: () => calls.push(["kill"]),
      store: {
        lock: (_dir, body) => body(),
        read: () => Promise.resolve(FRESH),
        write: () => Promise.reject(new Error("EROFS")),
      },
    })(faults);
    expect(calls).toEqual([
      ["log", "error", "append_only.triggers_changed", faults],
      ["log", "warn", "recovery.state_write_failed", { errorCode: "unknown" }],
      ["kill"],
    ]);
  });
});

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const UPDATE = "sales_append_only_update";
const DELETE = "sales_append_only_delete";

describe("tamperWatchJob", () => {
  let runner: JobRunner;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    await runner?.stopJobs();
    vi.restoreAllMocks();
    vi.useRealTimers();
    suite.db.run(sql.raw(`drop trigger if exists "${UPDATE}"`));
    suite.db.run(sql.raw(`drop trigger if exists "${DELETE}"`));
    installAppendOnlyTriggers(suite.db, ["sales"]);
  });

  function watch(db: Database = suite.db) {
    const refused: unknown[] = [];
    const lines: { level: LogLevel; event: string; fields?: Record<string, unknown> }[] = [];
    const log: Logger = (level, event, fields) => lines.push({ level, event, fields });
    const read = vi.spyOn(db, "execute");
    runner = createJobRunner({
      now: () => new Date(),
      log: () => {},
      delay: fakeTimerDelay,
      subscribe: () => () => {},
    });
    runner.add(
      tamperWatchJob({
        db,
        tables: ["sales"],
        intervalMs: 10_000,
        refuse: async (faults) => {
          refused.push(faults);
        },
        log,
      }),
    );
    const tick = () => vi.advanceTimersByTimeAsync(10_000);
    return { runner, read, refused, lines, tick };
  }

  it("keeps trading over three ticks of an untouched box, first reading one interval after start", async () => {
    const w = watch();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(w.read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await w.tick();
    await w.tick();
    expect(w.refused).toEqual([]);
    expect(w.read).toHaveBeenCalledTimes(3);
    expect(w.lines).toEqual([]);
  });

  it("refuses once, and arms no further tick, when a trigger is dropped", async () => {
    suite.db.run(sql.raw(`drop trigger "${UPDATE}"`));
    const w = watch();
    await w.tick();
    expect(w.refused).toEqual([{ missing: [UPDATE], altered: [] }]);
    await w.tick();
    expect(w.read).toHaveBeenCalledTimes(1);
    expect(w.runner.views()["fiscal.tamper_watch"]?.state).toBe("stopped");
  });

  it("finds the triggers restored after a case that tampered with them", async () => {
    const w = watch();
    await w.tick();
    expect(w.refused).toEqual([]);
  });

  it("refuses once with the trigger altered when it is replaced", async () => {
    suite.db.run(sql.raw(`drop trigger "${UPDATE}"`));
    suite.db.run(
      sql.raw(`create trigger "${UPDATE}" before update on "sales" begin select 1; end`),
    );
    const w = watch();
    await w.tick();
    expect(w.refused).toEqual([{ missing: [], altered: [UPDATE] }]);
    await w.tick();
    expect(w.read).toHaveBeenCalledTimes(1);
  });

  it("stopJobs cancels the armed check, and time passing afterwards does nothing", async () => {
    suite.db.run(sql.raw(`drop trigger "${UPDATE}"`));
    const w = watch();
    const stopping = w.runner.stopJobs();
    await w.tick();
    expect(w.refused).toEqual([]);
    expect(w.read).not.toHaveBeenCalled();
    await stopping;
  });

  it("logs a read that throws and checks again next interval, never refusing for it", async () => {
    const broken = {
      execute: () => {
        throw new Error("SQLITE_IOERR");
      },
    } as unknown as Database;
    const w = watch(broken);
    await w.tick();
    expect(w.refused).toEqual([]);
    expect(w.lines).toEqual([
      { level: "warn", event: "append_only.check_failed", fields: { errorCode: "unknown" } },
    ]);
    await w.tick();
    expect(w.read).toHaveBeenCalledTimes(2);
  });
});

describe("missingBeforeMigration", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  /** A fresh folder, migrated with the core set unless `migrate` is false. */
  async function venueDir(migrate = true): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "wt-before-migration-"));
    dirs.push(dir);
    if (migrate) await applyMigrations(dir, [CORE_MIGRATIONS]);
    return dir;
  }

  it("reports nothing for a folder with no tables yet", async () => {
    expect(await missingBeforeMigration(await venueDir(false), ["sales"])).toEqual([]);
  });

  it("reports nothing for a migrated folder whose triggers are intact", async () => {
    expect(await missingBeforeMigration(await venueDir(), ["sales"])).toEqual([]);
  });

  it("names a trigger dropped from a table that exists", async () => {
    const dir = await venueDir();
    const raw = new DatabaseSync(join(dir, "venue.db"), { timeout: 5000 });
    try {
      raw.exec(`drop trigger "${DELETE}"`);
    } finally {
      raw.close();
    }
    expect(await missingBeforeMigration(dir, ["sales"])).toEqual([DELETE]);
  });
});
