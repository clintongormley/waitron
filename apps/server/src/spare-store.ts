import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PAIR_STORE_DIR } from "@waitron/store";
import {
  HEALTHY_RUN_MS,
  RESTART_BACKOFF_MS,
  spawnLitestream,
  type ChildHandle,
  type SpawnFn,
} from "@waitron/stream";
import type { Logger } from "./logger.js";

/** Must equal `VERSITYGW_VERSION` in `scripts/setup-s3-test-server.mjs`; `scripts/versitygw-pin.test.ts` reads this line. */
export const VERSITYGW_VERSION = "1.8.0";
export const SPARE_STORE_BUCKET = "waitron";
export const SPARE_STORE_REGION = "us-east-1";

export interface SpareStoreDeps {
  bin: string;
  stateDir: string;
  accessKeyId: string;
  secretAccessKey: string;
  loopbackPort: number;
  /** `spawnLitestream` when absent, which hands the child only `PATH`, `HOME` and the keys. */
  spawn?: SpawnFn;
  log: Logger;
}

export interface SpareStore {
  loopbackUrl: string;
  stop(): Promise<void>;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Runs versitygw on loopback, serving the one bucket the main box streams to, from
 * `<state>/pair-store/`; starts it again after it exits, with the stream supervisor's backoff.
 * The keys reach it through its environment only, never its command line.
 */
export async function startSpareStore(deps: SpareStoreDeps): Promise<SpareStore> {
  const root = join(deps.stateDir, PAIR_STORE_DIR);
  const data = join(root, "data");
  const meta = join(root, "meta");
  // A folder under the gateway's root is a bucket, so no S3 call makes it.
  await mkdir(join(data, SPARE_STORE_BUCKET), { recursive: true, mode: 0o700 });
  await mkdir(meta, { recursive: true, mode: 0o700 });
  const address = `127.0.0.1:${deps.loopbackPort}`;
  const args = [
    "--port",
    address,
    "--region",
    SPARE_STORE_REGION,
    "posix",
    "--sidecar",
    meta,
    data,
  ];
  const env = {
    ROOT_ACCESS_KEY_ID: deps.accessKeyId,
    ROOT_SECRET_ACCESS_KEY: deps.secretAccessKey,
  };
  const spawn = deps.spawn ?? spawnLitestream;
  const wake = new AbortController();
  let current: ChildHandle | undefined;
  const loop = (async () => {
    let attempt = 0;
    while (!wake.signal.aborted) {
      const startedAt = Date.now();
      current = spawn(deps.bin, args, env);
      const code = await current.exited;
      if (wake.signal.aborted) return;
      if (Date.now() - startedAt >= HEALTHY_RUN_MS) attempt = 0;
      const delay = RESTART_BACKOFF_MS[Math.min(attempt, RESTART_BACKOFF_MS.length - 1)]!;
      attempt += 1;
      deps.log("warn", "spare.store_exited", { exitCode: code, restartInMs: delay });
      await sleep(delay, wake.signal);
    }
  })();
  return {
    loopbackUrl: `http://${address}`,
    async stop() {
      wake.abort();
      current?.kill();
      await current?.exited;
      await loop;
    },
  };
}
