import { closeSync, openSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Worker } from "node:worker_threads";

// Inline JavaScript also ships inside the server bundle; it imports only Node built-ins.
const copyScript = `
  const { workerData } = require("node:worker_threads");
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(workerData.source, { readOnly: true });
  try {
    db.exec("pragma busy_timeout = 5000");
    db.prepare("vacuum into ?").run(workerData.working);
  } finally {
    db.close();
  }
`;

/** The caller holds the venue folder until the copy finishes, including after an abort. */
export async function archiveInWorker(
  sourcePath: string,
  targetPath: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const working = `${targetPath}.partial`;
  await rm(working, { force: true });
  try {
    signal?.throwIfAborted();
    // VACUUM preserves an empty file's mode; a file SQLite creates itself may be world-readable.
    closeSync(openSync(working, "a", 0o600));
    const worker = new Worker(copyScript, {
      eval: true,
      workerData: { source: sourcePath, working },
    });
    await new Promise<void>((resolve, reject) => {
      let failure: unknown;
      worker.once("error", (error) => {
        failure = error;
      });
      worker.once("exit", (code) => {
        if (signal?.aborted) reject(signal.reason);
        else if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`Archive worker exited with code ${code}`));
        else resolve();
      });
    });
    signal?.throwIfAborted();
    await rename(working, targetPath);
  } catch (error) {
    await rm(working, { force: true });
    throw error;
  }
}
