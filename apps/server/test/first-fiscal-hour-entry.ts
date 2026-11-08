import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect } from "vitest";
import type { Agent } from "undici";
import { copyMigrationsRoot } from "../src/testing/boot-harness.js";
import {
  retainHttpListener,
  retainedHttpPreload,
  transferRetainedListeners,
} from "../src/testing/retained-http-listener.js";

/** Registers the file's clean-up and returns a builder for one throwaway entry workspace per case. */
export function entryWorkspaces() {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
  return async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "hour-entry-process-"));
    roots.push(root);
    const stateDir = join(root, "state"),
      venueDir = join(root, "venue");
    await mkdir(stateDir);
    await mkdir(venueDir);
    const migrations = join(root, "migrations");
    await copyMigrationsRoot(migrations);
    const setupApp = join(root, "setup-app");
    await mkdir(join(setupApp, "assets"), { recursive: true });
    await writeFile(
      join(setupApp, "index.html"),
      '<!doctype html><div id="app"></div><script type="module" src="/assets/setup-fixture.js"></script>',
    );
    await writeFile(
      join(setupApp, "assets", "setup-fixture.js"),
      'document.querySelector("#app").textContent = "Setup fixture";',
    );
    const env: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("WAITRON_")),
    );
    Object.assign(env, {
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_MIGRATIONS_DIR: migrations,
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_ENV: "dev",
      WAITRON_SETUP_APP_DIR: setupApp,
    });
    return { root, stateDir, venueDir, env };
  };
}

export async function childProcess(
  script: string,
  env: NodeJS.ProcessEnv,
  args: string[] = [],
  options: { landing?: boolean } = {},
) {
  const startupDeadline = Date.now() + 45_000;
  const held = await retainHttpListener();
  let landing: Awaited<ReturnType<typeof retainHttpListener>> | undefined;
  try {
    if (options.landing === true) landing = await retainHttpListener();
  } catch (error) {
    await held.close();
    throw error;
  }
  const child = spawn(
    process.execPath,
    ["--import", retainedHttpPreload, "--import", "tsx", resolve(script), ...args],
    {
      env: {
        ...env,
        WAITRON_HTTP_PORT: String(held.port),
        WAITRON_HTTP_LANDING_PORT: String(landing?.port ?? 0),
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  child.stdout!.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  child.stderr!.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res, rej) => {
    child.once("error", rej);
    child.once("exit", (code, signal) => res({ code, signal }));
  });
  const running = {
    child,
    port: held.port,
    landingPort: landing?.port ?? 0,
    startupDeadline,
    output: () => output,
    exited,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return exited;
      child.kill("SIGTERM");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          exited,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              child.kill("SIGKILL");
              reject(new Error(`Owned entry process ${child.pid} did not stop: ${output}`));
            }, 10_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        await exited;
      }
    },
  };
  const listeners = landing === undefined ? [held] : [held, landing];
  try {
    await transferRetainedListeners(child, listeners, Math.max(1, startupDeadline - Date.now()));
    return running;
  } catch (error) {
    await running.stop();
    throw error;
  } finally {
    for (const listener of listeners) if (listener.server.listening) await listener.close();
  }
}

export async function expectRestartExit(process: Awaited<ReturnType<typeof childProcess>>) {
  let result: Awaited<Awaited<ReturnType<typeof childProcess>>["exited"]> | undefined;
  const observed = process.exited.then((value) => {
    result = value;
  });
  await expect.poll(() => result, { timeout: 10_000 }).toEqual({ code: 0, signal: null });
  await observed;
}

export async function ready(
  process: Awaited<ReturnType<typeof childProcess>>,
  url: string,
  agent?: Agent,
) {
  const deadline = process.startupDeadline;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null || process.child.signalCode !== null)
      throw new Error(`Entry exited before listening: ${process.output()}`);
    try {
      const response = await fetch(`${url}/setup-api/first-setup/status`, {
        ...(agent === undefined ? {} : { dispatcher: agent }),
        signal: AbortSignal.timeout(1000),
      } as RequestInit);
      const value: unknown = await response.json();
      if (response.status === 200) return value;
    } catch {
      /* Wait only for the owned listener's actual response. */
    }
    await delay(25);
  }
  throw new Error(`Entry did not listen: ${process.output()}`);
}
