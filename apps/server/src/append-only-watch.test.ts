import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refuseTrading } from "./append-only-watch.js";
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
