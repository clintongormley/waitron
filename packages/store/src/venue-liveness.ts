import { hostname } from "node:os";
import { Worker } from "node:worker_threads";
import {
  removeVenueHolder,
  VENUE_HOLDER_STALE_MS,
  writeVenueHolder,
  type VenueHolder,
  type VenueHolderKind,
} from "./venue-holder.js";

export const HOLDER_HEARTBEAT_MS = 5000;
export const WATCHDOG_TICK_MS = 1000;
/** How long the watchdog waits for the frozen thread to pause before killing it without a stack. */
export const STACK_CAPTURE_MS = 2000;
export const VENUE_HOLDER_FROZEN_CODE = "provisioning.database_holder_frozen";

interface Timings {
  heartbeatMs: number;
  tickMs: number;
  staleMs: number;
  captureMs: number;
}

const PRODUCTION_TIMINGS: Timings = {
  heartbeatMs: HOLDER_HEARTBEAT_MS,
  tickMs: WATCHDOG_TICK_MS,
  staleMs: VENUE_HOLDER_STALE_MS,
  captureMs: STACK_CAPTURE_MS,
};

let timings = PRODUCTION_TIMINGS;

/** For tests: bounds for folders taken from now on. Anything left out is the production value. */
export function setVenueLivenessTimings(overrides: Partial<Timings>): void {
  timings = { ...PRODUCTION_TIMINGS, ...overrides };
}

interface WatchdogSettings {
  kind: VenueHolderKind;
  crashReportDirectory: string | null;
  version: string | null;
}

const settings: WatchdogSettings = { kind: "script", crashReportDirectory: null, version: null };

/** Posts every change to a running watchdog, whose thread cannot ask once the main thread froze. */
const update = (change: Partial<WatchdogSettings>) => {
  Object.assign(settings, change);
  watchdog?.worker.postMessage(change);
};

/** What this process says it is in the holder file and a watchdog report. Default `script`. */
export function setVenueHolderKind(kind: VenueHolderKind): void {
  update({ kind });
}

/**
 * Where the watchdog leaves one JSON file per kill, and the Waitron version it stamps on each.
 * `null` directory: no file, only the stderr line.
 */
export function setVenueCrashReportDirectory(
  directory: string | null,
  version: string | null,
): void {
  update({ crashReportDirectory: directory, version });
}

/**
 * The watchdog, as a source string rather than a module so the bundler (`scripts/bundle-node.mjs`)
 * carries it as text: a worker file path would not exist beside the bundle. It reaches Node's modules
 * through `process.getBuiltinModule` because the eval'd source is parsed as a module or as a script
 * depending on the parent's flags: under `--input-type=module`, `require` was undefined in it
 * (`venue-liveness.test.ts` runs its children that way).
 *
 * It writes with `fs.writeSync(2, …)` because a worker's `console` is relayed through the main
 * thread, which is the thread that has frozen: measured on Node v26.7.0, a worker's `console.error`
 * never printed while the main thread spun.
 *
 * The line and the report file carry the code, the frames, the holder's kind, pid, host and times,
 * and the version, and nothing else — no environment, command line, frame variables or venue data —
 * because both outlive the process in places other people read.
 *
 * Inspector reaches a thread spinning in JavaScript and not one blocked inside native code, such as
 * a synchronous SQLite statement; after `captureMs` the process is killed without a stack either way
 * (both cases are in `./venue-liveness.test.ts`).
 */
const WATCHDOG_SOURCE = String.raw`
const { workerData, parentPort } = process.getBuiltinModule("node:worker_threads");
const fs = process.getBuiltinModule("node:fs");
const path = process.getBuiltinModule("node:path");
const os = process.getBuiltinModule("node:os");
const inspector = process.getBuiltinModule("node:inspector");

const settings = workerData.settings;
parentPort.on("message", (change) => Object.assign(settings, change));
const beat = new BigInt64Array(workerData.beat);
const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

const check = setInterval(() => {
  const silentMs = nowMs() - Number(Atomics.load(beat, 0) / 1000000n);
  if (silentMs < workerData.staleMs) return;
  clearInterval(check);
  const lastTickAt = new Date(Date.now() - silentMs).toISOString();
  capture((stack) => kill(stack, lastTickAt));
}, workerData.tickMs);

function capture(done) {
  let finished = false;
  const finish = (stack) => {
    if (finished) return;
    finished = true;
    done(stack);
  };
  setTimeout(() => finish(null), workerData.captureMs);
  try {
    const session = new inspector.Session();
    session.connectToMainThread();
    // A paused frame's own url comes back empty; the script it names is announced on enable.
    const scripts = new Map();
    session.on("Debugger.scriptParsed", ({ params }) => scripts.set(params.scriptId, params.url));
    session.once("Debugger.paused", ({ params }) =>
      finish(
        params.callFrames.map((frame) => ({
          function: frame.functionName || "<anonymous>",
          file: path.basename(scripts.get(frame.location.scriptId) || frame.url),
          line: frame.location.lineNumber + 1,
          column: frame.location.columnNumber + 1,
        })),
      ),
    );
    session.post("Debugger.enable", () => session.post("Debugger.pause"));
  } catch {
    finish(null);
  }
}

function kill(stack, lastTickAt) {
  const killedAt = new Date().toISOString();
  const facts = {
    code: workerData.code,
    kind: settings.kind,
    pid: process.pid,
    lockedAt: workerData.lockedAt,
    lastTickAt,
    stack,
  };
  try {
    fs.writeSync(2, JSON.stringify({ ...facts, at: killedAt, level: "error", event: "venue.holder_frozen" }) + "\n");
  } catch {}
  try {
    const directory = settings.crashReportDirectory;
    if (directory !== null) {
      fs.mkdirSync(directory, { recursive: true });
      const report = { ...facts, host: os.hostname(), killedAt, version: settings.version };
      const name = "holder-frozen-" + killedAt.replace(/[:.]/g, "-") + "-" + process.pid + ".json";
      fs.writeFileSync(path.join(directory, name), JSON.stringify(report) + "\n");
    }
  } catch {}
  process.kill(process.pid, "SIGKILL");
}
`;

interface Watchdog {
  worker: Worker;
  tick: NodeJS.Timeout;
}

let watchdog: Watchdog | undefined;
let stopping: Promise<unknown> = Promise.resolve();

/**
 * Settles once the last watchdog this process stopped has ended. A worker's thread holds two file
 * descriptors until then (measured on Node v26.7.0: 12 open, 14 after `new Worker`, 14 after
 * `terminate()` is called, 12 once it resolves).
 */
export async function watchdogStopped(): Promise<void> {
  await stopping;
}

/** For tests: the watchdog thread while this process holds any folder. */
export function runningWatchdog(): Worker | undefined {
  return watchdog?.worker;
}

/** Reported as a process warning: a failing liveness side has no caller to throw to. */
const warn = (error: unknown, name: string) => process.emitWarning((error as Error).message, name);

function startWatchdog(lockedAt: string): Watchdog {
  // The main thread's monotonic clock, which the worker reads on the same clock: a wall-clock step
  // (a box setting its time at boot) must not look like a frozen thread.
  const beat = new BigInt64Array(new SharedArrayBuffer(8));
  const stamp = () => Atomics.store(beat, 0, process.hrtime.bigint());
  stamp();
  const tick = setInterval(stamp, timings.tickMs);
  tick.unref();
  const worker = new Worker(WATCHDOG_SOURCE, {
    eval: true,
    workerData: {
      beat: beat.buffer,
      settings,
      code: VENUE_HOLDER_FROZEN_CODE,
      lockedAt,
      staleMs: timings.staleMs,
      tickMs: timings.tickMs,
      captureMs: timings.captureMs,
    },
  });
  worker.unref();
  worker.on("error", (error) => warn(error, "VenueWatchdogWarning"));
  return { worker, tick };
}

/** The heartbeat of each folder this process holds, keyed by the lock's real path. */
const heartbeats = new Map<string, NodeJS.Timeout>();

/**
 * Called in the synchronous section that first takes a folder's lock. When the holder file cannot
 * be written it throws before starting anything, and the caller gives the lock back: without the
 * file, a process refused the folder cannot tell this live holder from a frozen one.
 */
export function beginHolding(directory: string): void {
  const now = new Date().toISOString();
  const holder: VenueHolder = {
    kind: settings.kind,
    pid: process.pid,
    host: hostname(),
    lockedAt: now,
    heartbeatAt: now,
  };
  writeVenueHolder(directory, holder);
  let failing = false;
  const heartbeat = setInterval(() => {
    try {
      writeVenueHolder(directory, {
        ...holder,
        kind: settings.kind,
        heartbeatAt: new Date().toISOString(),
      });
      failing = false;
    } catch (error) {
      // Once per run of failures: the next beat retries, and the file ages meanwhile.
      if (!failing) warn(error, "VenueHolderHeartbeatWarning");
      failing = true;
    }
  }, timings.heartbeatMs);
  heartbeat.unref();
  heartbeats.set(directory, heartbeat);
  watchdog ??= startWatchdog(now);
}

/** Called on a folder's last release, while its lock is still held. */
export function endHolding(directory: string): void {
  clearInterval(heartbeats.get(directory));
  heartbeats.delete(directory);
  try {
    removeVenueHolder(directory);
  } catch (error) {
    warn(error, "VenueHolderRemoveWarning");
  }
  if (heartbeats.size > 0) return;
  clearInterval(watchdog!.tick);
  stopping = watchdog!.worker.terminate();
  watchdog = undefined;
}
