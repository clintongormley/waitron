// A Vitest reporter that prints which test FILE is running, so a CI job that hangs shows the file
// it hung in. Vitest's default reporter, off a terminal, names a file only once it finishes.

const PREFIX = "[file-progress]";

function label(testModule) {
  const project = testModule.project.name;
  return project ? `${testModule.relativeModuleId} [${project}]` : testModule.relativeModuleId;
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

export default class FileProgressReporter {
  constructor({
    now = () => globalThis.performance.now(),
    write = (line) => process.stdout.write(`${line}\n`),
    setInterval: startInterval = globalThis.setInterval,
    clearInterval: stopInterval = globalThis.clearInterval,
    intervalMs = 60_000,
    slowFileMs = 90_000,
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
    this.running = new Map();
    this.timer = undefined;
  }

  onInit() {
    this.timer = this.startInterval(() => this.reportRunning(), this.intervalMs);
    this.timer.unref();
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
    this.trace(testModule, "collected");
  }

  onTestCaseReady(testCase) {
    this.trace(testCase.module, "case-start", { name: testCase.fullName });
  }

  onTestCaseResult(testCase) {
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
    this.trace(testModule, phase, { hook: name, name: entity.fullName });
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
  }

  // Keyed by label, not by object: Vitest hands each hook a different TestModule for one file.
  started(testModule) {
    const key = label(testModule);
    if (this.running.has(key)) return;
    this.running.set(key, this.now());
    this.write(`${PREFIX} start ${key}`);
  }

  reportRunning() {
    const at = this.now();
    for (const [key, startedAt] of this.running) {
      this.write(`${PREFIX} still running: ${key} ${seconds(at - startedAt)}`);
    }
  }
}
