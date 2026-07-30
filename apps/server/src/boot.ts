import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createPostgresDb } from "@waitron/db";
import { credentialTenants, loadKeyRing } from "@waitron/credentials";
import { runDue } from "@waitron/scheduler";
import { StripeReconciler } from "@waitron/payments-stripe";
import { drain } from "@waitron/fiscal-verifactu";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { aeatClientResolver, aeatEndpointFor, mtlsFetch } from "./aeat-transport.js";
import { loadConfig } from "./config.js";
import { assertDeploymentMatches } from "./deployment-guard.js";
import { createLogger } from "./logger.js";
import {
  createHealthState,
  healthApp,
  logDegradedDuties,
  recordPass,
  DUTY_BUDGET_MS,
  type HealthState,
} from "./health.js";
import { runLoop, realSleep } from "./loop.js";
import { reconcilerAsDuty } from "./reconcile-duty.js";
import { runPass, DRAIN_DUTY } from "./pass.js";
import { stripeAccountResolver, defaultMakeStripe } from "./stripe-account.js";
import "./errors.js";
// `DEFAULTS` is NOT imported: `loadConfig` already applied the scheduler's defaults, so reaching for
// them again here would be a second source of truth for the same five numbers.

export interface StartedServer {
  health: HealthState;
  /** Resolves when the loop has stopped, the listener is closed and the pool is drained. */
  close(): Promise<void>;
}

/**
 * Next to the bundle: `scripts/copy-migrations.mjs` puts them there, so `<dist>/drizzle` exists for
 * a built artefact. Run from source instead, this same expression resolves to
 * `apps/server/src/drizzle` — which does not exist — and `migrationOptionsFor` fails loud with
 * `migrations.set_missing`; `WAITRON_MIGRATIONS_DIR` (`config.ts`'s own override, see
 * `config.test.ts`) is the supported from-source route, not this default. `fileURLToPath`, not
 * `.pathname`: a path containing a space would otherwise arrive percent-encoded, and `.pathname` is
 * never absolute on Windows — `migrationOptionsFor`'s own relative-root fallback exists only to
 * protect a caller passing `WAITRON_MIGRATIONS_DIR` as a relative path, not this one.
 *
 * Exported, not inlined at the `loadConfig` call site below: a statement-coverage report cannot
 * tell a correct computation from a subtly wrong one (it is exercised either way, being a function
 * argument), so `boot.test.ts` asserts the two properties that actually matter — absolute, and
 * named `drizzle` — directly against THIS value, the one `startServer` actually passes in, rather
 * than a second copy of the expression that could silently drift from it.
 */
export const DEFAULT_MIGRATIONS_ROOT = fileURLToPath(new URL("drizzle", import.meta.url));

/**
 * The one place the real implementations meet. Everything above is injected, so this function is
 * thin by construction. `tsc` pins every field mapping below against each callee's own signature;
 * `boot.test.ts` is this function's own test subject — calling it against a real container, as the
 * deployment role, and asserting `onPass`'s effect on `/health`, the `minTickMs`/`maxTickMs`
 * mapping (via the logged `loop.sleeping` line, since a duty-neutral pass alone cannot distinguish a
 * swapped mapping from a correct one), both sides of the `settlementLagMs` conditional spread, and
 * `close()`'s own sequencing including its idempotency guard. `pass.rls.test.ts` does NOT import
 * this file — it builds its own, separate composition of the same pieces to prove the composed pass
 * runs as the non-superuser role; that predates `boot.test.ts` and remains evidence for the same
 * SHAPE of wiring, not a substitute for testing this function directly. The manual end-to-end boot
 * recorded in the Task 11 report (`node dist/server.js` against a fresh container, through to a
 * clean `/health` and a graceful `SIGTERM`) remains the only evidence that the BUNDLE, not just the
 * source, boots — `boot.test.ts` runs from source, matching every other suite in this package.
 *
 * Boot failures ESCAPE, deliberately: invalid config, an unloadable key ring, a failed migration or
 * an unreachable database exit non-zero and let the supervisor decide. A host that boots
 * half-configured and retries in the background is a host whose operator believes it is working.
 */
export async function startServer(env: Record<string, string | undefined>): Promise<StartedServer> {
  const now = () => new Date();
  const log = createLogger((line) => process.stdout.write(line), now);
  const config = loadConfig(env, DEFAULT_MIGRATIONS_ROOT);
  // This guard cannot live in `config.ts`'s `loadConfig` beside `minTickMs > maxTickMs` above it —
  // `health.ts` imports `DEFAULT_MAX_TICK_MS` FROM `config.ts` to build `DUTY_BUDGET_MS`, so
  // `config.ts` importing `DUTY_BUDGET_MS` back would be a cycle. `boot.ts` already imports both,
  // so this is where the two constants the invariant compares can actually meet. Runtime
  // `config.maxTickMs`, not the compile-time `DEFAULT_MAX_TICK_MS` `DUTY_BUDGET_MS[DRAIN_DUTY]`
  // itself is built from — `WAITRON_MAX_TICK_MS` above roughly 75 minutes is exactly the
  // regression `health.ts`'s own `DRAIN_STALE_SLACK_MS` comment and this package's README warn
  // about without enforcing: an idle host sleeps `config.maxTickMs` verbatim (`loop.ts`'s
  // `sleepMsFor`), and the pass that follows lands past a budget computed from the DEFAULT ceiling
  // rather than this one.
  if (config.maxTickMs >= DUTY_BUDGET_MS[DRAIN_DUTY]) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_MAX_TICK_MS",
      reason: "at_or_above_drain_budget",
    });
  }
  // The env this function was given, straight through: `loadKeyRing` owns the four
  // WAITRON_CREDENTIALS_KEY* names and their validation, and re-declaring them here would be a
  // second source of truth. (Not literally `process.env` — that is true only when `bin.ts` is the
  // caller; `boot.test.ts` passes a literal object instead.)
  const ring = loadKeyRing(env);

  // Before ANY write, including migrations: a host pointed at another environment's database must
  // stop here. Its own connection, closed immediately — the long-lived pool below is not opened
  // until migrations have run, and borrowing the migrator's string keeps this on the same database
  // the migrations are about to touch.
  const stampProbe = await createPostgresDb(config.migrationsDatabaseUrl);
  try {
    await assertDeploymentMatches(stampProbe, config.environment);
  } finally {
    await stampProbe.close();
  }

  // Migrations first, over `config.migrationsDatabaseUrl` — which defaults to `config.databaseUrl`
  // but may name a differently-privileged role (config.ts's own doc comment). Running this BEFORE
  // opening the long-lived pool below means a migration failure never leaves an app-role pool open
  // for nothing, and it means the pool is never asked to double as the migrator's connection: the
  // two connection strings can differ, and `applyMigrations` now opens its own connection from
  // whichever string it is given rather than migrating over a pool built from a different one.
  await applyMigrations(
    config.migrationsDatabaseUrl,
    migrationOptionsFor(manifestSets(), config.migrationsRoot),
  );
  const db = await createPostgresDb(config.databaseUrl);

  const reconciler = new StripeReconciler({
    db,
    resolveAccount: stripeAccountResolver({
      db,
      ring,
      environment: config.environment,
      makeStripe: defaultMakeStripe,
    }),
    ...(config.settlementLagMs === undefined ? {} : { settlementLagMs: config.settlementLagMs }),
  });
  const duty = reconcilerAsDuty(reconciler);

  const health = createHealthState(now());
  // Set inside the `listeningListener` below, and read by the `'error'` handler right after it —
  // see that handler's own comment on why an error arriving AFTER a successful bind must not be
  // treated the same way as a bind failure.
  let bound = false;
  // The SECOND argument, `serve`'s own `listeningListener`, not a log call placed right after this
  // expression: `serve()` calls `listen()` and returns immediately, but the underlying socket binds
  // ASYNCHRONOUSLY — a log line placed here in source order would assert "listening" before that
  // bind has actually happened. `listeningListener` is Node's own callback for "now it really is."
  const server = serve(
    { fetch: healthApp(health, now).fetch, port: config.httpPort, hostname: config.httpHost },
    (info) => {
      bound = true;
      log("info", "server.listening", { port: info.port, environment: config.environment });
    },
  );
  // The failure counterpart: `EADDRINUSE` (a fixed default port already taken — the most common
  // boot-time failure `WAITRON_HTTP_PORT`'s fixed default invites) or `EACCES` (a privileged port,
  // no permission) surfaces here, on Node's own `'error'` event, strictly AFTER `startServer` has
  // already returned its `StartedServer` — `serve()` is synchronous and this event is not, so
  // unlike every OTHER boot failure (§8's "everything escapes" as a rejected promise) this one
  // cannot reach `bin.ts` by throwing. Logging and exiting directly here is this path's own
  // equivalent, not a departure from §8's posture: a host that failed to bind its one HTTP route
  // and kept running in the background would be exactly the "boots half-configured and retries
  // invisibly" host §8 exists to rule out.
  //
  // This listener is registered for the WHOLE lifetime of the process, not just until the bind
  // settles — Node gives no way to remove it selectively once binding succeeds without risking a
  // race against a genuinely-late bind error. `bound` is the gate that keeps it from over-firing:
  // a healthy, already-listening host emitting a LATER, unrelated 'error' (this handler's own
  // pre-merge review found no confirmed real-world trigger, but nothing rules one out either) would
  // otherwise be logged as `server.listen_failed` and exited exactly like a genuine bind failure —
  // killing a mid-pass host over something that was never about listening at all.
  server.on("error", (error: NodeJS.ErrnoException) => {
    // A post-bind 'error' is not this handler's business — see the comment above. Nothing through
    // `startServer`'s public surface can emit a synthetic 'error' event on the raw `http.Server`
    // once it is listening (it is never exposed on `StartedServer`), so this branch is untestable
    // the same way `error.code ?? "unknown"` below already is documented to be.
    /* v8 ignore next */
    if (bound) return;
    const failure = new AppError("server.listen_failed", {
      port: config.httpPort,
      // `error.code` is optional on `NodeJS.ErrnoException`'s TYPE, but every real listen failure
      // this host can hit (EADDRINUSE, EACCES, ENOTFOUND, EADDRNOTAVAIL, …) sets it — Node's socket
      // layer always attaches one. Reaching the `?? "unknown"` fallback needs a synthetic error with
      // no `code`, which `boot.test.ts` cannot produce through `startServer`'s public surface (the
      // raw `http.Server` this handler is attached to is never exposed on `StartedServer`) — the
      // same shape of unreachable-but-type-required branch `loop.ts`'s `realSleep` documents rather
      // than forces.
      /* v8 ignore next */
      code: error.code ?? "unknown",
    });
    // NOT `log(...)` followed by a bare `process.exit(1)`: `log`'s sink is `process.stdout.write`
    // discarding any signal of completion, and on a pipe (Docker, systemd) that write is
    // ASYNCHRONOUS — exiting immediately after calling it races the write, which can truncate or
    // drop entirely the one line an operator is told to grep for. Setting `process.exitCode` alone
    // does not fix it either: the loop below is still running and keeps the event loop alive, so a
    // merely-set exit code is never consumed on its own — this path needs an explicit `process.exit`
    // somewhere, just not before the write it depends on has actually gone out. A one-off logger,
    // built the identical way `log` itself is, but whose sink only calls `process.exit` from the
    // write's own completion callback, is what makes that ordering real rather than assumed.
    // `packages/credentials`'s `bin.ts` avoids the same hazard the other way — it never calls
    // `process.exit` at all, setting `process.exitCode` and letting the event loop drain naturally,
    // which works there because nothing else keeps that process alive; this host's background loop
    // means that route isn't available here.
    createLogger((line) => process.stdout.write(line, () => process.exit(1)), now)(
      "error",
      failure.code,
      failure.params,
    );
  });

  const controller = new AbortController();
  const loop = runLoop({
    pass: (at) =>
      runPass(
        {
          // Per pass, not once at boot: `closeAll` below must release exactly the transports THIS
          // pass built. Each holds a TLS connection pool keyed to one tenant's client certificate,
          // and nothing closed them before — they accumulated for the process lifetime.
          drain: async (at2) => {
            const resolver = aeatClientResolver(
              {
                db,
                ring,
                endpointFor: aeatEndpointFor(config.environment),
                // `mtlsFetch` directly, not a wrapping arrow: its own second parameter (`ca`, for a
                // private trust root) is optional, so `mtlsFetch` already has the exact shape
                // `fetchFor` wants when called with one argument. A wrapper here would be one more
                // never-invoked closure.
                fetchFor: mtlsFetch,
              },
              log,
            );
            try {
              return await drain(
                {
                  db,
                  resolveClient: resolver.resolve,
                  skipRetryMs: config.skipRetryMs,
                  // Which deployment THIS host is — the same `WAITRON_ENV`-derived value
                  // `config.environment` already is (`deployment-guard.ts` pins it against the
                  // database at boot). `drain`'s guard (`@waitron/fiscal-verifactu`'s `claimBatch`)
                  // refuses any due registro whose own `entorno` disagrees, or is unrecorded,
                  // rather than ever submitting it to AEAT.
                  environment: config.environment,
                },
                at2,
              );
            } finally {
              await resolver.closeAll();
            }
          },
          // Enumerated per pass, not at boot: a tenant provisioned while the host runs is served
          // on the next pass rather than after a restart.
          reconcile: async (at2) =>
            runDue(
              {
                db,
                duties: [duty],
                horizonDays: config.scheduler.horizonDays,
                maxPeriodsPerTick: config.scheduler.maxPeriodsPerTick,
                maxAttempts: config.scheduler.maxAttempts,
                backoffBaseMs: config.scheduler.backoffBaseMs,
                staleAfterMs: config.scheduler.staleAfterMs,
                skipRetryMs: config.skipRetryMs,
              },
              await credentialTenants(db, "payments.stripe"),
              at2,
            ),
          monotonicMs: () => performance.now(),
          log,
        },
        at,
      ),
    now,
    sleep: realSleep,
    signal: controller.signal,
    minTickMs: config.minTickMs,
    maxTickMs: config.maxTickMs,
    log,
    onPass: (report, at) => logDegradedDuties(log, recordPass(health, report, at)),
  });

  // Guards a second, LOSING concurrent `close()`: without it, both calls would reach `db.close()`
  // (pg-pool's `.end()`), and `.end()` a second time throws "Called end on pool more than once".
  // `bin.ts`'s own signal latch prevents two calls from a signal handler today, but `close()` is
  // exported on `StartedServer` precisely so a caller outside `bin.ts` can invoke it directly — a
  // test hook above all — with no latch of its own. Checked and set synchronously, before the
  // first `await`: JS's run-to-completion means the loser's check always sees the winner's write,
  // however the two calls are interleaved by their caller. A plain early return is enough — the
  // loser does not wait for the winner's shutdown to finish, it only promises not to repeat it.
  let closed = false;
  return {
    health,
    close: async () => {
      if (closed) return;
      closed = true;
      controller.abort();
      await loop;
      // `finally`, not a plain sequential `await`: a rejecting `server.close()` (the listener
      // already gone — see bin.ts's own double-signal guard) must still drain the pool. `close()`
      // is exported on `StartedServer`, and a caller reaching for it outside `bin.ts` — a test hook
      // above all — would otherwise be left holding an undrained pool on exactly the path that
      // failed.
      try {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      } finally {
        await db.close();
      }
      log("info", "server.stopped");
    },
  };
}
