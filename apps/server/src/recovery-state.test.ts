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
  refusedWhileRunning,
  stayedUpClear,
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

describe("a refusal while running", () => {
  const at = new Date("2026-10-11T10:00:00Z");
  const code = "append_only.triggers_changed";
  const once = afterFailure(FRESH, "x", new Date("2026-10-10T10:00:00Z"));
  const triggers = { missing: ["sales_append_only_delete"], altered: ["sales_append_only_update"] };
  const refused = refusedWhileRunning(once, code, at, triggers);

  it("keeps the count, records the code and time, and is at recovery", () => {
    expect(refused).toStrictEqual({
      failures: 1,
      level: "recovery",
      lastErrorCode: code,
      lastFailureAt: at.toISOString(),
      clears: 0,
      refused: true,
      refusedTriggers: triggers,
    });
  });

  it("replaces the trigger names a refusal recorded before", () => {
    const again = refusedWhileRunning(refused, code, at, { missing: ["x"], altered: [] });
    expect(again.refusedTriggers).toStrictEqual({ missing: ["x"], altered: [] });
  });

  it.each([
    ["no refusal", { failures: 1, refusedTriggers: { missing: ["a"], altered: [] } }],
    [
      "a member that is not a list",
      { failures: 1, refused: true, refusedTriggers: { missing: "a", altered: [] } },
    ],
    [
      "a member holding a non-string",
      { failures: 1, refused: true, refusedTriggers: { missing: [], altered: [1] } },
    ],
    ["a missing member", { failures: 1, refused: true, refusedTriggers: { missing: [] } }],
    ["names that are not an object", { failures: 1, refused: true, refusedTriggers: null }],
  ])("reads back no trigger names for %s", async (_what, file) => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    await writeFile(join(dir, "recovery.json"), JSON.stringify(file));
    expect((await readRecoveryState(dir)).refusedTriggers).toBeUndefined();
  });

  it("reads back only the two lists of names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    await writeFile(
      join(dir, "recovery.json"),
      JSON.stringify({ ...refused, refusedTriggers: { ...triggers, extra: "<b>" } }),
    );
    expect((await readRecoveryState(dir)).refusedTriggers).toStrictEqual(triggers);
  });

  it("is read back refused, at recovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    await writeRecoveryState(dir, refused);
    const read = await readRecoveryState(dir);
    expect(read.level).toBe("recovery");
    expect(read).toStrictEqual(refused);
  });

  it("reads a flag that is not exactly true as not refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-rec-"));
    await writeFile(join(dir, "recovery.json"), JSON.stringify({ failures: 1, refused: "yes" }));
    expect(await readRecoveryState(dir)).toStrictEqual({ ...FRESH, failures: 1 });
  });

  it("is dropped by a clear", () => {
    expect(cleared(refused)).toStrictEqual({ ...FRESH, clears: 1 });
  });

  it("stays at recovery when an attempt takes its failure back", () => {
    const wrote = afterFailure(once, "server.boot_incomplete", at);
    const later = refusedWhileRunning(wrote, code, at, triggers);
    expect(withoutAttempt(later, once, wrote)).toStrictEqual({
      ...later,
      failures: 1,
      level: "recovery",
    });
  });

  it("treats a refusal as a change since the attempt, even with every other field the same", () => {
    const wrote = afterFailure(once, "server.boot_incomplete", at);
    const flagged: RecoveryState = { ...wrote, refused: true };
    expect(withoutAttempt(flagged, once, wrote)).toStrictEqual({
      ...flagged,
      failures: 1,
      level: "recovery",
    });
  });

  it("treats different trigger names as a change since the attempt", () => {
    const wrote = refusedWhileRunning(once, code, at, triggers);
    const changed = refusedWhileRunning(once, code, at, { missing: [], altered: ["other"] });
    expect(withoutAttempt(changed, once, wrote)).toStrictEqual({
      ...changed,
      failures: 0,
      level: "recovery",
    });
  });

  it("is kept by the stayed-up clear, which still clears an ordinary state", () => {
    expect(stayedUpClear(refused)).toBe(refused);
    expect(stayedUpClear(once)).toStrictEqual(cleared(once));
  });

  it("stands through a later failure and a later failure code, which replace the code", () => {
    const later = new Date("2026-10-11T10:05:00Z");
    expect(afterFailure(refused, "server.boot_incomplete", later)).toStrictEqual({
      failures: 2,
      level: "recovery",
      lastErrorCode: "server.boot_incomplete",
      lastFailureAt: later.toISOString(),
      clears: 0,
      refused: true,
      refusedTriggers: triggers,
    });
    expect(withFailureCode(refused, "provisioning.database_in_use", later)).toStrictEqual({
      failures: 1,
      level: "recovery",
      lastErrorCode: "provisioning.database_in_use",
      lastFailureAt: later.toISOString(),
      clears: 0,
      refused: true,
      refusedTriggers: triggers,
    });
  });
});
