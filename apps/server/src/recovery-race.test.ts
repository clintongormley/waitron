import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FRESH,
  readRecoveryState,
  writeRecoveryState,
  type RecoveryState,
} from "./recovery-state.js";

// Real processes, each running this package's own `updateRecoveryState` and `withRecoveryLock`
// through tsx. Every race is forced rather than hoped for: the first process holds its read open
// for `HOLD_MS` and drops a marker file, and the second starts its write when it sees the marker.
// Each case but the undo-after-clear one runs twice: with the lock the write survives, and with the
// lock held around the write alone (`NO_LOCK=1`: the read-to-write span unlocked) the same schedule
// loses a write — another start's counted failure, or the running server's clear — which is what
// shows it races at all. The control still locks the write itself, so two writers never share
// `recovery.json.tmp` (`fs-atomic.ts`), whose clash is a crash rather than a lost write.

const HOLD_MS = 1_000;
/** Each child's own bound. Import (~1 s), the barrier and one `HOLD_MS` fit well inside it. */
const CHILD_DEADLINE_MS = 20_000;
const TEST_TIMEOUT_MS = 60_000;

const moduleUrl = (name: string) =>
  JSON.stringify(pathToFileURL(join(import.meta.dirname, name)).href);

const CHILD = `import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const state = await import(${moduleUrl("recovery-state.ts")});
const { withRecoveryLock } = await import(${moduleUrl("recovery-lock.ts")});
const [dir, role, id] = process.argv.slice(1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mark = (name) => writeFileSync(join(dir, name), "");
const waitFor = async (name) => { while (!existsSync(join(dir, name))) await sleep(5); };
const writeOnly = process.env.NO_LOCK === "1";
const store = {
  lock: writeOnly ? (_dir, body) => body() : withRecoveryLock,
  read: state.readRecoveryState,
  write: writeOnly
    ? (d, s) => withRecoveryLock(d, () => state.writeRecoveryState(d, s))
    : state.writeRecoveryState,
};
const holdingRead = (marker) => ({
  ...store,
  read: async (d) => { const s = await state.readRecoveryState(d); mark(marker); await sleep(${HOLD_MS}); return s; },
});
const count = (s) => state.afterFailure(s, "server.boot_incomplete", new Date());
mark("ready-" + id);
await waitFor("go");
switch (role) {
  case "refused": {
    const { before, after } = await state.updateRecoveryState(holdingRead("refused-reading"), dir, count);
    await waitFor("counted-done");
    await state.updateRecoveryState(store, dir, (s) => state.withoutAttempt(s, before, after));
    break;
  }
  case "counted": {
    await waitFor("refused-reading");
    await state.updateRecoveryState(store, dir, count);
    mark("counted-done");
    break;
  }
  case "undoing": {
    const { before, after } = await state.updateRecoveryState(store, dir, count);
    await state.updateRecoveryState(holdingRead("undoing-reading"), dir, (s) => state.withoutAttempt(s, before, after));
    break;
  }
  case "clearing": {
    await waitFor("undoing-reading");
    await state.updateRecoveryState(store, dir, state.cleared);
    break;
  }
  case "undone-after-clear": {
    const { before, after } = await state.updateRecoveryState(store, dir, count);
    mark("a-counted");
    await waitFor("c-counted");
    await state.updateRecoveryState(store, dir, (s) => state.withoutAttempt(s, before, after));
    mark("a-undone");
    break;
  }
  case "clearing-after-count": {
    await waitFor("a-counted");
    await state.updateRecoveryState(store, dir, state.cleared);
    mark("cleared");
    break;
  }
  case "failing-after-undo": {
    await waitFor("cleared");
    await state.updateRecoveryState(store, dir, count);
    mark("c-counted");
    await waitFor("a-undone");
    await state.updateRecoveryState(store, dir, (s) => state.withFailureCode(s, "migrations.set_missing", new Date()));
    break;
  }
  case "many": {
    // A short hold between read and write, so the four processes' reads overlap when unlocked.
    const briefly = { ...store, read: async (d) => { const s = await state.readRecoveryState(d); await sleep(10); return s; } };
    for (let i = 0; i < 25; i += 1) await state.updateRecoveryState(briefly, dir, count);
    break;
  }
}
process.stdout.write("done");
`;

const children: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Outcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

function startChild(dir: string, role: string, id: number, noLock: boolean): Promise<Outcome> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      "--input-type=module",
      "-e",
      CHILD,
      dir,
      role,
      String(id),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_LOCK: noLock ? "1" : "0" },
    },
  );
  children.push(child);
  const deadline = setTimeout(() => child.kill("SIGTERM"), CHILD_DEADLINE_MS);
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(deadline);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Starts one child per role, releases them together once every one has loaded, and waits. */
async function race(
  initial: RecoveryState,
  roles: string[],
  noLock: boolean,
): Promise<{ final: RecoveryState; outcomes: Outcome[] }> {
  const dir = await mkdtemp(join(tmpdir(), "wt-recrace-"));
  dirs.push(dir);
  await writeRecoveryState(dir, initial);
  const running = roles.map((role, id) => startChild(dir, role, id, noLock));
  const ready = async () => {
    while (!roles.every((_role, id) => existsSync(join(dir, `ready-${id}`)))) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  await Promise.race([
    ready(),
    Promise.all(running).then(() => {
      throw new Error("a child exited before the barrier");
    }),
  ]);
  writeFileSync(join(dir, "go"), "");
  const outcomes = await Promise.all(running);
  return { final: await readRecoveryState(dir), outcomes };
}

const oneFailure: RecoveryState = {
  failures: 1,
  level: "normal",
  lastErrorCode: "migrations.set_missing",
  lastFailureAt: "2026-09-20T10:00:00.000Z",
  clears: 0,
};

const finishedCleanly = (outcomes: Outcome[]) =>
  outcomes.map((outcome) => ({ code: outcome.code, stdout: outcome.stdout }));

describe("two starts racing on recovery.json", () => {
  it(
    "a refused start's undo keeps the failure another start counted meanwhile",
    async () => {
      const locked = await race(oneFailure, ["refused", "counted"], false);
      expect(finishedCleanly(locked.outcomes)).toEqual([
        { code: 0, stdout: "done" },
        { code: 0, stdout: "done" },
      ]);
      // One failure before, the refused start's taken back, the other start's kept.
      expect(locked.final.failures).toBe(2);

      const unlocked = await race(oneFailure, ["refused", "counted"], true);
      expect(finishedCleanly(unlocked.outcomes)).toEqual([
        { code: 0, stdout: "done" },
        { code: 0, stdout: "done" },
      ]);
      expect(unlocked.final).toStrictEqual(oneFailure);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a refused start's undo keeps a clear the running server made meanwhile",
    async () => {
      const locked = await race(oneFailure, ["undoing", "clearing"], false);
      expect(finishedCleanly(locked.outcomes)).toEqual([
        { code: 0, stdout: "done" },
        { code: 0, stdout: "done" },
      ]);
      expect(locked.final).toStrictEqual({ ...FRESH, clears: 1 });

      const unlocked = await race(oneFailure, ["undoing", "clearing"], true);
      expect(unlocked.final).toStrictEqual(oneFailure);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a refused start's undo after a clear leaves the failure a later start counted",
    async () => {
      // A counts, the running server clears, C counts, A is refused and undoes, C then fails for
      // real. The clear already removed A's count, so A's undo must take nothing off C's.
      const { final, outcomes } = await race(
        oneFailure,
        ["undone-after-clear", "clearing-after-count", "failing-after-undo"],
        false,
      );
      expect(finishedCleanly(outcomes)).toEqual([
        { code: 0, stdout: "done" },
        { code: 0, stdout: "done" },
        { code: 0, stdout: "done" },
      ]);
      expect(final).toMatchObject({ failures: 1, lastErrorCode: "migrations.set_missing" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "four starts counting 25 failures each lose none of the hundred",
    async () => {
      const four = ["many", "many", "many", "many"];
      const locked = await race(FRESH, four, false);
      expect(locked.outcomes.map((outcome) => outcome.stderr)).toEqual(["", "", "", ""]);
      expect(locked.final.failures).toBe(100);

      // Every process finishes cleanly and the count still falls short: counts were lost, not
      // processes.
      const unlocked = await race(FRESH, four, true);
      expect(finishedCleanly(unlocked.outcomes)).toEqual(
        four.map(() => ({ code: 0, stdout: "done" })),
      );
      expect(unlocked.final.failures).toBeLessThan(100);
    },
    TEST_TIMEOUT_MS,
  );
});
