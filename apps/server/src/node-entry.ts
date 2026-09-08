import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import pg from "pg";
import { AppError } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import { DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT, startServer } from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { resolveConfigDir } from "./config.js";
import { isUnset } from "./env-value.js";
import { ensureInstance, type InstanceUrls } from "./instance-bootstrap.js";
import { createLogger, type Logger } from "./logger.js";
import {
  FRESH,
  afterFailure,
  readRecoveryState,
  writeRecoveryState,
  type RecoveryState,
} from "./recovery-state.js";
import { recoveryApp } from "./recovery-surface.js";
import { installShutdownHandlers } from "./run-server.js";
import { buildServeOptions, type TlsFiles } from "./tls.js";
import "./errors.js";

/** The one database a node owns, matching the URLs `ensureInstance` writes into `instance.env`. */
const DATABASE = "waitron";

/** The superuser URL compose derives from the box's `POSTGRES_PASSWORD`. It reaches `ensureInstance`
 *  and NOTHING else — never the server (see `runEntry`). */
const BOOTSTRAP_URL = "WAITRON_BOOTSTRAP_DATABASE_URL";

/** How long a boot must survive before its failure counter is cleared (spec §9.2). */
const STAYED_UP_MS = 120_000;

const WAIT_ATTEMPTS = 60;
const WAIT_DELAY_MS = 1000;

/** The recovery listener's port when `WAITRON_HTTP_PORT` is unset or unparseable — the same value
 * `config.ts`'s own `DEFAULT_HTTP_PORT` falls back to, duplicated rather than imported because the
 * recovery path must not call `loadConfig`: a box reaches recovery precisely when its configuration
 * or its database may be the thing that is broken, and a config that throws would take the page
 * down with it. The shipped image always sets the variable (443, spec §3.1), so this fallback is
 * reached only by a hand-run box. */
const FALLBACK_HTTP_PORT = 8080;

/** The recovery-state marker for an attempt whose outcome is not known YET — written before the
 * server starts, so a boot that HANGS (and therefore never produces a real code) still leaves the
 * page something true to say. Not an `AppError` code: nothing throws it. A boot that does throw
 * overwrites it with `codeOf`'s classification. */
const BOOT_INCOMPLETE = "server.boot_incomplete";

export interface WaitDeps {
  /** One connect-and-query round trip, or a rejection. */
  connect: (url: string) => Promise<void>;
  delay: (ms: number) => Promise<void>;
  log: Logger;
  attempts?: number;
  delayMs?: number;
}

/**
 * Poll until Postgres accepts a connection — the shape of `dev-setup.ts`'s own loop, bounded so a
 * cluster that is never coming back escalates through the failure counter instead of pinning the
 * container in a wait forever.
 *
 * The caught value is dropped rather than chained as a `cause`: a `pg` connection failure carries
 * the host and can carry the connection string, and the code thrown here is rendered on the
 * unauthenticated recovery page.
 */
export async function waitForPostgres(url: string, deps: WaitDeps): Promise<void> {
  const attempts = deps.attempts ?? WAIT_ATTEMPTS;
  // Unbounded `for`, bounded by the throw: a `attempt <= attempts` header would give the function a
  // fall-through exit that returns "connected" without ever connecting.
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.connect(url);
      return;
    } catch {
      if (attempt >= attempts) {
        throw new AppError("provisioning.database_unreachable", { attempts });
      }
      if (attempt === 1) deps.log("info", "instance.waiting_for_postgres", { attempts });
      await deps.delay(deps.delayMs ?? WAIT_DELAY_MS);
    }
  }
}

/**
 * The box's own leaf, or `undefined` when it has never minted one.
 *
 * `server.key` is `ensureBoxSecrets`'s own presence sentinel (`box-secrets.ts`), and both halves are
 * checked because `buildServeOptions` reads both and a half-written pair would throw inside the one
 * serve call the recovery path has. A box that has never completed a setup boot has no certificate
 * to present, so the page falls back to plain HTTP on the same port — the honest limit spec §9.3
 * states rather than leaving implicit, and the alternative (refusing to serve) hands the operator
 * nothing at all.
 */
export function recoveryTlsFiles(stateDir: string): TlsFiles | undefined {
  const certFile = join(stateDir, "tls", "server.crt");
  const keyFile = join(stateDir, "tls", "server.key");
  if (!existsSync(certFile) || !existsSync(keyFile)) return undefined;
  return { certFile, keyFile };
}

export interface RecoveryServeOptions {
  stateDir: string;
  port: number;
  log: Logger;
}

/**
 * Bind the recovery page on the box's own HTTPS port, presented with the box's existing leaf so an
 * already-trusting phone reaches it at the same URL with no new trust step.
 *
 * Resolves when the socket is actually bound (`serve`'s `listeningListener`, not source order —
 * `serve()` returns before the bind, as `boot.ts`'s `startListening` records), and rejects if the
 * bind fails: the caller lets that escape, so a port it cannot take exits non-zero and Docker
 * restarts into the same decision rather than leaving a silent, page-less container up.
 */
export function serveRecovery(
  app: Hono,
  opts: RecoveryServeOptions,
): Promise<ReturnType<typeof serve>> {
  return new Promise((resolve, reject) => {
    const tls = recoveryTlsFiles(opts.stateDir);
    const server = serve(buildServeOptions({ fetch: app.fetch, port: opts.port }, tls), (info) => {
      opts.log("warn", "recovery.listening", { port: info.port, tls: tls !== undefined });
      resolve(server);
    });
    server.on("error", (error: NodeJS.ErrnoException) => {
      reject(new AppError("server.listen_failed", { port: opts.port, code: error.code ?? "" }));
    });
  });
}

export interface EntryDeps {
  /** The process environment, before the box's own env files are merged under it. */
  baseEnv: NodeJS.ProcessEnv;
  stateDir: string;
  waitForPostgres: (url: string) => Promise<void>;
  ensureInstance: (opts: {
    bootstrapUrl: string;
    database: string;
    stateDir: string;
    log: Logger;
    migrationsRoot: string | null;
  }) => Promise<InstanceUrls>;
  loadBoxEnv: (base: NodeJS.ProcessEnv, stateDir: string) => Promise<NodeJS.ProcessEnv>;
  readRecoveryState: (stateDir: string) => Promise<RecoveryState>;
  writeRecoveryState: (stateDir: string, state: RecoveryState) => Promise<void>;
  startServer: (env: NodeJS.ProcessEnv) => Promise<{ close(): Promise<void> }>;
  serveRecovery: (app: Hono, opts: RecoveryServeOptions) => Promise<unknown>;
  installShutdownHandlers: (server: { close(): Promise<void> }) => void;
  /** Runs `onStayedUp` once the process has survived `ms` — see the counter rule in `runEntry`. */
  scheduleStayedUp: (ms: number, onStayedUp: () => void) => void;
  log: Logger;
  /** Where the recovery page reads its log tail from; defaults to `config.ts`'s own default. */
  logDir?: string;
  /**
   * Where the migration sets live. Typed `string`, never `string | null`, although
   * `ensureInstance` accepts null: null means "resolve from the bundle's own directory", which is
   * exactly the value that fails a real container's first boot with `migrations.set_missing`. The
   * default is the same expression `startServer` passes, so the entrypoint and the server it starts
   * can never migrate from two different folders.
   */
  migrationsRoot?: string;
  exit?: (code: number) => void;
}

/** The bootstrap URL, refused rather than passed to the driver when it is unusable.
 *
 * Both checks are needed. `new Client({ connectionString: "" })` resolves to localhost with every
 * default (`pg@8.22.0`, the receipt on `provisioning.admin_uri_missing`), so an `VAR=` line would
 * otherwise silently provision whatever answers on localhost:5432 — and one database per
 * environment is a fiscal invariant. A value `new URL` cannot parse reaches `withDatabase`
 * (`ensureInstance`) as a bare `TypeError` instead of a classified code, which the recovery page
 * can only render as "unknown". */
function bootstrapUrlFrom(env: NodeJS.ProcessEnv): string {
  const raw = env[BOOTSTRAP_URL];
  if (isUnset(raw)) throw new AppError("server.config_missing", { variable: BOOTSTRAP_URL });
  try {
    new URL(raw);
  } catch {
    throw new AppError("provisioning.admin_uri_not_a_url", { variable: BOOTSTRAP_URL });
  }
  return raw;
}

/** `WAITRON_HTTP_PORT`, or the fallback. Zero is refused with the rest: it means "any free port" to
 * `listen`, which would bind the recovery page somewhere the operator cannot find it. */
function httpPortFrom(env: NodeJS.ProcessEnv): number {
  const port = Number.parseInt(env.WAITRON_HTTP_PORT ?? "", 10);
  return Number.isInteger(port) && port > 0 ? port : FALLBACK_HTTP_PORT;
}

/** How long the real `exit` lets the event loop run before it takes the process down. */
const EXIT_FLUSH_MS = 250;

/* v8 ignore start -- the real process binding; every test supplies its own `exit` instead */
const DEFAULT_EXIT = (code: number): void => {
  // Scheduled, not immediate: the only caller is the recovery page's retry, which runs INSIDE the
  // request handler, and exiting there kills the socket before the response flushes. Measured on
  // the built bundle against the running page — an immediate `process.exit` returned an empty body
  // to the POST; with the delay it returns `{"ok":true}`. `unref` so this timer alone never holds
  // a process open that has nothing else to do.
  setTimeout(() => process.exit(code), EXIT_FLUSH_MS).unref();
};
/* v8 ignore stop */

/**
 * One container start: decide the level, bring the cluster into shape, hand the server its
 * environment, and start it — or serve the recovery page instead.
 *
 * THREE orderings carry the whole design, and each is invisible in production if it is wrong:
 *
 * 1. The level is read FIRST, before anything touches Postgres. A database-side failure is exactly
 *    what puts a box in recovery, so deciding after the wait and the bootstrap would make the page
 *    unreachable in most of the cases it exists for (spec §9.3).
 * 2. The failure counter is written BEFORE `startServer`, never only in a failure handler: a boot
 *    that HANGS never throws, and a catch-only counter would leave such a box restart-looping
 *    forever without ever escalating.
 * 3. It CLEARS only from the stayed-up callback — `startServer` resolved AND the process then
 *    survived `STAYED_UP_MS`. Clearing on "started" alone is a measurement where pass and fail look
 *    alike: a module throwing five seconds in would reset the counter on every attempt.
 *
 * `startServer` resolving is the signal rather than a healthy `/health` probe because `/health` is
 * 503 on a setup box by design, so a health-gated reset would drive every unprovisioned box into
 * recovery.
 */
export async function runEntry(deps: EntryDeps): Promise<void> {
  const state = await deps.readRecoveryState(deps.stateDir);
  const logDir = deps.logDir ?? join(deps.stateDir, "logs");
  const exit = deps.exit ?? DEFAULT_EXIT;

  if (state.level === "recovery") {
    deps.log("warn", "recovery.serving", {
      failures: state.failures,
      lastErrorCode: state.lastErrorCode,
    });
    await deps.serveRecovery(
      recoveryApp({
        state,
        logDir,
        // The level argument is not written: `readRecoveryState` DERIVES the level from the count,
        // so a zero count IS "normal" and a hand-written level could not pin a box either way. The
        // exit is the whole retry — Docker's restart policy performs the restart (spec §9.3).
        onRetry: async () => {
          await deps.writeRecoveryState(deps.stateDir, FRESH);
          exit(0);
        },
      }),
      { stateDir: deps.stateDir, port: httpPortFrom(deps.baseEnv), log: deps.log },
    );
    return;
  }

  const bootstrapUrl = bootstrapUrlFrom(deps.baseEnv);
  await deps.waitForPostgres(bootstrapUrl);
  const urls = await deps.ensureInstance({
    bootstrapUrl,
    database: DATABASE,
    stateDir: deps.stateDir,
    log: deps.log,
    migrationsRoot: deps.migrationsRoot ?? DEFAULT_MIGRATIONS_ROOT,
  });

  // AFTER `ensureInstance`, which has just written `instance.env` — that file is where the merged
  // environment's `DATABASE_URL` comes from.
  const env = await deps.loadBoxEnv(deps.baseEnv, deps.stateDir);
  // The server never holds superuser credentials: its owner connection is the MIGRATOR, the role
  // that owns the tables (`boot.ts`'s setup branch documents why). Deleted from the object handed
  // on, not merely left unread — a bundled module reading `process.env` directly would still find
  // it otherwise, and this process's own `process.env` is what `baseEnv` is.
  delete env[BOOTSTRAP_URL];
  env.WAITRON_ADMIN_DATABASE_URL = urls.migrationsDatabaseUrl;

  await deps.writeRecoveryState(deps.stateDir, afterFailure(state, BOOT_INCOMPLETE, new Date()));

  let server: { close(): Promise<void> };
  try {
    server = await deps.startServer(env);
  } catch (error) {
    // Same count as the pre-start write — this attempt is one failure, not two — now carrying the
    // real classification for the page. Rethrown so the process exits non-zero and Docker restarts.
    await deps.writeRecoveryState(deps.stateDir, afterFailure(state, codeOf(error), new Date()));
    throw error;
  }

  deps.installShutdownHandlers(server);
  deps.scheduleStayedUp(STAYED_UP_MS, () => {
    void deps.writeRecoveryState(deps.stateDir, FRESH);
  });
}

/* v8 ignore start -- the real process wiring: `process.env`, the `pg` driver, a timer and
   `process.exit`. Every decision lives in `runEntry` above, which takes each of these as a
   dependency; this half is exercised by a container boot, not by a unit test — the shape
   `bin-recovery.ts` and `run-server.ts`'s `DEFAULT_DEPS` both use. */
async function connectOnce(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => {});
  }
}

function bootThisProcess(): Promise<void> {
  const env = process.env;
  const stateDir = resolveConfigDir(env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  const log = createLogger(
    (line) => void process.stdout.write(line),
    () => new Date(),
  );
  return runEntry({
    baseEnv: env,
    stateDir,
    logDir: isUnset(env.WAITRON_LOG_DIR) ? join(stateDir, "logs") : env.WAITRON_LOG_DIR,
    // `config.ts`'s own fallback, verbatim (it stores this one unresolved), so the entrypoint and
    // the server it starts can never migrate from two different folders.
    migrationsRoot: isUnset(env.WAITRON_MIGRATIONS_DIR)
      ? DEFAULT_MIGRATIONS_ROOT
      : env.WAITRON_MIGRATIONS_DIR,
    waitForPostgres: (url) =>
      waitForPostgres(url, {
        connect: connectOnce,
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        log,
      }),
    ensureInstance,
    loadBoxEnv,
    readRecoveryState,
    writeRecoveryState,
    startServer,
    serveRecovery,
    installShutdownHandlers,
    // `unref` so the timer alone never holds the process open: the listener the server bound is
    // what keeps it alive, and a process that dies before the threshold has not stayed up.
    scheduleStayedUp: (ms, onStayedUp) => void setTimeout(onStayedUp, ms).unref(),
    log,
    exit: DEFAULT_EXIT,
  }).catch((error: unknown) => {
    // `codeOf`, never the caught value: a `pg` failure's message can embed the connection string,
    // and an unhandled rejection would print the whole stack.
    log("error", "server.boot_failed", { errorCode: codeOf(error) });
    process.exit(1);
  });
}

/**
 * Run ONLY when this file is the process's own entry point (`node /app/node-entry.js`), never when
 * it is imported — its own unit test imports it for `runEntry`, and an unguarded call here would
 * open a `pg` connection and start a server from inside the test runner. `realpathSync` because a
 * symlinked bin resolves to a different path than `import.meta.url`. Both directions are measured:
 * the built `dist/node-entry.js` really does boot (it reaches `server.config_missing` with no
 * bootstrap URL set), and `node-entry.test.ts` imports this module without one.
 */
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await bootThisProcess();
}
/* v8 ignore stop */
