import { spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { URL } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWithDeadline } from "./run-with-deadline.mjs";

describe("test process deadline", () => {
  it("cleans up a surviving worker when the command exits first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-deadline-"));
    const pidFile = join(dir, "pid");
    let pid;
    try {
      expect(
        await runWithDeadline(
          process.execPath,
          [
            "-e",
            `
        const {spawn}=require('node:child_process');
        const child=spawn(process.execPath, ['-e',
          'process.on("SIGTERM",()=>{});require("node:fs").writeFileSync(process.argv[1],String(process.pid));process.send("ready");setInterval(()=>{},1000)',
          process.argv[1]], {stdio:['ignore','ignore','ignore','ipc']});
        child.on('message',()=>process.exit(7));
      `,
            pidFile,
          ],
          { timeoutMs: 2000, graceMs: 100, stdio: "ignore" },
        ),
      ).toBe(7);
      pid = Number(readFileSync(pidFile, "utf8"));
      await expect
        .poll(
          () => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 1000 },
        )
        .toBe(false);
    } finally {
      if (pid !== undefined) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // The assertion's successful path has already stopped this worker.
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ])("forwards %s and removes listeners", async (signal, code) => {
    const signals = new EventEmitter();
    const done = runWithDeadline(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 2000,
      graceMs: 100,
      stdio: "ignore",
      signals,
    });
    signals.emit(signal);
    signals.emit(signal);
    expect(await done).toBe(code);
    expect(signals.eventNames()).toEqual([]);
  });

  it("reports a child killed by a signal as failure", async () => {
    expect(
      await runWithDeadline(process.execPath, ["-e", 'process.kill(process.pid, "SIGKILL")'], {
        timeoutMs: 1000,
        stdio: "ignore",
      }),
    ).toBe(1);
  });

  it("the CLI rejects missing arguments and preserves a command's failure", () => {
    const script = new URL("./run-with-deadline.mjs", import.meta.url).pathname;
    const invalid = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 2000 });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Usage:");
    const failure = spawnSync(
      process.execPath,
      [script, "1", "--", process.execPath, "-e", "process.exit(7)"],
      { timeout: 2000 },
    );
    expect(failure.status).toBe(7);
  });

  it("preserves success and failure exit codes", async () => {
    for (const code of [0, 7]) {
      expect(
        await runWithDeadline(process.execPath, ["-e", `process.exit(${code})`], {
          timeoutMs: 2000,
          stdio: "ignore",
        }),
      ).toBe(code);
    }
  });

  it("fails a process that cannot run its own timeout, even when it ignores SIGTERM", async () => {
    expect(
      await runWithDeadline(
        process.execPath,
        ["-e", 'process.on("SIGTERM", () => {}); while (true) {}'],
        { timeoutMs: 300, graceMs: 100, stdio: "ignore" },
      ),
    ).toBe(124);
  });

  it("rejects invalid deadlines before starting a command", async () => {
    for (const timeoutMs of [0, -1, NaN, Infinity]) {
      await expect(
        runWithDeadline(process.execPath, ["-e", "process.exit(0)"], { timeoutMs }),
      ).rejects.toThrow("positive finite");
    }
  });

  it("reports a command that cannot start as failure", async () => {
    expect(
      await runWithDeadline("/does-not-exist/waitron-test", [], {
        timeoutMs: 1000,
        stdio: "ignore",
      }),
    ).toBe(1);
  });

  it("the CLI forwards cancellation and kills a descendant holding stdout open", async () => {
    const child = spawn(
      process.execPath,
      [
        new URL("./run-with-deadline.mjs", import.meta.url).pathname,
        "5",
        "--",
        process.execPath,
        "-e",
        `const {spawn} = require('node:child_process');
         spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'], {stdio: 'inherit'});
         setInterval(() => {}, 1000);`,
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
    );
    try {
      await once(child.stdout, "data");
      const closed = once(child, "close");
      child.kill("SIGTERM");
      expect((await closed)[0]).toBe(143);
    } finally {
      child.kill("SIGKILL");
    }
  }, 10_000);
});
