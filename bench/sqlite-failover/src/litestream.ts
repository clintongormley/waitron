/**
 * Driving the real litestream binary: find it, point it at a store, stream, and restore.
 *
 * Everything here is a fact about the PIN below and nothing wider. Litestream 0.5 is not 0.3 — the
 * config takes a singular `replica:` object where 0.3 took a `replicas:` list, and the replica is
 * given as a URL — so a reader arriving from 0.3's documentation will find the shape here
 * unfamiliar. The receipts for each choice sit beside it.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "./store.ts";

/** The pinned release. `litestream version` prints exactly this, with no `v`, on stdout. */
export const LITESTREAM_VERSION = "0.5.17";

/** `<package>/.bin/litestream` — where `setup:litestream` puts the downloaded binary. */
export const BUNDLED_BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".bin",
  "litestream",
);

/**
 * The variable names the generated config references. Litestream expands `${VAR}` in the config by
 * default (its `-no-expand-env` flag turns that off), so the yaml names these and the spawn supplies
 * the values, and no credential is written to a file.
 *
 * One consequence of expansion being on: a `$` anywhere in a value would be expanded too. The
 * store's credentials are fixed ASCII constants (`src/store.ts`), so that case does not arise here —
 * which is a statement about this rig's credentials, not about what litestream would do with others.
 */
const ENV_ACCESS_KEY_ID = "WAITRON_BENCH_ACCESS_KEY_ID";
const ENV_SECRET_ACCESS_KEY = "WAITRON_BENCH_SECRET_ACCESS_KEY";

/**
 * Which credentials each config file's child process needs, keyed by config path. The three spawn
 * helpers take a config path and no store, so this is how the value the config only NAMES reaches
 * the child.
 */
const credentialsByConfig = new Map<string, Store["credentials"]>();

/**
 * The pinned binary, or `null`. Never throws: the scenarios treat "no litestream here" as SKIPPED,
 * and an exception from a lookup would be recorded as a critical failure of the harness instead.
 *
 * A wrong VERSION is also `null`, not a warning. Everything this rig records about litestream is a
 * measurement on the pin, so a different build silently answering the same calls would produce
 * results attributed to a version that never ran.
 */
export async function resolveLitestream(): Promise<{ bin: string; version: string } | null> {
  const candidates = [process.env.LITESTREAM_BIN, BUNDLED_BIN, "litestream"];
  for (const bin of candidates) {
    if (!bin) continue;
    const probe = await run(bin, ["version"], {});
    if (probe.code !== 0) continue;
    const version = probe.stdout.trim();
    if (version === LITESTREAM_VERSION) return { bin, version };
  }
  return null;
}

/**
 * A litestream config replicating one database to one prefix in `store`, written to `configPath`.
 *
 * `force-path-style=true` is what MinIO wants in general, but it was NOT required in the run that
 * established this shape: against a `http://localhost:<port>` endpoint, the same one-shot sync with
 * the parameter removed also exited 0 and wrote its object (measured 2026-09-18, litestream 0.5.17,
 * the pinned MinIO image). It is kept because nothing here has tested a non-localhost endpoint.
 *
 * No WAL pragma is set on the database first, and none is needed: a database left in `openNode`'s
 * default `delete` journal mode replicated with `replicate -once` (exit 0) and restored its rows,
 * with `PRAGMA journal_mode` reading `delete` before the run and `wal` after — litestream switched
 * it (same measurement).
 */
export function writeConfig(opts: {
  dbPath: string;
  store: Store;
  prefix: string;
  configPath: string;
}): string {
  const { dbPath, store, prefix, configPath } = opts;
  const url = `s3://${store.bucket}/${prefix}?endpoint=${store.endpoint}&region=us-east-1&force-path-style=true`;
  writeFileSync(
    configPath,
    [
      `access-key-id: \${${ENV_ACCESS_KEY_ID}}`,
      `secret-access-key: \${${ENV_SECRET_ACCESS_KEY}}`,
      ``,
      `dbs:`,
      `  - path: ${dbPath}`,
      `    replica:`,
      `      url: ${url}`,
      ``,
    ].join("\n"),
  );
  credentialsByConfig.set(configPath, store.credentials);
  return configPath;
}

/**
 * The long-running `litestream replicate` daemon.
 *
 * `kill()` sends SIGTERM and `exited` resolves with the exit code, so a caller can wait for the
 * child to be gone rather than for the signal to have been sent. Every child is also registered for
 * the parent's own exit (see `children` below): the scenario kills it in a `finally`, but a runner
 * that dies outside that `finally` would otherwise leave litestream streaming to a container nobody
 * is going to stop.
 */
export function replicate(
  bin: string,
  config: string,
): { kill(): void; exited: Promise<number | null> } {
  const child = spawn(bin, ["replicate", "-config", config], {
    env: childEnv(config),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);

  let killed = false;
  let log = "";
  // BOTH streams, and stdout is the one that matters: litestream 0.5.17 logs to STDOUT unless the
  // config sets `logging.stderr: true` (its bundled `etc/litestream.yml` documents the default as
  // false). Measured 2026-09-18 on the pin — one `replicate -once` run redirected separately gave
  // 7 lines on stdout and 0 on stderr. A daemon whose stdout was discarded would report its own
  // death with an empty explanation.
  const collect = (chunk: Buffer) => (log = tail(log + chunk.toString()));
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  const exited = new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      children.delete(child);
      // A daemon that died on its own explains why every later restore saw a short database; the
      // scenario's own failure message can only say that it did.
      if (!killed && code !== 0) console.error(`litestream replicate exited ${code}: ${log}`);
      resolve(code);
    });
    child.on("error", () => {
      children.delete(child);
      resolve(null);
    });
  });

  return {
    kill() {
      killed = true;
      child.kill("SIGTERM");
    },
    exited,
  };
}

/**
 * Rebuild `dbName`'s replica into `outPath`. Writes `-shm`/`-wal` sidecars beside `outPath` too.
 *
 * `dbName` is the database's path as the config names it, not a file that has to exist: restoring
 * with the source moved away returned every row (measured 2026-09-18), which is what makes a restore
 * evidence that the STORE holds the data.
 *
 * A prefix with no backup is an exit 1 and `Error: no matching backup files available` on stderr,
 * with no output file created — so the rejection here carries stderr, and a caller can tell a
 * refusal from a crash by reading it. Stderr is the right stream to carry: a real store failure
 * lands there too (measured 2026-09-18 against a bucket that did not exist — exit 1, 0 lines on
 * stdout, the `NoSuchBucket` line on stderr). That is the opposite of the DAEMON above, whose
 * ordinary logging goes to stdout.
 *
 * Two things `outPath` has to already be, both measured on the pin on 2026-09-18, and both waiting
 * for whichever later scenario restores over a database that is already there: an EMPTY file at
 * `outPath` is fine and litestream removes it when the restore then fails, while a NON-EMPTY one is
 * refused before any store call — `Error: cannot restore, output path already exists and is not
 * empty: …. Use -force to overwrite`. Nothing here passes `-force`.
 */
export async function restore(
  bin: string,
  config: string,
  dbName: string,
  outPath: string,
): Promise<void> {
  const result = await run(bin, ["restore", "-config", config, "-o", outPath, dbName], {
    env: childEnv(config),
  });
  if (result.code !== 0) {
    throw new Error(`litestream restore exited ${result.code}: ${result.stderr.trim()}`);
  }
}

/**
 * One upload of everything outstanding, with no daemon left behind.
 *
 * The one-shot is `replicate -once` ("one-shot replication complete", exit 0). It is NOT the `sync`
 * subcommand, whose help asks for a control socket (`-socket PATH`, default
 * `/var/run/litestream.sock`) — that talks to a daemon that is already running (measured
 * 2026-09-18 on the pin).
 */
export async function syncOnce(bin: string, config: string): Promise<void> {
  const result = await run(bin, ["replicate", "-once", "-config", config], {
    env: childEnv(config),
  });
  if (result.code !== 0) {
    throw new Error(`litestream replicate -once exited ${result.code}: ${result.stderr.trim()}`);
  }
}

/** Live `replicate` children, killed if this process exits before a scenario's `finally` runs. */
const children = new Set<ReturnType<typeof spawn>>();
process.on("exit", () => {
  for (const child of children) child.kill("SIGTERM");
});

function childEnv(config: string): NodeJS.ProcessEnv {
  const credentials = credentialsByConfig.get(config);
  if (!credentials) {
    // The config names the two variables and holds no values, so a config this module did not write
    // would reach litestream with empty credentials and fail as an S3 error — which names the store,
    // not the mistake.
    throw new Error(`no credentials recorded for ${config}; it was not written by writeConfig`);
  }
  return {
    ...process.env,
    [ENV_ACCESS_KEY_ID]: credentials.accessKeyId,
    [ENV_SECRET_ACCESS_KEY]: credentials.secretAccessKey,
  };
}

function run(
  bin: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout = tail(stdout + chunk.toString())));
    child.stderr.on("data", (chunk: Buffer) => (stderr = tail(stderr + chunk.toString())));
    // A missing binary is an `error` event, not a non-zero exit, and `resolveLitestream` walks a
    // list of candidates most of which are expected to be absent.
    child.on("error", (error) => resolve({ code: null, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Keep the last 8 KiB: enough for litestream's refusal line, bounded for a daemon that logs on. */
function tail(text: string): string {
  return text.length > 8192 ? text.slice(-8192) : text;
}
