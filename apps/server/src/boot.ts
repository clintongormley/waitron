import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { createPostgresDb, type Database } from "@waitron/db";
import { credentialTenants, loadKeyRing } from "@waitron/credentials";
import { runDue } from "@waitron/scheduler";
import {
  StripeOnDeviceProvider,
  StripeReconciler,
  StripeTerminalProvider,
} from "@waitron/payments-stripe";
import type { PaymentProvider } from "@waitron/payments";
import { drain } from "@waitron/fiscal-verifactu";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { aeatClientResolver, aeatEndpointFor, mtlsFetch } from "./aeat-transport.js";
import { parseEnvFile } from "./env-file.js";
import { loadConfig, loadSyncConfig, type ServerConfig } from "./config.js";
import { assertDeploymentMatches } from "./deployment-guard.js";
import { codeOf } from "./error-code.js";
import { createLogger, type Logger } from "./logger.js";
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
import {
  cardClientResolver,
  cardDeviceClientResolver,
  stripeAccountResolver,
  defaultMakeStripe,
} from "./stripe-account.js";
import type { StripeAccountDeps } from "./stripe-account.js";
import { mountWebhook } from "./webhook.js";
import { mountTillApi } from "./till-api.js";
import { mountDeviceApi } from "./device-api.js";
import { mountPrintApi } from "./print-api.js";
import { mountManagementApi } from "./management-api.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { mountPurchasingApi } from "./purchasing-api.js";
import { mountReportApi } from "./report-api.js";
import { mountRecipeApi } from "./recipe-api.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { mountScheduleApi } from "./schedule-api.js";
import { mountMeApi } from "./me-api.js";
import { mountMedia } from "./media-api.js";
import { assertBuiltApp, mountSpa } from "./spa-api.js";
import { mountSetup } from "./setup-api.js";
import { provisionVenue } from "./provision.js";
import { sealAeatCredential } from "./aeat-credential.js";
import { writeTradingEnv } from "./trading-config.js";
import { mountDiscovery } from "./discovery-api.js";
import { startMdnsResponder, type MdnsResponder } from "./mdns.js";
import { listBoxIpv4 } from "./box-reach.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { mountSyncApi } from "./sync-api.js";
import { fetchHttpClient } from "./sync-http.js";
import { runRetentionSweep, runSyncPull, type SyncLane } from "@waitron/sync";
import { readOrderFlow } from "./till-config.js";
import type { TillConfig } from "./till-config.js";
import { readVenueLocale } from "./venue-locale.js";
import { makeFiscalBackend, systemClock } from "./till-backend.js";
import { buildServeOptions } from "./tls.js";
import "./errors.js";
// `DEFAULTS` is NOT imported: `loadConfig` already applied the scheduler's defaults, so reaching for
// them again here would be a second source of truth for the same five numbers.

export interface StartedServer {
  health: HealthState;
  /** Resolves when the loop has stopped, the listener is closed and the pool is drained. */
  close(): Promise<void>;
}

/**
 * The mode-specific half of `close()` (see `makeStartedServer`): how to stop this boot's background
 * work and which connection pools to drain. Trading mode fills both in — abort the loop and the
 * sync/retention workers, then close the app, sync and retention pools. Setup mode's `stopWork` is a
 * no-op (a setup box runs neither loop nor sync) and its `closePools` drains only the app pool.
 */
interface BootTeardown {
  stopWork: () => Promise<void>;
  closePools: () => Promise<void>;
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
 * The default local store for product images, computed exactly as `DEFAULT_MIGRATIONS_ROOT` above:
 * beside the bundle (`<dist>/media`) for a built artefact, or `apps/server/src/media` run from
 * source. `WAITRON_MEDIA_DIR` overrides it (config.ts), and deployment (#9) sets it explicitly to a
 * durable path; this default only has to exist so a from-source dev boot has somewhere to write.
 * Threaded into `loadConfig` as the `defaultMediaRoot` argument, the same way this file supplies
 * `DEFAULT_MIGRATIONS_ROOT`.
 */
export const DEFAULT_MEDIA_ROOT = fileURLToPath(new URL("media", import.meta.url));

/**
 * The default persisted store for the box's self-signed cert PEMs and generated secrets, computed
 * exactly as `DEFAULT_MEDIA_ROOT` above: beside the bundle (`<dist>/state`) for a built artefact, or
 * `apps/server/src/state` run from source. The setup branch below materialises the box's self-signed
 * cert + secrets here on first setup boot (`ensureBoxSecrets`, `box-secrets.ts`) and serves the setup
 * surface over HTTPS from them; leaf renewal/rotation is later work. `WAITRON_STATE_DIR`
 * overrides it (config.ts), and deployment (#9) sets a durable, protected path; this default only has
 * to exist so a from-source dev boot has somewhere to write. The dev default is gitignored
 * (`apps/server/src/state/`) because it holds SECRETS. Threaded into `loadConfig` as the
 * `defaultStateRoot` argument, the same way this file supplies `DEFAULT_MEDIA_ROOT`.
 */
export const DEFAULT_STATE_ROOT = fileURLToPath(new URL("state", import.meta.url));

/**
 * The upper bound on a single product-image upload (design §5e, 5 MiB). A settled constant rather
 * than config: it is a DoS ceiling on an unauthenticated-adjacent write path, not an operator knob.
 * The upload route (a later slice) enforces it both coarsely (a `bodyLimit` middleware) and
 * precisely (a `file.size` check → `media.too_large`); exported here so that route and this boot
 * agree on one value rather than two literals that could drift.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * The one integrated card-payment provider this till drives (sub-project 7), or `undefined` when
 * `WAITRON_TILL_CARD_PROVIDER=none`. A till serves exactly ONE tenant (`cfg.tenantId`), so ONE
 * provider is built up front at boot rather than per request — the same "resolve provisioning-time
 * config once, not on the hot path" shape `readOrderFlow` follows. The collect-side client is built
 * from that tenant's own `payments.stripe` credential via the `cardClientResolver` /
 * `cardDeviceClientResolver` seams (which also apply the `sk_live_`/`sk_test_` environment guard), so
 * a missing or wrong-environment key fails the boot loudly here rather than on the first sale.
 *
 * Exported, not inlined into `startServer`: `startServer`'s only test subject (`boot.test.ts`) boots
 * against a real container with `cardProvider=none`, so it exercises only the `undefined` branch —
 * unit-testing THIS function directly (`boot-card-provider.test.ts`, PGlite + a seeded credential) is
 * what reaches the terminal / on-device branches without a full boot per provider, the same
 * "exported for a direct test subject" reasoning `DEFAULT_MIGRATIONS_ROOT` below carries.
 */
export async function buildCardProvider(
  cfg: TillConfig,
  deps: StripeAccountDeps,
): Promise<PaymentProvider | undefined> {
  if (cfg.cardProvider === "none") return undefined;
  if (cfg.cardProvider === "stripe_terminal") {
    const client = await cardClientResolver(deps)(cfg.tenantId);
    // Present because `cfg.cardProvider === "stripe_terminal"`: `loadTillConfig` `required`s
    // `WAITRON_TILL_STRIPE_READER_ID` on exactly that branch (till-config.ts's `stripeReaderId`
    // resolution), so a terminal cfg that reached here always carries one. `resolveReader` ignores
    // its `(tenantId, tillId)` args — this till drives one fixed, provisioned reader, not one
    // selected per collect.
    const readerId = cfg.stripeReaderId!;
    return new StripeTerminalProvider({
      client,
      db: deps.db,
      tenantId: cfg.tenantId,
      // The till's own node id, so a card collect's enrolled `payments` writes capture this node as
      // the sync origin (design §4d(B)).
      nodeId: cfg.nodeId,
      resolveReader: () => Promise.resolve(readerId),
    });
  }
  // `stripe_on_device` — the handheld Tap-to-Pay flow, which mints its own connection token and needs
  // no server-side reader id (till-config.ts requires none for this branch).
  const client = await cardDeviceClientResolver(deps)(cfg.tenantId);
  return new StripeOnDeviceProvider({
    client,
    db: deps.db,
    tenantId: cfg.tenantId,
    nodeId: cfg.nodeId,
  });
}

/**
 * Bind the one HTTP listener and wire its listen-failure handler — the serve step BOTH boot modes
 * share, written once here rather than duplicated across the setup and trading branches. Called LAST
 * in each branch, after every route that branch registered, so the mounted app is complete before it
 * binds. Returns the `@hono/node-server` server so `makeStartedServer`'s `close()` can shut it down.
 */
function startListening(
  config: ServerConfig,
  app: Hono,
  now: () => Date,
  log: Logger,
): ReturnType<typeof serve> {
  // Set inside the `listeningListener` below, and read by the `'error'` handler right after it —
  // see that handler's own comment on why an error arriving AFTER a successful bind must not be
  // treated the same way as a bind failure.
  let bound = false;
  // `buildServeOptions` turns the plain-HTTP options into HTTPS ones when `config.tls` is set,
  // reading the cert/key files, and returns them unchanged otherwise (loopback dev). The exact
  // `@hono/node-server` option names (`createServer` + `serverOptions`) are confirmed and documented
  // in `tls.ts`. A missing or unreadable certificate fails the boot loudly here (spec §8).
  //
  // The SECOND argument, `serve`'s own `listeningListener`, not a log call placed right after this
  // expression: `serve()` calls `listen()` and returns immediately, but the underlying socket binds
  // ASYNCHRONOUSLY — a log line placed here in source order would assert "listening" before that
  // bind has actually happened. `listeningListener` is Node's own callback for "now it really is."
  const server = serve(
    buildServeOptions(
      { fetch: app.fetch, port: config.httpPort, hostname: config.httpHost },
      config.tls,
    ),
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
    // does not fix it either: the loop may still be running and keeping the event loop alive, so a
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
  return server;
}

/**
 * The `StartedServer` BOTH modes return, with the shared `close()` sequence written once. `close()`
 * is idempotent and always drains the connection pools, whatever the teardown does first — the
 * mode-specific parts arrive as `teardown` (a `BootTeardown`): `stopWork` stops any background work
 * and awaits it (the loop plus the sync/retention workers in trading mode; a no-op in setup mode),
 * then `closePools` releases the pools (app + sync + retention in trading mode; the app pool alone in
 * setup mode). `mdns` is the shared mDNS responder both modes start in the prefix; `close()` stops it
 * FIRST — the box is going down, so it must stop advertising `waitron.local` before anything else.
 */
function makeStartedServer(
  server: ReturnType<typeof serve>,
  health: HealthState,
  log: Logger,
  teardown: BootTeardown,
  mdns: MdnsResponder,
): StartedServer {
  // Guards a second, LOSING concurrent `close()`: without it, both calls would reach the pool
  // teardown (pg-pool's `.end()`), and `.end()` a second time throws "Called end on pool more than
  // once". `bin.ts`'s own signal latch prevents two calls from a signal handler today, but `close()`
  // is exported on `StartedServer` precisely so a caller outside `bin.ts` can invoke it directly — a
  // test hook above all — with no latch of its own. Checked and set synchronously, before the first
  // `await`: JS's run-to-completion means the loser's check always sees the winner's write, however
  // the two calls are interleaved by their caller. A plain early return is enough — the loser does
  // not wait for the winner's shutdown to finish, it only promises not to repeat it.
  let closed = false;
  return {
    health,
    close: async () => {
      if (closed) return;
      closed = true;
      // Stop advertising FIRST — the box is going down, so `waitron.local` must stop resolving to it
      // before the listener and pools come apart. `stop()` is idempotent and destroys the UDP socket
      // once, so a second concurrent close() (guarded above) never double-destroys it either.
      await mdns.stop();
      // Stop this boot's background work and await it BEFORE the listener/pool teardown below, so
      // close() never leaves a worker dangling. In trading mode this aborts the main loop and the
      // sync/retention workers and swallows a worker's settle-by-rejection so it can never skip the
      // guaranteed teardown; in setup mode there is nothing to stop.
      await teardown.stopWork();
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
        await teardown.closePools();
      }
      log("info", "server.stopped");
    },
  };
}

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
  const config = loadConfig(env, DEFAULT_MIGRATIONS_ROOT, DEFAULT_MEDIA_ROOT, DEFAULT_STATE_ROOT);
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
  // Each configured built-SPA directory must actually hold an `index.html`. Checked HERE, in the
  // same fail-fast-before-resources group as the `maxTickMs` guard above and BEFORE any pool is
  // opened or migrations run: `assertBuiltApp` is a pure `existsSync` with no database dependency, so
  // a wrong or never-built dir should fail the boot LOUDLY (`server.config_invalid`, naming the env
  // var — §8's "everything escapes") before it costs a migration run or an open app-role pool, not
  // after. Gated exactly as the mounts below are — dev leaves both unset. The MOUNTS themselves stay
  // LAST, after every API route (`mountSpa`'s "call me after every API route" contract).
  if (config.dashboardAppDir !== undefined) {
    assertBuiltApp(config.dashboardAppDir, "WAITRON_DASHBOARD_APP_DIR");
  }
  if (config.tillAppDir !== undefined) {
    assertBuiltApp(config.tillAppDir, "WAITRON_TILL_APP_DIR");
  }

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

  // Health state + the one Hono app, shared by BOTH modes: `/health` answers in setup mode too, and
  // whichever surface the branch below mounts (setup or trading) attaches to this same app. Created
  // before the branch so the shared `startListening`/`makeStartedServer` helpers receive one app and
  // one health state whichever mode boots.
  const health = createHealthState(now());
  const app = healthApp(health, now);

  // Advertise waitron.local over mDNS from inside the process (slice 3) — in BOTH modes, so a
  // device reaches the box by name whether it is being set up or already trading. The name→IP
  // mapping is independent of which front-door cert is served; the reachable URL carries the port.
  // Stopped in makeStartedServer's close() below (shared teardown), so a test that opens and closes
  // many servers never leaks the UDP :5353 socket. Started AFTER the fail-fast config guards and the
  // migrations above, so a boot that aborts there never opened a socket; a throw AFTER this point
  // (either branch's own catch) stops it explicitly before it propagates (see those catches).
  const mdns = startMdnsResponder({ hostname: "waitron.local", getAddresses: listBoxIpv4, log });

  if (config.till === undefined) {
    // SETUP MODE (slice 1b/2a/2b) — this box is bound to no venue (none of the five WAITRON_TILL_*_ID
    // are set). It serves ONLY `/health` and the unauthenticated setup surface: no reconciler/duty, no
    // `readOrderFlow`, no trading routes, no sync transport, and no drain/reconcile workers — there is
    // nothing to submit yet. The DB is migrated all the same (the shared prefix above ran
    // `applyMigrations`), ready for the provisioning wizard. The till/dashboard SPAs are deliberately
    // NOT mounted — they are useless without a venue, and the real setup wizard app arrives in slice
    // 2c; the media store is trading-only, so it is not created here either.
    //
    // Slice 2b wires the provisioning surface: `ensureBoxSecrets` (2a) runs first (below), then this
    // branch recovers the vault key ring and opens an OWNER connection, and passes both — plus the
    // config-persist and restart callbacks — into `mountSetup` so `POST /setup-api/provision` can
    // stamp, mint the venue, seal the first `fiscal.aeat` credential, persist `trading.env` and
    // restart the box into trading mode.
    //
    // `ensureBoxSecrets` runs on EVERY setup boot, unconditionally — its two halves are independently
    // presence-gated inside (mint the self-signed cert quartet only when absent; generate
    // `secrets.env`'s vault key + node token only when absent), so it is cheap and idempotent, and a
    // reused box keeps both byte-for-byte. It runs regardless of `config.tls` because the box's OWN
    // secrets (the vault key above all — this branch loads it below to seal the first provisioned
    // credential) must exist whichever front-door cert is served; gating the whole call on
    // `config.tls === undefined` would strand an operator-TLS box with no vault key. THEN the served
    // cert is chosen: an operator who supplied their own WAITRON_TLS_* pair keeps it — `config.tls`
    // WINS — otherwise the box serves its own freshly-ensured self-signed leaf as the fallback. Only
    // the leaf `{ certFile, keyFile }` feeds `config.tls`; the returned `caCertFile` is the CA a setup
    // CLIENT trusts to accept the leaf, not a server input, so it is narrowed off here. `now` is
    // `startServer`'s own `() => new Date()`, so the cert's validity window is anchored to real boot
    // time. The trading `else` branch reads `config.tls` unchanged — untouched.
    //
    // The discovery + CA-serving surface (slice 3): GET /setup-api/ca.crt (the CA 2a minted),
    // GET /setup-api/discovery, and GET /setup/trust. Registered BEFORE mountSetup (below, inside the
    // provisioning try) so the GET * placeholder catch-all inside mountSetup cannot shadow these paths
    // (Hono is first-match-wins). Setup-mode only — a trading box needs neither (its tills are already
    // paired). `secure: true` — the box serves the setup surface over HTTPS (2a), so every reach URL is
    // https. Registered here, before the provisioning try, because it needs none of that try's
    // resources (the owner pool / key ring) — only config.
    mountDiscovery(
      app,
      { stateDir: config.stateDir, hostname: "waitron.local", port: config.httpPort, secure: true },
      log,
    );
    //
    // Guarded so a throw anywhere in this branch (`ensureBoxSecrets` on EACCES/EROFS under the state
    // dir, a missing/unreadable `secrets.env`, or `startListening` -> `buildServeOptions` ->
    // `readFileSync` on a missing/unreadable operator TLS file) closes `db` before it propagates —
    // mirroring the trading branch's own `loadKeyRing` guard below. `createPostgresDb` above already
    // opened a LIVE pool, and on a throw path `startServer` never returns a `StartedServer`, so
    // nothing else would ever call `db.close()` — the pool would leak. The happy path is unchanged.
    try {
      const ensured = await ensureBoxSecrets({
        stateDir: config.stateDir,
        hostnames: ["waitron.local", "localhost"],
        now,
      });
      // Recover the vault key ring (slice 2b R5). `ensureBoxSecrets` above WROTE
      // `WAITRON_CREDENTIALS_KEY`(+`_VERSION`) into `<stateDir>/secrets.env` but never loaded it into
      // this process's env — so, unlike the trading branch (which reads the ring from `env`), the
      // setup process has no key material in `process.env`. Read the file 2a just wrote back off disk
      // and build the ring from it, so the provision route can seal the first tenant's `fiscal.aeat`
      // credential. A missing/unreadable `secrets.env` is a LOUD boot failure (`readFileSync` throws,
      // caught by the guard above) — correct, since the write above guarantees it on the happy path.
      const ring = loadKeyRing(
        parseEnvFile(readFileSync(join(config.stateDir, "secrets.env"), "utf8")),
      );
      // The OWNER connection provisioning needs. `applyVenue` INSERTs into `tenants` (which `app_user`
      // deliberately cannot — CLAUDE.md §3) and `stampDeployment` writes the `deployment` singleton, so
      // both need a role that OWNS the tables, NOT the app pool's `config.databaseUrl`. In dev
      // `config.migrationsDatabaseUrl` is the container superuser (owns everything), so it works here.
      // NOTE (do not read this as "the migrator owns the tables"): the true owner is the role that ran
      // `waitron-provision instance` — it ran CREATE DATABASE + the migrations over the ADMIN string
      // (`packages/provisioning/src/instance-apply.ts`), NOT `waitron_migrator`, which is an `app_user`
      // member with no INSERT on `tenants`. On a role-split appliance the setup-mode owner connection
      // must be that admin, not `migrationsDatabaseUrl`; wiring it is deferred with the instance
      // role-split (R1). Closed in the setup teardown
      // (`closePools`) beside `db`, and on any throw below (the inner catch) so a later failure — from
      // `mountSetup` or `startListening` — never leaks it.
      const ownerDb = await createPostgresDb(config.migrationsDatabaseUrl);
      try {
        // The setup surface, now with the slice-2b provisioning deps bound. `provision`/`sealAeat`
        // capture `ownerDb` + `ring`; `persistTrading` writes `<stateDir>/trading.env`; `requestRestart`
        // SIGTERMs this process so the supervisor restarts it into trading mode (`bin.ts`'s latch does
        // the graceful shutdown). `databaseUrl`/`migrationsDatabaseUrl` become `trading.env`'s own
        // connection strings for the next boot. The `*` catch-all inside `mountSetup` stays terminal
        // and last, so the new POST route (registered before it) is not shadowed.
        mountSetup(
          app,
          {
            environment: config.environment,
            provision: (req) => provisionVenue({ ownerDb }, req),
            sealAeat: (tenantId, cert) => sealAeatCredential(ownerDb, ring, tenantId, cert),
            // `writeTradingEnv` returns the path it wrote; the surface only needs `Promise<void>`, so
            // discard it explicitly rather than widen the dep's type.
            persistTrading: async (cfg) => {
              await writeTradingEnv(config.stateDir, cfg);
            },
            databaseUrl: config.databaseUrl,
            migrationsDatabaseUrl: config.migrationsDatabaseUrl,
            requestRestart: () => process.kill(process.pid, "SIGTERM"),
          },
          log,
        );
        const tls = config.tls ?? { certFile: ensured.certFile, keyFile: ensured.keyFile };
        const server = startListening({ ...config, tls }, app, now, log);
        return makeStartedServer(
          server,
          health,
          log,
          {
            // A setup box runs no background work, so there is nothing to abort or await.
            stopWork: () => Promise.resolve(),
            // The app pool AND the provisioning owner pool — no sync/retention pools exist here.
            // `allSettled`, not sequential `await`s: a rejecting `db.close()` must NOT leak `ownerDb`.
            // Both are closed regardless of either's outcome, so neither pool dangles on the teardown
            // path (which `close()` runs even after a `server.close()` rejection).
            closePools: async () => {
              await Promise.allSettled([db.close(), ownerDb.close()]);
            },
          },
          mdns,
        );
      } catch (error) {
        // A throw AFTER `ownerDb` opened (`mountSetup` / `startListening` / `buildServeOptions`) must
        // close it before propagating to the outer catch that closes `db` — neither pool may leak.
        await ownerDb.close();
        throw error;
      }
    } catch (error) {
      // `mdns` started in the shared prefix above, so a throw in this branch must stop its UDP socket
      // before the pool is closed — otherwise the socket leaks on exactly the boot that failed.
      await mdns.stop();
      await db.close();
      throw error;
    }
  }

  // TRADING MODE — a venue is bound (`config.till` is present, narrowed for the rest of the function
  // by the early return above). Everything below is today's flow, only relocated into this branch; a
  // setup box reaches none of it.
  //
  // The env this function was given, straight through: `loadKeyRing` owns the four
  // WAITRON_CREDENTIALS_KEY* names and their validation, and re-declaring them here would be a second
  // source of truth. (Not literally `process.env` — that is true only when `bin.ts` is the caller;
  // `boot.test.ts` passes a literal object instead.) Loaded at the TOP of the trading branch, not in
  // the shared prefix: it is consumed only on trading paths (the reconciler, the webhook, the card
  // provider, the drain loop), so an unprovisioned box needs no WAITRON_CREDENTIALS_KEY.
  //
  // Guarded so a `loadKeyRing` throw (`credentials.key_missing`, a malformed WAITRON_CREDENTIALS_KEY)
  // closes `db` before it propagates. `createPostgresDb` above already opened a LIVE pool (it does
  // `await pool.connect(); probe.release()`, `packages/db/src/client.ts`), and on the throw path
  // `startServer` never returns a `StartedServer`, so nothing else would ever call `db.close()` — the
  // pool would leak. This mirrors the `stampProbe` try/finally in the shared prefix above; the happy
  // path is unchanged. (The pre-existing `readOrderFlow`/`buildCardProvider` throw sites below leak the
  // same way and are out of scope here — this only restores the no-leak `loadKeyRing` had before it
  // moved after the pool open.)
  let ring: ReturnType<typeof loadKeyRing>;
  try {
    ring = loadKeyRing(env);
  } catch (error) {
    // `mdns` started in the shared prefix above, so stop its UDP socket before closing the pool —
    // otherwise it leaks on this failed boot. The pre-existing `readOrderFlow`/`buildCardProvider`
    // throw sites further down leak both `db` AND this socket the same way and stay out of scope here
    // (they leaked `db` before slice 3 too — documented below), so only this guarded site is amended.
    await mdns.stop();
    await db.close();
    throw error;
  }

  const reconciler = new StripeReconciler({
    db,
    nodeId: config.till.nodeId,
    resolveAccount: stripeAccountResolver({
      db,
      ring,
      environment: config.environment,
      makeStripe: defaultMakeStripe,
    }),
    ...(config.settlementLagMs === undefined ? {} : { settlementLagMs: config.settlementLagMs }),
  });
  const duty = reconcilerAsDuty(reconciler);

  // The product-image store must exist before mounting the routes that read and write it (the
  // upload/serve mounts land in later slices). Done ONCE here, not per request; `recursive: true`
  // makes it idempotent — a no-op once the directory is there, which is every boot after the first.
  // After migrations deliberately: a boot that fails earlier never creates a stray media directory.
  // Trading-only — a setup box serves no media.
  mkdirSync(config.mediaDir, { recursive: true });

  // One Hono app: `/health` plus the Mode 3 inbound webhook, which "attaches to this app rather than
  // creating a second one" (health.ts's own note). `makeStripe` is `defaultMakeStripe`, the same SDK
  // factory `stripeAccountResolver` uses above — the webhook selects each request's signing secret
  // from the PATH tenant's own `payments.stripe` credential, never a platform one.
  mountWebhook(
    app,
    {
      db,
      ring,
      nodeId: config.till.nodeId,
      environment: config.environment,
      makeStripe: defaultMakeStripe,
    },
    log,
  );
  // The till's own HTTP surface (session, roster, boot info, catalogue, sales) on the SAME app —
  // `mountTillApi` "attaches to this app rather than creating a second one", the identical convention
  // `mountWebhook` above follows. `backend`/`clock` are the till's fiscal pieces, built exactly as
  // `scripts/record-one-sale.ts` does (see `till-backend.ts`): the till's `recordSale` files the same
  // Veri*Factu chain, and neither ever contacts AEAT (that is the `drain` loop below's job).
  // `secureCookies` tracks the transport: TRUE only when TLS is configured, so the session cookie is
  // never marked `Secure` on a plain-HTTP loopback host where the browser would then never send it
  // back. Mounting registers routes only — no database work happens here, so a till pointed at an
  // unprovisioned tenant fails per-request (via `run`), never at boot.
  // The till's pay-timing mode is a per-LOCATION column, not an env var, so `config.till` (from
  // `tryLoadTillConfig`) carries every fiscal id but NOT `orderFlow`. Read it here, ONCE, now that the
  // pool is open, and spread it in to form the full `TillConfig` the routes dispatch on — the merge
  // the type demands (`config.till` is `Omit<TillConfig, "orderFlow">`, see `till-config.ts`). A
  // boot-time read, not per request: the mode is stable provisioning-time config.
  const till: TillConfig = { ...config.till, orderFlow: await readOrderFlow(db, config.till) };
  // The venue's DEFAULT UI locale, derived ONCE now the pool is open — the DISPLAY counterpart to the
  // fiscal `till.locale`/`invoiceLocales` (left untouched). `readVenueLocale` applies the shared
  // `override → province → country → English` chain, reading the tenant's country + the location's
  // province under the app role. The override is the RAW `WAITRON_TILL_LOCALE` (`till.localeOverride`),
  // NOT the defaulted `till.locale` (which is `es-ES` and would mask geography). Threaded as a STRING
  // into the till + me mounts below (both surface it via `GET .../locales`), never re-read per request.
  const venueLocale = await readVenueLocale(db, {
    tenantId: till.tenantId,
    locationId: till.locationId,
    override: till.localeOverride,
  });
  // The till's ONE integrated card provider (or none), built from its tenant's own Stripe credential
  // — `makeStripe` is `defaultMakeStripe`, the same SDK factory `stripeAccountResolver` above uses. A
  // missing or wrong-environment key fails the boot here (§8's "everything escapes"), never the first
  // card sale. Tips read off `till.tipsEnabled` (part of `cfg`) wherever needed — no separate copy.
  const cardProvider = await buildCardProvider(till, {
    db,
    ring,
    environment: config.environment,
    makeStripe: defaultMakeStripe,
  });
  // The session cookie is `Secure` only when TLS is configured. Hoisted to ONE binding so the till
  // and management mounts below both read the same value — a shared local, not a duplicated literal.
  const secureCookies = config.tls !== undefined;
  mountTillApi(
    app,
    {
      db,
      backend: makeFiscalBackend(db, env),
      clock: systemClock(),
      cfg: till,
      secureCookies,
      cardProvider,
      venueLocale,
    },
    log,
  );
  // The trusted-DEVICE surface (device-identity-1) on the SAME app, the identical convention: the
  // UNAUTHENTICATED enrol route, the `requireDevice`-guarded KDS routes (a kitchen screen reads and
  // bumps only its own bound station), and the `device.manage`-gated management routes (mint a pairing
  // code, list devices, revoke one). It reuses the EXACT `db` and — unlike the sibling mounts, which
  // pass a `{ tenantId }` subset — the FULL `till` config `mountTillApi` receives above, because the
  // device verbs are typed `cfg: TillConfig` and `listStationQueue` scopes the queue by `cfg.nodeId`
  // (the routes touch none of the fiscal ids on it). `secureCookies` is the SAME hoisted binding, so the
  // enrolment cookie is `Secure` iff TLS is configured. Routes only — no database work at boot; the
  // device guard and the `device.manage` gate run per request.
  mountDeviceApi(app, { db, cfg: till, secureCookies }, log);
  // The printing subsystem's HTTP surface on the SAME app, the identical three-group convention: the
  // UNAUTHENTICATED agent enrol (`POST /print-api/agent/enrol`, redeem a pairing code for a Bearer
  // token), the `requireAgent`-gated agent group (claim this agent's queued jobs, report each result —
  // the claim commits within the request, holding no lock across the agent's push, design §3c/Ruling 6)
  // and the `printer.manage`-gated management group (mint agent codes, list/revoke agents, printers
  // CRUD, recent jobs). It reuses the EXACT `db` and this venue's tenant + location (`till.tenantId`/
  // `till.locationId`) so scope cannot drift from the sibling mounts. No `secureCookies` (the agent uses
  // a Bearer token, the management group the shared management session), no fiscal backend/clock/card
  // provider/media store — these routes touch only the four print_* tables. Routes only — no database
  // work at boot; the agent guard and the `printer.manage` gate run per request.
  mountPrintApi(app, { db, cfg: { tenantId: till.tenantId, locationId: till.locationId } }, log);
  // The dashboard's management HTTP surface (manager login, staff/person management, passkey
  // ceremonies) on the SAME app, the identical convention `mountWebhook` and `mountTillApi` above
  // follow. It reuses the EXACT values `mountTillApi` receives so the two cannot drift: the same `db`,
  // the same tenant (`till.tenantId`, this venue's one tenant) and the same `secureCookies` binding
  // hoisted above (one value, read by both mounts — not a re-typed `config.tls !== undefined`). No
  // fiscal backend, clock or card provider: the management routes read and write only the tenant's own
  // identity records. `rpId`/`origin` are the passkey Relying Party config from `loadConfig` — a
  // passkey is bound to its RP ID + origin, so these are config, never hardcoded (spec §4c). Routes
  // only — no database work at boot.
  mountManagementApi(
    app,
    {
      db,
      cfg: { tenantId: till.tenantId },
      // The venue's own config (tenant + location) the FP-1 zone/table config routes scope to — the
      // SAME `till` config `mountTillApi` receives above, so the dashboard "Sala" surface and the till
      // surface CRUD the same `floor_zones`/`dining_tables` under one location. Only tenant + location
      // are read there (the fiscal ids are inert — these are config routes touching no fiscal path).
      venueCfg: till,
      secureCookies,
      rpId: config.managementRpId,
      origin: config.managementOrigin,
    },
    log,
  );
  // The dashboard's gated catalogue write group (catalogues/categories/products + image upload) on the
  // SAME app, the identical convention. It reuses the EXACT `db` and tenant `mountManagementApi` above
  // receives (`till.tenantId`, this venue's one tenant) so the two cannot drift, plus the store
  // `mkdirSync` above ensured (`config.mediaDir`) and the shared `MAX_UPLOAD_BYTES` DoS ceiling — one
  // value read by this mount and its route, not two literals. No fiscal backend, clock or card
  // provider: these routes touch only the catalogue and the image store. Routes only — no database
  // work at boot; the `person.manage` gate runs per request.
  mountCatalogueApi(
    app,
    {
      db,
      cfg: { tenantId: till.tenantId, nodeId: till.nodeId },
      mediaDir: config.mediaDir,
      maxUploadBytes: MAX_UPLOAD_BYTES,
    },
    log,
  );
  // The dashboard's gated purchase-invoice write group (facturas recibidas: header + VAT desglose) on
  // the SAME app, the identical convention. Reuses the EXACT `db` and tenant `mountCatalogueApi` above
  // receives (`till.tenantId`, this venue's one tenant) so the two cannot drift. No `nodeId` (the
  // purchase tables carry no sync-capture trigger), no fiscal backend, clock, card provider or media
  // store — these routes touch only the two purchase-invoice tables. Routes only — no database work at
  // boot; the `purchase.manage` gate runs per request. This is the #91 fast-follow's capture surface,
  // feeding the headless modelo 303 IVA-deducible reporting.
  mountPurchasingApi(app, { db, cfg: { tenantId: till.tenantId } }, log);
  // The dashboard's gated modelo 303 DR303 export on the SAME app, the identical convention. Reuses
  // the EXACT `db` and tenant (`till.tenantId`, this venue's one tenant) `mountPurchasingApi` above
  // receives so the two cannot drift. No `nodeId` (a modelo 303 aggregates ALL of the obligado's
  // nodes), no fiscal backend, clock, card provider or media store — a READ-ONLY route over the filed
  // commercial record. Routes only — no database work at boot; the `report.export` gate runs per
  // request, and the reporting pipeline SELECTs only (tenant row + sales/purchase reads).
  mountReportApi(app, { db, cfg: { tenantId: till.tenantId } }, log);
  // The dashboard's gated recipe-authoring surface (ingredient CRUD + product-recipe get/set) on the
  // SAME app, the identical convention. Reuses the EXACT `db`, tenant and `nodeId` `mountCatalogueApi`
  // above receives (`till.tenantId`/`till.nodeId`, this venue's one tenant + this node) — a recipe write
  // UPDATEs the sync-enrolled `products` table (via applyRecipeDerivation), so it threads `nodeId` for
  // the same origin-attribution reason catalogue does. No fiscal backend, clock, card provider or media
  // store. Routes only — no database work at boot; the `recipe.manage` gate runs per request.
  mountRecipeApi(app, { db, cfg: { tenantId: till.tenantId, nodeId: till.nodeId } }, log);
  // The dashboard's gated shift-planning surface (roster authoring + publish) on the SAME app, the
  // identical convention. Reuses the EXACT db + tenant (till.tenantId, this venue's one tenant); no
  // fiscal backend, clock, card provider or media store — these routes touch only roster_versions /
  // shifts / convenio_config / locations. Routes only; the schedule.manage gate runs per request.
  mountWorkforceApi(app, { db, cfg: { tenantId: till.tenantId } }, log);
  // The STAFF-FACING half of the schedule surface on the SAME app — the till-session-gated request
  // routes (view my shifts/swaps/absences, request a swap or absence, accept a swap offered to me),
  // the counterpart to mountWorkforceApi's manager approval half. Same minimal deps (db + this venue's
  // tenant); the till PIN session gates it (requireSession), not a management session. Routes only.
  mountScheduleApi(app, { db, cfg: { tenantId: till.tenantId } }, log);
  // The STAFF SELF-SERVICE half of the management dashboard on the SAME app — the browser twin of the
  // till's mountScheduleApi. Its whoami (`GET /management-api/session/me`) + `/management-api/me/schedule/*`
  // routes gate on the MANAGEMENT session (requireManagementSession + resolveManagementSession), never
  // authorizeManager, so a staff-role person acts on their own roster/swaps/absences. Same minimal deps
  // (db + this venue's tenant); no fiscal backend, clock or card provider. Routes only.
  mountMeApi(app, { db, cfg: { tenantId: till.tenantId }, venueLocale }, log);
  // The PUBLIC read half of the product-image feature on the SAME app — the `mountWebhook` /
  // `mountTillApi` / `mountManagementApi` convention again. Deliberately UNAUTHENTICATED and taking
  // no `db`/session: it serves bytes from `config.mediaDir` (the store `mkdirSync` above ensured),
  // guarding the filename against traversal with its own explicit regex (design §5e). Mounted after
  // the gated groups purely for reading order; route registration only, no database work at boot.
  mountMedia(app, { mediaDir: config.mediaDir }, log);

  // The active-active sync transport: enabled iff WAITRON_SYNC_PEERS is set (loadSyncConfig). It opens
  // its OWN pool (a sync_tailer + app_user member — the app pool cannot read sync_log), mounts the
  // node-token-authenticated source group on the SAME app, and starts the background pull worker
  // against each configured peer. The sync NODE ID is till.nodeId (one source of truth; no second
  // WAITRON_SYNC_NODE_ID), and minTickMs/maxTickMs double as the worker's idle interval and backoff
  // ceiling. A host that sets no sync env leaves syncConfig undefined, so every existing boot is
  // unchanged (boot.test.ts sets none). Torn down in close() below.
  const syncConfig = loadSyncConfig(env);
  const syncController = new AbortController();
  let syncDb: Database | undefined;
  let syncWorker: Promise<void> | undefined;
  // The retention sweep's OWN pool + worker, declared beside the pull worker's so close() below tears
  // both down. Both `undefined` unless sync is on AND a retention role is configured (the sweep is
  // opt-in — see the wiring inside the `if` below).
  let retentionDb: Database | undefined;
  let retentionWorker: Promise<void> | undefined;
  if (syncConfig !== undefined) {
    syncDb = await createPostgresDb(syncConfig.databaseUrl);
    mountSyncApi(
      app,
      {
        db: syncDb,
        tenantId: till.tenantId,
        nodeId: till.nodeId,
        environment: config.environment,
        nodeTokens: syncConfig.nodeTokens,
      },
      log,
    );
    // Hoisted to a `const` so `runLane`'s closure keeps the non-`undefined` narrowing: `syncDb` is a
    // `let` declared outside this block, and TS widens a captured `let` back to `Database | undefined`
    // inside a nested function, whereas a `const` assigned here holds its narrowed `Database` type.
    const localSyncDb = syncDb;
    const runLane = (lane: SyncLane, minIdleMs: number): Promise<void> =>
      runSyncPull({
        localDb: localSyncDb,
        subscriberId: till.nodeId,
        tenantId: till.tenantId,
        localEnvironment: config.environment,
        http: fetchHttpClient,
        batchLimit: 500,
        peers: syncConfig.peers,
        sleep: realSleep,
        signal: syncController.signal,
        minIdleMs,
        maxBackoffMs: config.maxTickMs,
        log,
        lane,
      });
    // The ORDERED lane at the existing idle interval (config.minTickMs) and the FAST payments lane at
    // the tighter syncConfig.fastMinIdleMs, both against the same peers/localDb/http, both under the one
    // syncController and the existing close() teardown (spec §4d). Promise.all so a rejection from
    // either reaches close()'s `await syncWorker.catch(() => {})` swallow below; the two lanes
    // touch disjoint tables and disjoint cursor rows, so they never race (spec §4d). `.then(() => {})`
    // keeps syncWorker a `Promise<void>` so the existing teardown shape is unchanged.
    syncWorker = Promise.all([
      runLane("ordered", config.minTickMs),
      runLane("fast", syncConfig.fastMinIdleMs),
    ]).then(() => {});
    // A SECOND subscription so a lane that settles by rejection (an unexpected throw escaping
    // runSyncPull's own per-peer catch) is never a process-level unhandled rejection in the window
    // BEFORE close() runs — the window the single-worker slice never had, because `syncWorker` was
    // then the same promise the caller already held. This does NOT swallow the rejection for close():
    // `syncWorker` still rejects, so close()'s own `await syncWorker.catch(() => {})` below is still
    // the load-bearing teardown-ordering guard (its removal still fails the rejecting-worker test).
    // In production runSyncPull never rejects (its loop backs off every per-peer error), so this only
    // ever fires under a mocked worker in the test — but an EMPTY catch here would drop that signal
    // silently if it ever did happen for real, with sync stopped and no log line to say why. Log it
    // instead, the same `codeOf`-classified shape `loop.ts` and `error-boundary.ts` already use.
    syncWorker.catch((err) => log("error", "sync.worker_rejected", { errorCode: codeOf(err) }));

    // The scheduled retention sweep (spec §3.2) — this is what finally SCHEDULES the previously-unwired
    // pruneSyncLog. Opt-in: only when a `sync_retention`-member URL is configured. It opens its OWN
    // pool (that dedicated whole-log, cross-tenant role — NOT the app/sync_tailer pools, which cannot
    // DELETE sync_log) and starts runRetentionSweep under the SAME syncController the pull worker uses,
    // so close()'s single `syncController.abort()` stops the sweep too. Each tick prunes the log to the
    // min across every subscriber's cursor and alarms a stalled one; it NEVER evicts and NEVER
    // alive-filters the prune (an inherited owner decision — a human decides eviction, spec §3.4). Torn
    // down in close() below. `.catch` logs a settle-by-rejection the same way the pull worker's does —
    // runRetentionSweep swallows its own per-tick faults, so in practice this only ever fires under a
    // mocked worker in the test, but an unhandled rejection in the pre-close() window would be silent
    // otherwise.
    if (syncConfig.retentionDatabaseUrl !== undefined) {
      retentionDb = await createPostgresDb(syncConfig.retentionDatabaseUrl);
      retentionWorker = runRetentionSweep({
        db: retentionDb,
        sleep: realSleep,
        signal: syncController.signal, // the same controller close() aborts
        tickMs: syncConfig.retentionTickMs,
        // Opt-in lag alarm (spec §3.2): when WAITRON_SYNC_LAG_ALARM_ROWS is set the sweep emits the
        // retention-variant sync.stream_stalled past this threshold — the operator signal an eviction
        // decision reads. Undefined (unset) leaves the sweep prune-only.
        lagAlarmRows: syncConfig.lagAlarmRows,
        log,
      });
      retentionWorker.catch((err) =>
        log("error", "sync.worker_rejected", { errorCode: codeOf(err) }),
      );
    } else {
      // Sync is on but no retention role is configured: the log will grow unpruned. Loud, not fatal
      // (spec §3.2/§8 — opt-in, documented-required-in-prod), so an existing sync host that has not
      // provisioned the role still boots unchanged.
      log("warn", "sync.retention_unconfigured", {});
    }
  }

  // Serve the built front-ends SAME-ORIGIN (slice 1a), mounted LAST — after every API route AND the
  // optional sync block above — so the till's root catch-all cannot shadow `/api`, `/management-api`,
  // `/media`, `/health` or the sync routes (`mountSpa`'s "call me after every API route" contract).
  // Dashboard (`/manage`) FIRST so `/manage/*` wins; the till (`""` = origin root) LAST, the one
  // catch-all, so nothing it might swallow is registered after it (`boot.spa-mount.test.ts` pins that
  // order). Gated on each dir being configured — dev leaves them unset and uses the Vite dev servers,
  // so an existing boot (`boot.test.ts` sets neither) mounts nothing here, exactly as the sync block
  // gates on `syncConfig`. A dir configured but never built (no `index.html`) has ALREADY failed the
  // boot LOUDLY via the `assertBuiltApp` fail-fast checks near the top of `startServer`
  // (`server.config_invalid`, naming the env var), §8's "everything escapes" — so by here each
  // configured dir is known to hold its `index.html`, never a catch-all that 404s every page load.
  if (config.dashboardAppDir !== undefined) {
    mountSpa(app, { root: config.dashboardAppDir, basePath: "/manage" }, log);
  }
  if (config.tillAppDir !== undefined) {
    // `""` = the origin-root catch-all: MUST be the last GET mounted (see the block comment above).
    mountSpa(app, { root: config.tillAppDir, basePath: "" }, log);
  }

  // Bind the HTTP listener and wire the listen-failure handler — the serve step shared by both boot
  // modes (see `startListening`). Mounted here, LAST, after every trading route and the optional sync
  // block and SPA mounts above, so the app is complete before it binds.
  const server = startListening(config, app, now, log);

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

  // The shared `StartedServer` + `close()` (see `makeStartedServer`), with the trading mode's own
  // teardown supplied here: stop the main loop and the sync/retention workers, then drain the app,
  // sync and retention pools. Byte-for-byte the sequence this branch ran inline before the setup/
  // trading split — the ordering guarantees (abort the loop and sync together, await the loop, swallow
  // a worker's settle-by-rejection so it can never skip the guaranteed pool teardown) are unchanged.
  return makeStartedServer(
    server,
    health,
    log,
    {
      stopWork: async () => {
        controller.abort();
        // Stop the sync pull worker alongside the main loop so close() never leaves it dangling; the
        // worker's abort-aware sleep returns promptly rather than waiting out a backoff.
        syncController.abort();
        await loop;
        // Swallow a worker rejection so it can never skip the guaranteed teardown below. The worker is
        // still AWAITED — a clean shutdown drains it exactly as before, its abort-aware sleep returning
        // promptly — but if it settles by rejection (an unexpected throw escaping runSyncPull's own
        // per-peer catch), `.catch(() => {})` keeps that from throwing out of close() BEFORE the pool
        // teardown, which would leak the HTTP server and both connection pools on exactly the path that
        // failed. close() resolves either way; the worker's own errors are logged inside runSyncPull
        // (sync.pull_failed / sync.stream_stalled), not here.
        if (syncWorker !== undefined) await syncWorker.catch(() => {});
        // The retention sweep worker, torn down the identical way: `syncController.abort()` above already
        // stopped it (it shares that signal), so this only awaits its settle, swallowing a rejection so
        // it can never skip the guaranteed pool teardown below. Its own per-tick faults are logged and
        // swallowed inside runRetentionSweep, not here.
        if (retentionWorker !== undefined) await retentionWorker.catch(() => {});
      },
      closePools: async () => {
        await db.close();
        if (syncDb !== undefined) await syncDb.close();
        if (retentionDb !== undefined) await retentionDb.close();
      },
    },
    mdns,
  );
}
