import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect } from "vitest";
import type { Agent } from "undici";
import { copyMigrationsRoot } from "../src/testing/boot-harness.js";
import { freePorts } from "../src/testing/free-ports.js";

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
    const [port, landingPort] = await freePorts(2);
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
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_ENV: "dev",
      WAITRON_SETUP_APP_DIR: setupApp,
    });
    return { root, stateDir, venueDir, port, landingPort, env };
  };
}

export function childProcess(script: string, env: NodeJS.ProcessEnv, args: string[] = []) {
  const child = spawn(process.execPath, ["--import", "tsx", resolve(script), ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  child.stderr.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res, rej) => {
    child.once("error", rej);
    child.once("exit", (code, signal) => res({ code, signal }));
  });
  return {
    child,
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
}

export async function expectRestartExit(process: ReturnType<typeof childProcess>) {
  let result: Awaited<ReturnType<typeof childProcess>["exited"]> | undefined;
  const observed = process.exited.then((value) => {
    result = value;
  });
  await expect.poll(() => result, { timeout: 10_000 }).toEqual({ code: 0, signal: null });
  await observed;
}

export async function ready(process: ReturnType<typeof childProcess>, url: string, agent?: Agent) {
  const deadline = Date.now() + 45_000;
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
