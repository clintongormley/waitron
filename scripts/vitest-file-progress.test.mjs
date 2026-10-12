import { describe, expect, it } from "vitest";
import FileProgressReporter from "./vitest-file-progress.mjs";

function fakeModule(relativeModuleId, { project = "", state = "passed" } = {}) {
  return {
    relativeModuleId,
    project: { name: project },
    state: () => state,
  };
}

// A hand-driven clock and interval, so no case waits on a real timer.
function harness(options = {}) {
  const lines = [];
  const clock = { now: 0 };
  const timers = [];
  const reporter = new FileProgressReporter({
    ...options,
    now: () => clock.now,
    write: (line) => lines.push(line),
    setInterval: (fn, ms) => {
      const timer = {
        fn,
        ms,
        cleared: false,
        unrefed: false,
        unref() {
          this.unrefed = true;
          return this;
        },
      };
      timers.push(timer);
      return timer;
    },
    clearInterval: (timer) => {
      timer.cleared = true;
    },
  });
  const tick = (ms) => {
    clock.now += ms;
    for (const timer of timers) if (!timer.cleared) timer.fn();
  };
  return { reporter, lines, clock, timers, tick };
}

describe("vitest file progress reporter", () => {
  it("prints a line when a file starts, naming its project", () => {
    const { reporter, lines } = harness();
    reporter.onTestModuleQueued(fakeModule("src/a.test.ts", { project: "browser" }));
    expect(lines).toEqual(["[file-progress] start src/a.test.ts [browser]"]);
  });

  it("leaves the project out when the project has no name", () => {
    const { reporter, lines } = harness();
    reporter.onTestModuleQueued(fakeModule("src/a.test.ts"));
    expect(lines).toEqual(["[file-progress] start src/a.test.ts"]);
  });

  it("prints the end with the file's state and how long it took since it started", () => {
    const { reporter, lines, clock } = harness();
    const mod = fakeModule("src/a.test.ts", { project: "node", state: "failed" });
    reporter.onTestModuleQueued(mod);
    clock.now = 2345;
    reporter.onTestModuleEnd(mod);
    expect(lines[1]).toBe("[file-progress] end src/a.test.ts [node] failed 2.3s");
  });

  it("starts the clock at onTestModuleStart when the file was never queued", () => {
    const { reporter, lines, clock } = harness();
    const mod = fakeModule("src/b.test.ts", { state: "skipped" });
    clock.now = 1000;
    reporter.onTestModuleStart(mod);
    clock.now = 1500;
    reporter.onTestModuleEnd(mod);
    expect(lines).toEqual([
      "[file-progress] start src/b.test.ts",
      "[file-progress] end src/b.test.ts skipped 0.5s",
    ]);
  });

  it("does not print a second start when a queued file starts its tests", () => {
    const { reporter, lines } = harness();
    const mod = fakeModule("src/a.test.ts");
    reporter.onTestModuleQueued(mod);
    reporter.onTestModuleStart(mod);
    expect(lines).toHaveLength(1);
  });

  it("matches a file across hooks by project and path, since Vitest hands each hook a new object", () => {
    const { reporter, lines, clock } = harness();
    reporter.onTestModuleQueued(fakeModule("src/a.test.ts", { project: "chromium" }));
    reporter.onTestModuleQueued(fakeModule("src/a.test.ts", { project: "node" }));
    clock.now = 4000;
    reporter.onTestModuleStart(fakeModule("src/a.test.ts", { project: "chromium" }));
    reporter.onTestModuleEnd(fakeModule("src/a.test.ts", { project: "chromium" }));
    expect(lines).toEqual([
      "[file-progress] start src/a.test.ts [chromium]",
      "[file-progress] start src/a.test.ts [node]",
      "[file-progress] end src/a.test.ts [chromium] passed 4.0s",
    ]);
  });

  it("prints an end with no duration for a file it never saw start", () => {
    const { reporter, lines } = harness();
    reporter.onTestModuleEnd(fakeModule("src/c.test.ts"));
    expect(lines).toEqual(["[file-progress] end src/c.test.ts passed"]);
  });

  it("warns GitHub Actions when a file takes longer than 90 seconds by default", () => {
    const { reporter, lines, clock } = harness();
    const mod = fakeModule("src/slow.test.ts", { project: "node" });
    reporter.onTestModuleQueued(mod);
    clock.now = 95_200;
    reporter.onTestModuleEnd(mod);
    expect(lines).toEqual([
      "[file-progress] start src/slow.test.ts [node]",
      "[file-progress] end src/slow.test.ts [node] passed 95.2s",
      "::warning title=Slow test file::src/slow.test.ts [node] took 95.2s; a file over 90s holds up its CI shard (docs/developers/ci-and-gates.md)",
    ]);
  });

  it("does not warn for a file that takes exactly the threshold", () => {
    const { reporter, lines, clock } = harness();
    const mod = fakeModule("src/edge.test.ts");
    reporter.onTestModuleQueued(mod);
    clock.now = 90_000;
    reporter.onTestModuleEnd(mod);
    expect(lines).toEqual([
      "[file-progress] start src/edge.test.ts",
      "[file-progress] end src/edge.test.ts passed 90.0s",
    ]);
  });

  it("takes its threshold from the slowFileMs option", () => {
    const { reporter, lines, clock } = harness({ slowFileMs: 2000 });
    const fast = fakeModule("src/fast.test.ts");
    const slow = fakeModule("src/slow.test.ts");
    reporter.onTestModuleQueued(fast);
    reporter.onTestModuleQueued(slow);
    clock.now = 1999;
    reporter.onTestModuleEnd(fast);
    clock.now = 2001;
    reporter.onTestModuleEnd(slow);
    expect(lines.slice(2)).toEqual([
      "[file-progress] end src/fast.test.ts passed 2.0s",
      "[file-progress] end src/slow.test.ts passed 2.0s",
      "::warning title=Slow test file::src/slow.test.ts took 2.0s; a file over 2s holds up its CI shard (docs/developers/ci-and-gates.md)",
    ]);
  });

  it("does not warn for a file it never saw start, however late it ends", () => {
    const { reporter, lines, clock } = harness();
    clock.now = 500_000;
    reporter.onTestModuleEnd(fakeModule("src/c.test.ts"));
    expect(lines).toEqual(["[file-progress] end src/c.test.ts passed"]);
  });

  it("lists every still-running file each interval, and only the running ones", () => {
    const { reporter, lines, tick, timers } = harness();
    reporter.onInit();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(60_000);
    const a = fakeModule("src/a.test.ts", { project: "browser" });
    const b = fakeModule("src/b.test.ts");
    reporter.onTestModuleQueued(a);
    tick(30_000);
    reporter.onTestModuleQueued(b);
    tick(30_000);
    reporter.onTestModuleEnd(a);
    tick(60_000);
    expect(lines).toEqual([
      "[file-progress] start src/a.test.ts [browser]",
      "[file-progress] still running: src/a.test.ts [browser] 30.0s",
      "[file-progress] start src/b.test.ts",
      "[file-progress] still running: src/a.test.ts [browser] 60.0s",
      "[file-progress] still running: src/b.test.ts 30.0s",
      "[file-progress] end src/a.test.ts [browser] passed 60.0s",
      "[file-progress] still running: src/b.test.ts 90.0s",
    ]);
  });

  it("prints nothing on an interval when no file is running", () => {
    const { reporter, lines, tick } = harness();
    reporter.onInit();
    tick(60_000);
    expect(lines).toEqual([]);
  });

  it("never lets its timer hold the process open, and clears it when the run ends", () => {
    const { reporter, timers } = harness();
    reporter.onInit();
    expect(timers[0].unrefed).toBe(true);
    expect(timers[0].cleared).toBe(false);
    reporter.onTestRunEnd();
    expect(timers[0].cleared).toBe(true);
  });

  it("uses the real clock, stdout and an unref'd timer by default", () => {
    const reporter = new FileProgressReporter();
    const written = [];
    const original = process.stdout.write;
    process.stdout.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    try {
      const mod = fakeModule("src/real.test.ts");
      reporter.onInit();
      reporter.onTestModuleQueued(mod);
      reporter.onTestModuleEnd(mod);
    } finally {
      reporter.onTestRunEnd();
      process.stdout.write = original;
    }
    expect(written[0]).toBe("[file-progress] start src/real.test.ts\n");
    expect(written[1]).toMatch(/^\[file-progress\] end src\/real\.test\.ts passed \d+\.\ds\n$/);
  });
});
