import { clearTimeout, setTimeout } from "node:timers";
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { URL } from "node:url";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as deadlineRunner from "./run-with-deadline.mjs";
const { runWithDeadline } = deadlineRunner;

describe("test process deadline", () => {
  it("finishes when a separate process group retains a diagnostic pipe after the command exits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-diagnostic-detached-"));
    const pidFile = join(dir, "pid");
    let worker;
    let timer;
    const done = runWithDeadline(
      process.execPath,
      [
        "-e",
        `
      const {spawn}=require("node:child_process");
      const worker=spawn(process.execPath,["-e", 'require("node:fs").writeFileSync(process.argv[1],String(process.pid));process.send("ready");setInterval(()=>{},1000)', process.argv[1]],{detached:true,stdio:["ignore","inherit","inherit","ipc"]});
      worker.on("message",()=>process.exit(7));
    `,
        pidFile,
      ],
      { timeoutMs: 2000, graceMs: 100, diagnostics: true },
    );
    try {
      await expect.poll(() => existsSync(pidFile), { timeout: 1000 }).toBe(true);
      worker = Number(readFileSync(pidFile, "utf8"));
      expect(
        await Promise.race([
          done,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve("still waiting on a pipe"), 3000);
          }),
        ]),
      ).toBe(7);
      expect(() => process.kill(worker, 0)).not.toThrow();
    } finally {
      clearTimeout(timer);
      if (worker !== undefined) process.kill(worker, "SIGKILL");
      await done;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([0, 7])(
    "diagnostic cleanup keeps exit %i when a surviving worker holds its output pipes",
    async (code) => {
      const dir = mkdtempSync(join(tmpdir(), "waitron-diagnostic-survivor-"));
      const pidFile = join(dir, "pid");
      let worker;
      try {
        const result = await runWithDeadline(
          process.execPath,
          [
            "-e",
            `
        const {spawn}=require("node:child_process");
        const worker=spawn(process.execPath,["-e", 'process.on("SIGTERM",()=>{});require("node:fs").writeFileSync(process.argv[1],String(process.pid));process.send("ready");setInterval(()=>{},1000)', process.argv[1]],{stdio:["ignore","inherit","inherit","ipc"]});
        worker.on("message",()=>process.exit(${code}));
      `,
            pidFile,
          ],
          { timeoutMs: 2000, graceMs: 100, diagnostics: true },
        );
        worker = Number(readFileSync(pidFile, "utf8"));
        expect(result).toBe(code);
        await expect
          .poll(
            () => {
              try {
                process.kill(worker, 0);
                return true;
              } catch {
                return false;
              }
            },
            { timeout: 1000 },
          )
          .toBe(false);
      } finally {
        if (worker !== undefined) {
          try {
            process.kill(worker, "SIGKILL");
          } catch {
            /* The runner has already stopped this worker. */
          }
        }
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("prints a real process snapshot through the diagnostic runner's deadline", async () => {
    const lines = [];
    const error = vi.spyOn(console, "error").mockImplementation((line) => lines.push(line));
    try {
      expect(
        await runWithDeadline(
          process.execPath,
          ["-e", 'console.log("[file-progress] start blocked.test.ts [browser]"); while (true) {}'],
          { timeoutMs: 1000, graceMs: 100, diagnostics: true },
        ),
      ).toBe(124);
      expect(lines).toContain("  blocked.test.ts [browser]");
      expect(lines.some((line) => line.includes(String(process.pid)))).toBe(true);
      expect(lines.some((line) => line.includes("Process snapshot failed:"))).toBe(false);
    } finally {
      error.mockRestore();
    }
  });

  it("the diagnostic CLI preserves healthy output and success or failure without waiting for its deadline", () => {
    const script = new URL("./run-with-deadline.mjs", import.meta.url).pathname;
    for (const code of [0, 7]) {
      const result = spawnSync(
        process.execPath,
        [
          script,
          "20",
          "--diagnostics",
          "--",
          process.execPath,
          "-e",
          `process.stdout.write("shard output\\n"); process.stderr.write("shard error\\n"); process.exit(${code})`,
        ],
        { encoding: "utf8", timeout: 3000 },
      );
      expect(result.status).toBe(code);
      expect(result.stdout).toBe("shard output\n");
      expect(result.stderr).toBe("shard error\n");
      expect(result.error).toBeUndefined();
    }
  });

  it("the diagnostic CLI names unfinished files and snapshots processes before killing a blocked child", () => {
    const script = new URL("./run-with-deadline.mjs", import.meta.url).pathname;
    const result = spawnSync(
      process.execPath,
      [
        script,
        "1",
        "--diagnostics",
        "--",
        process.execPath,
        "-e",
        `
      console.log("[file-progress] start completed.test.ts [browser]");
      console.log("[file-progress] end completed.test.ts [browser] passed 0.1s");
      console.log("[file-progress] start stuck.test.ts [browser]");
      console.error("stderr from the shard");
      process.on("SIGTERM", () => {});
      while (true) {}
    `,
        "a1027-stalled-worker",
      ],
      { encoding: "utf8", timeout: 9000 },
    );
    expect(result.status).toBe(124);
    expect(result.stdout).toContain("[file-progress] start stuck.test.ts [browser]");
    expect(result.stderr).toContain("stderr from the shard");
    const report = result.stderr.slice(result.stderr.indexOf("Unfinished test files:"));
    expect(report).toContain("  stuck.test.ts [browser]\n");
    expect(report).not.toContain("  completed.test.ts [browser]\n");
    expect(report).toContain("Process snapshot (pid, ppid, state, elapsed, cpu, rss, command):");
    expect(report).toContain("a1027-stalled-worker");
    expect(result.error).toBeUndefined();
  }, 12_000);

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

describe("deadline diagnostics", () => {
  it("keeps unfinished files across split UTF-8 lines and independent output streams", () => {
    expect(deadlineRunner.createDeadlineDiagnostics).toBeTypeOf("function");
    const lines = [];
    const report = deadlineRunner.createDeadlineDiagnostics({
      write: (line) => lines.push(line),
      snapshot: () => ({ status: 0, stdout: "PID PPID STAT\n42 1 S node\n", stderr: "" }),
    });
    const name = Buffer.from("[file-progress] start sale-🧾.test.ts [browser]\n");
    const split = name.indexOf(Buffer.from("🧾")) + 1;
    report.observe(name.subarray(0, split), "stdout");
    report.observe(Buffer.from("[file-progress] start other.test.ts [node]\n"), "stderr");
    report.observe(name.subarray(split), "stdout");
    report.observe(
      Buffer.from(
        "[file-progress] end other.test.ts [node] passed 0.1s\n[file-progress] still running: sale-🧾.test.ts [browser] 60.0s\n",
      ),
      "stderr",
    );
    report.report();
    expect(lines).toContain("  sale-🧾.test.ts [browser]");
    expect(lines).not.toContain("  other.test.ts [node]");
    expect(lines).toContain("PID PPID STAT\n42 1 S node\n");
  });

  it("names a startup or teardown gap and a failed process snapshot", () => {
    expect(deadlineRunner.createDeadlineDiagnostics).toBeTypeOf("function");
    for (const snapshot of [
      () => ({ status: 2, stdout: "", stderr: "ps refused" }),
      () => ({ status: null, error: new Error("ps timed out"), stdout: "partial", stderr: "" }),
    ]) {
      const lines = [];
      const report = deadlineRunner.createDeadlineDiagnostics({
        write: (line) => lines.push(line),
        snapshot,
      });
      report.observe(
        Buffer.from(
          "unrelated output\n[file-progress] start finished.test.ts [node]\n[file-progress] end finished.test.ts [node] passed",
        ),
        "stdout",
      );
      report.report();
      expect(lines).toContain("  No unfinished file reported; startup or teardown may be stalled.");
      expect(lines.some((line) => line.includes("Process snapshot failed:"))).toBe(true);
      expect(lines).not.toContain("  finished.test.ts [node]");
    }
  });
});
