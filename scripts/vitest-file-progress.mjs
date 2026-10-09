// A Vitest reporter that prints which test FILE is running, so a CI job that hangs shows the file
// it hung in. Vitest's default reporter, off a terminal, names a file only once it finishes.
// Added to every CI test shard with `--reporter=<this file>`; see docs/developers/ci-and-gates.md.

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
  } = {}) {
    this.now = now;
    this.write = write;
    this.startInterval = startInterval;
    this.stopInterval = stopInterval;
    this.intervalMs = intervalMs;
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

  onTestModuleEnd(testModule) {
    const key = label(testModule);
    const startedAt = this.running.get(key);
    this.running.delete(key);
    const took = startedAt === undefined ? "" : ` ${seconds(this.now() - startedAt)}`;
    this.write(`${PREFIX} end ${key} ${testModule.state()}${took}`);
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

// A452 probe — never merged.
