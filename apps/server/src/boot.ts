import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import {
  createPostgresDb,
  persistNodeMembershipIfNewer,
  readDeploymentAxes,
  readFenceLsn,
  readMembershipTrustSet,
  readNodeMembership,
  setFenceLsnTx,
  setSingletonRoleTx,
  readMirrorConfig,
  type Database,
} from "@waitron/db";
import { credentialTenants, loadKeyRing } from "@waitron/credentials";
import { registerModulePermissions } from "@waitron/identity";
import { runDue } from "@waitron/scheduler";
import {
  StripeOnDeviceProvider,
  StripeReconciler,
  StripeTerminalProvider,
} from "@waitron/payments-stripe";
import type { PaymentProvider } from "@waitron/payments";
import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules, fiscalSlot, orderedMigrationSets, reconcile } from "@waitron/module";
import type { ModuleRouteContext } from "@waitron/module";
import { AppError } from "@waitron/shared";
import {
  ALL_MODULES,
  ALL_MODULE_PERMISSIONS,
  enabledFloorAnnotators,
  LEDGER_PUBLICATION_TABLES,
  STATE_PUBLICATION_TABLES,
} from "./modules.js";
import { readModuleConfig, writeModuleConfig } from "./module-config.js";
import { parseEnvFile } from "./env-file.js";
import {
  loadConfig,
  loadReplicationConfig,
  loadTunnelConfig,
  type ServerConfig,
} from "./config.js";
import { assertDeploymentMatches } from "./deployment-guard.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import {
  assertNotFenced,
  promoteLocalSecondaryToPrimary,
  promoteMirrorToPrimary,
} from "./promote.js";
import type {
  FenceAttestation,
  MirrorPromotionResult,
  PromoteDeps,
  PromotionResult,
} from "./promote.js";
import { codeOf } from "@waitron/server-kit";
import { createLogger, type Logger } from "./logger.js";
import { createRotatingFileSink, createLogReader, tee } from "./log-file.js";
import { createVerbosityController } from "./verbosity.js";
import { requestIdMiddleware } from "./request-id.js";
import { createOriginAllowlist } from "./allowed-origins.js";
import { corsForVenue } from "./cors.js";
import { mountDiagnosticsApi } from "./diagnostics-api.js";
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
import { mountNodeApi } from "./node-api.js";
import { mountDeviceApi } from "./device-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountPrintApi } from "./print-api.js";
import { mountManagementApi } from "./management-api.js";
import { openTab } from "./working-order.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { mountPurchasingApi } from "./purchasing-api.js";
import { mountReportApi } from "./report-api.js";
import { mountRecipeApi } from "./recipe-api.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { mountScheduleApi } from "./schedule-api.js";
import { mountMeApi } from "./me-api.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { mountPromoteApi, type PromoteRunResult } from "./promote-api.js";
import { mountMedia } from "./media-api.js";
import { assertBuiltApp, mountSpa } from "./spa-api.js";
import { mountSetup } from "./setup-api.js";
import { provisionVenue, venueModuleConfig } from "./provision.js";
import { adoptFromPrimary } from "./adopt.js";
import { fetchMirrorBundle } from "./mirror-bundle-fetch.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { writeTradingEnv, type TradingConfig } from "./trading-config.js";
import { ensureReplicationShape } from "./replication.js";
import { readPendingAdoption, runFinishAdoption } from "./finish-adoption.js";
import { mountDiscovery } from "./discovery-api.js";
import { startMdnsResponder, type MdnsResponder } from "./mdns.js";
import { listBoxIpv4 } from "./box-reach.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { mountBoxStatusApi } from "./box-status.js";
import { mountBoxRetireApi } from "./box-retire.js";
import { mountRecoveryBundleApi } from "./recovery-bundle-api.js";
import { loadBackupConfig } from "./backup-config.js";
import { assertBackupCanReadFiscal } from "./backup-probe.js";
import { runBackupSweep } from "./backup-sweep.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { readBackupStatus } from "./backup-status.js";
import { buildBackend } from "./local-fs-backend.js";
import { readOnlyGate } from "./read-only-gate.js";
import { isFenced } from "./membership-fence.js";
import { ensureMirrorViewer, mirrorSession } from "./mirror-session.js";
import { assertMirrorBindSafe } from "./mirror-bind-guard.js";
import {
  isDrained,
  listSlots,
  publicationName,
  readSlotDrain,
  readSubscriptionStatus,
  setSubscriptionPublications,
  subscriptionName,
  type SlotDrain,
} from "@waitron/sync";
import { acceptMembershipDocument, servingPrimaryNodeId } from "@waitron/membership";
import { fetchPeerMembershipDocument, reconcileMembershipOnBoot } from "./membership-reconcile.js";
import { runTunnelClient } from "@waitron/tunnel";
import { readFilingModule, readOrderFlow } from "./till-config.js";
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
  /**
   * Promote a read-only MIRROR to the venue's primary in-process (R3 design §4; parent SIF spec §5b) —
   * on the identity the mirror already holds (R3a). Rewrites `trading.env` with the cloud's OWN reserved
   * standard series id BEFORE the point-of-no-return (inert on a still-read-only mirror; owner decision
   * 2026-09-04, see `promote.ts` `MirrorPromoteDeps.persistTradingEnv`), then runs the PONR owner
   * transaction (mode → primary, singleton_role → primary, term-guarded endorsed document), then RESTARTS
   * the box into `mode=primary` (a mirror is not selling, so a brief restart costs nothing). Present only
   * in MIRROR mode; a non-mirror trading box omits it and exposes `promoteLocalSecondaryToPrimary` instead.
   * IN-PROCESS ONLY: no network endpoint yet (spec §8). Requires a fence attestation or it refuses
   * (`promotion.fence_not_attested`).
   */
  promoteMirrorToPrimary?: (attestation: FenceAttestation) => Promise<MirrorPromotionResult>;
  /** Resolves when the loop has stopped, the listener is closed and the pool is drained. */
  close(): Promise<void>;
}

/**
 * The mode-specific half of `close()` (see `makeStartedServer`): how to stop this boot's background
 * work and which connection pools to drain. Trading mode fills both in — abort the main loop, the
 * outbound tunnel and the backup sweep, then close the app, replication and backup-manifest pools.
 * Setup mode's `stopWork` is a no-op (a setup box runs no background loop) and its `closePools`
 * drains only the app pool.
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
      // The till's own node id, identifying this node on the card-collect record path.
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
 * and awaits it (the loop plus the outbound tunnel and backup sweep in trading mode; a no-op in
 * setup mode), then `closePools` releases the pools (app + replication + the backup manifest pool in
 * trading mode; the app pool alone in setup mode). `mdns` is the shared mDNS responder both modes start in the prefix; `close()` stops it
 * FIRST — the box is going down, so it must stop advertising `waitron.local` before anything else.
 */
function makeStartedServer(
  server: ReturnType<typeof serve>,
  health: HealthState,
  log: Logger,
  teardown: BootTeardown,
  mdns: MdnsResponder,
  promote?:
    | { kind: "mirror"; run: (a: FenceAttestation) => Promise<MirrorPromotionResult> }
    | { kind: "local-secondary"; run: (a: FenceAttestation) => Promise<PromotionResult> },
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
    ...(promote === undefined
      ? {}
      : promote.kind === "mirror"
        ? { promoteMirrorToPrimary: promote.run }
        : { promoteLocalSecondaryToPrimary: promote.run }),
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
      // close() never leaves a worker dangling. In trading mode this aborts the main loop, the
      // outbound tunnel and the backup sweep and swallows a worker's settle-by-rejection so it can
      // never skip the guaranteed teardown; in setup mode there is nothing to stop.
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
 * `close()`'s own sequencing including its idempotency guard. `pass.pg.test.ts` does NOT import
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
  // Config is loaded FIRST so `config.logDir` + the rotation knobs are available when the file sink is
  // built below (the logger writes to `<stateDir>/logs` by default). A boot with invalid config still
  // escapes here (§8) before any logger, pool or listener exists.
  const config = loadConfig(env, DEFAULT_MIGRATIONS_ROOT, DEFAULT_MEDIA_ROOT, DEFAULT_STATE_ROOT);
  // Fold every module's permission seat into identity's role ladder ONCE, before any surface that
  // gates on a management session is mounted below (in either mode). Pure and dependency-free (no DB,
  // no config), so it runs at the very top of boot; `registerModulePermissions` overwrites on a
  // repeat, so a re-boot in the same process (test harnesses) is harmless. After this, identity's
  // catalog resolves module permissions like booking.manage that it no longer names itself.
  registerModulePermissions(ALL_MODULE_PERMISSIONS);
  // The verbosity controller the diagnostics API raises and the logger reads at each call: request
  // logging (`http.request`, a `debug` line) is dropped by the default `info` threshold until an
  // operator raises it for a bounded window, then auto-reverts in memory (never across a restart).
  const verbosity = createVerbosityController({ defaultLevel: "info", now });
  const stdoutSink = (line: string) => process.stdout.write(line);
  // A stdout-only logger for the ONE notice the file sink emits if its directory becomes unwritable —
  // built through `createLogger` (like `bin.ts`'s exit logger) rather than hand-formatting JSON, so
  // the line shares the exact envelope every other log line has.
  const stdoutLog = createLogger(stdoutSink, now);
  // The rotating file sink under `config.logDir`. On ANY IO failure it degrades to a no-op after ONE
  // stdout warn line (`log.file_unavailable`) — the FILE is what failed, so the notice goes to stdout
  // only, and the paired `tee` still writes every line to stdout. Logging never throws into a request
  // path (SALE-SAFETY), so a lost log directory loses the file, not the sale.
  const fileSink = createRotatingFileSink(
    { dir: config.logDir, maxBytes: config.logMaxBytes, maxFiles: config.logMaxFiles },
    () => stdoutLog("warn", "log.file_unavailable"),
  );
  // Reads the rotating files back for the diagnostics `/recent` surface — the reader mirrors the sink's
  // rotation naming and `maxFiles`, so the two agree by construction on which files exist.
  const reader = createLogReader({ dir: config.logDir, maxFiles: config.logMaxFiles });
  // The one process logger: `tee`d to stdout AND the rotating file, with the live verbosity threshold
  // read per call. The two exit-path loggers (this file's `startListening` catch, `bin.ts`'s fatal
  // exit) stay 2-arg on purpose — they run at process death, want no file sink, and take the
  // `getThreshold` default (`info`).
  const log = createLogger(tee(stdoutSink, fileSink), now, () => verbosity.current());
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
  // SP-1b: the on-box `modules.json` desired set, read BEFORE the migration run — exactly when the
  // decision is needed (architecture §1.3). Read UNCONDITIONALLY (both modes need it: trading for the
  // migration filter + drift log, setup for the provisioning gate below), so a malformed file fails
  // fast, once, before the migration run (only the short-lived stamp probe above has opened yet).
  // Setup mode still migrates the FULL schema (the wizard needs it — SP-1a §4 "setup-migrates-all");
  // trading mode migrates only the enabled set (default: all). `enabledModules` never drops `core` —
  // it is `mandatory`, and `parseModuleConfig` refuses disabling a mandatory module.
  const moduleConfig = await readModuleConfig(config.stateDir);
  const setsToMigrate =
    config.till === undefined ? ALL_MODULES : enabledModules(ALL_MODULES, moduleConfig);
  await applyMigrations(
    config.migrationsDatabaseUrl,
    migrationOptionsFor(orderedMigrationSets(setsToMigrate), config.migrationsRoot),
  );
  const db = await createPostgresDb(config.databaseUrl);

  // SP-1b drift visibility (spec §3): compare the enabled set against what the DB has ACTUALLY
  // migrated (derived from appliedSchemaVersion — there is no deployment column). softDisabled = a
  // module the DB carries but modules.json no longer enables; its data is kept, it is simply not
  // migrated. Logged at info so an operator sees the reconcile outcome; nothing acts on it here beyond
  // the filter above.
  //
  // The reads run over their OWN short-lived MIGRATOR connection (`config.migrationsDatabaseUrl`, the
  // same string `applyMigrations` and the stamp probe above use), NOT the app `db` pool. The migrator
  // created and owns the drizzle journal tables (`__drizzle_migrations_*`), so it is the connection
  // that reliably reads them; keep this probe on it rather than coupling the read to the app pool's
  // role — the same reason the stamp probe above runs on the migrator connection, not the pool. They
  // also run auto-commit — a plain per-statement
  // `execute`, never inside a transaction — because `appliedSchemaVersion`'s 42P01 catch for a
  // never-migrated table poisons an enclosing transaction (spec §3); a fresh connection used
  // auto-commit satisfies that just as the pool would.
  // SP-1b drift visibility only (the outbox schema-version park gate that once read this is gone with
  // the sync block). Computed in the trading-mode block, used solely to log `module.reconcile` drift.
  if (config.till !== undefined) {
    const driftProbe = await createPostgresDb(config.migrationsDatabaseUrl);
    try {
      // One sweep of every module's applied schema version, keyed by name (`schemaVersionsByModule`,
      // which the backup manifest shares — the driftProbe is an auto-commit pool, so its `Promise.all`
      // reads are each isolated); the migrated Set is derived from it (version > 0).
      const myModuleVersions = await schemaVersionsByModule(driftProbe, ALL_MODULES);
      const migrated = new Set(
        Object.entries(myModuleVersions)
          .filter(([, v]) => v > 0)
          .map(([n]) => n),
      );
      // `setsToMigrate` already holds `enabledModules(ALL_MODULES, moduleConfig)` in trading mode
      // (the branch above), so reuse it rather than recompute the same filter.
      const r = reconcile(
        setsToMigrate.map((m) => m.name),
        migrated,
      );
      if (r.softDisabled.length > 0 || r.toMigrate.length > 0) {
        log("info", "module.reconcile", { softDisabled: r.softDisabled, toMigrate: r.toMigrate });
      }
    } finally {
      await driftProbe.close();
    }
  }

  // Health state + the one Hono app, shared by BOTH modes: `/health` answers in setup mode too, and
  // whichever surface the branch below mounts (setup or trading) attaches to this same app. Created
  // before the branch so the shared `startListening`/`makeStartedServer` helpers receive one app and
  // one health state whichever mode boots.
  const health = createHealthState(now());
  const app = healthApp(health, now);
  // Stamp + log every request FIRST, before the mirror read-only gate and every mounted surface below,
  // so every route mounted after this line (the setup surface, the mirror gate, and all the trading/
  // dashboard APIs) gets an `x-request-id` echo and a route-pattern `http.request` log line correlated
  // by that id. Hono runs matching handlers in registration order, so this wraps everything registered
  // AFTER it. The ONE route registered before it is `/health` (inside `healthApp` above), deliberately
  // left unwrapped: a liveness probe needs no request correlation and should not fill the request log
  // with probe noise. The request log is `debug`, dropped by the default verbosity until raised.
  app.use("*", requestIdMiddleware(log, now));

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
      // The OWNER connection every setup-mode owner write opens over — `applyVenue`'s INSERT into
      // `tenants` (which `app_user` deliberately cannot — CLAUDE.md §3), `stampDeployment`'s
      // `deployment` singleton, and the break-glass secret mint the adopt path rides through this same
      // pool. All need the role that OWNS the tables, NOT the app pool's `config.databaseUrl`.
      // `config.adminDatabaseUrl` IS that table-owner connection (the role that ran
      // `waitron-provision instance` — CREATE DATABASE + the migrations over the admin string,
      // `packages/provisioning/src/instance-apply.ts`); on a role-split appliance it is distinct from
      // `migrationsDatabaseUrl` (an `app_user` member with no INSERT on `tenants`), and unset it falls
      // back to `migrationsDatabaseUrl`→`databaseUrl` so dev/CI is unchanged and a misconfigured
      // appliance fails CLOSED (`42501`) rather than writing under a stray pool. Closed in the setup
      // teardown (`closePools`) beside `db`, and on any throw below (the inner catch) so a later
      // failure — from `mountSetup` or `startListening` — never leaks it.
      const ownerDb = await createPostgresDb(config.adminDatabaseUrl);
      try {
        // `writeTradingEnv` returns the path it wrote; both setup verbs only need `Promise<void>`, so
        // discard it explicitly rather than widen the dep's type. Extracted to a const so `provision`
        // and `adopt` (C2b) persist `trading.env` through the SAME writer.
        const persistTrading = async (cfg: TradingConfig): Promise<void> => {
          await writeTradingEnv(config.stateDir, cfg);
        };
        // The NAME of the database `ownerDb` writes — echoed by `provisioning.foreign_tenant` if a
        // fresh venue or a mirror adopt is pointed at a database already holding a different tenant.
        // Parsed from the owner URL, but never the URL itself (it can carry a password, and that code param is
        // operator-typed configuration, never a secret): an unparseable string (a bare Unix-socket
        // path throws in `new URL` — cli.ts's socket note) falls back to a neutral label.
        let ownerDatabaseName = "the target database";
        try {
          const parsed = new URL(config.adminDatabaseUrl).pathname.replace(/^\//, "");
          if (parsed !== "") ownerDatabaseName = parsed;
        } catch {
          // Keep the neutral label — a malformed/socket URL must not leak into the error param.
        }
        // The setup surface, now with the slice-2b provisioning deps bound. `provision` captures
        // `ownerDb`; `db`/`ring` are handed to the fiscal contribution's provisioning-secret seal seat
        // (so boot imports no regime); `persistTrading` writes `<stateDir>/trading.env`; `requestRestart`
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
            // Resolve the fiscal slot from the REQUEST's territory (authoritative, §4): the box's
            // `moduleConfig` base is default-on, which with two fiscal-slot members would be ambiguous;
            // `venueModuleConfig` forces exactly the territory's fiscal module on before provisionVenue's
            // gate/slot check runs and before it persists the set to `<stateDir>/modules.json`.
            provision: (req) =>
              provisionVenue(
                {
                  ownerDb,
                  moduleConfig: venueModuleConfig(moduleConfig, req.venue.location.fiscalTerritory),
                  database: ownerDatabaseName,
                  stateDir: config.stateDir,
                },
                req,
              ),
            adopt: async (req) => {
              // Adopt establishes a NATIVE subscription (swap step 4), so it needs the MIGRATOR
              // connection that holds `pg_create_subscription` and owns the subscription it creates —
              // distinct from `ownerDb` (the table-OWNER connection for the `deployment`/`mirror_config`
              // writes). Opened per adopt (a one-shot interactive action) and closed in `finally` so no
              // pool leaks on the setup path.
              const replicationDb = await createPostgresDb(config.migrationsDatabaseUrl, {
                max: 2,
              });
              try {
                return await adoptFromPrimary(
                  {
                    ownerDb,
                    replicationDb,
                    fetchBundle: fetchMirrorBundle,
                    advertisedOrigin: config.advertisedOrigin,
                    environment: config.environment,
                    persistTrading,
                    // `writeModuleConfig` returns the path it wrote; the dep only needs `Promise<void>`,
                    // so discard it the same way `persistTrading` above wraps `writeTradingEnv`.
                    persistModuleConfig: async (c) => {
                      await writeModuleConfig(config.stateDir, c);
                    },
                    stateDir: config.stateDir,
                    databaseUrl: config.databaseUrl,
                    migrationsDatabaseUrl: config.migrationsDatabaseUrl,
                    database: ownerDatabaseName,
                  },
                  req,
                );
              } finally {
                await replicationDb.close();
              }
            },
            establishIdentity: (tenantId, nodeId) =>
              establishNodeIdentity({ ownerDb, ring }, tenantId, nodeId),
            seedMembership: (tenantId, nodeId) =>
              seedTermZeroMembership(
                { db: ownerDb, ring },
                tenantId,
                nodeId,
                config.advertisedOrigin,
              ),
            // The owner DB + vault ring the setup surface seals the regime's provisioning secret with,
            // through the fiscal contribution's `provisioningSecret.seal` seat — so BOOT imports no
            // regime package (module-seams). The seal fires only for a provision whose regime demands
            // a secret (Veri*Factu: a production provision's AEAT cert).
            db: ownerDb,
            ring,
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
            // Just the app pool AND the provisioning owner pool — a setup box opens no others.
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

  // Adoption-pending boot (C6 / derived fact 1): an adopted mirror restarts into a database whose
  // native initial copy is still running (spec §2.2, "minutes over a WAN"), so its tenant-scoped rows
  // are not there yet. Boot must NOT touch them until the copy completes — it serves `/health` and a
  // minimal `/api/box/status` reporting `adoption: pending`, ensures the two publications, and starts
  // `runFinishAdoption`, which seals the reserved identity + ambient viewer once every table has
  // copied, then the box restarts into normal mirror mode. It reads no deployment axes / membership,
  // mounts no mirror session and no till/node-scoped read path — `ensureMirrorViewer` in particular
  // would throw a `persons`→`tenants` FK violation on the still-empty database (mirror-session.ts).
  // Entered BEFORE the axes read below for that reason.
  const pendingAdoption = await readPendingAdoption(config.stateDir);
  if (pendingAdoption !== null) {
    // A dedicated small OWNER pool (M8 — `replicationDb`, NEVER `ownerDb`, already declared from a
    // possibly-different role at the demote and promote sites). Wrapped so a throw closes both pools
    // (only `db` + this one are open here) before rethrowing.
    let replicationDb: Database;
    try {
      replicationDb = await createPostgresDb(config.migrationsDatabaseUrl, { max: 2 });
    } catch (error) {
      await db.close();
      throw error;
    }
    try {
      // Mode is 'mirror' (a mirror-to-be): this only ensures the publications (ready for a later
      // promotion) and narrows nothing.
      await ensureReplicationShape(replicationDb, {
        environment: config.environment,
        mode: "mirror",
        ledgerTables: LEDGER_PUBLICATION_TABLES,
        stateTables: STATE_PUBLICATION_TABLES,
        log,
      });
    } catch (error) {
      await Promise.allSettled([replicationDb.close(), db.close()]);
      throw error;
    }
    // The only status surface an adoption-pending box serves — unauthenticated (no ambient viewer
    // exists yet) and deliberately minimal, distinct from the full `mountBoxStatusApi` shape.
    app.get("/api/box/status", (c) => c.json({ adoption: "pending" }, 200));
    const finishController = new AbortController();
    const finishWorker = runFinishAdoption({
      replicationDb,
      ring,
      stateDir: config.stateDir,
      environment: config.environment,
      modules: setsToMigrate,
      log,
      signal: finishController.signal,
    });
    // A settle-by-rejection before close() must not become a process-level unhandled rejection — log
    // it the `codeOf`-classified way the sync/backup workers below do (runFinishAdoption swallows its
    // own per-tick faults, so this only ever fires under an unexpected escape).
    finishWorker.catch((err) =>
      log("error", "adoption.worker_rejected", { errorCode: codeOf(err) }),
    );
    const server = startListening(config, app, now, log);
    const mdns = startMdnsResponder({ hostname: BOX_HOSTNAME, getAddresses: listBoxIpv4, log });
    return makeStartedServer(
      server,
      health,
      log,
      {
        stopWork: async () => {
          finishController.abort();
          await finishWorker.catch(() => {});
        },
        closePools: async () => {
          await Promise.allSettled([replicationDb.close(), db.close()]);
        },
      },
      mdns,
    );
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
  // Membership rejoin R1 (design §6): a returned ex-primary that holds a superseding document marking
  // it sell-only/evicted must come up FENCED, not as the primary its saved axes still claim. The held
  // document is authority above the persisted axes (wire-protocol §8), and the reconciliation is
  // DEMOTE-ONLY — it can never self-promote. Read UNVERIFIED: the row was verified when adopted
  // (its acceptance path) or self-signed at promotion, so reading our own authoritative state back
  // needs no re-verify, exactly as the deployment axes are trusted.
  const initialAxes = await readDeploymentAxes(db);
  // Ruling C7 — returned-box membership reconciliation, the boot-time replacement for the deleted
  // gossip. Deleting the pull worker deleted membership GOSSIP, so a box that died BEFORE it was fenced
  // would boot with a stale serving-primary chart and SELL while the promoted cloud is also primary —
  // two nodes filing under one NIF (CLAUDE.md §5, unrecoverable). Only a node booting as PRIMARY
  // (mode !== 'mirror'; a mirror already boots read-only) with a configured cloud peer (`mirror_config`
  // present) has someone to be superseded by, so only then does it best-effort fetch the peer's current
  // signed chart and, if that chart VERIFIES against this node's trust set, is strictly NEWER, and
  // FENCES this node, PERSIST it. Unreachable / not-newer / unverifiable → nothing persisted, boot
  // proceeds as primary (a box that cannot reach the cloud cannot have been superseded without a
  // reachable cloud AND a human promotion — the MVP's accepted window). Run BEFORE the held-membership
  // read below, so a persisted superseding document flows straight into the existing `fenced` demote +
  // read-only path (no separate fencing code). A local DB fault while persisting escapes and fails the
  // boot loudly (§8), closing `db` first like the sibling guards in this region; the peer FETCH never
  // throws (best-effort → null).
  if (initialAxes.mode !== "mirror") {
    let peer: Awaited<ReturnType<typeof readMirrorConfig>>;
    try {
      peer = await readMirrorConfig(db);
    } catch (error) {
      await db.close();
      throw error;
    }
    if (peer !== null) {
      try {
        const [trustSet, held] = await Promise.all([
          readMembershipTrustSet(db, config.till.tenantId),
          readNodeMembership(db),
        ]);
        await reconcileMembershipOnBoot({
          held,
          nodeId: config.till.nodeId,
          // The peer's membership endpoint, formed from the stored link to the cloud peer. The
          // credential the peer's endpoint requires rides in a header the box supplies when it holds
          // one; absent, the peer answers 401 and the best-effort fetch reads it as unreachable →
          // proceed (Ruling C7). `mirror_config` is owner-written trusted config, so no SSRF screen.
          peerUrl: `${peer.relayUrl.replace(/\/+$/, "")}/management-api/membership`,
          fetchPeerMembership: fetchPeerMembershipDocument,
          // The two-part accept fence over the fetched document (`acceptMembershipDocument`: signature +
          // trust chain, then strictly-newer against the held term), persisting via the app pool's
          // term-guarded writer only when it accepts (`app_user` holds INSERT/UPDATE on
          // `node_membership`). Persist-if-accepted, so a newer verified chart is held even when it does
          // not fence this node.
          acceptDocument: async (incoming, currentTerm) => {
            const result = acceptMembershipDocument(incoming, currentTerm, trustSet);
            if (result.accepted) await persistNodeMembershipIfNewer(db, incoming);
            return result;
          },
          log,
        });
      } catch (error) {
        await db.close();
        throw error;
      }
    }
  }
  // The held membership document, re-read AFTER any reconciliation above so a persisted superseding
  // chart is reflected here. `fenced` then engages the existing R1 demote + read-only path below.
  const heldMembership = await readNodeMembership(db);
  const fenced = isFenced(heldMembership, config.till.nodeId);
  let axes = initialAxes;
  if (fenced && axes.singletonRole === "primary") {
    // Demote the singleton axis on the OWNER pool (app_user holds no UPDATE on deployment) — the same
    // table-owner adminDatabaseUrl owner-write R3b promote uses (withOwnerDb), so it shares the
    // fail-closed admin→migrations→app fallback. Idempotent: a
    // second fenced boot already reads 'secondary' and skips. mode stays 'primary' — the (primary,
    // secondary) pair is valid (deployment_role_valid_ck); the read-only gate below, not the mode,
    // enforces the fence. This stops the submitter/reconciler/config-writer via their existing
    // isSingletonPrimary gates with no worker-gating code change.
    // Close the app `db` pool on ANY throw before rethrowing, matching the loadKeyRing / mirror-guard
    // close-on-throw discipline in this region: startServer never returns on the throw path, so nothing
    // else would call `db.close()`. The inner try/finally closes the short-lived owner pool regardless.
    try {
      const ownerDb = await createPostgresDb(config.adminDatabaseUrl);
      try {
        // Demote the singleton axis AND capture the fence-LSN watermark in ONE owner transaction
        // (CLAUDE.md §3, Ruling C2): the moment this node enters its read-only fence it records
        // `pg_current_wal_lsn()` in `deployment.fence_lsn`, so the carrier's drain is measured against a
        // monotone watermark, not against pg_current_wal_lsn() (which decays after the carrier disables
        // its subscription, probe E). Idempotent: `fence_lsn = pg_current_wal_lsn()` re-runs harmlessly
        // on a second fenced boot (a slightly later LSN, still ≤ every already-shipped row's LSN because
        // this boot writes no sale). Owner-role — app_user holds no UPDATE on deployment.
        await ownerDb.transaction(async (tx) => {
          await setSingletonRoleTx(tx, "secondary");
          const wal = await tx.execute<{ lsn: string }>(
            sql`select pg_current_wal_lsn()::text as lsn`,
          );
          await setFenceLsnTx(tx, wal.rows[0]!.lsn);
        });
      } finally {
        await ownerDb.close();
      }
    } catch (error) {
      await db.close();
      throw error;
    }
    // Re-read rather than synthesize `{ ...axes, singletonRole: "secondary" }`: the demote wrote only
    // singleton_role, but re-reading takes BOTH axes from one fresh MVCC snapshot of the current row, so
    // `mode` cannot be stale if another owner action flipped `deployment.mode` in the window since the
    // initial read (the torn-pair / concurrent-promotion risk readDeploymentAxes's own contract describes).
    // One extra query on the rare fenced path, bought for that freshness (Copilot #214 re-review).
    axes = await readDeploymentAxes(db);
  }
  const holders = createDeploymentHolders(axes.mode, axes.singletonRole);
  // The awaiting-fiscal-certificate cell (pass.ts's `AwaitingCertStatus`), shared by reference between
  // the fiscal pass that WRITES it and the box-status read that surfaces it. A promoted cloud mirror
  // sells and chains locally but has no `fiscal.aeat` cert until the cert-distribution slice lands, so
  // its drain skips filing and flips this true — box-status then shows `awaitingFiscalCertificate`.
  const awaitingFiscalCert = { current: false };
  const isMirror = holders.mode.current === "mirror";
  // The boot-time read-only posture, shared by the two mount decisions below (mount the read-only gate;
  // do NOT mount the operational device/print surface) so they cannot drift out of De Morgan sync. A
  // mirror OR a fenced returned ex-primary is read-only. NOTE this is the boot-captured decision — the
  // gate's own per-request predicate re-reads `mode` live (so a promotion lifts it without a restart),
  // and is deliberately kept separate below.
  const fencedOrMirror = isMirror || fenced;
  // The primary-only SINGLETON duties below (scheduled backup, outbound tunnel client, and the fiscal
  // drain/reconcile pass) gate on THIS, not on `isMirror`: they must run on the ONE
  // `singleton_role='primary'` node, never on every non-mirror node (promotion runbook design §2/§3c —
  // the same axis `singletonPass` already gates the fiscal drain/reconcile pass on, #158). The bug this
  // fixes: a SELL-ONLY LOCAL SECONDARY (`mode='primary'`, `singleton_role='secondary'`) is NOT a mirror,
  // so the old `!isMirror` gate ran them on it too — a second node dialing the one outbound tunnel and
  // writing scheduled backups, duplicating the primary (active-active). Because `deployment_role_valid_ck`
  // rejects `(mirror, primary)`, `singleton_role='primary'` already implies `mode='primary'`, so this
  // predicate alone is correct and a mirror is always 'secondary'.
  //
  // BOOT decision, captured once like `isMirror` — DELIBERATELY not live. An in-process promotion (#160
  // `promoteLocalSecondaryToPrimary` flips `singleton_role` live and starts the fiscal pass next tick) will
  // NOT start these duties without a restart; the live worker-lifecycle manager that would is promotion
  // Slice 3 (runbook §3c), deferred behind reserved-SIF staging. This change only moves the gate from `mode`
  // to `singleton_role` (fixing the active-active duplication) — it does not make them start live.
  const isSingletonPrimary = holders.singletonRole.current === "primary";
  // FAIL CLOSED before we even seed the mirror's UNAUTHENTICATED admin surface: a mirror auto-logs a
  // full-admin viewer in (`ensureMirrorViewer` + `mirrorSession` below), so the ONLY thing keeping it
  // off the network is the loopback default of `config.httpHost`. Refuse a non-loopback bind under
  // mirror mode unless the operator explicitly opts in (`WAITRON_MIRROR_ALLOW_EXPOSED`); a primary is
  // unaffected. Placed here (not at the `startListening` bind further down) so the refuse path opens
  // no ambient viewer and no tunnel or backup workers — only `db` is live, closed the
  // same way the `loadKeyRing` guard above does rather than leaking the pool.
  try {
    assertMirrorBindSafe(config, isMirror, env);
  } catch (error) {
    await db.close();
    throw error;
  }
  // On mirrors, apply the read-only gate and establish the ambient viewer session.
  if (fencedOrMirror) {
    app.use(
      "*",
      // A mirror gates by mode (per-request, so a live promotion lifts it, design §10); a fenced
      // returned ex-primary (membership rejoin R1) gates on the boot-captured `fenced` — it leaves the
      // fence only by the wipe-and-restore of a later round, which is a fresh boot anyway.
      readOnlyGate(
        () => holders.mode.current === "mirror" || fenced,
        // Retirement and promote writes use their own authentication gates.
        (c) =>
          (fenced && c.req.method === "POST" && c.req.path === "/api/box/retire") ||
          // The promote trigger is exempt UNCONDITIONALLY, so an authorized POST reaches the handler on
          // a mirror AND on a fenced node — the latter to return the precise `promotion.node_fenced`
          // rather than a generic gate 403 (Task 7 `promoteRun`). On an unfenced primary the gate is
          // not mounted at all (`fencedOrMirror` false), so no exemption is needed there.
          (c.req.method === "POST" && c.req.path === "/management-api/promote"),
      ),
    );
  }
  if (isMirror) {
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

  // The node whose DATA this server DISPLAYS in its node-scoped read paths (report-api's per-till/fiscal
  // reports). On a PRIMARY it is the node's own id; on a MIRROR it is the ORIGIN — the primary whose
  // replicated sales the mirror holds — because those rows keep the primary's node_id, so scoping by the
  // mirror's own id would return nothing. Distinct from `config.till.nodeId`, which stays the node's OWN
  // identity for every WRITE path (membership promotion R3a). The origin is read from
  // `mirror_config` (written owner-role at adopt), NEVER from env. A mirror REQUIRES it: an absent
  // record is a loud `server.config_invalid` (fail-closed). Wrapped in the same db-cleanup guard the
  // `loadKeyRing` load above uses, so a throw closes the pool rather than leaking it. Hoisted ABOVE the
  // mounts because `mountReportApi` needs `dataNodeId`.
  let dataNodeId: string = config.till.nodeId;
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
      dataNodeId = loaded.originNodeId;
    } catch (error) {
      await db.close();
      throw error;
    }
  }

  // Native replication shape, reconciled on EVERY boot (swap spec §2.1/§4.2): ensure both publications
  // name their derived tables and, on a PRIMARY, self-heal any subscription still naming the state
  // publication down to ledger-only (a promoted node's drain window must not re-copy state). A
  // dedicated small OWNER pool (M8 — `replicationDb`, NOT `ownerDb`, which the demote/promote sites
  // above/below already take): the migrator owns every published table and every subscription it
  // created, and this pool only runs that occasional owner DDL, so it is capped. Opened AFTER the last
  // db-cleanup throw site in this branch (the mirror-config read just above) so a throw here is the
  // first that must also drain it; closed in `closePools` below.
  let replicationDb: Database;
  try {
    replicationDb = await createPostgresDb(config.migrationsDatabaseUrl, { max: 2 });
  } catch (error) {
    await db.close();
    throw error;
  }
  try {
    await ensureReplicationShape(replicationDb, {
      environment: config.environment,
      mode: holders.mode.current,
      ledgerTables: LEDGER_PUBLICATION_TABLES,
      stateTables: STATE_PUBLICATION_TABLES,
      log,
    });
  } catch (error) {
    await Promise.allSettled([replicationDb.close(), db.close()]);
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

  // CORS for the venue's own origins on `/api/*` (till-reroute §3.4), registered before the API mounts
  // so it wraps them and after `requestIdMiddleware` so the request id is stamped first. Trading-only:
  // the allow-list reads the held membership document off `db`, which a setup box has not provisioned.
  const allowOrigin = createOriginAllowlist({
    advertisedOrigin: config.advertisedOrigin,
    readMembership: () => readNodeMembership(db),
    devMode: config.devMode,
    now: () => Date.now(),
  });
  app.use("/api/*", corsForVenue(allowOrigin));
  // The media surface is served at `/media/*` (media-api.ts), OUTSIDE `/api/*`, but §3.4 lists it
  // among the CORS surfaces: a rerouted till fetches menu photos cross-origin. Same `allowOrigin`
  // instance — one allow-list, not a second read path.
  app.use("/media/*", corsForVenue(allowOrigin));

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
  // `mountWebhook` above follows. `backend`/`clock` are the till's fiscal pieces: the backend is built
  // by whichever ENABLED module fills the fiscal slot (`makeFiscalBackend` → `fiscalSlot`), and it
  // never contacts an authority on the sale path (that is the `drain` loop below's job).
  // `secureCookies` tracks the transport: TRUE only when TLS is configured, so the session cookie is
  // never marked `Secure` on a plain-HTTP loopback host where the browser would then never send it
  // back. Mounting registers routes only — no database work happens here, so a till pointed at an
  // unprovisioned tenant fails per-request (via `run`), never at boot.
  // The till's pay-timing mode is a per-LOCATION column, not an env var, so `config.till` (from
  // `tryLoadTillConfig`) carries every fiscal id but NOT `orderFlow`. Read it here, ONCE, now that the
  // pool is open, and spread it in to form the full `TillConfig` the routes dispatch on — the merge
  // the type demands (`config.till` is `Omit<TillConfig, "orderFlow">`, see `till-config.ts`). A
  // boot-time read, not per request: the mode is stable provisioning-time config.
  //
  // The regime provisioning stamped this node with (`nodes.filing_module`) is read ONCE here beside
  // it, for the same reason: it too is provisioning-time config. `makeFiscalBackend` cross-checks it
  // against the enabled fiscal module, so a node whose records were filed under another regime fails
  // the boot rather than chaining under the wrong one (§5 — unrepairable). The two reads have no
  // data dependency on each other, so they run together.
  const [orderFlow, filingModule] = await Promise.all([
    readOrderFlow(db, config.till),
    readFilingModule(db, config.till),
  ]);
  // The enabled module that fills the fiscal slot, resolved ONCE for the runtime `drain` seat below.
  // `fiscalSlot` (generic `@waitron/module`, not a regime package) refuses zero, two, or a node
  // stamped for another regime — the same guard `makeFiscalBackend` runs for the sale-path backend.
  // The regime's transport now lives behind this contribution's `drain`, so `boot.ts` names no regime
  // package (`scripts/module-seams.test.ts`).
  const enabledFiscal = fiscalSlot(setsToMigrate, filingModule);
  const till: TillConfig = { ...config.till, orderFlow };
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
      // `setsToMigrate` is the ENABLED module set on this (trading) branch — boot.ts:551 — so the
      // slot picks from what is enabled, not from ALL_MODULES.
      backend: makeFiscalBackend(setsToMigrate, filingModule, db, env),
      clock: systemClock(),
      cfg: till,
      // The floor read's per-table annotators, from the ENABLED set (`setsToMigrate`) — a disabled
      // module's table is not migrated, so its annotator must not run (modules.ts:enabledFloorAnnotators).
      floorAnnotators: enabledFloorAnnotators(setsToMigrate),
      secureCookies,
      cardProvider,
      venueLocale,
      devMode: config.devMode,
    },
    log,
  );
  // The public role probe a till polls to follow the venue's primary across a failover (till-reroute
  // §3.1). Mounted on every trading boot, not in setup: "not accepting sales" from a mirror or a fenced
  // node is the answer that steers a till away, so those boots must answer it too. `!fencedOrMirror` is
  // redundant while `deployment_role_valid_ck` rejects (mirror, primary) and the fence above demotes the
  // singleton axis; kept so the probe refuses if either stops.
  mountNodeApi(
    app,
    {
      nodeId: till.nodeId,
      acceptingSales: isSingletonPrimary && !fencedOrMirror,
      environment: config.environment,
      // These deps carry no `db`, so the whole-DB membership read is injected rather than taken off a
      // handle — the one place in this boot that still binds it.
      readMembership: () => readNodeMembership(db),
    },
    log,
  );
  // The operational agent/device groups — NOT mounted under mirror mode, and NOT on a FENCED node.
  // Unlike the dashboard read
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
  // FENCED (membership rejoin R1): a returned/superseded node comes up `mode='primary'` (so `isMirror`
  // is FALSE) but must be FULLY read-only. Because the read-only gate is verb-based it would let the
  // print write-behind-a-GET through, so a fenced node un-mounts this surface for the SAME reason a
  // mirror does — hence `!isMirror && !fenced`. The `fenced` local is the boot-captured decision (a
  // fenced node leaves the fence only by a fresh boot), the same value the read-only gate above reads.
  // ALTITUDE (deliberate, deferred): the landed promotion design (promotion-runbook-design.md §3a
  // "Mount-and-gate everything") makes REQUEST-time gating the eventual form so live mirror→primary
  // promotion needs no restart. Boot un-mounting is chosen for now — tighter read-only-mirror posture,
  // and the verb gate can't catch a write-behind-a-GET without a new path deny-list — and converting it
  // to the §3a form belongs with promotion Slice 3, which already converts the analogous
  // `singleton_role`-gated workers (backup / tunnel, §3c — re-gated in #168) to
  // runtime-startable. See read-only-gate.ts's header.
  if (!fencedOrMirror) {
    // ONE window for the venue: every surface that has a knock shares this holder, so "venue-wide" is a
    // property of the wiring rather than a rule anyone has to remember (design §1.1). In memory, so a
    // restart or a promotion starts SHUT — a node that has just taken over must not inherit an open door.
    const pairingMode = createPairingMode();
    // The trusted-DEVICE surface (device-identity-1) on the SAME app, the identical convention: the
    // UNAUTHENTICATED knock and join-status routes, the `requireDevice`-guarded KDS routes (a kitchen
    // screen reads and bumps only its own bound station), and the `device.manage`-gated management routes
    // (list devices, revoke one, rebind one). It reuses the EXACT `db` and — unlike the sibling mounts,
    // which pass a `{ tenantId }` subset — the FULL `till` config `mountTillApi` receives above, because
    // the device verbs are typed `cfg: TillConfig` and `listStationQueue` scopes the queue by `cfg.nodeId`
    // (the routes touch none of the fiscal ids on it). `secureCookies` is the SAME hoisted binding, so the
    // device cookie is `Secure` iff TLS is configured. Routes only — no database work at boot; the
    // device guard and the `device.manage` gate run per request.
    mountDeviceApi(
      app,
      {
        db,
        cfg: till,
        secureCookies,
        pairingMode,
        devMode: config.devMode,
        tenantDomain: config.tenantDomain,
      },
      log,
    );
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
  // The deployment holds one tenant per database. The dashboard's management HTTP surface
  // (manager login, staff/person management, passkey ceremonies) on the SAME app, the identical
  // convention `mountWebhook` and `mountTillApi` above follow. It reuses the EXACT values
  // `mountTillApi` receives so the two cannot drift: the same `db`, the same tenant
  // (`till.tenantId`) and the same `secureCookies` binding hoisted above (one value, read by both
  // mounts — not a re-typed `config.tls !== undefined`). No fiscal backend, clock or card
  // provider: the management routes read and write only the tenant's own identity records.
  // `rpId`/`origin` are the passkey Relying Party config from `loadConfig` — a passkey is bound
  // to its RP ID + origin, so these are config, never hardcoded (spec §4c). Routes only — no
  // database work at boot.
  mountManagementApi(
    app,
    {
      db,
      // `nodeId` is THIS node's id (the same `till.nodeId` the adjacent `mountCatalogueApi`
      // receives — one source of truth), carried on the uniform write-path `cfg` shape.
      cfg: { tenantId: till.tenantId, nodeId: till.nodeId },
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
  // The deployment holds one tenant per database. The dashboard's diagnostics surface (read the
  // recent log tail, read + raise verbosity) on the SAME app, the identical convention. It reuses
  // the EXACT `db` and tenant (`till.tenantId`) `mountManagementApi` above receives, plus the
  // `reader` over the rotating files and the in-memory `verbosity` controller the logger reads.
  // All three routes are gated behind `diagnostics.view`. Routes only — no database work at boot;
  // the gate runs per request.
  mountDiagnosticsApi(app, { db, cfg: { tenantId: till.tenantId }, reader, verbosity }, log);
  // The deployment holds one tenant per database. The dashboard's gated catalogue write group
  // (catalogues/categories/products + image upload) on the SAME app, the identical convention. It
  // reuses the EXACT `db` and tenant `mountManagementApi` above receives (`till.tenantId`) so the
  // two cannot drift, plus the store `mkdirSync` above ensured (`config.mediaDir`) and the shared
  // `MAX_UPLOAD_BYTES` DoS ceiling — one value read by this mount and its route, not two
  // literals. No fiscal backend, clock or card provider: these routes touch only the catalogue
  // and the image store. Routes only — no database work at boot; the `person.manage` gate runs
  // per request.
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
  // The deployment holds one tenant per database. The dashboard's gated purchase-invoice write
  // group (facturas recibidas: header + VAT desglose) on the SAME app, the identical convention.
  // Reuses the EXACT `db` and tenant `mountCatalogueApi` above receives (`till.tenantId`) so the
  // two cannot drift. No `nodeId` (the purchase tables carry no sync-capture trigger), no fiscal
  // backend, clock, card provider or media store — these routes touch only the two
  // purchase-invoice tables. Routes only — no database work at boot; the `purchase.manage` gate
  // runs per request. This is the #91 fast-follow's capture surface, feeding the headless modelo
  // 303 IVA-deducible reporting.
  mountPurchasingApi(app, { db, cfg: { tenantId: till.tenantId } }, log);
  // Mount every ENABLED module's routes generically (SP1). `setsToMigrate` is the enabled module
  // set on this trading branch (boot.ts:552), so a module toggled off mounts nothing — no
  // hand-written guard at the mount site. `routeCtx` binds cfg to the two `TillConfig` fields a
  // module route reads (`tenantId`/`locationId`); `core.openTab` closes over the FULL `till` HERE,
  // so `nodeId`/`tillId` never enter the module's cfg. Bookings is the first `*-api.ts` behind the
  // seat; the other `mount*Api` calls stay as they are.
  const routeCtx: ModuleRouteContext = {
    db,
    cfg: { tenantId: till.tenantId, locationId: till.locationId },
    core: { openTab: (tx, req) => openTab(tx, till, req) },
  };
  for (const m of setsToMigrate) m.routes?.mount(app, routeCtx, log);
  // The deployment holds one tenant per database. The dashboard's gated reporting surface on the
  // SAME app, the identical convention. Reuses the EXACT `db` and tenant (`till.tenantId`)
  // `mountPurchasingApi` above receives so the two cannot drift. `nodeId` here is `dataNodeId` —
  // the node whose DATA this server DISPLAYS, not its own identity: on a MIRROR that is the
  // ORIGIN (the primary whose replicated sales it holds), so the per-till/fiscal reports
  // (daily-close view, period, cash-up, VAT, overdue) resolve the venue's data rather than the
  // mirror's empty own node (membership promotion R3a); on a primary it is the own id. The
  // `/reports/overview` route ignores it entirely and aggregates the WHOLE venue (all nodes), and
  // the modelo 303 export is likewise tenant-wide. No fiscal backend, card provider or media
  // store — READ-ONLY routes over the filed commercial record + the venue's dining tables. Routes
  // only — no database work at boot; the `report.export`/`report.view` gates run per request,
  // SELECTs only.
  mountReportApi(app, { db, cfg: { tenantId: till.tenantId, nodeId: dataNodeId } }, log);
  // The deployment holds one tenant per database. The dashboard's gated recipe-authoring surface
  // (ingredient CRUD + product-recipe get/set) on the SAME app, the identical convention. Reuses
  // the EXACT `db`, tenant and `nodeId` `mountCatalogueApi` above receives
  // (`till.tenantId`/`till.nodeId`) — a recipe write UPDATEs the sync-enrolled `products` table
  // (via applyRecipeDerivation), so it threads `nodeId` for the same origin-attribution reason
  // catalogue does. No fiscal backend, clock, card provider or media store. Routes only — no
  // database work at boot; the `recipe.manage` gate runs per request.
  mountRecipeApi(app, { db, cfg: { tenantId: till.tenantId, nodeId: till.nodeId } }, log);
  // The deployment holds one tenant per database. The dashboard's gated shift-planning surface
  // (roster authoring + publish) on the SAME app, the identical convention. Reuses the EXACT db +
  // tenant (till.tenantId); no fiscal backend, clock, card provider or media store — these routes
  // touch only roster_versions / shifts / convenio_config / locations. Routes only; the
  // schedule.manage gate runs per request.
  mountWorkforceApi(app, { db, cfg: { tenantId: till.tenantId, nodeId: till.nodeId } }, log);
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
  mountMeApi(
    app,
    // `nodeId` is THIS node's id (the same `till.nodeId` `mountManagementApi`/`mountCatalogueApi`
    // receive), carried on the uniform write-path `cfg` shape.
    // `modules` is the enabled-module set (`setsToMigrate`, boot.ts above) by name — surfaced by
    // `GET /session/me` so the dashboard activates and shows only enabled modules. Includes `core`
    // harmlessly (the browser registry only matches UI-bearing ids).
    {
      db,
      cfg: { tenantId: till.tenantId, nodeId: till.nodeId },
      venueLocale,
      modules: setsToMigrate.map((m) => m.name),
    },
    log,
  );
  // The PUBLIC read half of the product-image feature on the SAME app — the `mountWebhook` /
  // `mountTillApi` / `mountManagementApi` convention again. Deliberately UNAUTHENTICATED and taking
  // no `db`/session: it serves bytes from `config.mediaDir` (the store `mkdirSync` above ensured),
  // guarding the filename against traversal with its own explicit regex (design §5e). Mounted after
  // the gated groups purely for reading order; route registration only, no database work at boot.
  mountMedia(app, { mediaDir: config.mediaDir }, log);

  // Start backups only on a singleton primary after the configured backup connection
  // passes assertBackupCanReadFiscal. The worker reuses that pool for manifest reads;
  // pg_dump opens its own connection with the same URL. A probe failure leaves backup
  // disabled and is logged without stopping sales. Close any pool not handed to the worker.
  const backupConfig = loadBackupConfig(env);
  const backupController = new AbortController();
  // Build the `StorageBackend`s ONCE, here in boot scope, so the sweep worker below and the
  // box-status freshness reader further down share the SAME array — one `buildBackend` per configured
  // destination, not two divergent lists. Empty when backup is off (`backupConfig === undefined`), in
  // which case the sweep block is skipped and the reader is never wired (`backupWorker` stays
  // undefined), so the empty array is never read.
  const backupBackends = backupConfig?.destinations.map(buildBackend) ?? [];
  // The pre-encryption dump is staged under `<stateDir>/backup-staging`, NOT an OS tmp dir: it must
  // never sit (even briefly) inside a directory a destination's `list("waitron-")` scan walks, or a
  // stray plaintext dump could be read back as if it were a stored artifact — and under stateDir it
  // lives on the box's persistent volume beside its other state, not on a tmpfs that may be wiped
  // mid-dump. `runBackupSweep` re-creates it (recursively) each tick, so a wiped dir self-heals.
  const backupStagingDir = join(config.stateDir, "backup-staging");
  let backupWorker: Promise<void> | undefined;
  // The backup read pool the sweep's `buildManifest` reads the drizzle journal off. Assigned ONLY
  // on the probe's success path (the probe pool is reused), so it is `undefined` whenever backup
  // is off/fenced; closed in `closePools` below, AFTER `stopWork` has aborted + awaited
  // `backupWorker`, so no tick can touch it mid-close.
  let backupDb: Database | undefined;
  if (isSingletonPrimary && backupConfig !== undefined) {
    let probeDb: Database | undefined;
    try {
      probeDb = await createPostgresDb(backupConfig.databaseUrl);
      await assertBackupCanReadFiscal(probeDb);
      // The probe just validated this exact backup read connection; hand it to the worker as
      // `backupDb` (rather than opening a SECOND pool to the same role) and null `probeDb` so the
      // `finally` no longer closes it — ownership has passed to `backupDb`, closed in
      // `closePools`.
      backupDb = probeDb;
      probeDb = undefined;
      backupWorker = runBackupSweep({
        // The full fan-out: the same encrypted archive is `put` to EVERY configured destination each
        // tick (`WAITRON_BACKUP_DIR`'s "primary" entry plus any in `WAITRON_BACKUP_DESTINATIONS`).
        backends: backupBackends,
        // The backup read pool for the manifest's schema-version reads (NOT the app pool —
        // app_user has no SELECT on the `__drizzle_migrations_*` journal), plus the composition
        // the archive captures: every module's non-DB state + schema versions, this box's
        // environment, the media resolver, and the state dir the recovery secrets are read from.
        db: backupDb,
        modules: ALL_MODULES,
        environment: config.environment,
        resolvers: { media: config.mediaDir },
        stateDir: config.stateDir,
        stagingDir: backupStagingDir,
        databaseUrl: backupConfig.databaseUrl,
        recoveryKey: backupConfig.recoveryKey,
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
      // pool-close rejection on the strict §5 path must never become a boot-aborting throw. Only a
      // FAILURE path reaches here with `probeDb` still set — on success it was nulled after handoff to
      // `backupDb`. The probe's own errors are already handled by the `catch` above.
      if (probeDb !== undefined) await probeDb.close().catch(() => {});
    }
  } else if (isSingletonPrimary) {
    log("info", "backup.disabled", {});
  }

  // The carrier that would drain this node's fenced tail (`servingPrimaryNodeId` of the held chart),
  // captured at boot. The carrier's publisher-side slot on THIS node is named by the CARRIER (the
  // subscriber that drains it, C1), so the fenced node finds it by the carrier's id.
  const carrierNodeId = heldMembership === null ? undefined : servingPrimaryNodeId(heldMembership);
  // The fence-LSN watermark this node recorded when it entered its read-only fence (Ruling C2), read
  // ONCE at boot — `null` on a serving node (never fenced) or a dead box. The drain guard is
  // `isDrained(slot, fenceLsn) && !slot.active`. Only ever consulted when a carrier is known (both
  // `readDisposal` and `mountBoxRetireApi` are inert with no carrier), so skip the read entirely on an
  // unfenced primary rather than spend a round-trip on a value nothing reads.
  const fenceLsn = carrierNodeId === undefined ? null : await readFenceLsn(db);
  // The native slot-drain reader (swap S4): the carrier's slot on THIS node is named by the carrier
  // (C1), read on the migrator/owner pool (`replicationDb`) — a non-superuser reads pg_replication_slots
  // unmasked (probe B). `undefined` when the held chart names no carrier, exactly as retire/box-status
  // expect (fenced-with-no-carrier → refuse fail-safe). The disposal cell folds in `isDrained` here so
  // box-status stays pure of the fence LSN.
  const readFenceSlotDrain: (() => Promise<SlotDrain>) | undefined =
    carrierNodeId === undefined
      ? undefined
      : () => readSlotDrain(replicationDb, subscriptionName(config.environment, carrierNodeId));
  mountBoxStatusApi(
    app,
    {
      db,
      cfg: { tenantId: till.tenantId, nodeId: till.nodeId },
      environment: config.environment,
      health,
      now,
      tlsCertPath: config.tls?.certFile,
      // Native replication (swap S4): a PRIMARY is a publisher and lists its peers' slots; a MIRROR is a
      // subscriber and reports its own subscription (incl. the narrowed publications, I6). Exactly one is
      // wired, off the boot-captured mode. Both read the migrator/owner pool (`replicationDb`).
      readReplicationSlots: isMirror ? undefined : () => listSlots(replicationDb),
      readReplicationSubscription: isMirror
        ? () =>
            readSubscriptionStatus(replicationDb, subscriptionName(config.environment, till.nodeId))
        : undefined,
      // The disposal cell: the carrier's slot drain folded with `isDrained` against the fence LSN and the
      // `!active` half — present only on a fenced node with a known carrier (`readFenceSlotDrain` set).
      readDisposal:
        readFenceSlotDrain !== undefined && carrierNodeId !== undefined
          ? async () => {
              const d = await readFenceSlotDrain();
              return {
                carrierNodeId,
                drained: fenceLsn !== null && isDrained(d, fenceLsn) && !d.active,
                active: d.active,
                walStatus: d.walStatus,
                retainedBytes: d.retainedBytes,
              };
            }
          : undefined,
      readBackup:
        backupWorker !== undefined
          ? () => readBackupStatus(backupBackends, backupConfig!.staleAfterMs, now())
          : undefined,
      // Report the effective mode the box is actually serving as — the same holder the read-only gate
      // and mirror-session middlewares read — so the status matches what the box enforces and tracks a
      // live promotion the same way, rather than issuing a fresh DB read of its own.
      readMode: () => holders.mode.current,
      // The live singleton role (primary/secondary), read per-request from the same holder the
      // duty loop reads — box-status now shows BOTH deployment axes (mode + singleton_role, #158).
      readSingletonRole: () => holders.singletonRole.current,
      // The awaiting-cert cell the fiscal pass writes below — same holder, read live per request.
      readAwaitingFiscalCertificate: () => awaitingFiscalCert.current,
    },
    log,
  );

  // The self-eviction endpoint (retire/evict R3): a fully-drained fenced node retires itself. Mounted
  // UNCONDITIONALLY (a real management endpoint) — `retireSelf`'s ordered guards make it safe on any
  // node: a serving node refuses `node.retire_not_fenced`, and a fenced node with no carrier refuses
  // `node.retire_no_carrier` (signalled by `readSlotDrain === undefined`). It consumes the SAME native
  // slot-drain reader + fence LSN box-status's `disposal` surface uses, so the two views cannot desync.
  mountBoxRetireApi(
    app,
    {
      appDb: db,
      ring,
      tenantId: till.tenantId,
      nodeId: till.nodeId,
      readSlotDrain: readFenceSlotDrain,
      fenceLsn,
      // The boot carrier the slot reader keys on. retireSelf re-derives the current carrier from the
      // fresh held chart and refuses `node.retire_carrier_changed` if it changed (I1).
      carrierNodeId,
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

  // The operator flow's PRIMARY endpoint: POST /management-api/mirror-bundle mints a MirrorBundle a
  // cloud mirror adopts (design §4). SINGLETON-PRIMARY-only (a mirror emits no bundle, and a sell-only
  // local secondary must not either). The bundle now carries the primary's native-replication
  // CONNECTION (swap step 4) — `config.replication` (the `waitron_repl` credential + advertise
  // address); the route refuses `server.config_missing` (503) when it is unconfigured. `database` is
  // the name of the primary's own database, carried in the bundle so the mirror's subscription names
  // the right dbname to COPY from. `relayUrl` is this primary's own relay coordinates
  // (`loadTunnelConfig`, undefined when no tunnel is configured — the route then refuses
  // `mirror.no_relay`); `boxHostname` is the same box leaf SAN the discovery-api and cert-minting use;
  // `designated` is `config.till` (the five WAITRON_TILL_*_ID). Mounted before the SPA catch-alls below.
  if (isSingletonPrimary) {
    // This primary's own native-replication credential + advertise address (swap spec §2.2), loaded
    // from env here — it rides the mirror bundle, not the sale path, so it is only read on the
    // bundle-minting primary. `undefined` when unconfigured; the route then refuses.
    const replicationConfig = loadReplicationConfig(env);
    // The NAME of this primary's own database, carried in the bundle's replication connection so the
    // mirror's `CREATE SUBSCRIPTION` names the right `dbname`. Parsed from the app URL, never the URL
    // itself (it can carry a password); a socket/malformed URL falls back to a neutral label.
    let primaryDatabaseName = "the primary database";
    try {
      const parsed = new URL(config.databaseUrl).pathname.replace(/^\//, "");
      if (parsed !== "") primaryDatabaseName = parsed;
    } catch {
      // Keep the neutral label.
    }
    mountMirrorBundleApi(
      app,
      {
        appDb: db,
        // The box vault key `assembleMirrorBundle` uses to unseal the primary's identity key and endorse
        // the standby's key (membership promotion R2). Already in scope for the provisioning-secret seal.
        ring,
        stateDir: config.stateDir,
        // A FULL https URL, not bare host:port: the mirror consumes this end-to-end to the box cert
        // through the tunnel, so the scheme is https (matches Task 5's `https://relay.test:9000/`).
        relayUrl:
          tunnelConfig !== undefined
            ? `https://${tunnelConfig.relayHost}:${tunnelConfig.relayPort}/`
            : undefined,
        boxHostname: BOX_HOSTNAME,
        designated: config.till,
        // The primary's own native-replication credential + advertise address, undefined when
        // unconfigured (the route then refuses `server.config_missing`).
        replication: replicationConfig,
        database: primaryDatabaseName,
      },
      log,
    );
  }

  // The short-lived owner pool both the in-process promotes and the promote ENDPOINT open from the
  // table-OWNER admin connection (the same open/close pattern the boot-time `stampProbe` uses) rather
  // than holding one open — a trading box keeps only the app pool — handing the promote the shared
  // `PromoteDeps`. `config.adminDatabaseUrl` is `WAITRON_ADMIN_DATABASE_URL` when set, else the
  // migrations URL, else the app URL: so a role-split appliance that misconfigures it opens the
  // LEAST-privileged connection and the owner write hits a role with no UPDATE on `deployment`, throwing
  // 42501 — fails CLOSED, never a silent no-op. In dev/CI the URL is the superuser.
  const withOwnerDb = async <T>(run: (deps: PromoteDeps) => Promise<T>): Promise<T> => {
    const ownerDb = await createPostgresDb(config.adminDatabaseUrl);
    try {
      return await run({
        appDb: db,
        ownerDb,
        holders,
        log,
        ring,
        tenantId: till.tenantId,
        nodeId: till.nodeId,
      });
    } finally {
      await ownerDb.close();
    }
  };

  // The mirror→primary promote, shared by the in-process `StartedServer.promoteMirrorToPrimary`
  // (boot.promote.test.ts) and the HTTP endpoint's `promoteRun` below. It corrects `trading.env` to the
  // cloud's OWN reserved standard series (spec §4.3) BEFORE the point-of-no-return (inert on a
  // still-read-only mirror), runs the PONR owner transaction, and restarts into `mode=primary` on a real
  // promote — an already-primary re-run is an idempotent no-op that skips the restart. Only a mirror
  // changes its selling series + `deployment.mode` on promotion, so this path exists only in mirror mode.
  const promoteMirrorRun = (attestation: FenceAttestation): Promise<MirrorPromotionResult> =>
    withOwnerDb(async (deps) => {
      const result = await promoteMirrorToPrimary(
        {
          ...deps,
          // The promoted primary numbers under its OWN reserved standard series, not the primary's inert
          // `till.seriesId` that adopt wrote; every other value is re-emitted unchanged from the running
          // config. Called BEFORE the PONR (inert on a still-read-only mirror), so a PROCESS crash can
          // never leave the box primary on the primary's series (power-loss residual documented on
          // `MirrorPromoteDeps.persistTradingEnv`).
          persistTradingEnv: async (seriesId) => {
            const next: TradingConfig = {
              tenantId: till.tenantId,
              tillId: till.tillId,
              nodeId: till.nodeId,
              seriesId,
              locationId: till.locationId,
              databaseUrl: config.databaseUrl,
              migrationsDatabaseUrl: config.migrationsDatabaseUrl,
              environment: config.environment,
            };
            await writeTradingEnv(config.stateDir, next);
          },
          // Narrow the promoted node's OWN subscription to the ledger publication AFTER the PONR (spec
          // §4.2 step 3), so the drain window re-copies no state. The subscription is named by THIS
          // node's own id (C1) and runs on the migrator pool `replicationDb` (which owns the
          // subscription, I6 — NOT `deps.ownerDb`/`config.adminDatabaseUrl`, which may not). A failure
          // is logged `promotion.narrow_failed` and not rethrown (the node is already primary); boot's
          // `ensureReplicationShape` re-narrows on the next boot.
          narrowSubscription: () =>
            setSubscriptionPublications(
              replicationDb,
              subscriptionName(config.environment, till.nodeId),
              [publicationName(config.environment, "ledger")],
            ),
        },
        attestation,
      );
      if (!result.alreadyPrimary) {
        // Restart into `mode=primary` on the NEXT tick so the in-process caller's result is returned
        // first (the supervisor loop that reboots the box is out of process; `requestRestart` is only
        // wired in the setup branch, so the inline `process.kill` form is used here).
        setTimeout(() => process.kill(process.pid, "SIGTERM"), 0);
      }
      return result;
    });

  // The promote ENDPOINT's delegate (both modes, spec §6). On a mirror → the real restart-into-primary
  // promote (`promoteMirrorRun`), reporting `restarting` from its `alreadyPrimary`. On a non-mirror
  // (primary or fenced) → an informative read-only status: a node its OWN held document marks fenced
  // throws `promotion.node_fenced` (the endpoint maps it to 409), an unfenced primary is already-primary.
  // NEVER calls `promoteLocalSecondaryToPrimary` (shelved active-active, spec §2).
  const promoteRun = async (attestation: FenceAttestation): Promise<PromoteRunResult> => {
    if (isMirror) {
      const result = await promoteMirrorRun(attestation);
      return { alreadyPrimary: result.alreadyPrimary, restarting: !result.alreadyPrimary };
    }
    const held = await readNodeMembership(db);
    assertNotFenced(held, till.nodeId); // throws promotion.node_fenced on a fenced (primary, secondary) node
    return { alreadyPrimary: true, restarting: false };
  };

  // Mount the operator's failover trigger on BOTH modes (spec §6), before the SPA catch-alls. The
  // read-only gate exempts this POST (above), so a mirror AND a fenced node reach the handler.
  mountPromoteApi(app, { appDb: db, tenantId: config.till.tenantId, run: promoteRun }, log);

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
    mountSpa(
      app,
      { root: config.dashboardAppDir, basePath: "/manage", navigationPath: "/manage" },
      log,
    );
  }
  if (config.tillAppDir !== undefined) {
    // `""` = the origin-root catch-all: MUST be the last GET mounted (see the block comment above).
    mountSpa(app, { root: config.tillAppDir, basePath: "", navigationPath: "/tabs" }, log);
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
            // The regime owns the submission transport: `enabledFiscal.drain` builds a per-pass mTLS
            // resolver (one TLS pool per tenant with due work, released in its own `finally`) and runs
            // the pass. The host injects only the vault ring, the deployment identity and the cadence —
            // `config.environment` is the `WAITRON_ENV`-derived value `deployment-guard.ts` pinned
            // against the database at boot, and the regime's `entorno` guard refuses any due registro
            // whose own `entorno` disagrees or is unrecorded. `boot.ts` names no regime package.
            drain: (at2) =>
              enabledFiscal.drain(
                {
                  db,
                  ring,
                  environment: config.environment,
                  skipRetryMs: config.skipRetryMs,
                  log,
                },
                at2,
              ),
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
            awaitingCert: awaitingFiscalCert,
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
  // teardown supplied here: stop the main loop, the outbound tunnel and the backup sweep, then drain
  // the app and replication pools. The ordering guarantees (abort the loop and workers together, await
  // the loop, swallow a worker's settle-by-rejection so it can never skip the guaranteed pool
  // teardown) are unchanged.
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
        // Stop the outbound tunnel client — its own controller, aborted here so close() never leaves it
        // dialing; runTunnelClient resolves promptly on abort (it destroys every live socket and
        // cancels every pending backoff nap). Aborted alongside the others, awaited below.
        tunnelController.abort();
        // Stop the scheduled backup sweep the same way — its own controller, aborted here so close()
        // never leaves it mid-cadence; runBackupSweep's abort-aware sleep returns promptly rather than
        // waiting out its (up to daily) interval. Aborted alongside the others, awaited below.
        backupController.abort();
        await loop;
        // The outbound tunnel worker, torn down the identical way: tunnelController.abort() above
        // already signalled it, so this only awaits its settle, swallowing a settle-by-rejection so it
        // can never skip the guaranteed pool teardown below. It never rejects in production (its slots
        // back off every error), and holds no connection pool of its own — nothing to add to
        // closePools.
        if (tunnelWorker !== undefined) await tunnelWorker.catch(() => {});
        // The scheduled backup sweep worker, torn down the identical way:
        // backupController.abort() above already signalled it, so this only awaits its settle,
        // swallowing a settle-by-rejection so it can never skip the guaranteed pool teardown
        // below. runBackupSweep swallows its own per-tick faults (a wedged pg_dump, a full disk)
        // so it never rejects in production. Awaiting it HERE before `closePools` is what lets
        // `closePools` close its backup manifest read pool (`backupDb`) safely — no tick is left
        // mid-flight reading the journal off it.
        if (backupWorker !== undefined) await backupWorker.catch(() => {});
      },
      closePools: async () => {
        await db.close();
        // The replication owner pool (M8), opened after the mirror-config read above and closed here
        // beside the app pool.
        await replicationDb.close();
        // The backup sweep's backup manifest read pool. `stopWork` above already aborted +
        // awaited `backupWorker`, so no tick can be reading the journal off it as it closes.
        if (backupDb !== undefined) await backupDb.close();
      },
    },
    mdns,
    // Which in-process promote this box exposes is decided ONCE at boot by the deployment mode (captured
    // in `isMirror`), so a mirror surfaces `promoteMirrorToPrimary` and a local secondary
    // `promoteLocalSecondaryToPrimary` — never both. The mirror path (`promoteMirrorRun`, defined above,
    // also the endpoint's mirror delegate) corrects `trading.env` and restarts; the local-secondary path
    // does not. Both build `PromoteDeps` via the shared `withOwnerDb`.
    isMirror
      ? { kind: "mirror" as const, run: promoteMirrorRun }
      : {
          kind: "local-secondary" as const,
          run: (attestation: FenceAttestation) =>
            withOwnerDb((deps) => promoteLocalSecondaryToPrimary(deps, attestation)),
        },
  );
}
