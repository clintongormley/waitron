// Imports only Node's own modules: the exit-sweep case loads this file in a plain Node process,
// which does not map `.js` specifiers onto `.ts` files.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * A process's command line, arguments joined by spaces, or null when it is not running or cannot be
 * read: Linux's `/proc/<pid>/cmdline`, else `ps` (macOS). Confirms a PID is still the Litestream it
 * was recorded for before anything signals it.
 */
export async function readCommandLine(pid: number): Promise<string | null> {
  try {
    return (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").join(" ").trim();
  } catch {
    try {
      const { stdout } = await execFileAsync("ps", ["-o", "command=", "-p", String(pid)]);
      return stdout.trim();
    } catch {
      return null;
    }
  }
}

/** One running Litestream, as the supervisor sees it. */
export interface ChildHandle {
  readonly pid: number | undefined;
  /** Settles with the exit code; null when it was killed by a signal or never started. */
  readonly exited: Promise<number | null>;
  /** Asks politely (SIGTERM, which lets Litestream flush), then insists (SIGKILL) after the grace. */
  kill(): void;
  /** The last few thousand characters of its stdout and stderr together. */
  output(): string;
}

export type SpawnFn = (
  bin: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
) => ChildHandle;

const KILL_GRACE_MS = 5_000;

/** Litestream logs to stdout unless told otherwise, so both streams are kept. */
const OUTPUT_KEEP = 8_192;

/**
 * Children still running, sent SIGTERM when this process EXITS (`process.exit`, or the event loop
 * emptying). A process killed by a signal it has no handler for never emits `exit`, so its
 * children are not stopped here.
 */
const live = new Set<ChildProcess>();
process.on("exit", () => {
  for (const child of live) child.kill("SIGTERM");
});

/**
 * Starts `bin` with `args`, giving it `PATH`, `HOME` and `env` — never the rest of this process's
 * environment, which holds the vault key.
 *
 * `exited` is settled by the SIGKILL escalation as well as by `close`: `close` fires when the output
 * pipes close, and a killed child whose own children hold them never produces it
 * (`bench/sqlite-failover/src/litestream.ts`, on `run`).
 */
export function spawnLitestream(
  bin: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  killGraceMs = KILL_GRACE_MS,
): ChildHandle {
  // Node leaves out a variable whose value is undefined, rather than passing the text "undefined".
  const child = spawn(bin, [...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  live.add(child);
  let output = "";
  const collect = (chunk: Buffer | string) => {
    output = (output + chunk.toString()).slice(-OUTPUT_KEEP);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  let resolve!: (code: number | null) => void;
  const exited = new Promise<number | null>((settled) => (resolve = settled));
  let done = false;
  const settle = (code: number | null) => {
    if (done) return;
    done = true;
    live.delete(child);
    resolve(code);
  };
  child.on("close", (code) => settle(code));
  child.on("error", (error) => {
    collect(error.message);
    settle(null);
  });
  return {
    pid: child.pid,
    exited,
    output: () => output,
    kill() {
      child.kill("SIGTERM");
      const escalate = setTimeout(() => {
        child.kill("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
        settle(null);
      }, killGraceMs);
      escalate.unref();
      void exited.then(() => clearTimeout(escalate));
    },
  };
}
