import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FRESH,
  afterFailure,
  cleared,
  levelFor,
  readRecoveryState,
  updateRecoveryState,
  withFailureCode,
  withoutAttempt,
  writeRecoveryState,
  type RecoveryState,
} from "./recovery-state.js";

describe("levelFor", () => {
  it("escalates normal → recovery at 3", () => {
    expect(levelFor(0)).toBe("normal");
    expect(levelFor(2)).toBe("normal");
    expect(levelFor(3)).toBe("recovery");
    expect(levelFor(99)).toBe("recovery");
  });
});

describe("afterFailure", () => {
  it("counts up and records the classified code", () => {
    const at = new Date("2026-09-08T10:00:00Z");
    const next = afterFailure(FRESH, "module.config_invalid", at);
    expect(next.failures).toBe(1);
    expect(next.level).toBe("normal");
    expect(next.lastErrorCode).toBe("module.config_invalid");
    expect(next.lastFailureAt).toBe(at.toISOString());
  });

  it("reaches recovery on the third consecutive failure", () => {
    const at = new Date("2026-09-08T10:00:00Z");
    let s = FRESH;
    for (let i = 0; i < 3; i += 1) s = afterFailure(s, "boom", at);
    expect(s.failures).toBe(3);
    expect(s.level).toBe("recovery");
  });
});

describe("readRecoveryState", () => {
  it("is FRESH when the file is absent — an unprovisioned box is not a failing one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    expect(await readRecoveryState(dir)).toEqual(FRESH);
  });

  it("is FRESH when the file is corrupt, rather than throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    await writeRecoveryState(dir, FRESH);
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(join(dir, "recovery.json"), "{ not json"),
    );
    expect(await readRecoveryState(dir)).toEqual(FRESH);
  });

  it("round-trips, and writes 0600", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    const state = afterFailure(FRESH, "boom", new Date("2026-09-08T10:00:00Z"));
    await writeRecoveryState(dir, state);
    expect(await readRecoveryState(dir)).toEqual(state);
    const { mode } = await import("node:fs/promises").then((fs) =>
      fs.stat(join(dir, "recovery.json")),
    );
    expect(mode & 0o777).toBe(0o600);
  });

  it.each([
    ["a negative count", { failures: -2 }],
    ["a count written as text", { failures: "5" }],
  ])("reads %s as no failures", async (_label, stored) => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    await writeFile(join(dir, "recovery.json"), JSON.stringify(stored));
    expect(await readRecoveryState(dir)).toEqual(FRESH);
  });

  it("drops fields of the wrong type and derives the level from the count, not the stored level", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    await writeFile(
      join(dir, "recovery.json"),
      JSON.stringify({
        failures: 1,
        level: "recovery",
        lastErrorCode: 7,
        lastFailureAt: false,
        clears: "2",
      }),
    );
    expect(await readRecoveryState(dir)).toEqual({
      failures: 1,
      level: "normal",
      lastErrorCode: null,
      lastFailureAt: null,
      clears: 0,
    });
  });

  it.each([
    ["no clear count, as a file from before the field existed", {}, 0],
    ["a negative clear count", { clears: -1 }, 0],
    ["a fractional clear count", { clears: 1.5 }, 0],
    ["a clear count", { clears: 4 }, 4],
  ])("reads %s", async (_label, fields, clears) => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    await writeFile(join(dir, "recovery.json"), JSON.stringify({ failures: 2, ...fields }));
    expect(await readRecoveryState(dir)).toMatchObject({ failures: 2, clears });
  });
});

describe("the holder's kind", () => {
  it("round-trips a kind from the closed set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    const state: RecoveryState = {
      ...afterFailure(FRESH, "provisioning.database_holder_stalled", new Date()),
      holderKind: "restore",
    };
    await writeRecoveryState(dir, state);
    expect(await readRecoveryState(dir)).toStrictEqual(state);
  });

  it.each([
    ["a kind outside the set", "sidecar"],
    ["a kind of the wrong type", 3],
  ])("reads %s as no kind at all", async (_label, holderKind) => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    await writeFile(
      join(dir, "recovery.json"),
      JSON.stringify({ failures: 3, lastErrorCode: "x", lastFailureAt: null, holderKind }),
    );
    expect(await readRecoveryState(dir)).toStrictEqual({
      failures: 3,
      level: "recovery",
      lastErrorCode: "x",
      lastFailureAt: null,
      clears: 0,
    });
  });

  it("is dropped by the next failure of any other kind", () => {
    const stalled: RecoveryState = { ...FRESH, failures: 1, holderKind: "server" };
    expect(afterFailure(stalled, "boom", new Date())).not.toHaveProperty("holderKind");
  });
});

describe("cleared", () => {
  it("empties the count and moves the clear count on by one", () => {
    const stalled: RecoveryState = {
      ...afterFailure({ ...FRESH, clears: 4 }, "x", new Date()),
      holderKind: "server",
    };
    expect(cleared(stalled)).toStrictEqual({ ...FRESH, clears: 5 });
  });
});

describe("the clear count", () => {
  it("is carried through a failure and a failure code", () => {
    const counted = afterFailure({ ...FRESH, clears: 2 }, "x", new Date());
    expect(counted.clears).toBe(2);
    expect(withFailureCode(counted, "y", new Date()).clears).toBe(2);
  });
});

describe("withFailureCode", () => {
  const at = new Date("2026-09-24T10:00:00Z");

  it("keeps the count and records the code, the time and the level the count gives", () => {
    const current: RecoveryState = { ...FRESH, failures: 3, holderKind: "rejoin" };
    expect(withFailureCode(current, "migrations.set_missing", at)).toStrictEqual({
      failures: 3,
      level: "recovery",
      lastErrorCode: "migrations.set_missing",
      lastFailureAt: at.toISOString(),
      clears: 0,
    });
  });

  it("records the holder's kind when it is given one", () => {
    expect(
      withFailureCode(
        { ...FRESH, failures: 1 },
        "provisioning.database_holder_stalled",
        at,
        "server",
      ),
    ).toStrictEqual({
      failures: 1,
      level: "normal",
      lastErrorCode: "provisioning.database_holder_stalled",
      lastFailureAt: at.toISOString(),
      clears: 0,
      holderKind: "server",
    });
  });
});

describe("withoutAttempt", () => {
  const before: RecoveryState = {
    failures: 1,
    level: "normal",
    lastErrorCode: "migrations.set_missing",
    lastFailureAt: "2026-09-20T10:00:00.000Z",
    clears: 0,
  };
  const wrote = afterFailure(before, "server.boot_incomplete", new Date("2026-09-24T10:00:00Z"));

  it("puts back the state read before the attempt when nothing else wrote since", () => {
    expect(withoutAttempt({ ...wrote }, before, wrote)).toStrictEqual(before);
  });

  it("takes one failure off, and keeps the rest, when another start recorded one since", () => {
    const another = afterFailure(wrote, "provisioning.database_ahead", new Date());
    expect(withoutAttempt(another, before, wrote)).toStrictEqual({
      ...another,
      failures: 2,
      level: "normal",
    });
  });

  it("keeps a clear the running server made", () => {
    expect(withoutAttempt(cleared(wrote), before, wrote)).toStrictEqual(cleared(wrote));
  });

  it("takes nothing off a failure another start counted after a clear", () => {
    const counted = afterFailure(cleared(wrote), "server.boot_incomplete", new Date());
    expect(counted.failures).toBe(1);
    expect(withoutAttempt(counted, before, wrote)).toStrictEqual(counted);
  });

  it("takes the level down with the count", () => {
    const three = afterFailure(wrote, "x", new Date());
    expect(three.level).toBe("recovery");
    expect(withoutAttempt(three, before, wrote)).toMatchObject({ failures: 2, level: "normal" });
  });

  it("treats a different kind as a different state", () => {
    const withKind: RecoveryState = { ...wrote, holderKind: "script" };
    expect(withoutAttempt(withKind, before, wrote)).toStrictEqual({
      ...withKind,
      failures: 1,
      level: "normal",
    });
  });
});

describe("updateRecoveryState", () => {
  it("reads and writes inside the lock, and returns what it read and wrote", async () => {
    const events: string[] = [];
    const stored: RecoveryState = { ...FRESH, failures: 1 };
    const result = await updateRecoveryState(
      {
        lock: async (stateDir, body) => {
          events.push(`lock ${stateDir}`);
          const value = await body();
          events.push("unlock");
          return value;
        },
        read: (stateDir) => {
          events.push(`read ${stateDir}`);
          return Promise.resolve(stored);
        },
        write: (stateDir, next) => {
          events.push(`write ${stateDir} ${next.failures}`);
          return Promise.resolve();
        },
      },
      "/state",
      (current) => ({ ...current, failures: current.failures + 1 }),
    );
    expect(events).toEqual(["lock /state", "read /state", "write /state 2", "unlock"]);
    expect(result).toEqual({ before: stored, after: { ...FRESH, failures: 2 } });
  });

  it("writes nothing when the change throws", async () => {
    const write = vi.fn(() => Promise.resolve());
    await expect(
      updateRecoveryState(
        { lock: (_dir, body) => body(), read: () => Promise.resolve(FRESH), write },
        "/state",
        () => {
          throw new Error("no");
        },
      ),
    ).rejects.toThrow("no");
    expect(write).not.toHaveBeenCalled();
  });
});
