import { resolve as resolvePath } from "node:path";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { Worker, type WorkerOptions } from "node:worker_threads";

/**
 * As text, because the bundler (`scripts/bundle-node.mjs`) folds the server into one file and a
 * worker file's path would not exist beside it. It reaches Node's modules the way
 * `packages/store/src/venue-liveness.ts`'s worker does. Every failure to open or read the file
 * means the same as a failed check: the thread answers and ends normally.
 */
const INTEGRITY_SOURCE = String.raw`
const { workerData, parentPort } = process.getBuiltinModule("node:worker_threads");
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const { pathToFileURL } = process.getBuiltinModule("node:url");
let intact = false;
try {
  let target = workerData.path;
  if (workerData.immutable) {
    target = pathToFileURL(workerData.path);
    target.searchParams.set("mode", "ro");
    target.searchParams.set("immutable", "1");
  }
  const db = new DatabaseSync(target, { readOnly: true, allowExtension: false });
  try {
    db.exec("pragma query_only=on");
    const checks = db.prepare("pragma integrity_check").all();
    intact =
      checks.length === 1 &&
      checks[0].integrity_check === "ok" &&
      db.prepare("pragma foreign_key_check").get() === undefined;
  } finally {
    db.close();
  }
} catch {
  intact = false;
}
parentPort.postMessage({ intact });
`;

type WorkerStarter = (source: string, options: WorkerOptions) => Worker;

const runningChecks = new Set<string>();

export function copyCheckRunning(path: string): boolean {
  return runningChecks.has(resolvePath(path));
}

/**
 * A stop waits this long at most, less than the server's
 * `SHUTDOWN_DEADLINE_MS`.
 */
const STOP_WAIT_MS = 5000;

// Provisional budget for the same SQLite checks across copy paths, unmeasured for venue size.
const INTEGRITY_LIMIT_MS = 30 * 60_000;

export async function checkCopyIntegrity(
  path: string,
  options: Parameters<typeof isCopyIntact>[1] & { limitMs?: number } = {},
): Promise<boolean> {
  const { limitMs = INTEGRITY_LIMIT_MS, signal, ...workerOptions } = options;
  const deadline = new AbortController();
  const timer = setTimeout(
    () =>
      deadline.abort(
        new AppError("handover.copy_check_failed", { module: "core" }, { reason: "timeout" }),
      ),
    limitMs,
  );
  timer.unref();
  try {
    return await isCopyIntact(path, {
      ...workerOptions,
      signal: signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal]),
    });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether `pragma integrity_check` and `pragma foreign_key_check` both pass on `path`, on a thread
 * of its own: on a venue-sized file they take long enough that the box would answer nothing
 * meanwhile. A thread that fails or ends without answering rejects, because that says nothing about
 * the file. `immutable` reads the main file alone and leaves no `-wal` or `-shm` beside it; it is
 * only for a caller that has already refused a `-wal` or a `-journal` there.
 */
export function isCopyIntact(
  path: string,
  options: {
    signal?: AbortSignal;
    startWorker?: WorkerStarter;
    stopWaitMs?: number;
    immutable?: boolean;
  } = {},
): Promise<boolean> {
  const {
    signal,
    immutable = false,
    startWorker = (source, opts) => new Worker(source, opts),
    stopWaitMs = STOP_WAIT_MS,
  } = options;
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const key = resolvePath(path);
    if (runningChecks.has(key))
      throw new AppError("handover.copy_check_failed", { module: "core" });
    const worker = startWorker(INTEGRITY_SOURCE, { eval: true, workerData: { path, immutable } });
    runningChecks.add(key);
    let stopWait: NodeJS.Timeout | undefined;
    const stop = () => {
      const stopped = () => {
        worker.unref();
        reject(signal!.reason);
      };
      stopWait = setTimeout(stopped, stopWaitMs);
      stopWait.unref();
      worker.terminate().catch(stopped);
    };
    signal?.addEventListener("abort", stop, { once: true });
    let intact: boolean | undefined;
    worker.once("message", (answer: { intact: boolean }) => {
      intact = answer.intact;
    });
    worker.once("error", reject);
    // Only once it has gone, so the file is closed by the time a caller discards it. A stop that
    // outlasts `stopWaitMs` answers without this, with the file possibly still open.
    worker.once("exit", (code) => {
      runningChecks.delete(key);
      signal?.removeEventListener("abort", stop);
      clearTimeout(stopWait);
      if (signal?.aborted) reject(signal.reason);
      else if (intact === undefined)
        reject(new Error(`the integrity thread exited with code ${code}`));
      else resolve(intact);
    });
  });
}
