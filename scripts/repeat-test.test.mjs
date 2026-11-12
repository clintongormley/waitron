import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { repeatTest } from "./repeat-test.mjs";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "repeat-test-case-"));
  directories.push(directory);
  return directory;
}
async function repeat(options) {
  const result = await repeatTest(options);
  directories.push(result.directory);
  return result;
}
const node = (script, ...args) => [process.execPath, "-e", script, ...args];

it("runs N sequential attempts with separate logs and literal command arguments", async () => {
  const directory = scratch();
  const marker = join(directory, "order");
  const command = node(
    `
    const fs = require('node:fs');
    const [marker, literal] = process.argv.slice(1);
    const before = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
    console.log(literal, before.length);
    setTimeout(() => fs.appendFileSync(marker, 'x'), 30);
  `,
    marker,
    "$(touch must-not-run); *",
  );
  const result = await repeat({ count: 2, seconds: 10, command });
  expect(result.code).toBe(0);
  expect(readFileSync(marker, "utf8")).toBe("xx");
  expect(readFileSync(join(result.directory, "attempt-1.log"), "utf8")).toContain(
    "$(touch must-not-run); * 0",
  );
  expect(readFileSync(join(result.directory, "attempt-2.log"), "utf8")).toContain(
    "$(touch must-not-run); * 1",
  );
  expect(readdirSync(result.directory).sort()).toEqual(["attempt-1.log", "attempt-2.log"]);
});

it("keeps an early failure after a later success and retains an after-exit snapshot", async () => {
  const marker = join(scratch(), "first");
  const result = await repeat({
    count: 2,
    seconds: 10,
    command: node(
      `
    const fs = require('node:fs');
    const first = !fs.existsSync(process.argv[1]);
    fs.writeFileSync(process.argv[1], 'seen');
    console.error(first ? 'first failure' : 'later success');
    process.exitCode = first ? 7 : 0;
  `,
      marker,
    ),
  });
  expect(result.code).toBe(1);
  const failed = readFileSync(join(result.directory, "attempt-1.log"), "utf8");
  expect(failed).toContain("first failure");
  expect(failed).toContain("Exit: 7");
  expect(failed).toContain("Process snapshot (after exit)");
  expect(failed).toContain(String(process.pid));
  expect(readFileSync(join(result.directory, "attempt-2.log"), "utf8")).toContain("later success");
});

it("cancels the owned load and attempt while an unrelated process survives", async () => {
  const directory = scratch();
  const attemptPid = join(directory, "attempt");
  const loadPid = join(directory, "load");
  const signals = new EventEmitter();
  const hold = (marker) =>
    node(
      `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)`,
      marker,
    );
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  const unrelatedClosed = once(unrelated, "close");
  const running = repeat({
    count: 2,
    seconds: 10,
    command: hold(attemptPid),
    load: hold(loadPid),
    signals,
  });
  try {
    await expect
      .poll(() => existsSync(attemptPid) && existsSync(loadPid), { timeout: 5_000 })
      .toBe(true);
    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    const result = await running;
    expect(result.code).toBe(130);
    for (const marker of [attemptPid, loadPid]) {
      expect(() => process.kill(Number(readFileSync(marker, "utf8")), 0)).toThrowError(
        expect.objectContaining({ code: "ESRCH" }),
      );
    }
    expect(() => process.kill(unrelated.pid, 0)).not.toThrow();
    expect(existsSync(join(result.directory, "attempt-2.log"))).toBe(false);
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  } finally {
    signals.emit("SIGTERM");
    await running;
    unrelated.kill();
    await unrelatedClosed;
  }
}, 15_000);

it("reports an experiment invalid and fails when its load exits early", async () => {
  const result = await repeat({
    count: 2,
    seconds: 10,
    command: node("setInterval(() => {}, 1000)"),
    load: node("console.log('load stopped')"),
  });
  expect(result.code).toBe(1);
  expect(readFileSync(join(result.directory, "load.log"), "utf8")).toContain(
    "Invalid experiment: load exited early",
  );
  expect(existsSync(join(result.directory, "attempt-2.log"))).toBe(false);
});
