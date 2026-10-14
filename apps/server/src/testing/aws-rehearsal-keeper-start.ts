// Starts the keeper (`scripts/aws-rehearsal-keeper.ts`) beside a rehearsal run (design D8, D9).
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { AwsRehearsalRefused } from "./aws-rehearsal-refused.js";

export interface KeeperHandle {
  /** The keeper's own pid as its journal reports it; null when no keeper process was started. */
  keeperPid: number | null;
  /** Ends the pipe the keeper reads; the keeper then reads the journal and acts on it. */
  end(): void;
}

/** The environment the keeper is given; nothing else from the runner's reaches it. */
export const KEEPER_ENV_NAMES = [
  "WAITRON_RUN_AWS_REHEARSAL",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CONFIG_FILE",
  "TMPDIR",
  "PATH",
  "HOME",
] as const;

export function keeperEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of KEEPER_ENV_NAMES) {
    const value = env[name];
    if (value !== undefined) kept[name] = value;
  }
  return kept;
}

export const KEEPER_READY_MS = 10_000;
const KEEPER_POLL_MS = 50;

export const KEEPER_SCRIPT = fileURLToPath(
  new URL("../../scripts/aws-rehearsal-keeper.ts", import.meta.url),
);

/** tsx's loader, run in the node process itself: `.bin/tsx` would put the keeper in a second one. */
export function tsxLoaderUrl(): string {
  return pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
}

function keeperReady(journalPath: string): number | null {
  try {
    const parsed = JSON.parse(readFileSync(journalPath, "utf8")) as {
      ready?: unknown;
      keeperPid?: unknown;
    };
    const pid = parsed.keeperPid;
    return parsed.ready === true && typeof pid === "number" && Number.isSafeInteger(pid) && pid > 1
      ? pid
      : null;
  } catch {
    return null;
  }
}

/**
 * Spawns the launcher, which starts the keeper in a session of its own and exits, so the keeper's
 * parent is pid 1. The keeper's stdin is a pipe whose writing end only this process holds, so this
 * process ending, however it ends, is end-of-file there. Resolves once the journal shows the keeper
 * ready and the launcher has exited 0; refuses `keeper-unavailable` otherwise.
 */
export async function startKeeper(
  journalPath: string,
  env: Readonly<Record<string, string | undefined>>,
  options: { readyMs?: number; script?: string } = {},
): Promise<KeeperHandle> {
  const readyMs = options.readyMs ?? KEEPER_READY_MS;
  let tty: number | undefined;
  try {
    tty = openSync("/dev/tty", "w");
  } catch {
    // No terminal (launchd, CI, a detached group): the keeper writes its log alone.
  }
  let failed = false;
  let exited = false;
  const child = (() => {
    try {
      return spawn(
        process.execPath,
        [
          "--import",
          tsxLoaderUrl(),
          options.script ?? KEEPER_SCRIPT,
          "--launch",
          "--journal",
          journalPath,
        ],
        { env: keeperEnv(env), stdio: ["pipe", tty ?? "ignore", tty ?? "ignore"] },
      );
    } finally {
      if (tty !== undefined) closeSync(tty);
    }
  })();
  child.on("error", () => {
    failed = true;
  });
  child.on("exit", (code) => {
    exited = true;
    if (code !== 0) failed = true;
  });
  // Node destroys `child.stdin` when the child exits, which here is at once: the launcher's exit
  // would be end-of-file for the keeper (measured on Node v26.7.0, macOS). Held apart, it stays open.
  const pipe = child.stdin!;
  child.stdin = null;
  pipe.on("error", () => {});
  child.unref();
  (pipe as unknown as { unref?(): void }).unref?.();
  const end = (): void => {
    try {
      pipe.end();
    } catch {
      // The keeper reads end-of-file when this process exits anyway.
    }
  };
  const until = Date.now() + readyMs;
  while (!failed && Date.now() < until) {
    // Ready and the launcher gone, so the keeper is outside the runner's process tree.
    const pid = keeperReady(journalPath);
    if (pid !== null && exited) return { keeperPid: pid, end };
    await delay(KEEPER_POLL_MS);
  }
  end();
  throw new AwsRehearsalRefused(
    "keeper-unavailable",
    failed
      ? "the keeper's launcher failed; nothing was created"
      : `the keeper did not report ready within ${readyMs} ms; nothing was created`,
  );
}
