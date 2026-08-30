import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import {
  createPostgresDb,
  readDeploymentAxes,
  readMirrorConfig,
  withTenant,
  type Database,
  type MirrorConnection,
} from "@waitron/db";
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
import {
  loadConfig,
  loadMirrorSyncConfig,
  loadSyncConfig,
  loadTunnelConfig,
  type ServerConfig,
} from "./config.js";
import { assertDeploymentMatches } from "./deployment-guard.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { promoteLocalSecondaryToPrimary } from "./promote.js";
import type { FenceAttestation, PromotionResult } from "./promote.js";
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
import { singletonPass } from "./singleton-pass.js";
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
import { mountBookingsApi } from "./booking-api.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { mountPurchasingApi } from "./purchasing-api.js";
import { mountReportApi } from "./report-api.js";
import { mountRecipeApi } from "./recipe-api.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { mountScheduleApi } from "./schedule-api.js";
import { mountMeApi } from "./me-api.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { mountMedia } from "./media-api.js";
import { assertBuiltApp, mountSpa } from "./spa-api.js";
import { mountSetup } from "./setup-api.js";
import { provisionVenue } from "./provision.js";
import { adoptFromPrimary } from "./adopt.js";
import { fetchMirrorBundle } from "./mirror-bundle-fetch.js";
import { sealAeatCredential } from "./aeat-credential.js";
import { writeTradingEnv, type TradingConfig } from "./trading-config.js";
import { mountDiscovery } from "./discovery-api.js";
import { startMdnsResponder, type MdnsResponder } from "./mdns.js";
import { listBoxIpv4 } from "./box-reach.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { mountSyncApi } from "./sync-api.js";
import { mountBoxStatusApi } from "./box-status.js";
import { mountRecoveryBundleApi } from "./recovery-bundle-api.js";
import { loadBackupConfig } from "./backup-config.js";
import { assertBackupCanReadFiscal } from "./backup-probe.js";
import { runBackupSweep } from "./backup-sweep.js";
import { readBackupStatus } from "./backup-status.js";
import { fetchHttpClient } from "./sync-http.js";
import { tunnelHttpClient } from "./tunnel-http.js";
import { readOnlyGate } from "./read-only-gate.js";
import { ensureMirrorViewer, mirrorSession } from "./mirror-session.js";
import { assertMirrorBindSafe } from "./mirror-bind-guard.js";
import { readMirrorToken } from "./mirror-token.js";
import { lagFor, runRetentionSweep, runSyncPull, type SyncLane } from "@waitron/sync";
import { runTunnelClient } from "@waitron/tunnel";
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
  /**
   * Promote a local secondary to primary in-process (promotion runbook design §5a) — flips
   * `singleton_role` to 'primary' and refreshes the fiscal-pass holder with no restart. Present only in
   * trading mode; a setup box omits it. IN-PROCESS ONLY: no network endpoint / break-glass auth yet (Slice
   * 2). Requires a fence attestation or it refuses (`promotion.fence_not_attested`).
   */
  promoteLocalSecondaryToPrimary?: (attestation: FenceAttestation) => Promise<PromotionResult>;
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
 * The box's canonical mDNS / self-hosted hostname. ONE source of truth so the three wirings that MUST
 * agree can never drift into a certificate-hostname mismatch — the exact failure the trust flow exists
 * to avoid (spec §7/§8): the mDNS responder that ANSWERS for the name, the discovery/trust surface that
 * ADVERTISES it, and the self-signed leaf's SAN list (`ensureBoxSecrets`) that must COVER it.
 */
const BOX_HOSTNAME = "waitron.local";

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
  promote?: (attestation: FenceAttestation) => Promise<PromotionResult>,
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
    ...(promote === undefined ? {} : { promoteLocalSecondaryToPrimary: promote }),
    close: async () => {
      if (closed) return;
      closed = true;
      // Stop advertising FIRST — the box is going down, so `waitron.local` must stop resolving to it
      // before the listener and pools come apart. `stop()` is idempotent and destroys the UDP socket
      // once, so a second concurrent close() (guarded above) never double-destroys it either.
      // `.catch(() => {})`: `stop()` never rejects today (mdns.ts's own `Promise<void>` executor has
      // no reject path), but a reject here must never skip the guaranteed pool teardown below, so this
      // is defensive rather than a response to an observed failure.
      await mdns.stop().catch(() => {});
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
  // after. Gated exactly as the mounts are — dev leaves them unset. The trading SPA mounts stay LAST,
  // after every API route (`mountSpa`'s "call me after every API route" contract); the setup wizard is
  // mounted inside `mountSetup` (the setup branch below), but its dir is checked here, in BOTH modes,
  // so a mis-built setup bundle fails a trading boot's config validation just as loudly.
  if (config.dashboardAppDir !== undefined) {
    assertBuiltApp(config.dashboardAppDir, "WAITRON_DASHBOARD_APP_DIR");
  }
  if (config.tillAppDir !== undefined) {
    assertBuiltApp(config.tillAppDir, "WAITRON_TILL_APP_DIR");
  }
  if (config.setupAppDir !== undefined) {
    assertBuiltApp(config.setupAppDir, "WAITRON_SETUP_APP_DIR");
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

  if (config.till === undefined) {
    // SETUP MODE (slice 1b/2a/2b) — this box is bound to no venue (none of the five WAITRON_TILL_*_ID
    // are set). It serves ONLY `/health` and the unauthenticated setup surface: no reconciler/duty, no
    // `readOrderFlow`, no trading routes, no sync transport, and no drain/reconcile workers — there is
    // nothing to submit yet. The DB is migrated all the same (the shared prefix above ran
    // `applyMigrations`), ready for the provisioning wizard. The till/dashboard SPAs are deliberately
    // NOT mounted — they are useless without a venue; the built setup wizard IS served (slice 2c) when
    // `config.setupAppDir` is set, threaded into `mountSetup` below as its root catch-all (else the
    // inline placeholder). The media store is trading-only, so it is not created here either.
    //
    // Slice 2b wires the provisioning surface: `ensureBoxSecrets` (2a) runs first (below), then this
    // branch recovers the vault key ring and opens an OWNER connection, and passes both — plus the
    // config-persist and restart callbacks — into `mountSetup` so `POST /setup-api/provision` can
    // stamp, mint the venue, seal the first `fiscal.aeat` credential, persist `trading.env` and
    // restart the box into trading mode.
    //
    // `ensureBoxSecrets` runs on EVERY setup boot, unconditionally — its two halves are independently
    // presence-gated inside (mint the self-signed cert quartet only when absent; generate
    // `secrets.env`'s vault key only when absent), so it is cheap and idempotent, and a
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
      { stateDir: config.stateDir, hostname: BOX_HOSTNAME, port: config.httpPort, secure: true },
      log,
    );
    // Guarded so a throw anywhere in this branch (`ensureBoxSecrets` on EACCES/EROFS under the state
    // dir, a missing/unreadable `secrets.env`, or `startListening` -> `buildServeOptions` ->
    // `readFileSync` on a missing/unreadable operator TLS file) closes `db` before it propagates —
    // mirroring the trading branch's own `loadKeyRing` guard below. `createPostgresDb` above already
    // opened a LIVE pool, and on a throw path `startServer` never returns a `StartedServer`, so
    // nothing else would ever call `db.close()` — the pool would leak. The happy path is unchanged.
    try {
      const ensured = await ensureBoxSecrets({
        stateDir: config.stateDir,
        hostnames: [BOX_HOSTNAME, "localhost"],
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
        // `writeTradingEnv` returns the path it wrote; both setup verbs only need `Promise<void>`, so
        // discard it explicitly rather than widen the dep's type. Extracted to a const so `provision`
        // and `adopt` (C2b) persist `trading.env` through the SAME writer.
        const persistTrading = async (cfg: TradingConfig): Promise<void> => {
          await writeTradingEnv(config.stateDir, cfg);
        };
        // The setup surface, now with the slice-2b provisioning deps bound. `provision`/`sealAeat`
        // capture `ownerDb` + `ring`; `persistTrading` writes `<stateDir>/trading.env`; `requestRestart`
        // SIGTERMs this process so the supervisor restarts it into trading mode (`bin.ts`'s latch does
        // the graceful shutdown). `databaseUrl`/`migrationsDatabaseUrl` become `trading.env`'s own
        // connection strings for the next boot. `adopt` is the MIRROR-side sibling (C2b): it fetches the
        // primary's bundle over real HTTP (`fetchMirrorBundle`) and adopts the venue into this box's own
        // database, reusing the SAME `ownerDb`/`ring`/`persistTrading` the provision path wires. The `*`
        // catch-all inside `mountSetup` stays terminal and last, so the POST routes (registered before
        // it) are not shadowed.
        mountSetup(
          app,
          {
            environment: config.environment,
            provision: (req) => provisionVenue({ ownerDb }, req),
            adopt: (req) => {
              // Ruling 1 (fail loud at adopt, not at reboot): an adopted mirror MUST end up with
              // WAITRON_SYNC_DATABASE_URL in `trading.env`, because the next (mirror) boot's
              // `loadMirrorSyncConfig` reads it back — an absent one throws `server.config_missing`
              // there and the box never boots into mirror mode. The POST /setup-api/adopt request is
              // the ONE interactive moment the operator can fix the deploy env, so if it is unset we
              // refuse HERE (before any bundle fetch or DB write) rather than persist nothing and let
              // the reboot fail. Reuse the existing `server.config_missing` code + its `variable`
              // param shape (config.ts's `required`) — this fact is exactly a missing config var, so
              // no new code is minted. The guard narrows `config.syncDatabaseUrl` (string | undefined)
              // to the non-empty string `AdoptDeps.syncDatabaseUrl` requires.
              if (config.syncDatabaseUrl === undefined) {
                throw new AppError("server.config_missing", {
                  variable: "WAITRON_SYNC_DATABASE_URL",
                });
              }
              return adoptFromPrimary(
                {
                  ownerDb,
                  ring,
                  fetchBundle: fetchMirrorBundle,
                  persistTrading,
                  databaseUrl: config.databaseUrl,
                  migrationsDatabaseUrl: config.migrationsDatabaseUrl,
                  syncDatabaseUrl: config.syncDatabaseUrl,
                },
                req,
              );
            },
            sealAeat: (tenantId, cert) => sealAeatCredential(ownerDb, ring, tenantId, cert),
            persistTrading,
            databaseUrl: config.databaseUrl,
            migrationsDatabaseUrl: config.migrationsDatabaseUrl,
            requestRestart: () => process.kill(process.pid, "SIGTERM"),
            // The built setup wizard (slice 2c) served as the setup surface's root catch-all when
            // configured; `undefined` (dev/Vite, or an image without the bundle) keeps the inline
            // placeholder shell. Its dir was already `assertBuiltApp`-checked in the fail-fast group
            // above, so `mountSetup`'s `mountSpa` never becomes a 404-for-every-page catch-all.
            setupAppDir: config.setupAppDir,
          },
          log,
        );
        const tls = config.tls ?? { certFile: ensured.certFile, keyFile: ensured.keyFile };
        const server = startListening({ ...config, tls }, app, now, log);
        // Advertise waitron.local over mDNS LAST — after every throwing setup step above AND once
        // `startListening` has bound the socket — so no boot-failure path can leak the UDP :5353 socket
        // (an earlier throw simply never started it, which is why the catches below no longer stop it).
        // Both modes advertise; the responder is stopped in makeStartedServer's close() below. mDNS is
        // non-load-bearing (the box stays reachable by IP); a bind / no-multicast-route failure logs and
        // is swallowed inside the responder.
        const mdns = startMdnsResponder({ hostname: BOX_HOSTNAME, getAddresses: listBoxIpv4, log });
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
      // mDNS is not started until just before `makeStartedServer` below (after every throwing step in
      // this branch), so a throw reaching here never opened the UDP socket — only the DB pool (the app
      // pool AND, if it opened, the provisioning owner pool via the inner catch) needs closing.
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
    // mDNS is not started until just before `makeStartedServer` (after every throwing setup step), so a
    // `loadKeyRing` throw here never opened the UDP socket — only `db` needs closing. The pre-existing
    // `readOrderFlow`/`buildCardProvider` throw sites further down still leak `db` the same way and stay
    // out of scope here (they leaked `db` before slice 3 too — documented above).
    await db.close();
    throw error;
  }

  // Which role this database plays (C2a design §4). A mirror pulls + applies and serves read-only; a
  // primary is today's flow. Read ONCE here into a refreshable holder that the promote action
  // (`promoteLocalSecondaryToPrimary`, this slice) refreshes after its owner-role write — so a mode flip
  // would take effect live, no restart (design §10; the refresh is in promote.ts). This slice does NOT
  // flip the mode: a local-secondary promote refreshes this holder without changing its value ('primary'
  // stays 'primary'). What FLIPS deployment.mode to 'primary' to open the read-only gate live is the
  // mirror→primary path (spec §5b), a later slice. The pool is already open, so this DB read is free.
  // The singleton-ownership axis (promotion runbook design §2), read into its own refreshable holder
  // beside the mode holder: a 'secondary' node (a mirror OR a sell-only local secondary) runs no fiscal
  // duties; only a 'primary' drains/reconciles. Read PER PASS below, and the promote action DOES flip this
  // holder: after writing singleton_role='primary' it refreshes both holders, so the fiscal pass starts on
  // the next tick with no restart (promotion runbook design §3b/§3c).
  // Both axes from ONE read (a single MVCC snapshot), so the initial holder pair is never torn — the
  // same single-snapshot guarantee `refreshDeploymentHolders` relies on: two separate reads under READ
  // COMMITTED could straddle a concurrent promotion and yield an impossible `(mirror, primary)` pair.
  const axes = await readDeploymentAxes(db);
  const holders = createDeploymentHolders(axes.mode, axes.singletonRole);
  const isMirror = holders.mode.current === "mirror";
  // The four primary-only SINGLETON duties below (sync SOURCE, retention sweep, scheduled backup, outbound
  // tunnel client) gate on THIS, not on `isMirror`: they must run on the ONE `singleton_role='primary'`
  // node, never on every non-mirror node (promotion runbook design §2/§3c — the same axis `singletonPass`
  // already gates the fiscal drain/reconcile pass on, #158). The bug this fixes: a SELL-ONLY LOCAL
  // SECONDARY (`mode='primary'`, `singleton_role='secondary'`) is NOT a mirror, so the old `!isMirror`
  // gate ran all four on it — a second node pruning the shared `sync_log`, dialing the one outbound tunnel,
  // writing scheduled backups and serving the authoritative sync source, duplicating the primary
  // (active-active). Because `deployment_role_valid_ck` rejects `(mirror, primary)`, `singleton_role='primary'`
  // already implies `mode='primary'`, so this predicate alone is correct and a mirror is always 'secondary'.
  //
  // BOOT decision, captured once like `isMirror` — DELIBERATELY not live. An in-process promotion (#160
  // `promoteLocalSecondaryToPrimary` flips `singleton_role` live and starts the fiscal pass next tick) will
  // NOT start these four without a restart; the live worker-lifecycle manager that would is promotion
  // Slice 3 (runbook §3c), deferred behind reserved-SIF staging. This change only moves the gate from `mode`
  // to `singleton_role` (fixing the active-active duplication) — it does not make the four start live.
  const isSingletonPrimary = holders.singletonRole.current === "primary";
  // FAIL CLOSED before we even seed the mirror's UNAUTHENTICATED admin surface: a mirror auto-logs a
  // full-admin viewer in (`ensureMirrorViewer` + `mirrorSession` below), so the ONLY thing keeping it
  // off the network is the loopback default of `config.httpHost`. Refuse a non-loopback bind under
  // mirror mode unless the operator explicitly opts in (`WAITRON_MIRROR_ALLOW_EXPOSED`); a primary is
  // unaffected. Placed here (not at the `startListening` bind further down) so the refuse path opens
  // no ambient viewer, no sync/tunnel workers and no retention pool — only `db` is live, closed the
  // same way the `loadKeyRing` guard above does rather than leaking the pool.
  try {
    assertMirrorBindSafe(config, isMirror, env);
  } catch (error) {
    await db.close();
    throw error;
  }
  // On a mirror, front the whole user-facing surface with the read-only gate (non-GET → node.read_only
  // 403) and the ambient viewer session (so the existing management-session gates pass with no login).
  // Registered BEFORE the mounts below so Hono wraps them; `/health` (registered before this branch) is
  // deliberately not wrapped — it is a GET and must answer in every mode. A primary installs neither.
  // BOTH middlewares read `holders.mode.current` per request, so promotion is a genuine flag-flip: when the
  // holder flips to 'primary', the gate opens writes AND the ambient viewer stops (real auth applies) —
  // there is no window where writes are open while an admin is still auto-logged-in. `ensureMirrorViewer`
  // runs on this app-role `db` (RLS as app_user); guarded so its throw closes the pool rather than leaking
  // it, matching the loadKeyRing / mirror-config db-cleanup discipline in this branch.
  if (isMirror) {
    app.use(
      "*",
      readOnlyGate(() => holders.mode.current),
    );
    try {
      await ensureMirrorViewer(db, config.till.tenantId);
    } catch (error) {
      await db.close();
      throw error;
    }
    app.use(
      "*",
      mirrorSession(db, config.till.tenantId, config.tls !== undefined, () => holders.mode.current),
    );
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
  // The operational agent/device groups — NOT mounted under mirror mode. Unlike the dashboard read
  // surface below (management/catalogue/report/recipe/schedule/purchasing/workforce/me), whose writes
  // all sit behind non-GET verbs the read-only gate refuses, the PRINT group exposes a WRITE BEHIND A
  // GET: `GET /print-api/agent/jobs` runs `claimPrintJobs`, a locking UPDATE (packages/printing/src/
  // runtime.ts). The method gate (`read-only-gate.ts`, whose own comment at 6-24 flags exactly this)
  // cannot catch a write on a GET. The device group's own writes are all behind non-GET verbs the gate
  // already refuses; it is dropped from a mirror as part of the same operational surface, not for a
  // write-behind-a-GET. So the read-only guarantee for these operational groups rests on NOT mounting
  // them on a mirror rather than on the verb — where before this guard existed it rested only on their
  // backing tables (`print_*`, `devices`) being unprovisioned on a mirror. A mirror provisions none of
  // those tables anyway, so it loses nothing by their absence; a primary mounts both. This guard skips
  // route REGISTRATION only — every shared boot value (`till`, `secureCookies`) is built above and read
  // by the sibling mounts, so nothing downstream depends on these mounts having run.
  // ALTITUDE (deliberate, deferred): the landed promotion design (promotion-runbook-design.md §3a
  // "Mount-and-gate everything") makes REQUEST-time gating the eventual form so live mirror→primary
  // promotion needs no restart. Boot un-mounting is chosen for now — tighter read-only-mirror posture,
  // and the verb gate can't catch a write-behind-a-GET without a new path deny-list — and converting it
  // to the §3a form belongs with promotion Slice 3, which already converts the analogous
  // `singleton_role`-gated workers (sync source / retention / backup / tunnel, §3c — re-gated in #168) to
  // runtime-startable. See read-only-gate.ts's header.
  if (!isMirror) {
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
  }
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
  // The dashboard's gated staff-reservation write group (create/list-by-day/edit + the seat + lifecycle
  // moves) on the SAME app, the identical convention. Unlike the siblings it receives the FULL `till`
  // config, not just `{ tenantId }`: `seatBooking` opens a real TS-1 tab whose order-number allocation
  // reads `till.tillId`/`till.nodeId`, and create/list read `till.locationId` (the day-list scope RLS
  // cannot supply). Reuses the EXACT `db` + this venue's `till` the trading surface holds so scope
  // cannot drift. Routes only — no database work at boot; the `booking.manage` gate runs per request,
  // and no fiscal path is touched (a seat writes a pre-fiscal working order only).
  mountBookingsApi(app, { db, cfg: till }, log);
  // The dashboard's gated reporting surface on the SAME app, the identical convention. Reuses the EXACT
  // `db` and tenant (`till.tenantId`, this venue's one tenant) `mountPurchasingApi` above receives so
  // the two cannot drift, plus `till.nodeId` — THIS server's own node, which the `/reports/overview`
  // route scopes today's takings/counts/open-tables/top-sellers to (the modelo 303 export ignores it and
  // aggregates ALL of the obligado's nodes). No fiscal backend, card provider or media store — READ-ONLY
  // routes over the filed commercial record + the venue's dining tables. Routes only — no database work
  // at boot; the `report.export`/`report.view` gates run per request, and the pipeline SELECTs only.
  mountReportApi(app, { db, cfg: { tenantId: till.tenantId, nodeId: till.nodeId } }, log);
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

  // The active-active sync transport. A PRIMARY enables it iff WAITRON_SYNC_PEERS is set
  // (`loadSyncConfig` → undefined otherwise). A MIRROR always pulls (`loadMirrorSyncConfig` never
  // returns undefined — an absent WAITRON_SYNC_DATABASE_URL is a loud server.config_missing), and its
  // pull PEER (the relay + the per-peer token) comes from the DATABASE + the vault below, NOT from env
  // (C2b, spec §7) — so a mirror needs no WAITRON_SYNC_PEERS. Either way the block opens its OWN pool
  // (a sync_tailer + app_user member — the app pool cannot read sync_log), the primary mounts the
  // peer-authenticated source group on the SAME app (each caller's Bearer token resolves to its
  // enrolled sync_peers identity), and both start the background pull worker. The sync NODE ID is
  // till.nodeId (one source of truth; no second WAITRON_SYNC_NODE_ID), and minTickMs/maxTickMs double
  // as the worker's idle interval and backoff ceiling. A primary that sets no sync env leaves
  // syncConfig undefined, so every existing boot is unchanged (boot.test.ts sets none). Torn down in
  // close() below.
  const syncConfig = isMirror ? loadMirrorSyncConfig(env) : loadSyncConfig(env);
  // The mirror's link to its primary through B's tunnel (C2b, spec §7): the box CA + hostname
  // `tunnelHttpClient` validates the box's TLS leaf against, the relay URL it dials, and the per-peer
  // sync token — all read from the DATABASE (`mirror_config`, written owner-role at adopt) and the
  // vault (`sync.mirror_token`, sealed under the mirror's OWN box key), NEVER from env. A mirror
  // REQUIRES them: an absent/partial `mirror_config` is a loud `server.config_invalid` (fail-closed),
  // and an absent or unsealable token throws its own loud `credentials.*` error — never a silent
  // no-op. The peer's `nodeId` is this node's own id: the mirror adopted the primary's identity, so
  // the subscriber and the origin it pulls are the same adopted node (design §5/§7), and the token was
  // enrolled with that same node as its subscriber (mirror-bundle.ts). Read ONLY on a mirror (a
  // primary sets none), and wrapped in the same db-cleanup guard the `loadKeyRing` load above uses, so
  // a throw closes the pool rather than leaking it (only `db` is open here — the sync and retention
  // pools below are not yet). The token is never logged.
  let mirror: MirrorConnection | undefined;
  let mirrorPeer: { nodeId: string; url: string; token: string } | undefined;
  if (isMirror) {
    try {
      const loaded = await readMirrorConfig(db);
      if (loaded === null) {
        // The registered `server.config_invalid` shape is `{ variable, reason }` (errors.ts). The
        // "variable" is no longer an env name — the mirror's connection config lives in the DB now — so
        // it names the DB record instead; `reason` says the mirror requires it.
        throw new AppError("server.config_invalid", {
          variable: "mirror_config",
          reason: "mirror_requires_mirror_config",
        });
      }
      mirror = loaded;
      const token = await readMirrorToken(db, ring, config.till.tenantId);
      mirrorPeer = { nodeId: config.till.nodeId, url: loaded.relayUrl, token };
    } catch (error) {
      await db.close();
      throw error;
    }
  }
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
    // The authoritative replication SOURCE — only the SINGLETON primary serves it (a mirror is a
    // subscriber that pulls + applies and never sources, C2a design §8; a sell-only local secondary must
    // not duplicate the primary's source either). So `mountSyncApi` gates on `isSingletonPrimary`. The
    // pull worker below still runs whenever sync is configured — pulling is NOT a singleton duty (a mirror
    // pulls through the tunnel HTTP client, a secondary pulls too), so it stays outside this gate.
    if (isSingletonPrimary) {
      mountSyncApi(
        app,
        {
          db: syncDb,
          tenantId: till.tenantId,
          nodeId: till.nodeId,
          environment: config.environment,
        },
        log,
      );
    }
    // Hoisted to a `const` so `runLane`'s closure keeps the non-`undefined` narrowing: `syncDb` is a
    // `let` declared outside this block, and TS widens a captured `let` back to `Database | undefined`
    // inside a nested function, whereas a `const` assigned here holds its narrowed `Database` type.
    const localSyncDb = syncDb;
    // A mirror pulls through B's reverse tunnel: the peer `url` names the RELAY, but TLS terminates at
    // the BOX, so `tunnelHttpClient` dials the relay while validating the box's own cert end-to-end
    // against the DB-stored box CA + hostname (C2b, spec §7). A primary pulls directly over
    // `fetchHttpClient`. `mirror`/`mirrorPeer` are always defined on a mirror (the required-check above
    // threw otherwise); the `&& … !== undefined` is what narrows them for the tunnel branch.
    const syncHttp =
      isMirror && mirror !== undefined
        ? tunnelHttpClient({ ca: mirror.boxCaPem, servername: mirror.boxHostname })
        : fetchHttpClient;
    // A mirror's ONE peer is the relay it dials, built from the DB config + the vault token above; a
    // primary's peers come from WAITRON_SYNC_PEERS (loadSyncConfig).
    const peers = isMirror && mirrorPeer !== undefined ? [mirrorPeer] : syncConfig.peers;
    const runLane = (lane: SyncLane, minIdleMs: number): Promise<void> =>
      runSyncPull({
        localDb: localSyncDb,
        subscriberId: till.nodeId,
        tenantId: till.tenantId,
        localEnvironment: config.environment,
        http: syncHttp,
        batchLimit: 500,
        peers,
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
    // Retention is a SINGLETON duty: only the singleton primary prunes the shared `sync_log`. A mirror
    // holds no `sync_log` (it applies, never captures) and a sell-only local secondary must not run a
    // SECOND pruner against the primary's log — so both skip the sweep AND the `sync.retention_unconfigured`
    // warn (C2a design §8). Gates on `isSingletonPrimary`, not `!isMirror`.
    if (isSingletonPrimary && syncConfig.retentionDatabaseUrl !== undefined) {
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
    } else if (isSingletonPrimary) {
      // A singleton primary with sync on but no retention role configured: the log will grow unpruned.
      // Loud, not fatal (spec §3.2/§8 — opt-in, documented-required-in-prod), so an existing sync host that
      // has not provisioned the role still boots unchanged. A non-singleton node (mirror or local secondary)
      // skips this warn too — it prunes nothing, so an unconfigured retention role is not its concern.
      log("warn", "sync.retention_unconfigured", {});
    }
  }

  // The scheduled local pg_dump backup (onboarding slice 4b-ii). OPT-IN on WAITRON_BACKUP_DIR
  // (`loadBackupConfig` → undefined otherwise), and a SINGLETON duty: the singleton primary owns the
  // backup, so it takes the SAME `isSingletonPrimary` gate the retention sweep and the tunnel client take
  // (a mirror holds a pulled copy, not the source of record it must dump, and its RLS probe below needs a
  // SUPERUSER/BYPASSRLS role it is not provisioned with; a sell-only local secondary must not run a SECOND
  // backup writer against the same dir/source either). It MIRRORS
  // the retention worker's shape exactly: its OWN AbortController + worker promise (declared beside the
  // sync/tunnel ones so close() below tears it down), a `.catch` logging `codeOf`, and a teardown that
  // aborts + awaits. `runBackupSweep` shells out to `pg_dump` and holds no long-lived pool of its own,
  // so there is nothing to add to `closePools` — the probe pool below is the only pool it involves, and
  // that is closed in its own `finally` (the worker shells out to a fresh `pg_dump` process and never
  // touches the probe pool, so the two never share a connection).
  //
  // Before the worker starts, an RLS PROBE (`assertBackupCanReadFiscal`): under FORCE RLS a `pg_dump`
  // as a role that is neither SUPERUSER nor BYPASSRLS either loud-fails or silently emits an empty
  // fiscal dump, so a fenced backup role must never be enabled (backup-probe.ts). The probe opens a
  // short-lived pool to `backupConfig.databaseUrl` — the EXACT connection string `runBackupSweep` /
  // `realPgDump` dump with, no SET ROLE and no second role — so a green probe is evidence about the
  // real dump connection, not an adjacent one. It is FAIL-SAFE, NEVER fatal (CLAUDE.md §5 — nothing may
  // block a sale): a fenced role, an unreachable backup database, or ANY other probe error leaves
  // backup off (`backupWorker` stays undefined) and logs `backup.disabled_probe_failed` (with the
  // structured `errorCode` so a connection/network fault is distinguishable from an RLS fence — the
  // event name covers ANY probe failure, not just a fence) rather than throwing out of boot — a bad backup
  // role must not brick the till. The whole open+assert sits inside the `try`, and the probe pool is
  // closed in the `finally` whichever way it settles, so nothing leaks. `backupWorker` is the single
  // source of truth for "backup is on": it is assigned ONLY on the probe's success path (so a fenced or
  // unreachable role leaves it `undefined`), and the box-status wiring and teardown below both gate on
  // `backupWorker !== undefined`. When `backupConfig` is set on a non-singleton node (mirror or local
  // secondary) the config is simply not consulted (the `isSingletonPrimary` gate), matching retention/tunnel.
  const backupConfig = loadBackupConfig(env);
  const backupController = new AbortController();
  let backupWorker: Promise<void> | undefined;
  if (isSingletonPrimary && backupConfig !== undefined) {
    let probeDb: Database | undefined;
    try {
      probeDb = await createPostgresDb(backupConfig.databaseUrl);
      await assertBackupCanReadFiscal(probeDb);
      backupWorker = runBackupSweep({
        dir: backupConfig.dir,
        databaseUrl: backupConfig.databaseUrl,
        intervalMs: backupConfig.intervalMs,
        retain: backupConfig.retain,
        signal: backupController.signal,
        sleep: realSleep,
        log,
      });
      backupWorker.catch((err) =>
        log("error", "backup.worker_rejected", { errorCode: codeOf(err) }),
      );
    } catch (err) {
      log("error", "backup.disabled_probe_failed", { errorCode: codeOf(err) });
    } finally {
      // `.catch(() => {})`: a throw in this `finally` would ESCAPE the surrounding try/catch, so a
      // pool-close rejection on the strict §5 path must never become a boot-aborting throw. The
      // probe's own errors are already handled by the `catch` above.
      if (probeDb !== undefined) await probeDb.close().catch(() => {});
    }
  } else if (isSingletonPrimary) {
    log("info", "backup.disabled", {});
  }

  // The operator box-status surface (onboarding slice 4a). Mounted AFTER the sync block so it can hand
  // box-status the sync-pool lag reader when sync is on; when sync is off (`syncDb === undefined`, the
  // free-tier single box) the reader stays absent and `replication.configured:false`. GET-only, so the
  // mirror read-only gate passes it. On a mirror the ambient viewer primes the session cookie on the
  // RESPONSE, so a cookieless first request 401s AND emits the Set-Cookie; the browser's next request
  // carries that ambient cookie and `requireManagementSession` passes (see `mirror-e2e.rls.test.ts` —
  // Hono setCookie is a response header, not readable within the same request). `health` and `now` are
  // the same bindings `healthApp(health, now)` used above; `config.tls?.certFile` is the served-leaf
  // path (absent on a plain-HTTP boot → `cert.available:false`).
  //
  // `syncDb` (the sync_tailer + app_user member pool the sync block opened) is captured into a `const`
  // so TS keeps its non-`undefined` narrowing inside the reader closure — a captured `let` widens back
  // to `Database | undefined`, the same reason the sync block hoists `localSyncDb`. It is the pool the
  // reader must use: `lagFor` reads `sync_log`, which `app_user` (the `db` pool) holds no SELECT on at
  // all (0000_sync_outbox.sql REVOKEs it, granting only INSERT for capture), so the app pool cannot
  // read the lag — only this sync-tailer pool can.
  //
  // The reader runs `lagFor` INSIDE `withTenant(till.tenantId)`, not bare: `sync_tailer`'s SELECT on
  // `sync_log` is fenced by the per-tenant `sync_log_tenant_isolation` policy (no TO clause → applies
  // under FORCE RLS to this login too), and with no `app.tenant_id` set `current_tenant_id()` is NULL,
  // so a BARE `lagFor(syncDb)` sees ZERO `sync_log` rows and reports every subscriber at lag 0 — a
  // silent false-healthy. This is PINNED by the box-status durability guard
  // (`packages/sync/src/retention.gate.test.ts`), which asserts a bare `sync_tailer` `lagFor` and the
  // SAME member under `withTenant` DISAGREE — the invariant, not any specific number (the guard's own
  // probe happens to see 0 vs a real lag). The box is single-venue (one tenant, `till.tenantId`), so every captured
  // outbox row carries that tenant_id and its context reveals the whole log. NO `asAppUser` here — that
  // `SET ROLE app_user`s and would drop the sync_tailer membership's SELECT on `sync_log`; `withTenant`
  // only sets the GUC (packages/db/src/tenancy.ts), leaving the login's inherited grants intact.
  const lagPool = syncDb;
  mountBoxStatusApi(
    app,
    {
      db,
      cfg: { tenantId: till.tenantId, nodeId: till.nodeId },
      environment: config.environment,
      health,
      now,
      tlsCertPath: config.tls?.certFile,
      readReplicationLag:
        lagPool === undefined
          ? undefined
          : () => withTenant(lagPool, till.tenantId, (tx) => lagFor(tx)),
      // The backup freshness reader (Task 6): present only when the RLS probe above ENABLED backup, so
      // `configured:false` covers both "no backup env" and "backup env set but the role is fenced /
      // unreachable" — the box-status surface reports the effective state, not merely the config. Reads
      // the SAME dir `runBackupSweep` writes into, scanning for the newest dump per request; `now` is the
      // live wall-clock factory (`() => new Date()`) established at boot, CALLED per box-status request so
      // `ageSeconds` is measured against request time. `backupConfig!` is safe: `backupWorker` is only ever assigned when `backupConfig`
      // was defined (the probe block above runs under `backupConfig !== undefined`).
      readBackup:
        backupWorker !== undefined
          ? () => readBackupStatus(backupConfig!.dir, backupConfig!.staleAfterMs, now())
          : undefined,
      // Report the effective mode the box is actually serving as — the same holder the read-only gate
      // and mirror-session middlewares read — so the status matches what the box enforces and tracks a
      // live promotion the same way, rather than issuing a fresh DB read of its own.
      readMode: () => holders.mode.current,
      // The live singleton role (primary/secondary), read per-request from the same holder the
      // duty loop reads — box-status now shows BOTH deployment axes (mode + singleton_role, #158).
      readSingletonRole: () => holders.singletonRole.current,
    },
    log,
  );

  // The recovery-bundle download (slice 4b-i): the same management gate as box-status, packing the
  // box's persisted secret files (config.stateDir) into a passphrase-encrypted bundle. Mounted in the
  // trading branch only — a setup box has no provisioned identity to recover.
  mountRecoveryBundleApi(
    app,
    { db, cfg: { tenantId: till.tenantId }, stateDir: config.stateDir, now },
    log,
  );

  // The outbound cloud-mirror tunnel (sub-project B): enabled iff WAITRON_TUNNEL_RELAY_URL is set
  // (loadTunnelConfig). The box sits behind NAT with no inbound ports, so it dials OUT to the relay and
  // keeps a pool of idle registered connections open; when the relay pairs one with a cloud client it
  // splices raw bytes to the box's OWN served port (config.httpPort — the exact listener
  // startListening binds below), TLS end-to-end. Its own AbortController + worker promise, declared
  // beside the sync worker's above: the tunnel runs INDEPENDENTLY of sync (it can be enabled with sync
  // off), so it carries a dedicated controller rather than borrowing syncController, and close() below
  // aborts and awaits it the same way. runTunnelClient resolves on abort and never rejects (its slots
  // back off every establish error), so the `.catch` mirrors the pull worker's: in production it never
  // fires, but an unexpected throw escaping the client's own handling would be a silent unhandled
  // rejection in the pre-close() window otherwise — logged, the same codeOf-classified shape. A host
  // that sets no tunnel env (every existing boot) leaves tunnelConfig undefined and dials nothing —
  // logged once so the off state is visible in the boot log. Torn down in close() below.
  const tunnelConfig = loadTunnelConfig(env);
  const tunnelController = new AbortController();
  let tunnelWorker: Promise<void> | undefined;
  // The tunnel CLIENT dials OUT from the box to the relay (C2a design §8) — a SINGLETON duty: only the
  // singleton primary keeps the one outbound tunnel. A mirror is the cloud side the box dials INTO (never a
  // client), and a sell-only local secondary must not open a SECOND tunnel beside the primary's — so both
  // start no client and log nothing here. Gates on `isSingletonPrimary`, not `!isMirror`.
  if (isSingletonPrimary && tunnelConfig !== undefined) {
    tunnelWorker = runTunnelClient({
      relayHost: tunnelConfig.relayHost,
      relayPort: tunnelConfig.relayPort,
      boxId: tunnelConfig.boxId,
      token: tunnelConfig.token,
      // The box's OWN served port — a paired connection is spliced to the exact listener
      // `startListening` binds below, so the cloud reaches the same surface a LAN client does.
      localPort: config.httpPort,
      // The operator's standing-pool size (WAITRON_TUNNEL_POOL_SIZE, defaulted in loadTunnelConfig),
      // threaded through so the knob is live rather than dead config — runTunnelClient's poolSize is
      // its only consumer.
      poolSize: tunnelConfig.poolSize,
      sleep: realSleep,
      signal: tunnelController.signal,
      log,
    });
    tunnelWorker.catch((err) => log("error", "tunnel.worker_rejected", { errorCode: codeOf(err) }));
  } else if (isSingletonPrimary) {
    log("info", "tunnel.disabled", {});
  }

  // The C2b operator flow's PRIMARY endpoint: POST /management-api/mirror-bundle mints a MirrorBundle a
  // cloud mirror adopts (design §4). PRIMARY-only, and only when the retention sweep opened its
  // `sync_retention` connection — the handler mints the peer token as that role via `enrolPeer`, so the
  // endpoint exists exactly when the connection it needs does (a mirror never opens one, and a primary
  // that configured no retention role cannot mint). `relayUrl` is this primary's own relay coordinates
  // (`loadTunnelConfig`, undefined when no tunnel is configured — the route then refuses `mirror.no_relay`
  // before minting); `boxHostname` is the same box leaf SAN the discovery-api and cert-minting use;
  // `designated` is `config.till` (the five WAITRON_TILL_*_ID). Mounted before the SPA catch-alls below.
  // Kept consistent with retention's gate (`isSingletonPrimary`): `retentionDb` is now only opened on the
  // singleton primary, so the `!== undefined` already implies it, but gating explicitly on
  // `isSingletonPrimary` keeps this primary-only endpoint reading the same axis as the sweep it depends on.
  if (isSingletonPrimary && retentionDb !== undefined) {
    mountMirrorBundleApi(
      app,
      {
        appDb: db,
        retentionDb,
        stateDir: config.stateDir,
        // A FULL https URL, not bare host:port: the mirror consumes this as its `peer.url` and
        // `packages/sync/src/pull.ts` builds `${trimSlash(peer.url)}/sync-api/hello` → `undiciFetch`,
        // which throws on a scheme-less address. The mirror always speaks HTTPS end-to-end to the box
        // cert through the tunnel, so the scheme is https (matches Task 5's `https://relay.test:9000/`).
        relayUrl:
          tunnelConfig !== undefined
            ? `https://${tunnelConfig.relayHost}:${tunnelConfig.relayPort}/`
            : undefined,
        boxHostname: BOX_HOSTNAME,
        designated: config.till,
      },
      log,
    );
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
    // The fiscal/settlement duties (drain/reconcile) run ONLY when this node holds the singletons
    // (`singleton_role = 'primary'`) — see `singletonPass` (promotion runbook design §2/§3c; #33 §7).
    // A NON-singleton node gets a trivial empty pass: that covers BOTH a read-only mirror AND a
    // sell-only local secondary (mode=`primary`, singleton_role=`secondary`). The empty pass keeps
    // `/health` advancing (`recordPass` sets `lastPassAt`) and `close()`'s `await loop` identical to
    // the singleton path. Running drain/reconcile on a non-singleton would contact AEAT/Stripe for a
    // host that must file and settle nothing (a mirror's real "work" is the pull worker above, §7).
    // `holders.singletonRole.current` is read PER PASS below, so a promotion that flips the holder to
    // 'primary' starts these duties on the next tick, no restart.
    // NOTE: because a non-singleton's pass has no duties, `/health` reflects only process liveness,
    // NOT replication liveness — a mirror whose pull is stalled (dead relay, wrong hostname, bad
    // token) still reports healthy; those surface as `sync.pull_failed` log lines. Real
    // replication-lag monitoring belongs to the hosting slice (like real per-user auth), out of scope
    // for the C2a stand-in.
    pass: singletonPass(
      () => holders.singletonRole.current,
      (at) =>
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
  //
  // Advertise waitron.local over mDNS LAST — after every throwing setup step in this branch AND once
  // `startListening` has bound the socket — so no boot-failure path can leak the UDP :5353 socket (an
  // earlier throw never started it). Both modes advertise; stopped in makeStartedServer's close() below.
  const mdns = startMdnsResponder({ hostname: BOX_HOSTNAME, getAddresses: listBoxIpv4, log });
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
        // Stop the outbound tunnel client the same way — its own controller, aborted here so close()
        // never leaves it dialing; runTunnelClient resolves promptly on abort (it destroys every live
        // socket and cancels every pending backoff nap). Aborted alongside the others, awaited below.
        tunnelController.abort();
        // Stop the scheduled backup sweep the same way — its own controller, aborted here so close()
        // never leaves it mid-cadence; runBackupSweep's abort-aware sleep returns promptly rather than
        // waiting out its (up to daily) interval. Aborted alongside the others, awaited below.
        backupController.abort();
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
        // The outbound tunnel worker, torn down the identical way: tunnelController.abort() above
        // already signalled it, so this only awaits its settle, swallowing a settle-by-rejection so it
        // can never skip the guaranteed pool teardown below. It never rejects in production (its slots
        // back off every error), and holds no connection pool of its own — nothing to add to
        // closePools.
        if (tunnelWorker !== undefined) await tunnelWorker.catch(() => {});
        // The scheduled backup sweep worker, torn down the identical way: backupController.abort() above
        // already signalled it, so this only awaits its settle, swallowing a settle-by-rejection so it
        // can never skip the guaranteed pool teardown below. runBackupSweep swallows its own per-tick
        // faults (a wedged pg_dump, a full disk) so it never rejects in production, and it holds no
        // connection pool of its own (it shells out to pg_dump) — nothing to add to closePools.
        if (backupWorker !== undefined) await backupWorker.catch(() => {});
      },
      closePools: async () => {
        await db.close();
        if (syncDb !== undefined) await syncDb.close();
        if (retentionDb !== undefined) await retentionDb.close();
      },
    },
    mdns,
    async (attestation) => {
      // Owner-role write: open a short-lived owner pool from the migrations URL (the same open/close
      // pattern the boot-time `stampProbe` above uses) rather than holding one open — a trading box keeps
      // only the app pool. If `WAITRON_MIGRATIONS_DATABASE_URL` is unset this URL defaults to the app URL,
      // so the write hits `app_user` (no UPDATE on `deployment`) and throws 42501 — fails CLOSED, never a
      // silent no-op. See the plan's
      // "Known limitations" #2: the REAL runtime admin connection is deferred with instance provisioning
      // (boot.ts:529); this URL is the superuser in dev/CI where the promote is exercised.
      const ownerDb = await createPostgresDb(config.migrationsDatabaseUrl);
      try {
        return await promoteLocalSecondaryToPrimary(
          { appDb: db, ownerDb, holders, log },
          attestation,
        );
      } finally {
        await ownerDb.close();
      }
    },
  );
}
