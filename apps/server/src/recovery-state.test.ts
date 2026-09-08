// apps/server/src/recovery-state.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRESH,
  afterFailure,
  levelFor,
  readRecoveryState,
  writeRecoveryState,
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
});
