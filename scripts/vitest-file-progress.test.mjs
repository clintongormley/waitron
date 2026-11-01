import { describe, expect, it, vi } from "vitest";
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

describe("selected-file progress details", () => {
  const path = "src/blocked.test.ts";
  const module = () => fakeModule(path, { project: "browser" });
  const testCase = () => ({
    module: module(),
    fullName: "dialog > opens\nthen waits",
    result: () => ({ state: "passed" }),
  });
  const details = (lines) =>
    lines
      .filter((line) => line.startsWith("[file-progress] detail "))
      .map((line) => JSON.parse(line.slice("[file-progress] detail ".length)));

  it("records completed collection before any case begins", () => {
    const { reporter, lines, clock } = harness({ traceFiles: [path] });
    clock.now = 1234;
    reporter.onTestModuleCollected?.(module());
    expect(details(lines)).toEqual([
      { file: "src/blocked.test.ts [browser]", phase: "collected", atMs: 1234 },
    ]);
  });

  it("records the exact active case and its completion as separate single lines", () => {
    const { reporter, lines } = harness({ traceFiles: [path] });
    reporter.onTestCaseReady?.(testCase());
    reporter.onTestCaseResult?.(testCase());
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
    expect(details(lines)).toEqual([
      {
        file: "src/blocked.test.ts [browser]",
        phase: "case-start",
        name: "dialog > opens\nthen waits",
        atMs: 0,
      },
      {
        file: "src/blocked.test.ts [browser]",
        phase: "case-end",
        name: "dialog > opens\nthen waits",
        state: "passed",
        atMs: 0,
      },
    ]);
  });

  it.each(["beforeEach", "afterEach"])(
    "records a case's %s hook separately from its body",
    (name) => {
      const { reporter, lines } = harness({ traceFiles: [path] });
      reporter.onHookStart?.({ name, entity: testCase() });
      reporter.onHookEnd?.({ name, entity: testCase() });
      expect(details(lines)).toEqual([
        {
          file: "src/blocked.test.ts [browser]",
          phase: "hook-start",
          hook: name,
          name: "dialog > opens\nthen waits",
          atMs: 0,
        },
        {
          file: "src/blocked.test.ts [browser]",
          phase: "hook-end",
          hook: name,
          name: "dialog > opens\nthen waits",
          atMs: 0,
        },
      ]);
    },
  );

  it.each(["beforeAll", "afterAll"])("records a module's %s hook", (name) => {
    const { reporter, lines } = harness({ traceFiles: [path] });
    reporter.onHookStart?.({ name, entity: { ...module(), type: "module" } });
    reporter.onHookEnd?.({ name, entity: { ...module(), type: "module" } });
    expect(details(lines)).toEqual([
      { file: "src/blocked.test.ts [browser]", phase: "hook-start", hook: name, atMs: 0 },
      { file: "src/blocked.test.ts [browser]", phase: "hook-end", hook: name, atMs: 0 },
    ]);
  });

  it("keeps suite hook names and distinguishes projects sharing the same path", () => {
    const { reporter, lines } = harness({ traceFiles: [path] });
    reporter.onHookStart?.({
      name: "beforeAll",
      entity: { module: fakeModule(path, { project: "node" }), fullName: "nested suite" },
    });
    reporter.onTestCaseReady?.(testCase());
    expect(details(lines)).toEqual([
      {
        file: "src/blocked.test.ts [node]",
        phase: "hook-start",
        hook: "beforeAll",
        name: "nested suite",
        atMs: 0,
      },
      {
        file: "src/blocked.test.ts [browser]",
        phase: "case-start",
        name: "dialog > opens\nthen waits",
        atMs: 0,
      },
    ]);
  });

  it("leaves unselected files' normal start and end output unchanged", () => {
    const { reporter, lines } = harness({ traceFiles: ["src/other.test.ts"] });
    reporter.onTestModuleQueued(module());
    reporter.onTestModuleCollected?.(module());
    reporter.onTestCaseReady?.(testCase());
    reporter.onHookStart?.({ name: "beforeEach", entity: testCase() });
    reporter.onHookEnd?.({ name: "beforeEach", entity: testCase() });
    reporter.onTestCaseResult?.(testCase());
    reporter.onTestModuleEnd(module());
    expect(lines).toEqual([
      "[file-progress] start src/blocked.test.ts [browser]",
      "[file-progress] end src/blocked.test.ts [browser] passed 0.0s",
    ]);
  });

  it.each([undefined, "", "   "])(
    "emits no details for an unset or empty selector (%s)",
    (value) => {
      vi.stubEnv("WAITRON_TEST_TRACE_FILES", value);
      try {
        const { reporter, lines } = harness();
        reporter.onTestModuleCollected?.(module());
        reporter.onTestCaseReady?.(testCase());
        expect(lines).toEqual([]);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("reads exact comma-separated file selectors from the environment", () => {
    vi.stubEnv("WAITRON_TEST_TRACE_FILES", " src/other.test.ts, , src/blocked.test.ts ");
    try {
      const { reporter, lines } = harness();
      reporter.onTestModuleCollected?.(module());
      reporter.onTestModuleCollected?.(fakeModule("prefix/src/blocked.test.ts"));
      expect(details(lines)).toEqual([
        { file: "src/blocked.test.ts [browser]", phase: "collected", atMs: 0 },
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("stack samples from a browser page that a file has kept busy", () => {
  const settle = () => new Promise((resolve) => globalThis.setImmediate(resolve));

  function fakeCdp() {
    const listeners = new Map();
    const cdp = {
      sent: [],
      pauseWith: undefined,
      evaluateAnswers: true,
      enableFails: false,
      pauseFails: false,
      on(event, listener) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(listener);
      },
      listeners: (event) => listeners.get(event)?.length ?? 0,
      emit(event, payload) {
        for (const listener of listeners.get(event) ?? []) listener(payload);
      },
      send(method, params) {
        cdp.sent.push(method);
        if (method === "Debugger.enable" && cdp.enableFails) {
          return Promise.reject(new Error("enable refused"));
        }
        if (method === "Debugger.pause" && cdp.pauseFails) {
          return Promise.reject(new Error("pause refused"));
        }
        if (method === "Debugger.pause" && cdp.pauseWith) {
          const callFrames = cdp.pauseWith;
          globalThis.queueMicrotask(() => cdp.emit("Debugger.paused", { callFrames }));
        }
        if (method === "Debugger.resume") return Promise.reject(new Error("not paused"));
        if (method === "Runtime.evaluate") {
          expect(params).toEqual({ expression: "0" });
          if (!cdp.evaluateAnswers) return new Promise(() => {});
        }
        return Promise.resolve({});
      },
    };
    return cdp;
  }

  function fakePage(frameUrls = []) {
    const cdp = fakeCdp();
    const page = {
      cdp,
      sessions: 0,
      frameUrls,
      frames: () => page.frameUrls.map((url) => ({ url: () => url })),
      context: () => ({
        newCDPSession: async (target) => {
          expect(target).toBe(page);
          page.sessions += 1;
          return cdp;
        },
      }),
    };
    return page;
  }

  const absolute = (path) => `/repo/apps/dashboard/${path}`;
  const frameFor = (path) =>
    `http://localhost:63315/__vitest_test__/__test__/?sessionId=s&iframeId=${encodeURIComponent(absolute(path))}`;

  function browserProject(pages, name = "browser") {
    return {
      name,
      browser: { provider: { pages: new Map(pages.map((page, i) => [`s${i}`, page])) } },
    };
  }

  function browserModule(path, project) {
    return { relativeModuleId: path, moduleId: absolute(path), project, state: () => "passed" };
  }

  function stackHarness(options = {}) {
    const timeouts = [];
    const h = harness({
      ...options,
      setTimeout: (fn, ms) => {
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
        timeouts.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        timer.cleared = true;
      },
    });
    const fire = (ms) => {
      for (const timer of timeouts) {
        if (timer.ms === ms && !timer.cleared && !timer.fired) {
          timer.fired = true;
          timer.fn();
        }
      }
    };
    const stackLines = () => h.lines.filter((line) => line.startsWith("[file-progress] stack:"));
    return { ...h, timeouts, fire, stackLines };
  }

  const hangPath = "src/hang.test.ts";

  async function runningHangFile(options) {
    const page = fakePage([frameFor(hangPath)]);
    const project = browserProject([page]);
    const h = stackHarness(options);
    h.reporter.onInit({ projects: [{ name: "node" }, project] });
    h.reporter.onTestModuleQueued(browserModule(hangPath, project));
    await settle();
    return { ...h, page, project };
  }

  it("attaches to each browser page once and enables its debugger", async () => {
    const { reporter, page, project } = await runningHangFile();
    reporter.onTestModuleStart(browserModule(hangPath, project));
    reporter.onTestModuleQueued(browserModule("src/other.test.ts", project));
    const later = fakePage();
    project.browser.provider.pages.set("s9", later);
    reporter.onTestModuleQueued(browserModule("src/third.test.ts", project));
    await settle();
    expect(page.sessions).toBe(1);
    expect(page.cdp.sent).toEqual(["Debugger.enable"]);
    expect(page.cdp.listeners("Debugger.paused")).toBe(1);
    expect(page.cdp.listeners("Debugger.scriptParsed")).toBe(1);
    expect(later.sessions).toBe(1);
    expect(later.cdp.sent).toEqual(["Debugger.enable"]);
  });

  it("prints the paused page's call frames, naming scripts from their parse events", async () => {
    const { page, tick, stackLines } = await runningHangFile();
    page.cdp.emit("Debugger.scriptParsed", { scriptId: "7", url: "http://localhost/src/hang.ts" });
    page.cdp.emit("Debugger.scriptParsed", { scriptId: "8", url: "" });
    page.cdp.pauseWith = [
      {
        functionName: "spinForever",
        url: "",
        location: { scriptId: "7", lineNumber: 9, columnNumber: 4 },
      },
      {
        functionName: "",
        url: "http://localhost/fallback.js",
        location: { scriptId: "8", lineNumber: 0, columnNumber: 0 },
      },
    ];
    tick(60_000);
    await settle();
    expect(stackLines()).toEqual([
      "[file-progress] stack: src/hang.test.ts [browser] has run 60.0s; its page was running JavaScript:",
      "[file-progress] stack:   at spinForever http://localhost/src/hang.ts:10:5",
      "[file-progress] stack:   at (anonymous) http://localhost/fallback.js:1:1",
    ]);
    expect(page.cdp.sent).toEqual(["Debugger.enable", "Debugger.pause", "Debugger.resume"]);
  });

  it("prints at most thirty frames, each on one line", async () => {
    const { page, tick, stackLines } = await runningHangFile();
    page.cdp.pauseWith = Array.from({ length: 40 }, (_, i) => ({
      functionName: `f${i}\nsecond`,
      url: "http://x/a\r\nb.js",
      location: { scriptId: "1", lineNumber: i, columnNumber: 0 },
    }));
    tick(60_000);
    await settle();
    const lines = stackLines();
    expect(lines).toHaveLength(31);
    expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
    expect(lines[1]).toBe("[file-progress] stack:   at f0 second http://x/a  b.js:1:1");
    expect(lines[30]).toBe("[file-progress] stack:   at f29 second http://x/a  b.js:30:1");
  });

  it("says the page is waiting when nothing pauses within 3 seconds but the page answers", async () => {
    const { page, tick, fire, timeouts, stackLines } = await runningHangFile();
    tick(61_000);
    await settle();
    expect(stackLines()).toEqual([]);
    expect(timeouts.map((timer) => [timer.ms, timer.unrefed])).toEqual([[3000, true]]);
    fire(3000);
    await settle();
    expect(page.cdp.sent).toEqual(["Debugger.enable", "Debugger.pause", "Runtime.evaluate"]);
    expect(stackLines()).toEqual([
      "[file-progress] stack: src/hang.test.ts [browser] has run 61.0s; no JavaScript was running and the page answers (it is waiting, not blocked)",
    ]);
    expect(timeouts.map((timer) => [timer.ms, timer.cleared])).toEqual([
      [3000, true],
      [2000, true],
    ]);
  });

  it("says the renderer is stuck when nothing pauses and the page does not answer in 2 seconds", async () => {
    const { page, tick, fire, timeouts, stackLines } = await runningHangFile();
    page.cdp.evaluateAnswers = false;
    tick(60_000);
    await settle();
    fire(3000);
    await settle();
    expect(stackLines()).toEqual([]);
    fire(2000);
    await settle();
    expect(stackLines()).toEqual([
      "[file-progress] stack: src/hang.test.ts [browser] has run 60.0s; no JavaScript paused and the page did not answer in 2s (the renderer is stuck outside JavaScript)",
    ]);
    expect(timeouts.every((timer) => timer.unrefed)).toBe(true);
  });

  it("asks the page whether it answers when the pause request itself is refused", async () => {
    const { page, tick, fire, stackLines } = await runningHangFile();
    page.cdp.pauseFails = true;
    tick(60_000);
    await settle();
    fire(3000);
    await settle();
    expect(stackLines()).toEqual([
      "[file-progress] stack: src/hang.test.ts [browser] has run 60.0s; no JavaScript was running and the page answers (it is waiting, not blocked)",
    ]);
  });

  it("resumes a pause that arrives after the wait gave up, and one nobody asked for", async () => {
    const { page, tick, fire, stackLines } = await runningHangFile();
    page.cdp.emit("Debugger.paused", { callFrames: [] });
    await settle();
    expect(page.cdp.sent).toEqual(["Debugger.enable", "Debugger.resume"]);
    tick(60_000);
    await settle();
    fire(3000);
    await settle();
    const before = stackLines();
    page.cdp.emit("Debugger.paused", {
      callFrames: [
        { functionName: "late", location: { scriptId: "1", lineNumber: 0, columnNumber: 0 } },
      ],
    });
    await settle();
    expect(page.cdp.sent.at(-1)).toBe("Debugger.resume");
    expect(page.cdp.sent.filter((method) => method === "Debugger.resume")).toHaveLength(2);
    expect(stackLines()).toEqual(before);
  });

  it("does not sample a file below the threshold, and samples each file at most once", async () => {
    const { page, tick, timers } = await runningHangFile({ stackAfterMs: 10_000 });
    expect(timers.map((timer) => [timer.ms, timer.unrefed])).toEqual([
      [60_000, true],
      [5000, true],
    ]);
    page.cdp.pauseWith = [];
    tick(9_999);
    await settle();
    expect(page.cdp.sent).toEqual(["Debugger.enable"]);
    tick(1);
    await settle();
    tick(5000);
    await settle();
    expect(page.cdp.sent.filter((method) => method === "Debugger.pause")).toHaveLength(1);
  });

  it("samples only the pages showing the file", async () => {
    const shown = fakePage([frameFor("src/other.test.ts"), frameFor(hangPath)]);
    const elsewhere = fakePage([frameFor("src/other.test.ts")]);
    const project = browserProject([elsewhere, shown]);
    const { reporter, tick, stackLines } = stackHarness();
    reporter.onInit({ projects: [project] });
    reporter.onTestModuleQueued(browserModule(hangPath, project));
    await settle();
    shown.cdp.pauseWith = [];
    tick(60_000);
    await settle();
    expect(elsewhere.cdp.sent).toEqual(["Debugger.enable"]);
    expect(shown.cdp.sent).toContain("Debugger.pause");
    expect(stackLines()).toEqual([
      "[file-progress] stack: src/hang.test.ts [browser] has run 60.0s; its page was running JavaScript:",
    ]);
  });

  it("says so when no attached page shows a browser file", async () => {
    const project = browserProject([fakePage([frameFor("src/other.test.ts")])]);
    const { reporter, tick, stackLines } = stackHarness();
    reporter.onInit({ projects: [project] });
    reporter.onTestModuleQueued(browserModule(hangPath, project));
    await settle();
    tick(60_000);
    await settle();
    expect(stackLines()).toEqual([
      "[file-progress] stack: src/hang.test.ts [browser] has run 60.0s; no browser page showed it, so no stack was taken",
    ]);
  });

  it("writes nothing for a file whose project has no browser", async () => {
    const { reporter, lines, tick } = stackHarness();
    reporter.onInit({ projects: [{ name: "node" }, { name: "other", browser: {} }] });
    reporter.onTestModuleQueued(fakeModule("src/node.test.ts", { project: "node" }));
    await settle();
    tick(120_000);
    await settle();
    expect(lines).toEqual([
      "[file-progress] start src/node.test.ts [node]",
      "[file-progress] still running: src/node.test.ts [node] 120.0s",
    ]);
  });

  it("writes an attach failure once instead of throwing, and samples no failed page", async () => {
    const broken = fakePage([frameFor(hangPath)]);
    broken.context = () => ({
      newCDPSession: () => Promise.reject(new Error("target closed\nnow")),
    });
    const refusing = fakePage([frameFor(hangPath)]);
    refusing.cdp.enableFails = true;
    const gone = fakePage([frameFor(hangPath)]);
    gone.context = () => ({ newCDPSession: () => Promise.reject("gone") });
    const project = browserProject([broken, refusing, gone]);
    const { reporter, tick, stackLines } = stackHarness();
    reporter.onInit({ projects: [project] });
    reporter.onTestModuleQueued(browserModule(hangPath, project));
    reporter.onTestModuleQueued(browserModule("src/again.test.ts", project));
    await settle();
    tick(60_000);
    await settle();
    expect(stackLines()).toEqual([
      "[file-progress] stack: could not attach to a browser page: target closed now",
      "[file-progress] stack: could not attach to a browser page: gone",
      "[file-progress] stack: could not attach to a browser page: enable refused",
      "[file-progress] stack: src/hang.test.ts [browser] has run 60.0s; no browser page showed it, so no stack was taken",
      "[file-progress] stack: src/again.test.ts [browser] has run 60.0s; no browser page showed it, so no stack was taken",
    ]);
  });

  it("writes a failure while sampling instead of rejecting", async () => {
    const { page, tick, stackLines } = await runningHangFile();
    page.frames = () => {
      throw "page closed";
    };
    tick(60_000);
    await settle();
    expect(stackLines()).toEqual([
      "[file-progress] stack: src/hang.test.ts [browser] has run 60.0s; sampling failed: page closed",
    ]);
  });

  it("checks every 5 seconds by default, never holds the process open, and stops at run end", async () => {
    const { reporter, timers } = await runningHangFile();
    expect(timers[1].ms).toBe(5000);
    expect(timers[1].unrefed).toBe(true);
    reporter.onTestRunEnd();
    expect(timers.map((timer) => timer.cleared)).toEqual([true, true]);
  });

  it("uses the global timeouts by default for its bounded waits", async () => {
    const page = fakePage([frameFor(hangPath)]);
    page.cdp.evaluateAnswers = false;
    const project = browserProject([page]);
    const lines = [];
    let clock = 0;
    const intervals = [];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const reporter = new FileProgressReporter({
        now: () => clock,
        write: (line) => lines.push(line),
        setInterval: (fn) => {
          intervals.push(fn);
          return { unref() {} };
        },
        clearInterval: () => {},
      });
      reporter.onInit({ projects: [project] });
      reporter.onTestModuleQueued(browserModule(hangPath, project));
      await vi.advanceTimersByTimeAsync(0);
      clock = 60_000;
      intervals[1]();
      await vi.advanceTimersByTimeAsync(5000);
    } finally {
      vi.useRealTimers();
    }
    expect(lines.at(-1)).toContain("the renderer is stuck outside JavaScript");
  });
});
