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
    intact = checks.length === 1 && checks[0].integrity_check === "ok";
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
 * Whether `pragma integrity_check` passes on `path`, on a thread of its own: on a venue-sized file
 * it takes long enough that the box would answer nothing meanwhile. A thread that fails or ends
 * without answering rejects, because that says nothing about the file.
 */
export function isCopyIntact(
  path: string,
  options: { signal?: AbortSignal; startWorker?: WorkerStarter } = {},
): Promise<boolean> {
  const { signal, startWorker = (source, opts) => new Worker(source, opts) } = options;
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = startWorker(INTEGRITY_SOURCE, { eval: true, workerData: { path } });
    const stop = () => {
      reject(signal!.reason);
      void worker.terminate();
    };
    signal?.addEventListener("abort", stop, { once: true });
    let intact: boolean | undefined;
    worker.once("message", (answer: { intact: boolean }) => {
      intact = answer.intact;
    });
    worker.once("error", reject);
    // Only once it has gone, so the file is closed by the time a caller discards it.
    worker.once("exit", (code) => {
      signal?.removeEventListener("abort", stop);
      if (intact === undefined) reject(new Error(`the integrity thread exited with code ${code}`));
      else resolve(intact);
    });
  });
}
