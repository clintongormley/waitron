import { Worker } from "node:worker_threads";
import { withArchiveFile } from "./archive.js";

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
  await withArchiveFile(targetPath, async (working) => {
    signal?.throwIfAborted();
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
  });
}
