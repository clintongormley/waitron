// A Vitest reporter that prints which test FILE is running, so a CI job that hangs shows the file
// it hung in. Vitest's default reporter, off a terminal, names a file only once it finishes. In a
// browser project it also attaches Chrome's debugger to each test page, and pauses a page whose
// file has reported no case or hook for 60 seconds longer than its running cases' time limits and
// the project's hook time limit, to print its JavaScript stack.

const PREFIX = "[file-progress]";
const STACK = `${PREFIX} stack:`;
const MAX_FRAMES = 30;
const PAUSE_WAIT_MS = 3000;
const ANSWER_WAIT_MS = 2000;
const TIMED_OUT = Symbol("timed out");

function label(testModule) {
  const project = testModule.project.name;
  return project ? `${testModule.relativeModuleId} [${project}]` : testModule.relativeModuleId;
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function oneLine(text) {
  return String(text).replace(/[\r\n\u2028\u2029]/g, " ");
}

function limit(ms) {
  return typeof ms === "number" ? ms : undefined;
}

// Vitest's timer sets no limit for these (withTimeout in @vitest/runner).
function unbounded(ms) {
  return ms !== undefined && (ms <= 0 || ms === Infinity);
}

// Vitest reruns a case's body for each retry and repeat inside one case-start/case-end pair.
function tries({ retry, repeats } = {}) {
  const retries = typeof retry === "object" ? retry?.count : retry;
  return ((limit(retries) ?? 0) + 1) * ((limit(repeats) ?? 0) + 1);
}

function send(cdp, method, params) {
  return Promise.resolve().then(() => cdp.send(method, params));
}

export default class FileProgressReporter {
  constructor({
    now = () => globalThis.performance.now(),
    write = (line) => process.stdout.write(`${line}\n`),
    setInterval: startInterval = globalThis.setInterval,
    clearInterval: stopInterval = globalThis.clearInterval,
    setTimeout: startTimeout = globalThis.setTimeout,
    clearTimeout: stopTimeout = globalThis.clearTimeout,
    intervalMs = 60_000,
    slowFileMs = 90_000,
    stackCheckMs = 5000,
    stackAfterMs = 60_000,
    traceFiles = (process.env.WAITRON_TEST_TRACE_FILES ?? "")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean),
  } = {}) {
    this.now = now;
    this.write = write;
    this.startInterval = startInterval;
    this.stopInterval = stopInterval;
    this.intervalMs = intervalMs;
    this.slowFileMs = slowFileMs;
    this.traceFiles = new Set(traceFiles);
    this.startTimeout = startTimeout;
    this.stopTimeout = stopTimeout;
    this.stackCheckMs = stackCheckMs;
    this.stackAfterMs = stackAfterMs;
    this.running = new Map();
    this.modules = new Map();
    this.sampled = new Set();
    this.progress = new Map();
    this.cases = new Map();
    this.unbounded = new Set();
    this.unshown = new Set();
    this.pages = new Map();
    this.timer = undefined;
    this.stackTimer = undefined;
  }

  onInit(vitest) {
    this.timer = this.startInterval(() => this.reportRunning(), this.intervalMs);
    this.timer.unref();
    this.vitest = vitest;
    if (!vitest) return;
    this.stackTimer = this.startInterval(() => this.sampleStalledFiles(), this.stackCheckMs);
    this.stackTimer.unref();
  }

  // Queued fires in the worker as it begins collecting the file, so an import that never
  // returns is covered; onTestModuleStart comes only after collection.
  onTestModuleQueued(testModule) {
    this.started(testModule);
  }

  onTestModuleStart(testModule) {
    this.started(testModule);
  }

  onTestModuleCollected(testModule) {
    this.progressed(testModule);
    this.trace(testModule, "collected");
  }

  onTestCaseReady(testCase) {
    this.progressed(testCase.module);
    const key = label(testCase.module);
    if (!this.cases.has(key)) this.cases.set(key, new Map());
    const timeout = testCase.options?.timeout;
    this.cases.get(key).set(testCase.id, {
      // A browser project sends collected tasks as JSON, which turns an Infinity timeout into null.
      timeout: timeout === null ? Infinity : limit(timeout),
      tries: tries(testCase.options),
    });
    this.trace(testCase.module, "case-start", { name: testCase.fullName });
  }

  onTestCaseResult(testCase) {
    this.progressed(testCase.module);
    this.cases.get(label(testCase.module))?.delete(testCase.id);
    this.trace(testCase.module, "case-end", {
      name: testCase.fullName,
      state: testCase.result().state,
    });
  }

  onHookStart(hook) {
    this.hook("hook-start", hook);
  }

  onHookEnd(hook) {
    this.hook("hook-end", hook);
  }

  hook(phase, { name, entity }) {
    const testModule = entity.type === "module" ? entity : entity.module;
    this.progressed(testModule);
    this.trace(testModule, phase, { hook: name, name: entity.fullName });
  }

  progressed(testModule) {
    this.progress.set(label(testModule), this.now());
  }

  trace(testModule, phase, details = {}) {
    if (!this.traceFiles.has(testModule.relativeModuleId)) return;
    this.write(
      `${PREFIX} detail ${JSON.stringify({ file: label(testModule), phase, ...details, atMs: Math.round(this.now()) })}`,
    );
  }

  onTestModuleEnd(testModule) {
    const key = label(testModule);
    const startedAt = this.running.get(key);
    this.running.delete(key);
    this.progress.delete(key);
    this.cases.delete(key);
    if (startedAt === undefined) {
      this.write(`${PREFIX} end ${key} ${testModule.state()}`);
      return;
    }
    const elapsed = this.now() - startedAt;
    this.write(`${PREFIX} end ${key} ${testModule.state()} ${seconds(elapsed)}`);
    if (elapsed > this.slowFileMs) {
      this.write(
        `::warning title=Slow test file::${key} took ${seconds(elapsed)}; a file over ` +
          `${this.slowFileMs / 1000}s holds up its CI shard (docs/developers/ci-and-gates.md)`,
      );
    }
  }

  onTestRunEnd() {
    this.stopInterval(this.timer);
    if (this.stackTimer !== undefined) this.stopInterval(this.stackTimer);
  }

  // Keyed by label, not by object: Vitest hands each hook a different TestModule for one file.
  started(testModule) {
    this.attachPages();
    const key = label(testModule);
    this.progressed(testModule);
    if (this.running.has(key)) return;
    this.running.set(key, this.now());
    this.modules.set(key, { moduleId: testModule.moduleId, project: testModule.project });
    this.write(`${PREFIX} start ${key}`);
  }

  stack(text) {
    this.write(`${STACK} ${oneLine(text)}`);
  }

  attachPages() {
    for (const project of this.vitest?.projects ?? []) {
      const pages = project.browser?.provider?.pages;
      if (!pages) continue;
      for (const page of pages.values()) {
        if (this.pages.has(page)) continue;
        const debuggee = { page, cdp: undefined, scripts: new Map(), waiters: [] };
        this.pages.set(page, debuggee);
        this.attach(debuggee).catch((error) =>
          this.stack(`could not attach to a browser page: ${error?.message ?? error}`),
        );
      }
    }
  }

  async attach(debuggee) {
    const cdp = await debuggee.page.context().newCDPSession(debuggee.page);
    cdp.on("Debugger.scriptParsed", ({ scriptId, url }) => {
      if (url) debuggee.scripts.set(scriptId, url);
    });
    // Resume every pause: one sent to an idle page stops that page's next script.
    cdp.on("Debugger.paused", ({ callFrames }) => {
      const waiters = debuggee.waiters.splice(0);
      for (const waiter of waiters) waiter(callFrames);
      send(cdp, "Debugger.resume").catch(() => {});
    });
    await send(cdp, "Debugger.enable");
    debuggee.cdp = cdp;
  }

  // Bounded and unref'd, so a page that never answers neither hangs a sample nor the process.
  within(ms, promise) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = this.startTimeout(() => resolve(TIMED_OUT), ms);
      timer?.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => this.stopTimeout(timer));
  }

  sampleStalledFiles() {
    const at = this.now();
    for (const [key, startedAt] of this.running) {
      const silent = at - this.progress.get(key);
      if (silent < this.stackAfterMs || this.sampled.has(key)) continue;
      const head = `${key} has run ${seconds(at - startedAt)};`;
      const bound = this.silenceAllowed(key);
      if (bound === undefined) {
        this.noteUnbounded(key, head);
        continue;
      }
      if (silent < bound) continue;
      this.sampleFile(key, head).catch((error) => {
        this.sampled.add(key);
        this.stack(`${head} sampling failed: ${error?.message ?? error}`);
      });
    }
  }

  // The longest running case's timeout plus one hookTimeout, once per try (onTestFinished
  // callbacks are registered again on each try). Not counted: a timeout argument given to a hook
  // or an onTestFinished/onTestFailed callback (the reporter is never handed one), a second such
  // callback, several hooks of one kind in one suite, an aroundEach or aroundAll hook (none of
  // these reports its own event), and a retry's delay; only the 60-second margin covers those.
  // Undefined when a limit Vitest treats as none may cover what is running.
  silenceAllowed(key) {
    const config = this.modules.get(key).project.config ?? {};
    const testTimeout = limit(config.testTimeout);
    const running = [...(this.cases.get(key)?.values() ?? [])];
    const cases = running.length > 0 ? running : [{ timeout: undefined, tries: 1 }];
    const caseTimeouts = cases.map((testCase) => testCase.timeout ?? testTimeout);
    const hookTimeout = limit(config.hookTimeout);
    if (caseTimeouts.some(unbounded) || unbounded(hookTimeout)) return undefined;
    const tryLimits = cases.map(
      ({ tries }, i) => ((caseTimeouts[i] ?? 0) + (hookTimeout ?? 0)) * tries,
    );
    return this.stackAfterMs + Math.max(...tryLimits);
  }

  noteUnbounded(key, head) {
    if (this.unbounded.has(key) || !this.modules.get(key).project.browser?.provider?.pages) return;
    this.unbounded.add(key);
    this.stack(
      `${head} what is running may have no time limit (0 or less, or Infinity), so its page is not paused now`,
    );
  }

  async sampleFile(key, head) {
    const { moduleId, project } = this.modules.get(key);
    if (!project.browser?.provider?.pages) {
      this.sampled.add(key);
      return;
    }
    const needle = encodeURIComponent(moduleId);
    const showing = [...this.pages.values()].filter(
      ({ cdp, page }) => cdp && page.frames().some((frame) => frame.url().includes(needle)),
    );
    if (showing.length === 0) {
      if (this.unshown.has(key)) return;
      this.unshown.add(key);
      this.stack(`${head} no browser page showed it yet, so no stack was taken`);
      return;
    }
    this.sampled.add(key);
    await Promise.all(showing.map((debuggee) => this.samplePage(debuggee, head)));
  }

  async samplePage(debuggee, head) {
    let waiter;
    const paused = new Promise((resolve) => {
      waiter = resolve;
      debuggee.waiters.push(resolve);
    });
    let refused;
    send(debuggee.cdp, "Debugger.pause").catch((error) => {
      refused = error?.message ?? error;
    });
    const callFrames = await this.within(PAUSE_WAIT_MS, paused);
    if (callFrames !== TIMED_OUT) {
      this.stack(`${head} its page was running JavaScript:`);
      for (const { functionName, url, location } of callFrames.slice(0, MAX_FRAMES)) {
        const script = debuggee.scripts.get(location.scriptId) ?? url;
        this.stack(
          `  at ${functionName || "(anonymous)"} ${script}:${location.lineNumber + 1}:${location.columnNumber + 1}`,
        );
      }
      return;
    }
    debuggee.waiters = debuggee.waiters.filter((pending) => pending !== waiter);
    // A pause left armed would stop the page's next script, in whatever test runs it.
    const answer = await this.within(
      ANSWER_WAIT_MS,
      send(debuggee.cdp, "Debugger.disable")
        .then(() => send(debuggee.cdp, "Debugger.enable"))
        .then(() => send(debuggee.cdp, "Runtime.evaluate", { expression: "0" })),
    );
    const reply =
      answer === TIMED_OUT
        ? `the page did not answer in ${ANSWER_WAIT_MS / 1000}s`
        : "the page answers";
    this.stack(
      refused === undefined
        ? `${head} no JavaScript paused within ${PAUSE_WAIT_MS / 1000}s and ${reply}`
        : `${head} the pause request was refused (${refused}); ${reply}`,
    );
  }

  reportRunning() {
    const at = this.now();
    for (const [key, startedAt] of this.running) {
      this.write(`${PREFIX} still running: ${key} ${seconds(at - startedAt)}`);
    }
  }
}
