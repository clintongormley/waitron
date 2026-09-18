/**
 * Driving the real litestream binary: find it, point it at a store, stream, and restore.
 *
 * Everything here is a fact about the PIN below and nothing wider. The config shape this module
 * writes — a singular `replica:` object holding a URL — is the one litestream 0.5's own bundled
 * sample documents (`etc/litestream.yml` in the release tarball), and it is the shape every
 * measurement in this file was taken on. It is NOT the only shape the pin accepts: 0.3's plural
 * `replicas:` list with separate `type`/`bucket`/`path`/`endpoint`/`region` keys was also given to
 * this binary on 2026-09-18 and it replicated and restored just as well. So a reader arriving from
 * 0.3's documentation will find this unfamiliar, not wrong. The receipts for each choice sit beside
 * it.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "./store.ts";

/** The pinned release. `litestream version` prints exactly this, with no `v`, on stdout. */
export const LITESTREAM_VERSION = "0.5.17";

/**
 * How long any one litestream call may take before it is killed. Generous: the slowest call this
 * rig makes is a restore, and the recorded runs finish one in well under a second against a local
 * container. It is a bound on a stall, not a performance budget.
 */
const CHILD_TIMEOUT_MS = 30_000;

/** How long a `replicate` daemon is given to honour SIGTERM before it is killed outright. */
const KILL_GRACE_MS = 5_000;

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
 * Expansion is of the YAML TEXT, not of what the environment supplies for it. Measured 2026-09-18
 * against a MinIO whose own root password was the literal `waitron$NOT_SET_ANYWHERE`, handed to the
 * child under these variable names: the one-shot sync completed and its object was written, so the
 * `$NOT_SET_ANYWHERE` inside the value was passed through rather than expanded to nothing. What was
 * NOT tested is a `$` written directly into the config file, which is the thing expansion is for.
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
    // A short bound of its own: a candidate that does not answer `version` promptly is not the
    // pinned binary, and the lookup walks a list.
    const probe = await run(bin, ["version"], { timeoutMs: 10_000 });
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
 * `kill()` asks first and insists afterwards: SIGTERM, then SIGKILL if the child is still there a
 * few seconds later, and `exited` settles either way. Asking first is deliberate — a daemon given
 * SIGTERM flushes what it has to the store before exiting, which is the behaviour S0 and S3 will
 * want — but asking alone is not a bound. Measured 2026-09-18 against a stub that declines SIGTERM
 * (`trap '' TERM`): before this escalation, `exited` was still unsettled 20 seconds after `kill()`,
 * and the scenario's `finally` awaits it before anything stops the MinIO container.
 *
 * Every child is also registered for the parent's own exit (see `children` below): the scenario
 * kills it in a `finally`, but a runner that dies outside that `finally` would otherwise leave
 * litestream streaming to a container nobody is going to stop.
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

  let settleExit: (code: number | null) => void = () => {};
  const exited = new Promise<number | null>((resolve) => {
    settleExit = (code) => {
      children.delete(child);
      resolve(code);
    };
    child.on("close", (code) => {
      // A daemon that died on its own explains why every later restore saw a short database; the
      // scenario's own failure message can only say that it did.
      if (!killed && code !== 0) console.error(`litestream replicate exited ${code}: ${log}`);
      settleExit(code);
    });
    child.on("error", () => settleExit(null));
  });

  return {
    kill() {
      killed = true;
      child.kill("SIGTERM");
      const escalation = setTimeout(() => {
        child.kill("SIGKILL");
        // Settled here for the reason `run()` records: `close` fires when the stdio pipes close, not
        // when the process dies, so a killed child whose own children hold those pipes never
        // produces it. The pipes are destroyed too, or their open handles keep the event loop alive
        // and the RUNNER never exits even though every promise has settled.
        child.stdout?.destroy();
        child.stderr?.destroy();
        settleExit(null);
      }, KILL_GRACE_MS);
      escalation.unref();
    },
    exited,
  };
}

/**
 * Rebuild `dbName`'s replica into `outPath`.
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
 *
 * A successful restore writes `outPath` and nothing else. The `-shm`/`-wal` sidecars that appear
 * beside it are SQLite's, created when something opens the result: measured 2026-09-18, a listing
 * taken between the restore and the first open showed neither file, and both after.
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
  if (result.timedOut) {
    throw new Error(
      `litestream restore was killed after ${CHILD_TIMEOUT_MS}ms: ${result.stderr.trim()}`,
    );
  }
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
  if (result.timedOut) {
    throw new Error(
      `litestream replicate -once was killed after ${CHILD_TIMEOUT_MS}ms: ${result.stderr.trim()}`,
    );
  }
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

/**
 * Every one-shot litestream call is bounded here rather than at each caller. (`replicate`'s daemon
 * is deliberately not: it runs until the scenario kills it, and its own bound is the escalation in
 * `kill()`.)
 *
 * A caller's own deadline cannot help: a loop that re-checks the clock each time round never gets
 * back to the check while it is awaiting a child that has stopped making progress. Measured
 * 2026-09-18 with a stub binary whose `restore` runs `sleep 100000` — before this timeout, the
 * scenario's 60-second poll was still unsettled at 65 seconds and its `finally` had not run, so the
 * MinIO container stayed up as well. `CLAUDE.md` §4 states the rule a Vitest timer paid for: use an
 * outer deadline.
 *
 * SIGKILL rather than SIGTERM, because the child being killed is one that has already failed to
 * finish in time and a signal it can decline is not a bound.
 */
function run(
  bin: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => (stdout = tail(stdout + chunk.toString())));
    child.stderr.on("data", (chunk: Buffer) => (stderr = tail(stderr + chunk.toString())));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // The pipes are destroyed as well as the child killed. A SIGKILL settles this promise but does
      // not close a pipe a surviving grandchild still holds, and an open pipe handle keeps Node's
      // event loop alive — so the scenario would report its verdict and the runner would never exit.
      child.stdout.destroy();
      child.stderr.destroy();
      // Settled here rather than waiting for `close`, which fires when the STDIO PIPES close, not
      // when the process dies — a killed child whose own grandchildren inherited those pipes keeps
      // them open and `close` never arrives. Measured 2026-09-18 against a stub whose `restore` is
      // `sleep 100000`: killing it and waiting for `close` left the promise unsettled at 65s, the
      // same reading as having no timeout at all.
      settle({ code: null, stdout, stderr });
    }, options.timeoutMs ?? CHILD_TIMEOUT_MS);

    function settle(result: { code: number | null; stdout: string; stderr: string }): void {
      clearTimeout(timer);
      resolve({ ...result, timedOut });
    }
    // A missing binary is an `error` event, not a non-zero exit, and `resolveLitestream` walks a
    // list of candidates most of which are expected to be absent.
    child.on("error", (error) => settle({ code: null, stdout, stderr: error.message }));
    child.on("close", (code) => settle({ code, stdout, stderr }));
  });
}

/**
 * Keep the last 8192 string units — enough for litestream's refusal line, bounded for a daemon that
 * logs on. String units, not bytes: `length` counts UTF-16 units, so a log full of multi-byte
 * characters is retained at several times that in bytes. The point is that it is bounded, not what
 * the bound is in bytes.
 */
function tail(text: string): string {
  return text.length > 8192 ? text.slice(-8192) : text;
}
