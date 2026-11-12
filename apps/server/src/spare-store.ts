import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PAIR_STORE_DIR } from "@waitron/store";
import { codeOf } from "@waitron/server-kit";
import { errnoOf } from "./errno.js";
import {
  abortableSleep,
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
  /** `abortableSleep` when absent. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log: Logger;
}

export interface SpareStore {
  loopbackUrl: string;
  stop(): Promise<void>;
}

/** How many characters from the end of versitygw's output an exit logs. */
const OUTPUT_TAIL = 1_024;

/** The end of `output`, with the pair's two keys taken out wherever they appear. */
function outputTail(output: string, keys: readonly string[]): string {
  return keys.reduce((text, key) => text.replaceAll(key, "[redacted]"), output).slice(-OUTPUT_TAIL);
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
  const sleep = deps.sleep ?? abortableSleep;
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
      deps.log("warn", "spare.store_exited", {
        exitCode: code,
        output: outputTail(current.output(), [deps.secretAccessKey, deps.accessKeyId]),
        restartInMs: delay,
      });
      await sleep(delay, wake.signal);
    }
  })().catch((error: unknown) => {
    deps.log("error", "spare.store_failed", {
      errno: errnoOf(error) ?? null,
      errorCode: codeOf(error),
    });
  });
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
