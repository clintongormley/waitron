import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCommandLine, spawnLitestream } from "./litestream-process.js";

let dir: string;
const stub = (name: string, body: string): string => {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};
let prints: string;
let obedient: string;
let stubborn: string;
let waiting: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "waitron-litestream-stub-"));
  prints = stub("prints", 'echo "on stdout"; echo "on stderr" >&2; exit 3');
  obedient = stub("obedient", "exec sleep 30");
  // Ignores the polite signal, and leaves a child of its own holding the output pipes after it is
  // killed: `exited` must still settle, by the escalation after the grace.
  stubborn = stub("stubborn", "trap '' TERM; echo ready; sleep 3; :");
  // Stays a shell (no `exec`), so its own argv stays readable while it waits.
  waiting = stub("waiting", "sleep 30; :");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("spawnLitestream", () => {
  it("keeps both output streams and reports the exit code", async () => {
    const child = spawnLitestream(prints, [], {});
    await expect(child.exited).resolves.toBe(3);
    expect(child.output()).toContain("on stdout");
    expect(child.output()).toContain("on stderr");
  });

  it("stops a child that honours SIGTERM", async () => {
    const child = spawnLitestream(obedient, [], {});
    child.kill();
    await expect(child.exited).resolves.toBeNull();
  });

  it("settles a child that ignores SIGTERM, by SIGKILL after the grace", async () => {
    const child = spawnLitestream(stubborn, [], {}, 200);
    // Signalled before the trap is installed, the stub dies of SIGTERM and nothing escalates.
    await expect.poll(() => child.output()).toContain("ready");
    const started = performance.now();
    child.kill();
    await child.exited;
    expect(performance.now() - started).toBeLessThan(2_000);
    await expect.poll(() => alive(child.pid!), { timeout: 1_000 }).toBe(false);
  }, 10_000);

  it("reports a binary that is not there as an exit with no code", async () => {
    const child = spawnLitestream(join(dir, "missing"), ["version"], {});
    await expect(child.exited).resolves.toBeNull();
    expect(child.output()).toContain("ENOENT");
  });

  // The vault key and every other secret in this process's environment stay out of the child's.
  // `env` itself rather than a shell script: a shell adds variables of its own (PWD, SHLVL, _).
  it("hands the child PATH, HOME and the variables it was given, and nothing else", async () => {
    process.env.WAITRON_STREAM_TEST_SENTINEL = "must-not-reach-the-child";
    try {
      const child = spawnLitestream("/usr/bin/env", [], {
        WAITRON_STREAM_ACCESS_KEY_ID: "AKIAEXAMPLE",
      });
      await expect(child.exited).resolves.toBe(0);
      expect(child.output().trim().split("\n").sort()).toEqual([
        `HOME=${process.env.HOME}`,
        `PATH=${process.env.PATH}`,
        "WAITRON_STREAM_ACCESS_KEY_ID=AKIAEXAMPLE",
      ]);
    } finally {
      delete process.env.WAITRON_STREAM_TEST_SENTINEL;
    }
  });

  it("reads a running process's command line, and null for a PID nothing holds", async () => {
    const child = spawnLitestream(waiting, ["replicate", "-config", "/tmp/x.yml"], {}, 200);
    try {
      await expect
        .poll(() => readCommandLine(child.pid!))
        .toContain("replicate -config /tmp/x.yml");
    } finally {
      child.kill();
      await child.exited;
    }
    expect(await readCommandLine(2_147_483_646)).toBeNull();
  });

  // A server that exits without stopping its Litestream would leave it streaming. The module is
  // loaded in a separate Node process — it imports only Node's own modules, so Node runs the
  // TypeScript directly — which starts a child and exits; the child must go with it.
  it("stops its children when this process exits", async () => {
    const moduleUrl = pathToFileURL(join(import.meta.dirname, "litestream-process.ts")).href;
    const script =
      `const { spawnLitestream } = await import(${JSON.stringify(moduleUrl)});` +
      `const child = spawnLitestream(${JSON.stringify(obedient)}, [], {});` +
      `console.log(child.pid); setTimeout(() => process.exit(0), 300);`;
    const parent = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    parent.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    await new Promise((resolve) => parent.on("close", resolve));
    const pid = Number(out.trim());
    expect(pid).toBeGreaterThan(0);
    try {
      await expect.poll(() => alive(pid), { timeout: 3_000 }).toBe(false);
    } finally {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 15_000);
});
