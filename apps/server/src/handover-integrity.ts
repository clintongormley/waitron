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
let intact = false;
try {
  const db = new DatabaseSync(workerData.path, { readOnly: true, allowExtension: false });
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

/**
 * A thread inside the check ends only when the check returns: `terminate` does not interrupt a
 * running SQLite call. So a stop waits this long at most, less than the server's
 * `SHUTDOWN_DEADLINE_MS`.
 */
const STOP_WAIT_MS = 5000;

/**
 * Whether `pragma integrity_check` and `pragma foreign_key_check` both pass on `path`, on a thread
 * of its own: on a venue-sized file they take long enough that the box would answer nothing
 * meanwhile. A thread that fails or ends without answering rejects, because that says nothing about
 * the file.
 */
export function isCopyIntact(
  path: string,
  options: { signal?: AbortSignal; startWorker?: WorkerStarter; stopWaitMs?: number } = {},
): Promise<boolean> {
  const {
    signal,
    startWorker = (source, opts) => new Worker(source, opts),
    stopWaitMs = STOP_WAIT_MS,
  } = options;
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = startWorker(INTEGRITY_SOURCE, { eval: true, workerData: { path } });
    let stopWait: NodeJS.Timeout | undefined;
    const stop = () => {
      const stopped = () => reject(signal!.reason);
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
      signal?.removeEventListener("abort", stop);
      clearTimeout(stopWait);
      if (signal?.aborted) reject(signal.reason);
      else if (intact === undefined)
        reject(new Error(`the integrity thread exited with code ${code}`));
      else resolve(intact);
    });
  });
}
