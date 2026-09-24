import { mountCloudPublic } from "./cloud-remote.js";
import { runCloudWorker } from "./cloud-worker.js";
import { createCloudConnection, loadCloudOrigin } from "./cloud-client.js";
import { mountCloudApi } from "./cloud-api.js";
import { liveResourceTypes } from "./live-resources.js";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { inArray } from "drizzle-orm";
import type { Hono } from "hono";
import {
  installChangeFeed,
  subscribeToChanges,
  persistNodeMembershipIfNewer,
  readDeploymentAxes,
  readMembershipTrustSet,
  readNodeMembership,
  setSingletonRoleTx,
  readMirrorConfig,
  openVenueDatabase,
  withTransaction,
  type Database,
} from "@waitron/db";
import { credentialProvisioned, loadKeyRing, tenantCredentials } from "@waitron/credentials";
import { registerModulePermissions, withPassiveManagementRead } from "@waitron/identity";
import { LiveEvents, changeSubscriber, mountLiveApi } from "./live-api.js";
import { runDue } from "@waitron/scheduler";
import type { TickResult } from "@waitron/scheduler";
import { StripeReconciler } from "@waitron/payments-stripe";
import {
  SimulatorPaymentProvider,
  type CardProviderContribution,
  type CardProviderRuntimeDeps,
  type PaymentProvider,
} from "@waitron/payments";
import { recordIncidentOnce } from "@waitron/core";
import { CARD_PROVIDERS } from "@waitron/composition";
import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";
import { assertSingleOperationalVenue, readOperationalVenueIds } from "@waitron/provisioning";
import { enabledModules, fiscalSlot, orderedMigrationSets, reconcile } from "@waitron/module";
import type { AlertSource, ModuleRouteContext } from "@waitron/module";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@waitron/media";
import { AppError } from "@waitron/shared";
import {
  ALL_ALERT_CLAIMS,
  ALL_MODULES,
  ALL_MODULE_PERMISSIONS,
  enabledAlertSources,
  enabledFloorAnnotators,
} from "./modules.js";
import { readModuleConfig, writeModuleConfig } from "./module-config.js";
import { parseEnvFile } from "./env-file.js";
import { loadConfig, loadTunnelConfig, type ServerConfig } from "./config.js";
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
import { withDevMigrationHint } from "./dev-migration-hint.js";
import { createRotatingFileSink, createLogReader, tee } from "./log-file.js";
import { createVerbosityController } from "./verbosity.js";
import { requestIdMiddleware } from "./request-id.js";
import { createOriginAllowlist } from "./allowed-origins.js";
import { corsForVenue } from "./cors.js";
import { mountDiagnosticsApi } from "./diagnostics-api.js";
import { mountAlertsApi } from "./alerts-api.js";
import { createAlertRegistry } from "./alerts.js";
import {
  awaitingCertAlertSource,
  backupAlertSource,
  type BackupOutcomeHolder,
  batteryAlertSource,
  printingAlertSource,
} from "./alert-sources.js";
import type { BackupStatus } from "./backup-status.js";
import { createTtlCache } from "./ttl-cache.js";
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
import { runPass, DRAIN_DUTY, type PassReport } from "./pass.js";
import { singletonPass } from "./singleton-pass.js";
import { stripeAccountResolver, defaultMakeStripe } from "./stripe-account.js";
import { mountWebhook } from "./webhook.js";
import { mountTillApi } from "./till-api.js";
import { mountNodeApi } from "./node-api.js";
import { mountNodeEnrolApi } from "./node-enrol-api.js";
import { mountDeviceApi } from "./device-api.js";
import { mountJoinApi } from "./join-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountPrintApi } from "./print-api.js";
import { mountPaymentsApi } from "./payments-api.js";
import { createCardProviderPool } from "./card-provider-pool.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import { mountLocationSettingsApi } from "./location-settings-api.js";
import { mountManagementApi } from "./management-api.js";
import { mountConfigurationExportApi } from "./configuration-export-api.js";
import { createAccountEmailSender } from "./account-email.js";
import { resolveEmailDelivery } from "./email-delivery.js";
import { mountEmailInboxApi } from "./email-inbox-api.js";
import { createMailpitClient } from "./mailpit-client.js";
import { createSetupOperationStore } from "./setup-operation.js";
import { stageRestoreRequest } from "./restore-request.js";
import { validateArtifact } from "./restore.js";
import {
  clearStagedConfigurationImport,
  readStagedConfigurationImport,
  stageConfigurationImport,
} from "./configuration-import.js";
import {
  importConfigurationTables,
  validateConfigurationBundle,
} from "./configuration-transfer.js";
import { createFiscalReadinessStore } from "./fiscal-readiness.js";
import { fiscalReadinessInput, submitFiscalReadiness } from "./fiscal-readiness-runner.js";
import { openTab } from "./working-order.js";
import { mountCatalogueApi } from "./catalogue-api.js";
import { mountUnitsApi } from "./units-api.js";
import { mountPurchasingApi } from "./purchasing-api.js";
import { mountReportApi, resolveVenueClock } from "./report-api.js";
import { mountWorkforceApi } from "./workforce-api.js";
import { mountScheduleApi } from "./schedule-api.js";
import { mountMeApi } from "./me-api.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { mountPromoteApi, type PromoteRunResult } from "./promote-api.js";
import { assertBuiltApp, mountSpa } from "./spa-api.js";
import { mountSetup } from "./setup-api.js";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { seedInstalledDemo } from "./demo-seed.js";
import { runFiscalDrain } from "./onboarding-policy.js";
import { resetBeforeFirstDrain } from "./restart-reset.js";
import { adoptFromPrimary } from "./adopt.js";
import { fetchMirrorBundle } from "./mirror-bundle-fetch.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { writeTradingEnv, type OnboardingIntent, type TradingConfig } from "./trading-config.js";
import { accountPurposeKey, resolveAccountKey } from "./account-key.js";
import { readPendingAdoption, runFinishAdoption } from "./finish-adoption.js";
import { mountDiscovery } from "./discovery-api.js";
import { startMdnsResponder, type MdnsResponder } from "./mdns.js";
import { buildReachInfo, listBoxIpv4 } from "./box-reach.js";
import { ensureBoxSecrets, mintedBoxLeaf } from "./box-secrets.js";
import { resolveTradingTls } from "./trading-tls.js";
import { buildLandingApp } from "./landing-app.js";
import { closeListener } from "./close-listener.js";
import { mountBoxStatusApi } from "./box-status.js";
import { mountBoxRetireApi } from "./box-retire.js";
import { mountRecoveryBundleApi } from "./recovery-bundle-api.js";
import { mountBackupApi } from "./backup-api.js";
import { loadBackupConfig, loadRecoveryKey } from "./backup-config.js";
import { BackupSupervisor } from "./backup-supervisor.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { loadBoxEnv } from "./box-env.js";
import { isUnset } from "./env-value.js";
import { readOnlyGate } from "./read-only-gate.js";
import { isFenced } from "./membership-fence.js";
import { endMirrorViewer, ensureMirrorViewer, mirrorSession } from "./mirror-session.js";
import { assertMirrorBindSafe } from "./mirror-bind-guard.js";
import { acceptMembershipDocument } from "@waitron/membership";
import { fetchPeerMembershipDocument, reconcileMembershipOnBoot } from "./membership-reconcile.js";
import { runTunnelClient } from "@waitron/tunnel";
import { readFilingModule, readOrderFlow } from "./till-config.js";
import type { TillConfig } from "./till-config.js";
import { readVenueLocale } from "./venue-locale.js";
import { readVenueTimeZone } from "./venue-time-zone.js";
import { makeFiscalBackend, systemClock } from "./till-backend.js";
import { buildServeOptions, watchTlsFiles } from "./tls.js";
import { Server as HttpsServer } from "node:https";
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
  /**
   * Resolves once background work has stopped, the listeners are closed and the venue store is
   * closed; rejects if any of that fails.
   */
  close(): Promise<void>;
}

/**
 * The mode-specific half of `close()` (see `makeStartedServer`): how to stop this boot's background
 * work and what to close. In every mode `closePools` closes the venue store, which is both of the
 * directory's files. Trading's backup read connection is the exception: `backupSupervisor.stop()` in
 * `stopWork` closes it, swallowing a failure to close it. A failure to close rejects `close()`; a
 * signal-initiated shutdown then logs `server.shutdown_failed`, unless the shutdown deadline has
 * already exited the process. Setup's `stopWork` is a no-op;
 * adoption-pending's AWAITS the adoption worker — `runFinishAdoption` takes no abort signal, so there
 * is nothing to cancel; trading's stops the main loop, the outbound tunnel and the backup sweep, and
 * closes the live event bus after dropping its change-feed subscription. That unsubscribe is itself
 * synchronous — it returns nothing to await, the feed being in-process and holding no connection.
 * The awaits later in trading's `stopWork` belong to the main loop, the tunnel worker and
 * `backupSupervisor.stop()`, not to it.
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
 * The default persisted store for the box's self-signed cert PEMs and generated secrets, computed
 * beside the server entry point: beside the bundle (`<dist>/state`) for a built artefact, or
 * `apps/server/src/state` run from source. The setup branch below materialises the box's self-signed
 * cert + secrets here on first setup boot (`ensureBoxSecrets`, `box-secrets.ts`) and serves the setup
 * surface over HTTPS from them; leaf renewal/rotation is later work. `WAITRON_STATE_DIR`
 * overrides it (config.ts), and deployment (#9) sets a durable, protected path; this default only has
 * to exist so a from-source dev boot has somewhere to write. The dev default is gitignored
 * (`apps/server/src/state/`) because it holds SECRETS. Threaded into `loadConfig` as the
 * `defaultStateRoot` argument.
 */
export const DEFAULT_STATE_ROOT = fileURLToPath(new URL("state", import.meta.url));

/** Every `WAITRON_BACKUP_*` env var `loadBackupConfig` reads. The supervisor's `isManagedByEnvironment`
 * reports true iff any is non-empty in the RAW base env — the provenance signal that distinguishes an
 * env-injected backup config (a cloud profile) from a file-sourced one written by the wizard (spec
 * §3.2). Only presence matters here; the parse/validation of the values lives in `loadBackupConfig`. */
const BACKUP_ENV_KEYS = [
  "WAITRON_BACKUP_DIR",
  "WAITRON_BACKUP_DESTINATIONS",
  "WAITRON_BACKUP_RECOVERY_KEY",
  "WAITRON_BACKUP_SCHEDULE_DAYS",
  "WAITRON_BACKUP_AT",
  "WAITRON_BACKUP_INTERVAL_MS",
  "WAITRON_BACKUP_RETAIN",
  "WAITRON_BACKUP_RETAIN_DAYS",
] as const;

/**
 * The box's canonical mDNS / self-hosted hostname. ONE source of truth so the wirings that MUST
 * agree can never drift into a certificate-hostname mismatch — the exact failure the trust flow exists
 * to avoid (spec §7/§8): the mDNS responder that ANSWERS for the name, the discovery/trust surface that
 * ADVERTISES it, and the self-signed leaf's SAN list (`ensureBoxSecrets`) that must COVER it.
 *
 * Three copies of this string live outside this process, where no import can reach them: the
 * image's `WAITRON_MANAGEMENT_RP_ID` / `WAITRON_MANAGEMENT_ORIGIN`, compose's defaults for the
 * same, and `waitron.sh`'s QR URL. `scripts/deploy-image-env.test.ts` reads this line as text and
 * pins all three to it.
 */
export const BOX_HOSTNAME = "waitron.local";

/**
 * The upper bound on a single product-image upload, 20 MiB. What is stored is the shrunk copy
 * `prepareImage` makes, so this bounds how large an upload the server will buffer; the decode is
 * bounded by `MAX_INPUT_PIXELS`, since a small file can declare that many pixels.
 * A settled constant rather than config: it is a DoS ceiling on an unauthenticated-adjacent write
 * path, not an operator knob. The media upload route (`packages/media/src/routes.ts`) enforces it
 * coarsely (a `bodyLimit` middleware) and precisely (`prepareImage`'s size check,
 * `image.too_large`); set from the route's own fallback, `DEFAULT_MAX_UPLOAD_BYTES`, so the two agree.
 */
export const MAX_UPLOAD_BYTES = DEFAULT_MAX_UPLOAD_BYTES;

/** What `reconcile` reports when the Stripe credential is not provisioned: no runs, nothing
 * deferred, nothing dropped by the horizon, nothing skipped, and no next due time — the same shape
 * `runDue` returns for a tick with no work, so `runPass` and `health.ts` need no special case. */
const NOTHING_TO_RECONCILE: TickResult = {
  ran: [],
  deferred: 0,
  beyondHorizon: 0,
  skipped: [],
  nextDueAt: null,
};

/**
 * The card-payment provider a Demo or default-Prepare till drives: the local simulator, built once at
 * boot. Every OTHER card sale routes to its reader's own provider through the
 * pool at collect time (Task 12 cutover), so a live/integration till returns `undefined` here — there
 * is no single per-till provider any more. Prepare that explicitly opts into real test providers
 * (`paymentTestProviders`) also returns `undefined` and uses real readers.
 *
 * Exported, not inlined into `startServer`: `startServer`'s only test subject (`boot.test.ts`) boots
 * a real migrated venue directory in a non-demo mode, so it exercises only the `undefined` branch —
 * unit-testing THIS function directly (`boot-card-provider.test.ts`) is what reaches the
 * simulator branch, the same "exported for a direct test subject" reasoning `DEFAULT_MIGRATIONS_ROOT`
 * below carries.
 */
export async function buildCardProvider(
  db: Database,
  onboardingIntent?: OnboardingIntent,
  paymentTestProviders = false,
): Promise<PaymentProvider | undefined> {
  if (onboardingIntent === "demo" || (onboardingIntent === "prepare" && !paymentTestProviders)) {
    return new SimulatorPaymentProvider(db);
  }
  return undefined;
}

/** Run the card provider's own `resolvePending` sweep on every tick, wrapping (not replacing) the
 * singleton fiscal pass. Independent of the singleton gate because the sweep resolves THIS node's
 * own `attempting` card rows — a sell-only local secondary that takes card sales must sweep them
 * even though it never drains/reconciles (`singletonPass` returns an empty pass there). Log-only:
 * NOT a health-tracked `Duty`, because `createHealthState` seeds every `ALL_DUTIES` member on every
 * node and a conditional duty that never runs on a no-card node would read stale on the staleness
 * check → `/health` 503. A stuck sweep surfaces as `resolve_pending.failed`, the channel a mirror's
 * stalled pull uses; it is a card-settlement backstop, not a fiscal-legal or process-liveness
 * signal, so it does not gate `/health` (the deferred SumUp reconciler is the same tier, likewise
 * off it). The returned `nextDueAt` is logged, not yet used to pace the loop.
 *
 * Since the reader-provider cutover (Task 12) a live box builds NO single provider at boot — readers
 * come from the pool per sale — so the set of providers to sweep is enumerated EACH pass
 * (`sweepProviders`, `connectedCardProviderSweep` below): every card provider this tenant has a sealed
 * credential for, plus the demo/prepare simulator if one was built. A tenant connected while the host
 * runs is therefore swept on the next pass, no restart. An empty set is a no-op (no card configured).
 *
 * Exported for a direct unit test (`boot-pending-sweep.test.ts`) — a stubbed `inner` + a fake
 * enumerator, no database — the same "exported for a direct test subject" reasoning `buildCardProvider`
 * carries; the full loop wiring is exercised only through a real boot. */
export function withPendingSweep(
  inner: (now: Date) => Promise<PassReport>,
  sweepProviders: () => Promise<readonly PaymentProvider[]>,
  log: Logger,
): (now: Date) => Promise<PassReport> {
  return async (now) => {
    const report = await inner(now);
    // Enumerating the providers can itself fail (a credential read, a pool build) — that is a sweep
    // failure, logged like a stuck sweep and never propagated into the pass (the fiscal `report` is
    // already computed and must be returned whatever the card backstop does). The whole CALL is
    // wrapped, not just the returned promise, so a SYNCHRONOUS throw from the enumerator is contained
    // exactly like a rejection rather than escaping and dropping the report.
    let providers: readonly PaymentProvider[];
    try {
      providers = await sweepProviders();
    } catch (error) {
      log("warn", "resolve_pending.failed", { error: String(error) });
      providers = [];
    }
    for (const provider of providers) {
      try {
        const r = await provider.resolvePending(now);
        log("info", "resolve_pending.complete", {
          provider: provider.provider,
          captured: r.forwarded,
          failed: r.declined,
          incidentsRaised: r.incidentsRaised,
          nextDueAt: r.nextDueAt?.toISOString() ?? null,
        });
      } catch (error) {
        log("warn", "resolve_pending.failed", {
          provider: provider.provider,
          error: String(error),
        });
      }
    }
    return report;
  };
}

/**
 * The per-pass enumerator `withPendingSweep` calls: the demo/prepare simulator (if one was built),
 * plus every pooled card provider this tenant has a SEALED CREDENTIAL for — the same
 * credential-presence signal `payments-api`'s GET providers and `/api/pay`'s connected pre-check use.
 * Read EACH pass, so a provider connected mid-run is swept next pass without a restart. A provider
 * with no sealed credential is NOT swept (its `resolvePending` would only fail on a missing
 * credential), which is the negative control the test pins.
 *
 * Exported for a direct test (`boot-pending-sweep.test.ts`, a venue file with a seeded credential
 * plus a fake pool). */
export function connectedCardProviderSweep(deps: {
  db: Database;
  pool: CardProviderPool;
  contributions: readonly Pick<CardProviderContribution, "providerId" | "credentialPurpose">[];
  simulator: PaymentProvider | undefined;
}): () => Promise<readonly PaymentProvider[]> {
  return async () => {
    const out: PaymentProvider[] = [];
    if (deps.simulator !== undefined) out.push(deps.simulator);
    const purposes = [...new Set(deps.contributions.map((c) => c.credentialPurpose))];
    // No card seats at all → nothing pooled to sweep (only the simulator, already added).
    if (purposes.length > 0) {
      const held = await withTransaction(deps.db, async (tx) => {
        const rows = await tx
          .select({ purpose: tenantCredentials.purpose })
          .from(tenantCredentials)
          .where(inArray(tenantCredentials.purpose, purposes));
        return new Set(rows.map((r) => r.purpose));
      });
      for (const c of deps.contributions) {
        if (!held.has(c.credentialPurpose)) continue;
        // The sweep only drives `resolvePending`, which touches no reader, so `get` needs no reader:
        // the provider carries none (the reader is a per-collect input), so fetching one to sweep is
        // exactly the same cached instance the pay path uses.
        out.push(await deps.pool.get(c.providerId));
      }
    }
    return out;
  };
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
    /* v8 ignore start */
    if (bound) return;
    /* v8 ignore stop */
    const failure = new AppError("server.listen_failed", {
      port: config.httpPort,
      // `error.code` is optional on `NodeJS.ErrnoException`'s TYPE, but every real listen failure
      // this host can hit (EADDRINUSE, EACCES, ENOTFOUND, EADDRNOTAVAIL, …) sets it — Node's socket
      // layer always attaches one. Reaching the `?? "unknown"` fallback needs a synthetic error with
      // no `code`, which `boot.test.ts` cannot produce through `startServer`'s public surface (the
      // raw `http.Server` this handler is attached to is never exposed on `StartedServer`) — the
      // same shape of unreachable-but-type-required branch `loop.ts`'s `realSleep` documents rather
      // than forces.
      /* v8 ignore start */
      code: error.code ?? "unknown",
      /* v8 ignore stop */
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
  if (config.tls && server instanceof HttpsServer) {
    watchTlsFiles(server, config.tls, new URL(config.managementOrigin).hostname, () =>
      log("error", "cloud.certificate_reload_failed"),
    );
  }
  return server;
}

/** Bind a TRADING listener over the box's OWN minted leaf: an operator `WAITRON_TLS_*` (`config.tls`)
 * still wins, and a leaf-less box keeps plain HTTP. A box never sets `WAITRON_TLS_*`, so without this
 * fallback a trading listener would speak plain HTTP and every already-trusting phone/till would hit
 * a TLS handshake error after setup. ONE home for the two trading binds (adoption-pending and the
 * main trading listener), so a future third cannot silently drift back to plain HTTP the way one of
 * these two once did. The SETUP bind is deliberately not routed through here — it mints its leaf a
 * different way (from the `ensured` secrets it already holds). */
function startTradingListener(
  config: ServerConfig,
  app: Hono,
  now: () => Date,
  log: Logger,
): ReturnType<typeof serve> {
  return startListening({ ...config, tls: resolveTradingTls(config) }, app, now, log);
}

/**
 * Bind the plain-HTTP trust/landing listener (Task 3) on `config.landingPort` (default 80) — a SECOND
 * listener beside the HTTPS one, on a DIFFERENT port, so the two never conflict. It exists because a
 * phone that opens the box's HTTPS origin on an untrusted self-signed leaf hits the browser's
 * certificate interstitial BEFORE any of our JS runs, so the "download and trust the CA" page has to
 * be served over plain HTTP where the browser will actually load it (and where the CA download link
 * resolves without a trust step). It NEVER redirects and sends NO HSTS — both would strand the phone
 * back on the interstitial.
 *
 * Returns a closable handle threaded into `makeStartedServer` (so shutdown closes it too), or
 * `undefined` when there is nothing meaningful to serve:
 *   - `config.landingPort === 0` — the operator disabled it; or
 *   - `config.tls` is set — an operator-TLS box serves the operator's cert, which its devices already
 *     trust, so there is no box CA worth handing out; or
 *   - the box has no minted leaf (`mintedBoxLeaf`) — a leaf-less dev box serves plain HTTP on its main
 *     port anyway, so there is no untrusted-cert interstitial to escape.
 *
 * The last two conditions together are exactly "the box serves its own minted leaf" — the same
 * `config.tls ?? mintedBoxLeaf(...)` selection `startTradingListener` makes for the HTTPS bind, so the
 * landing page appears precisely when the HTTPS origin presents a self-signed leaf a phone must trust.
 *
 * The reach URLs and the HTTPS hand-off link it renders point at the box's OWN https origin
 * (`config.httpPort`), because that is where the visitor continues once the CA is trusted.
 *
 * Takes only the fields it reads (not the whole `ServerConfig`) so the recovery entrypoint — which
 * deliberately never runs `loadConfig`, since a broken config is what lands a box in recovery — can
 * build one from a handful of throw-free env reads (`node-entry.ts`).
 */
export type LandingListenerConfig = Pick<
  ServerConfig,
  "landingPort" | "httpHost" | "stateDir" | "httpPort" | "boxAddresses" | "tls"
>;

export function startLandingListener(
  config: LandingListenerConfig,
  log: Logger,
): { close(): Promise<void> } | undefined {
  if (
    config.landingPort === 0 ||
    config.tls !== undefined ||
    mintedBoxLeaf(config.stateDir) === undefined
  ) {
    return undefined;
  }
  const reach = buildReachInfo({
    hostname: BOX_HOSTNAME,
    port: config.httpPort,
    secure: true,
    listIpv4: () => config.boxAddresses ?? listBoxIpv4(),
  });
  const app = buildLandingApp({
    stateDir: config.stateDir,
    reachUrls: [reach.hostnameUrl, ...reach.ipUrls],
    httpsUrl: reach.hostnameUrl,
    log,
  });
  // Plain HTTP: `buildServeOptions(base, undefined)` returns `base` unchanged (tls.ts), so this binds
  // a plain-HTTP socket — the whole point, an origin the browser does not gate behind the
  // untrusted-cert interstitial.
  const server = serve(
    buildServeOptions(
      { fetch: app.fetch, port: config.landingPort, hostname: config.httpHost },
      undefined,
    ),
    (info) => log("info", "landing.listening", { port: info.port }),
  );
  // Unlike the main HTTPS listener, a landing-listener bind failure must NOT take the box down: it is
  // a convenience surface (the box still sells and serves HTTPS), and port 80 is the likeliest to be
  // taken or need a privilege the process lacks (the box image grants `cap_net_bind_service`; a
  // non-root dev host or CI runner does not, so this handler fires with EACCES on every such boot).
  // Log and carry on — the mDNS responder's own non-load-bearing posture. Without this handler, Node
  // would throw the 'error' as unhandled and crash the process.
  server.on("error", (error: NodeJS.ErrnoException) => {
    log("warn", "landing.listen_failed", {
      port: config.landingPort,
      // `code` is optional on the error TYPE, but every listen failure this can hit (EACCES,
      // EADDRINUSE, …) sets it; the fallback is type-required but unreachable in practice.
      /* v8 ignore start */
      code: error.code ?? "unknown",
      /* v8 ignore stop */
    });
  });
  return {
    // closeListener drops keep-alive sockets so this resolves — see the main listener's close below.
    close: () => closeListener(server),
  };
}

/**
 * The `StartedServer` every mode returns, with the shared `close()` sequence written once. `close()`
 * is idempotent. The mode-specific parts arrive as `teardown` (a `BootTeardown`): `stopWork` stops
 * any background work and awaits it; then, after the listeners close and in a `finally` so a
 * listener failure still reaches it, `closePools` closes the venue store (trading's backup read
 * connection is closed by `stopWork` instead). A failure to close rejects `close()`, and
 * `server.stopped` is then not logged. `mdns` is the
 * mDNS responder (inactive for development and loopback listeners); `close()` stops it FIRST — the box is
 * going down, so it must stop advertising `waitron.local` before anything else.
 */
function makeStartedServer(
  server: ReturnType<typeof serve>,
  health: HealthState,
  log: Logger,
  teardown: BootTeardown,
  mdns: MdnsResponder,
  // The plain-HTTP landing listener (Task 3), or `undefined` when none was started (disabled, or a
  // leaf-less/operator-TLS box). `close()` shuts it down alongside the main listener — a SECOND socket
  // that would otherwise leak on shutdown.
  landing: { close(): Promise<void> } | undefined,
  promote?:
    | { kind: "mirror"; run: (a: FenceAttestation) => Promise<MirrorPromotionResult> }
    | { kind: "local-secondary"; run: (a: FenceAttestation) => Promise<PromotionResult> },
): StartedServer {
  // Guards a second, LOSING concurrent `close()`: without it both calls would run the whole
  // sequence — stopping the mdns responder, the background work and the listeners a second time.
  // (The store's own `close` is separately idempotent, `packages/store/src/index.ts`, so it is this
  // guard that owns everything ABOVE it.) `bin.ts`'s own signal latch prevents two calls from a
  // signal handler today, but `close()`
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
      // before the listener and the store come apart. `stop()` is idempotent and destroys the UDP socket
      // once, so a second concurrent close() (guarded above) never double-destroys it either.
      // `.catch(() => {})`: `stop()` never rejects today (mdns.ts's own `Promise<void>` executor has
      // no reject path), but a reject here must never skip the store teardown below, so this is
      // defensive rather than a response to an observed failure.
      await mdns.stop().catch(() => {});
      // Stop this boot's background work and await it BEFORE the listener/store teardown below, so
      // close() does not leave a worker running. This await sits outside the try/finally below,
      // so a rejecting `stopWork` skips `closePools` and leaves the store open: a mode's `stopWork`
      // must not reject.
      await teardown.stopWork();
      // `finally`, not a plain sequential `await`: a rejecting `server.close()` (the listener
      // already gone — see bin.ts's own double-signal guard) must still close the store. `close()`
      // is exported on `StartedServer`, and a caller reaching for it outside `bin.ts` — a test hook
      // above all — would otherwise be left holding the store open on exactly the path that failed.
      try {
        // closeListener drops idle keep-alive sockets (then all, after a grace) so this resolves —
        // Node's server.close() otherwise waits forever on the setup page's poll connection, which
        // wedged the setup→trading self-restart (process never exited → Docker never restarted it).
        await closeListener(server);
      } finally {
        // Close the plain-HTTP landing listener too (when one was started), in the `finally` so a
        // rejecting `server.close()` above never leaks it. `.catch(() => {})` for the same reason the
        // mdns stop above swallows: a reject here must not skip the store teardown below.
        if (landing !== undefined) await landing.close().catch(() => {});
        await teardown.closePools();
      }
      log("info", "server.stopped");
    },
  };
}

/**
 * The one place the real implementations meet. Everything above is injected, so this function is
 * thin by construction. `tsc` pins every field mapping below against each callee's own signature;
 * `boot.test.ts` is this function's own test subject — calling it against a real migrated venue
 * directory (`openVenueDatabase`; `grep -c 'useRealPostgres\|Testcontainers' apps/server/src/boot.test.ts`
 * prints 0, run 2026-09-23) and asserting `onPass`'s effect on `/health`, the `minTickMs`/`maxTickMs`
 * mapping (via the logged `loop.sleeping` line, since a duty-neutral pass alone cannot distinguish a
 * swapped mapping from a correct one), both sides of the `settlementLagMs` conditional spread, and
 * `close()`'s own sequencing including its idempotency guard. `pass.db.test.ts` does NOT import this
 * file — it builds its own, separate composition of the same pieces and runs the REAL duties against
 * a migrated database; it predates `boot.test.ts` and remains evidence for the same SHAPE of wiring,
 * not a substitute for testing this function directly. The manual end-to-end boot recorded in the
 * Task 11 report (`node dist/server.js` through to a clean `/health` and a graceful `SIGTERM`)
 * remains the only evidence that the BUNDLE, not just the source, boots — `boot.test.ts` runs from
 * source, matching every other suite in this package.
 *
 * Boot failures ESCAPE, deliberately: invalid config, an unloadable key ring, a failed migration or
 * an unreachable database exit non-zero and let the supervisor decide. A host that boots
 * half-configured and retries in the background is a host whose operator believes it is working.
 */
export async function startServer(
  env: Record<string, string | undefined>,
  base: NodeJS.ProcessEnv = {},
): Promise<StartedServer> {
  const now = () => new Date();
  // Config is loaded FIRST so `config.logDir` + the rotation knobs are available when the file sink is
  // built below (the logger writes to `<stateDir>/logs` by default). A boot with invalid config still
  // escapes here (§8) before any logger, pool or listener exists.
  const config = loadConfig(env, DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT);
  const cloudOrigin = loadCloudOrigin(env);
  // The addresses this box tells the LAN to reach it on — the leaf's iPAddress SANs, the discovery
  // document's IP URLs (and the QR built from them) and the mDNS answers. One resolver, so all three
  // read the same list on any single call: the operator's `WAITRON_BOX_ADDRESSES` when set, else the
  // host's own interfaces. A container behind bridge networking holds an address no device on the
  // venue network can reach, so it needs the override; a box on the venue's own network does not.
  //
  // It does NOT keep them agreeing over time, and the difference is observable: the leaf is minted
  // ONCE and reused (`server.key` is `ensureBoxSecrets`'s presence sentinel), while discovery and
  // mDNS resolve per request. Adding or changing the override on a box that already holds
  // `<stateDir>/tls/server.key` therefore moves the QR and the mDNS answers to an address the
  // certificate does not cover — a name mismatch in the trust flow. Measured on a two-boot probe
  // against a real container. Set the override on the FIRST boot of a state dir, or discard the
  // `tls/` quartet to re-mint.
  const boxAddresses = (): string[] => config.boxAddresses ?? listBoxIpv4();
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
  //
  // The two halves are deliberately NOT filtered alike. The FILE half masks URL credentials
  // (`createRotatingFileSink` calls `redactSecrets` on every line), because the recovery page serves
  // that file's tail to anyone on the venue's LAN with no login. The STDOUT half is left whole: it is
  // the installer's channel (spec §4.4), reachable only with a shell on the box, and masking it would
  // erase the difference between a wrong password and no password at all — both render `***` — which
  // is exactly what an installer chasing a refused outbound connection has to tell apart. The
  // credentialed URLs that reach the log are the box's OUTBOUND ones now (SMTP, the mirror relay, a
  // payment provider); the box's own database is a file on its disk and carries no password, so the
  // database example this reasoning used to carry is gone with the cluster. Pinned by `recovery-surface.test.ts` → "the caught error's own words on the page",
  // which asserts both directions on one logged line.
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
  // same fail-fast-before-resources group as the `maxTickMs` guard above and BEFORE the venue store
  // is opened or migrations run: `assertBuiltApp` is a pure `existsSync` with no database dependency,
  // so a wrong or never-built dir should fail the boot LOUDLY (`server.config_invalid`, naming the env
  // var — §8's "everything escapes") before it costs a migration run or an open store, not
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
  // stop here. Its own short-lived open of the same venue directory, closed in the `finally` — the
  // long-lived store below is not opened until migrations have run, so at no point does this
  // function hold two opens of one directory at once, and `applyMigrations` takes its own file lock
  // over a directory nothing else here has open.
  const stampProbe = await openVenueDatabase(config.venueDir);
  try {
    await assertDeploymentMatches(stampProbe.venue, config.environment);
  } finally {
    await stampProbe.close();
  }

  // Migrations first, over `config.venueDir`. `applyMigrations` takes the directory's migration lock
  // and opens and closes its own store (`packages/migrations/src/apply.ts` states why both), so
  // running it BEFORE the long-lived open below keeps this boot to one open of the directory at a
  // time and leaves nothing open behind a failed migration.
  // SP-1b: the on-box `modules.json` desired set, read BEFORE the migration run — exactly when the
  // decision is needed (architecture §1.3). Read UNCONDITIONALLY (both modes need it: trading for the
  // migration filter + drift log, setup for the provisioning gate below), so a malformed file fails
  // fast, once, before the migration run (the stamp probe above has already closed).
  // Setup mode still migrates the FULL schema (the wizard needs it — SP-1a §4 "setup-migrates-all");
  // trading mode migrates only the enabled set (default: all). `enabledModules` never drops `core` —
  // it is `mandatory`, and `parseModuleConfig` refuses disabling a mandatory module.
  const moduleConfig = await readModuleConfig(config.stateDir);
  const setsToMigrate =
    config.till === undefined ? ALL_MODULES : enabledModules(ALL_MODULES, moduleConfig);
  // The wrapper only adds a log line on the way past a dev-mode failure, and re-throws untouched;
  // `dev-migration-hint.ts` states why that line is worth a seam here.
  await withDevMigrationHint(log, config.devMode, () =>
    applyMigrations(
      config.venueDir,
      migrationOptionsFor(orderedMigrationSets(setsToMigrate), config.migrationsRoot),
    ),
  );
  // The long-lived open, and the only one for the rest of this boot. `store` owns BOTH files, so
  // every teardown below closes IT; `db` is the venue handle, which is what every read and write in
  // this function names.
  const store = await openVenueDatabase(config.venueDir);
  const db = store.venue;

  // SP-1b drift visibility (spec §3): compare the enabled set against what the DB has ACTUALLY
  // migrated (derived from appliedSchemaVersion — there is no deployment column). softDisabled = a
  // module the DB carries but modules.json no longer enables; its data is kept, it is simply not
  // migrated. Logged at info so an operator sees the reconcile outcome; nothing acts on it here beyond
  // the filter above.
  //
  // The reads run on `db`, the store already open above — there is one file here and nothing to
  // choose between. They are also outside any transaction, and nothing needs them to be inside one:
  // `appliedSchemaVersion` asks `sqlite_master` whether the journal table exists rather than issuing
  // a statement it expects to be refused (`packages/migrations/src/schema-version.ts` carries the
  // measurement that decided that), so no refusal reaches this code at all.
  // SP-1b drift visibility only (the outbox schema-version park gate that once read this is gone with
  // the sync block). Computed in the trading-mode block, used solely to log `module.reconcile` drift.
  let appliedModuleVersions: Record<string, number> = {};
  if (config.till !== undefined) {
    // One sweep of every module's applied schema version, keyed by name (`schemaVersionsByModule`,
    // which the backup manifest shares); the migrated Set is derived from it (version > 0).
    const myModuleVersions = await schemaVersionsByModule(db, ALL_MODULES);
    appliedModuleVersions = myModuleVersions;
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
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" && c.req.header("x-waitron-live") === "1") {
      await withPassiveManagementRead(next);
    } else await next();
  });

  // Setup and recovery must answer unavailable before their HTML catch-all can handle this path.
  let cloudServing = () => false;
  mountCloudPublic(app, () => cloudServing());

  // Help and certificate downloads precede every mode-specific gate and SPA catch-all.
  // Machine discovery remains setup-only; the fallback CA does not certify operator TLS.
  mountDiscovery(
    app,
    {
      stateDir: config.stateDir,
      hostname: BOX_HOSTNAME,
      port: config.httpPort,
      secure:
        config.till === undefined ||
        config.tls !== undefined ||
        mintedBoxLeaf(config.stateDir) !== undefined,
      listIpv4: boxAddresses,
      discoveryEnabled: config.till === undefined,
      serveBoxCa: config.tls === undefined,
    },
    log,
  );

  if (config.till === undefined) {
    // SETUP MODE (slice 1b/2a/2b) — this box is bound to no venue (none of the four WAITRON_TILL_*_ID
    // are set). It serves ONLY `/health` and the unauthenticated setup surface: no reconciler/duty, no
    // `readOrderFlow`, no trading routes, no sync transport, and no drain/reconcile workers — there is
    // nothing to submit yet. The DB is migrated all the same (the shared prefix above ran
    // `applyMigrations`), ready for the provisioning wizard. The till/dashboard SPAs are deliberately
    // NOT mounted — they are useless without a venue; the built setup wizard IS served (slice 2c) when
    // `config.setupAppDir` is set, threaded into `mountSetup` below as its root catch-all (else the
    // inline placeholder). A Demo provision writes its sample product images into the configured
    // media store before restart; Prepare, Live, mirror and restore leave it untouched.
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
    // Guarded so a throw anywhere in this branch (`ensureBoxSecrets` on EACCES/EROFS under the state
    // dir, a missing/unreadable `secrets.env`, or `startListening` -> `buildServeOptions` ->
    // `readFileSync` on a missing/unreadable operator TLS file) closes the store before it propagates
    // — mirroring the trading branch's own `loadKeyRing` guard below. The store is open by now, and on
    // a throw path `startServer` never returns a `StartedServer`, so nothing else would ever call
    // `store.close()` and both files would stay open. The happy path is unchanged.
    try {
      const ensured = await ensureBoxSecrets({
        stateDir: config.stateDir,
        hostnames: [BOX_HOSTNAME, "localhost"],
        now,
        listIpv4: boxAddresses,
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
      const accountKey = resolveAccountKey({}, ring);
      // `writeTradingEnv` returns the path it wrote; both setup verbs only need `Promise<void>`, so
      // discard it explicitly rather than widen the dep's type. Extracted to a const so `provision`
      // and `adopt` (C2b) persist `trading.env` through the SAME writer.
      const persistTrading = async (cfg: TradingConfig): Promise<void> => {
        await writeTradingEnv(config.stateDir, {
          ...cfg,
          accountKey: cfg.accountKey ?? accountKey.toString("base64"),
        });
      };
      // What `provisioning.foreign_tenant` names when a fresh venue or a mirror adopt is pointed at
      // a database that already holds a different tenant. The venue DIRECTORY is the database now, so
      // that is the value: `WAITRON_VENUE_DIR` or its default under the state root (`config.ts`), both
      // operator-typed configuration rather than a secret, which is why it may be echoed. The name
      // the receiving side gives this — `database` — is unchanged.
      const ownerDatabaseName = config.venueDir;
      // The setup surface, now with the slice-2b provisioning deps bound. `db`/`ring` are handed to
      // the fiscal contribution's provisioning-secret seal seat (so boot imports no regime);
      // `persistTrading` writes `<stateDir>/trading.env`; `requestRestart` SIGTERMs this process so the
      // supervisor restarts it into trading mode (`bin.ts`'s latch does the graceful shutdown).
      // `adopt` is the MIRROR-side sibling (C2b): it fetches the primary's bundle over real HTTP
      // (`fetchMirrorBundle`) and adopts the venue into this box's own database, reusing the SAME
      // `db`/`ring`/`persistTrading` the provision path wires. The `*` catch-all inside `mountSetup`
      // stays terminal and last, so the POST routes (registered before it) are not shadowed.
      mountSetup(
        app,
        {
          environment: config.environment,
          devMode: config.devMode,
          operations: createSetupOperationStore(config.stateDir),
          stageRestore: (request) =>
            stageRestoreRequest(config.stateDir, request, async (candidate) => {
              await validateArtifact({
                artifact: candidate.artifact,
                recoveryKey: candidate.recoveryKey,
                stateDir: config.stateDir,
                stagingDir: join(config.stateDir, "restore-staging"),
                migrationsRoot: config.migrationsRoot,
                modules: ALL_MODULES,
                environment: candidate.environment,
              });
            }),
          stageConfiguration: (artifact, passphrase) =>
            stageConfigurationImport(
              config.stateDir,
              ring,
              artifact,
              passphrase,
              async (bundle) => {
                const resolvedConfig = venueModuleConfig(
                  moduleConfig,
                  bundle.venue.location.fiscalTerritory,
                );
                const modules = enabledModules(ALL_MODULES, resolvedConfig);
                validateConfigurationBundle(
                  bundle,
                  modules,
                  await schemaVersionsByModule(db, modules),
                );
              },
            ),
          clearConfiguration: () => clearStagedConfigurationImport(config.stateDir),
          runFiscalTest: async ({ request, contribution, secret }) => {
            const resolvedConfig = venueModuleConfig(
              moduleConfig,
              request.venue.location.fiscalTerritory,
            );
            const modules = enabledModules(ALL_MODULES, resolvedConfig);
            const moduleVersions = await schemaVersionsByModule(db, modules);
            const input = fiscalReadinessInput({
              venue: request.venue,
              contribution,
              secret,
              moduleVersions,
              applicationVersion:
                process.env.WAITRON_BUILD_ID ?? process.env.npm_package_version ?? "development",
            });
            return createFiscalReadinessStore(
              config.stateDir,
              () =>
                submitFiscalReadiness({
                  stateDir: config.stateDir,
                  migrationsRoot: config.migrationsRoot,
                  modules,
                  venue: request.venue,
                  contribution,
                  secret,
                  ring,
                  readinessInput: input,
                }),
              ring.current.key,
            ).run(input);
          },
          assertFiscalReady: async ({ request, contribution, secret }) => {
            const resolvedConfig = venueModuleConfig(
              moduleConfig,
              request.venue.location.fiscalTerritory,
            );
            const modules = enabledModules(ALL_MODULES, resolvedConfig);
            const moduleVersions = await schemaVersionsByModule(db, modules);
            await createFiscalReadinessStore(
              config.stateDir,
              async () => "uncertain",
              ring.current.key,
            ).assertReady(
              fiscalReadinessInput({
                venue: request.venue,
                contribution,
                secret,
                moduleVersions,
                applicationVersion:
                  process.env.WAITRON_BUILD_ID ?? process.env.npm_package_version ?? "development",
              }),
            );
          },
          // Resolve the fiscal slot from the REQUEST's territory (authoritative, §4): the box's
          // `moduleConfig` base is default-on, which with two fiscal-slot members would be ambiguous;
          // `venueModuleConfig` forces exactly the territory's fiscal module on before provisionVenue's
          // gate/slot check runs and before it persists the set to `<stateDir>/modules.json`.
          provision: async (req) => {
            const resolvedConfig = venueModuleConfig(
              moduleConfig,
              req.venue.location.fiscalTerritory,
            );
            const modules = enabledModules(ALL_MODULES, resolvedConfig);
            const staged = req.configurationImport
              ? await readStagedConfigurationImport(config.stateDir, ring)
              : null;
            if (req.configurationImport && staged === null) {
              throw new AppError("setup.request_invalid", { field: "configurationImport" });
            }
            if (
              staged !== null &&
              (staged.bundle.venue.country !== req.venue.country ||
                staged.bundle.venue.taxId !== req.venue.taxId)
            ) {
              throw new AppError("setup.request_invalid", { field: "configurationImport" });
            }
            const versions =
              staged === null ? undefined : await schemaVersionsByModule(db, modules);
            const result = await provisionVenue(
              {
                ownerDb: db,
                moduleConfig: resolvedConfig,
                database: ownerDatabaseName,
                stateDir: config.stateDir,
                ...(staged === null
                  ? {}
                  : {
                      beforeCommit: async (tx, result) => {
                        await importConfigurationTables(
                          tx,
                          staged.bundle,
                          { locationId: result.locationId },
                          modules,
                          versions!,
                        );
                      },
                    }),
              },
              req,
            );
            return result;
          },
          recoverProvision: async (req) => {
            const result = await recoverProvisionedVenue(db, req);
            return result;
          },
          seedDemo: (result, req) => seedInstalledDemo(db, result, req.venue),
          adopt: (req) =>
            adoptFromPrimary(
              {
                ownerDb: db,
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
                database: ownerDatabaseName,
              },
              req,
            ),
          establishIdentity: (nodeId) => establishNodeIdentity({ ownerDb: db, ring }, nodeId),
          seedMembership: (nodeId) =>
            seedTermZeroMembership({ db, ring }, nodeId, config.advertisedOrigin),
          // The venue file + vault ring the setup surface seals the regime's provisioning secret
          // with, through the fiscal contribution's `provisioningSecret.seal` seat — so BOOT imports no
          // regime package (module-seams). The seal fires only for a provision whose regime demands
          // a secret (Veri*Factu: a production provision's AEAT cert).
          db,
          ring,
          persistTrading,
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
      // Start discovery after the throwing setup steps so a failed boot cannot leak its socket.
      // The responder skips development and loopback listeners; close() owns its teardown.
      const mdns = startMdnsResponder({
        hostname: BOX_HOSTNAME,
        devMode: config.devMode,
        httpHost: config.httpHost,
        getAddresses: boxAddresses,
        log,
      });
      return makeStartedServer(
        server,
        health,
        log,
        {
          // A setup box runs no background work, so there is nothing to abort or await.
          stopWork: () => Promise.resolve(),
          // The venue directory's two files, which `store.close()` closes together — a setup box
          // opens nothing else.
          closePools: () => store.close(),
        },
        mdns,
        // The plain-HTTP trust/landing listener (Task 3): a setup box serves its own minted leaf,
        // so a phone can trust the CA from this page before hitting the HTTPS interstitial. Started
        // AFTER the HTTPS bind above, on a different port; `undefined` when disabled or leaf-less.
        startLandingListener(config, log),
      );
    } catch (error) {
      // mDNS is not started until just before `makeStartedServer` below (after every throwing step in
      // this branch), so a throw reaching here never opened the UDP socket — only the store needs
      // closing.
      await store.close();
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
  // closes the store before it propagates. The store is open by now, and on the throw path
  // `startServer` never returns a `StartedServer`, so nothing else would ever call `store.close()` and
  // both files would stay open. This mirrors the `stampProbe` try/finally in the shared prefix above;
  // the happy path is unchanged. (The `readOrderFlow`/`buildCardProvider` throw sites below leave the
  // store open the same way and are out of scope here.)
  let ring: ReturnType<typeof loadKeyRing>;
  try {
    ring = loadKeyRing(env);
  } catch (error) {
    // mDNS is not started until just before `makeStartedServer` (after every throwing setup step), so a
    // `loadKeyRing` throw here never opened the UDP socket — only `db` needs closing. The pre-existing
    // `readOrderFlow`/`buildCardProvider` throw sites further down still leak `db` the same way and stay
    // out of scope here (they leaked `db` before slice 3 too — documented above).
    await store.close();
    throw error;
  }
  const accountKey = resolveAccountKey(env, ring);
  const totpKeyRing = {
    current: { version: 1, key: accountPurposeKey(accountKey, "totp") },
  };

  // Adoption-pending boot (C6): an adopted mirror's reserved standby identity is DORMANT — adopt
  // records a latch instead of establishing it — and EVERY boot retries that step. None can complete
  // it today, so a box that has adopted stays in this mode: `finish-adoption.ts`'s `PendingAdoption`
  // header is the one place that says why, and `docs/backlog.md` carries it as an operator-visible
  // consequence. In this mode boot serves `/health` and a minimal `/api/box/status` reporting
  // `adoption: pending`: it reads no deployment axes / membership and mounts no mirror session and no
  // till/node-scoped read path, and nothing in this branch restarts the box. Entered BEFORE the axes
  // read below.
  const pendingAdoption = await readPendingAdoption(config.stateDir);
  if (pendingAdoption !== null) {
    // The only status surface an adoption-pending box serves — unauthenticated (no ambient viewer
    // exists yet) and deliberately minimal, distinct from the full `mountBoxStatusApi` shape.
    app.get("/api/box/status", (c) => c.json({ adoption: "pending" }, 200));
    const finishWorker = runFinishAdoption({
      ownerDb: db,
      ring,
      stateDir: config.stateDir,
      modules: setsToMigrate,
      log,
    });
    // A settle-by-rejection before close() must not become a process-level unhandled rejection — log
    // it the `codeOf`-classified way the sync/backup workers below do (runFinishAdoption swallows its
    // own faults, so this only ever fires under an unexpected escape).
    finishWorker.catch((err) =>
      log("error", "adoption.worker_rejected", { errorCode: codeOf(err) }),
    );
    // The adoption-pending listener serves trading, so it takes the box's own minted leaf via the
    // shared fallback (see `startTradingListener`) — without it this bind spoke plain HTTP and every
    // already-trusting phone/till hit a TLS handshake error after setup.
    const server = startTradingListener(config, app, now, log);
    const mdns = startMdnsResponder({
      hostname: BOX_HOSTNAME,
      devMode: config.devMode,
      httpHost: config.httpHost,
      getAddresses: boxAddresses,
      log,
    });
    return makeStartedServer(
      server,
      health,
      log,
      {
        stopWork: async () => {
          await finishWorker.catch(() => {});
        },
        closePools: () => store.close(),
      },
      mdns,
      // The plain-HTTP trust/landing listener (Task 3) — an adoption-pending box serves trading over
      // its own minted leaf, so a phone can still trust the CA from this page.
      startLandingListener(config, log),
    );
  }

  try {
    assertSingleOperationalVenue(await readOperationalVenueIds(db), config.till.locationId);
  } catch (error) {
    await store.close();
    throw error;
  }

  // Which role this database plays (C2a design §4). Nothing gets here as a `mirror` today: the one
  // production write of `mode='mirror'` (`adoptFromPrimary`, `adopt.ts`) records the adoption-pending
  // latch in the same call, and the branch above returns while that latch is set. What the code below
  // does when a mirror does get here: it boots behind the read-only gate and an ambient viewer
  // session, both mounted below — `read-only-gate.ts` refuses a CLIENT'S non-safe HTTP
  // VERB bar its named exemptions, which is narrower than "no writes": the viewer's own keepalive
  // writes inside a GET, and the promote POST is exempt by name. Nothing copies the venue's rows onto
  // a mirror; `mirror-bundle.ts`'s header says what the deleted replication used to supply and that no
  // replacement has landed. A primary is today's flow.
  // Read ONCE here into a refreshable holder that both promote actions refresh after their
  // write (design §10; the refresh is in promote.ts). `promoteLocalSecondaryToPrimary` never
  // changes the mode, so its refresh leaves this holder at 'primary'. What flips this node's
  // `node_roles.mode` to 'primary' is `promoteMirrorToPrimary` (promote.ts, spec §5b). The store
  // is already open, so this read is free.
  // The singleton-ownership axis (promotion runbook design §2), read into its own refreshable holder
  // beside the mode holder: a 'secondary' node (a mirror OR a sell-only local secondary) runs no fiscal
  // duties; only a 'primary' drains/reconciles. Read PER PASS below, and each promote action DOES flip
  // this holder: after writing singleton_role='primary' it refreshes both holders. After a local-secondary
  // promote the fiscal pass starts on the next tick with no restart (promotion runbook design §3b/§3c);
  // a mirror promote restarts the process into `mode=primary` (`promoteMirrorRun`, below).
  // Both axes from ONE read of the one row, so the initial holder pair is never torn — the same thing
  // `refreshDeploymentHolders` relies on: two separate reads could straddle a concurrent promotion and
  // yield an impossible `(mirror, primary)` pair.
  // Membership rejoin R1 (design §6): a returned ex-primary that holds a superseding document marking
  // it sell-only/evicted must come up FENCED, not as the primary its saved axes still claim. The held
  // document is authority above the persisted axes (wire-protocol §8), and the reconciliation is
  // DEMOTE-ONLY — it can never self-promote. Read UNVERIFIED: the row was verified when adopted
  // (its acceptance path) or self-signed at promotion, so reading our own authoritative state back
  // needs no re-verify, exactly as the deployment axes are trusted.
  const initialAxes = await readDeploymentAxes(db, config.till.nodeId);
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
      peer = await readMirrorConfig(db, config.till.nodeId);
    } catch (error) {
      await store.close();
      throw error;
    }
    if (peer !== null) {
      try {
        const [trustSet, held] = await Promise.all([
          readMembershipTrustSet(db),
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
          // trust chain, then strictly-newer against the held term), persisting through the
          // term-guarded writer only when it accepts. Persist-if-accepted, so a newer verified chart is
          // held even when it does not fence this node.
          acceptDocument: async (incoming, currentTerm) => {
            const result = acceptMembershipDocument(incoming, currentTerm, trustSet);
            if (result.accepted) await persistNodeMembershipIfNewer(db, incoming);
            return result;
          },
          log,
        });
      } catch (error) {
        await store.close();
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
    // Demote the singleton axis. Idempotent: a second fenced boot already reads 'secondary' and
    // skips. mode stays 'primary' — the (primary, secondary) pair is valid
    // (node_roles_role_valid_ck); the read-only gate below, not the mode, enforces the fence. This
    // stops the submitter/reconciler/config-writer via their existing isSingletonPrimary gates with
    // no worker-gating code change.
    // Close the store on ANY throw before rethrowing, matching the loadKeyRing / mirror-guard
    // close-on-throw discipline in this region: startServer never returns on the throw path, so nothing
    // else would call `store.close()`.
    const ownNodeId = config.till.nodeId;
    try {
      await withTransaction(db, async (tx) => {
        await setSingletonRoleTx(tx, ownNodeId, "secondary");
      });
    } catch (error) {
      await store.close();
      throw error;
    }
    // Re-read rather than synthesize `{ ...axes, singletonRole: "secondary" }`: the demote wrote only
    // singleton_role, and re-reading takes BOTH axes from one read of the current row, so `mode`
    // cannot be stale if something flipped `node_roles.mode` in the window since the initial read.
    // One extra query on the rare fenced path, bought for that freshness (Copilot #214 re-review).
    axes = await readDeploymentAxes(db, config.till.nodeId);
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
  // The primary-only SINGLETON duties below (scheduled backup, outbound tunnel client, and the
  // fiscal drain/reconcile pass) gate on THIS, not on `isMirror`: they must run on the ONE
  // `singleton_role='primary'` node, never on every non-mirror node (promotion runbook design
  // §2/§3c — the same axis `singletonPass` already gates the fiscal drain/reconcile pass on, #158).
  // The bug this fixes: a SELL-ONLY LOCAL SECONDARY (`mode='primary'`,
  // `singleton_role='secondary'`) is NOT a mirror, so the old `!isMirror` gate ran them on it too —
  // a second node dialing the one outbound tunnel and writing scheduled backups, duplicating the
  // primary (active-active). Because `node_roles_role_valid_ck` rejects `(mirror, primary)`,
  // `singleton_role='primary'` already implies `mode='primary'`, so this predicate alone is correct
  // and a mirror is always 'secondary'.
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
  // same way the `loadKeyRing` guard above does rather than leaving the store open.
  try {
    assertMirrorBindSafe(config, isMirror, env);
  } catch (error) {
    await store.close();
    throw error;
  }
  // Resolve the trading transport once so the mirror's ambient session and every mounted login
  // surface agree with the listener about whether cookies require HTTPS.
  const secureCookies = resolveTradingTls(config) !== undefined;
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
    let viewerToken: string;
    try {
      viewerToken = await ensureMirrorViewer(db);
    } catch (error) {
      await store.close();
      throw error;
    }
    app.use(
      "*",
      mirrorSession(db, secureCookies, () => holders.mode.current, viewerToken),
    );
  } else {
    try {
      await endMirrorViewer(db);
    } catch (error) {
      await store.close();
      throw error;
    }
  }

  // The node whose DATA this server DISPLAYS in its node-scoped read paths (report-api's per-till/fiscal
  // reports). On a PRIMARY it is the node's own id; on a MIRROR it is the ORIGIN — the primary it was
  // adopted from — because the venue's sales keep that primary's node_id, so scoping by the mirror's
  // own id would return nothing. (A mirror holds none of those rows today, `mirror-bundle.ts`'s header
  // says why; the origin is still what its reads must be scoped to.) Distinct from
  // `config.till.nodeId`, which stays the node's OWN identity for every WRITE path (membership
  // promotion R3a). The origin is read from
  // `mirror_config` (written at adopt), NEVER from env. A mirror REQUIRES it: an absent
  // record is a loud `server.config_invalid` (fail-closed). Wrapped in the same db-cleanup guard the
  // `loadKeyRing` load above uses, so a throw closes the store rather than leaving it open. Hoisted ABOVE the
  // mounts because `mountReportApi` needs `dataNodeId`.
  let dataNodeId: string = config.till.nodeId;
  if (isMirror) {
    try {
      const loaded = await readMirrorConfig(db, config.till.nodeId);
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
      await store.close();
      throw error;
    }
  }

  // The live change feed installs its triggers as DDL. That ran on its own connection while the
  // engine had roles to choose between; there is one file and one handle now, so it runs on `db`.
  const liveEvents = new LiveEvents();
  const changeSources = setsToMigrate.flatMap((module) => module.changes ?? []);
  try {
    await installChangeFeed(db, changeSources);
  } catch (error) {
    await store.close();
    throw error;
  }
  mountLiveApi(
    app,
    {
      db,
      bus: liveEvents,
      resourceTypes: liveResourceTypes(changeSources),
    },
    log,
  );

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
  // The media module serves `/media/*`, OUTSIDE `/api/*`, but §3.4 lists it
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
  // `secureCookies` tracks the resolved trading transport: operator TLS or a persisted box leaf makes
  // every session cookie `Secure`; a leaf-less loopback development host keeps an HTTP-usable cookie.
  // Mounting registers routes only — no database work happens here, so a till pointed at an
  // unprovisioned tenant fails per-request (via `run`), never at boot.
  // The till's pay-timing mode is a per-LOCATION column, not an env var, so `config.till` (from
  // `tryLoadTillConfig`) carries every fiscal id but NOT `orderFlow`. Read it here, ONCE, now that the
  // store is open, and spread it in to form the full `TillConfig` the routes dispatch on — the merge
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
  const till: TillConfig = {
    ...config.till,
    orderFlow,
    practiceMode: config.onboardingIntent === "demo" || config.onboardingIntent === "prepare",
  };
  // The venue's DEFAULT UI locale, derived ONCE now the store is open — the DISPLAY counterpart to the
  // fiscal `till.locale`/`invoiceLocales` (left untouched). `readVenueLocale` applies the shared
  // `override → province → country → English` chain, reading the tenant's country + the location's
  // province. The override is the RAW `WAITRON_TILL_LOCALE` (`till.localeOverride`),
  // NOT the defaulted `till.locale` (which is `es-ES` and would mask geography). Threaded as a STRING
  // into the till + me mounts below (both surface it via `GET .../locales`), never re-read per request.
  const venueLocale = await readVenueLocale(db, {
    locationId: till.locationId,
    override: till.localeOverride,
  });
  const venueTimeZone = await readVenueTimeZone(db, {
    locationId: till.locationId,
  });
  // Demo and the default Prepare target use the local simulator. Every other card sale routes to its
  // reader's own provider through `cardPool` below (built once, one live provider per id), so a
  // live/integration till gets `undefined` here.
  const cardProvider = await buildCardProvider(
    db,
    config.onboardingIntent,
    config.paymentTestProviders,
  );
  // The card-provider POOL, built ONCE for this tenant/node (one live provider per id, rebuilt on a
  // credential change via `evict`). It reaches a seat only through `CARD_PROVIDERS`, the composition
  // list, so `boot.ts` names no provider package for this path. Built HERE, before `mountTillApi`, so
  // the pay route (`POST /api/pay`) can resolve each sale's reader through it; the payments MANAGEMENT
  // surface below reuses the SAME instance (never a second pool), so a reader added there and a sale
  // driven here share one cache and one eviction. Cheap and DB-free at construction (just a Map + the
  // seat closures), so building it on a mirror/fenced boot too costs nothing — those boots never reach
  // a sale.
  const cardPool = createCardProviderPool({
    providers: CARD_PROVIDERS,
    db,
    ring,
    nodeId: till.nodeId,
    environment: config.environment,
    incidents: recordIncidentOnce,
  });
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
      pool: cardPool,
      providers: CARD_PROVIDERS,
      venueLocale,
      onboardingIntent: config.onboardingIntent,
      devMode: config.devMode,
    },
    log,
  );
  // The public role probe a till polls to follow the venue's primary across a failover
  // (till-reroute §3.1). Mounted on every trading boot, not in setup: "not accepting sales" from a
  // mirror or a fenced node is the answer that steers a till away, so those boots must answer it
  // too. `!fencedOrMirror` is redundant while `node_roles_role_valid_ck` rejects (mirror, primary)
  // and the fence above demotes the singleton axis; kept so the probe refuses if either stops.
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
  // On-node print-agent self-enrol (design §1.1). Mounted on EVERY trading boot beside the probe —
  // deliberately OUTSIDE the `!fencedOrMirror` block, so a mirror/fenced node carries the route too. On
  // such a node the read-only gate refuses the POST with `node.read_only` BEFORE the route's `isPrimary`
  // check runs; `isPrimary` (false here) is the defensive `node.enrol_unavailable` refusal for a
  // non-primary node the read-only gate does not cover. Either refusal makes the agent fall back to the
  // manual path (spec §2). Loopback-gated inside; `isPrimary` is the probe's `acceptingSales` predicate.
  mountNodeEnrolApi(
    app,
    { db, cfg: till, nodeId: till.nodeId, isPrimary: isSingletonPrimary && !fencedOrMirror },
    log,
  );
  // The operational agent/device groups — NOT mounted under mirror mode, and NOT on a FENCED node.
  // These are the whole operational surface (the agent pull/report + the device station/session), dropped
  // on a read-only node for the tighter read-only-mirror posture: on a mirror their routes are ABSENT
  // (404), where before this guard existed the read-only guarantee rested only on their backing tables
  // (`print_*`, `devices`) being unprovisioned. The agent pull (`POST /print-api/agent/jobs`, whose
  // `claimPrintJobs` is a locking UPDATE — packages/printing/src/runtime.ts) and the device writes are all
  // non-safe verbs the read-only gate (`read-only-gate.ts`) already refuses, so un-mounting is
  // belt-and-braces for the writes; its real value is denying the whole operational surface, including any
  // safe-verb read the groups expose (e.g. `GET /print-api/agent/join/status`). (The pull was a
  // write-behind-a-GET before the central-printer inventory work moved it to POST; the mount guard's
  // rationale no longer hinges on that.) A mirror provisions none of those tables anyway, so it loses
  // nothing by their absence; a primary mounts both. This guard skips route REGISTRATION only — every
  // shared boot value (`till`, `secureCookies`) is built above and read by the sibling mounts, so nothing
  // downstream depends on these mounts having run.
  // FENCED (membership rejoin R1): a returned/superseded node comes up `mode='primary'` (so `isMirror`
  // is FALSE) but must be FULLY read-only. The verb gate would refuse the pull's POST there, but to deny
  // the whole operational surface (its safe-verb reads included) a fenced node un-mounts this surface for
  // the SAME reason a mirror does — hence `!isMirror && !fenced`. The `fenced` local is the boot-captured
  // decision (a fenced node leaves the fence only by a fresh boot), the same value the read-only gate reads.
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
    // which pass only what they read — the FULL `till` config `mountTillApi` receives above, because
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
    // The ADMIN side of joining, on the SAME app: the venue's pairing-window control, and the pending
    // requests both surfaces raise (list, challenge, deny — each gated on the permission the ROW's kind
    // demands — plus BOTH per-surface accepts, device and print agent). It takes the SAME `pairingMode` holder the device mount above
    // received, which is what makes the window venue-wide, and the same full `till` config, because the
    // accept verb is typed `cfg: TillConfig`. Routes only — no database work at boot; the management
    // gate runs per request.
    mountJoinApi(app, { db, cfg: till, pairingMode }, log);
    // The printing subsystem's HTTP surface on the SAME app, the identical three-group convention: the
    // UNAUTHENTICATED knock + status (`POST /print-api/agent/join`, `GET /print-api/agent/join/status`
    // — join through the shared join_requests mechanism a device uses), the `requireAgent`-gated agent
    // group (claim this agent's queued jobs, report each result — the claim commits within the request,
    // holding no lock across the agent's push, design §3c/Ruling 6; the pull also carries the venue's
    // node id + routable servers) and the `printer.manage`-gated management group (list/revoke agents,
    // printers CRUD, recent jobs). It passes `till` verbatim (the same FULL `TillConfig` `mountTillApi`
    // and `mountJoinApi` receive), the SAME `pairingMode` holder the device + join mounts share (so the
    // venue's one window admits the agent knock too), and `readNodeMembership` for the pull's server
    // list. No `secureCookies` (the agent uses a Bearer token, the management group the shared management
    // session). Routes only — no database work at boot.
    mountPrintApi(
      app,
      { db, cfg: till, readMembership: () => readNodeMembership(db), pairingMode, venueLocale },
      log,
    );
    // The card-payments MANAGEMENT surface on the SAME app (design Phase C): connect/disconnect a
    // provider, add/retire readers, and set a device's default reader — all `payments.manage`-gated.
    // It reuses the SAME `cardPool` the pay route received above (built once before `mountTillApi`), so
    // a reader added or a credential rotated here evicts the exact provider the next sale rebuilds —
    // never a second pool with its own stale cache. Not mounted under mirror/fenced mode, the sibling
    // operational surfaces' rule.
    mountPaymentsApi(
      app,
      {
        db,
        cfg: till,
        ring,
        environment: config.environment,
        pool: cardPool,
        providers: CARD_PROVIDERS,
      },
      log,
    );
  }
  // The deployment holds one taxpayer per database. The dashboard's management HTTP surface
  // (manager login, staff/person management, passkey ceremonies) on the SAME app, the identical
  // convention `mountWebhook` and `mountTillApi` above follow. It reuses the EXACT values
  // `mountTillApi` receives so the two cannot drift: the same `db` and the same `secureCookies`
  // binding hoisted above (one value, read by both mounts — not a re-typed
  // `config.tls !== undefined`). No fiscal backend, clock or card provider: the management routes
  // read and write only this box's own identity records.
  // `rpId`/`origin` are the passkey Relying Party config from `loadConfig` — a passkey is bound
  // to its RP ID + origin, so these are config, never hardcoded (spec §4c). Routes only — no
  // database work at boot.
  const resolveAccountEmail = () =>
    resolveEmailDelivery(db, ring, config.devMode || till.practiceMode === true);
  mountLocationSettingsApi(app, { db, cfg: till, fiscal: enabledFiscal }, log);
  mountManagementApi(
    app,
    {
      db,
      cfg: { nodeId: till.nodeId },
      // The venue's own config (its location) the FP-1 zone/table config routes scope to — the
      // SAME `till` config `mountTillApi` receives above, so the dashboard "Sala" surface and the till
      // surface CRUD the same `floor_zones`/`dining_tables` under one location. Only `locationId` is
      // read there (the fiscal ids are inert — these are config routes touching no fiscal path).
      venueCfg: till,
      secureCookies,
      rpId: config.managementRpId,
      origin: config.managementOrigin,
      googleOidc: config.googleOidc,
      venueLocale,
      privacyNoticeUrl: config.privacyNoticeUrl,
      accountActionCodeKey: accountPurposeKey(accountKey, "account-action-code"),
      credentialKeyRing: totpKeyRing,
      // Resolve on every send so a newly configured or rotated SMTP gateway takes effect immediately.
      // Configured SMTP wins; practice/dev falls back to the loopback-only Mailpit service.
      sendAccountEmail: async (message) => {
        const delivery = await resolveAccountEmail();
        if (delivery.mode === "unconfigured") throw new Error("account email is not configured");
        await createAccountEmailSender({ ...delivery.smtp, timeZone: venueTimeZone })(message);
      },
    },
    log,
  );
  if (config.onboardingIntent === "prepare") {
    mountConfigurationExportApi(
      app,
      {
        db,
        cfg: {
          locationId: till.locationId,
          tillId: till.tillId,
          nodeId: till.nodeId,
        },
        modules: setsToMigrate,
        moduleVersions: appliedModuleVersions,
      },
      log,
    );
  }
  mountEmailInboxApi(
    app,
    {
      db,
      resolveMode: async () => (await resolveAccountEmail()).mode,
      mailpit: createMailpitClient("http://127.0.0.1:8025"),
    },
    log,
  );
  // The deployment holds one taxpayer per database. The dashboard's diagnostics surface (read the
  // recent log tail, read + raise verbosity) on the SAME app, the identical convention. It reuses
  // the EXACT `db` `mountManagementApi` above receives, plus the
  // `reader` over the rotating files and the in-memory `verbosity` controller the logger reads.
  // All three routes are gated behind `diagnostics.view`. Routes only — no database work at boot;
  // the gate runs per request.
  mountDiagnosticsApi(app, { db, reader, verbosity }, log);
  // The dashboard alerts surface is mounted lower down, once `backupSupervisor` exists — the backups
  // alert source closes over it. See the `mountAlertsApi` call beside the other management-api mounts.
  // Catalogue writes and language settings share the management permission gate.
  mountCatalogueApi(
    app,
    {
      db,
      // The venue the product editor routes a product's station/course against.
      venueCfg: till,
      contentTranslationGaps: async (tx, language) => {
        const gaps = [];
        for (const module of setsToMigrate) {
          if (module.contentTranslations)
            gaps.push(...(await module.contentTranslations.gaps(tx, language)));
        }
        return gaps;
      },
      venueLocale,
    },
    log,
  );
  mountUnitsApi(app, { db, venueLocale }, log);
  // The deployment holds one taxpayer per database. The dashboard's gated purchase-invoice write
  // group (facturas recibidas: header + VAT desglose) on the SAME app, the identical convention.
  // Reuses the EXACT `db` `mountCatalogueApi` above receives so the
  // two cannot drift. No `nodeId` (the purchase tables carry no sync-capture trigger), no fiscal
  // backend, clock, card provider or media store — these routes touch only the two
  // purchase-invoice tables. Routes only — no database work at boot; the `purchase.manage` gate
  // runs per request. This is the #91 fast-follow's capture surface, feeding the headless modelo
  // 303 IVA-deducible reporting.
  mountPurchasingApi(app, { db }, log);
  // Mount every ENABLED module's routes generically (SP1). `setsToMigrate` is the enabled module
  // set on this trading branch (boot.ts:552), so a module toggled off mounts nothing — no
  // hand-written guard at the mount site. `routeCtx` binds cfg to the one `TillConfig` field a
  // module route reads (`locationId`); `core.openTab` closes over the FULL `till` HERE,
  // so `nodeId`/`tillId` never enter the module's cfg. Bookings is the first `*-api.ts` behind the
  // seat; the other `mount*Api` calls stay as they are.
  const routeCtx: ModuleRouteContext = {
    db,
    cfg: {
      locationId: till.locationId,
      contentDefaultLanguage: venueLocale,
    },
    maxUploadBytes: MAX_UPLOAD_BYTES,
    core: { openTab: (tx, req) => openTab(tx, till, req) },
  };
  for (const m of setsToMigrate) m.routes?.mount(app, routeCtx, log);
  // The deployment holds one taxpayer per database. The dashboard's gated reporting surface on the
  // SAME app, the identical convention. Reuses the EXACT `db`
  // `mountPurchasingApi` above receives so the two cannot drift. `nodeId` here is `dataNodeId` —
  // the node whose DATA this server DISPLAYS, not its own identity: on a MIRROR that is the
  // ORIGIN (the primary it was adopted from, whose node_id the venue's sales carry), so the
  // per-till/fiscal reports (daily-close view, period, cash-up, VAT, overdue) scope to the venue's
  // data rather than the mirror's own empty node (membership promotion R3a); on a primary it is the
  // own id. The `/reports/overview` route ignores it entirely and aggregates the WHOLE venue (all
  // nodes), and
  // the modelo 303 export is likewise tenant-wide. No fiscal backend, card provider or media
  // store — READ-ONLY routes over the filed commercial record + the venue's dining tables. Routes
  // only — no database work at boot; the `report.export`/`report.view` gates run per request,
  // SELECTs only.
  mountReportApi(app, { db, cfg: { nodeId: dataNodeId } }, log);
  // The deployment holds one tenant per database. The dashboard's gated shift-planning surface
  // (roster authoring + publish) on the SAME app, the identical convention. Reuses the EXACT db and
  // this node's id; no fiscal backend, clock, card provider or media store — these routes
  // touch only roster_versions / shifts / convenio_config / locations. Routes only; the
  // schedule.manage gate runs per request.
  mountWorkforceApi(app, { db, cfg: { nodeId: till.nodeId } }, log);
  // The STAFF-FACING half of the schedule surface on the SAME app — the till-session-gated request
  // routes (view my shifts/swaps/absences, request a swap or absence, accept a swap offered to me),
  // the counterpart to mountWorkforceApi's manager approval half. Minimal deps — `db` alone; the till
  // PIN session gates it (requireSession), not a management session. Routes only.
  mountScheduleApi(app, { db }, log);
  // The STAFF SELF-SERVICE half of the management dashboard on the SAME app — the browser twin of the
  // till's mountScheduleApi. Its whoami (`GET /management-api/session/me`) + `/management-api/me/schedule/*`
  // routes gate on the MANAGEMENT session (requireManagementSession + resolveManagementSession), never
  // authorizeManager, so a staff-role person acts on their own roster/swaps/absences. Minimal deps —
  // `db` plus this node's id; no fiscal backend, clock or card provider. Routes only.
  mountMeApi(
    app,
    // `modules` is the enabled-module set (`setsToMigrate`, boot.ts above) by name — surfaced by
    // `GET /session/me` so the dashboard activates and shows only enabled modules. Includes `core`
    // harmlessly (the browser registry only matches UI-bearing ids).
    {
      db,
      cfg: { nodeId: till.nodeId },
      venueLocale,
      onboardingIntent: config.onboardingIntent,
      modules: setsToMigrate.map((m) => m.name),
      credentialKeyRing: totpKeyRing,
      accountActionCodeKey: accountPurposeKey(accountKey, "account-action-code"),
      accountActionBaseUrl: `${config.managementOrigin}/`,
      privacyNoticeUrl: config.privacyNoticeUrl,
      sendAccountEmail: async (message) => {
        const delivery = await resolveAccountEmail();
        if (delivery.mode === "unconfigured") throw new Error("account email is not configured");
        await createAccountEmailSender({ ...delivery.smtp, timeZone: venueTimeZone })(message);
      },
    },
    log,
  );
  // The backup duty's lifecycle owner (BR-1 Task 4). It re-reads the box-env files from DISK on every
  // `reload()` (so the wizard's `backup.env` takes effect without a restart), opens the venue
  // directory on its OWN connection — not this one — and starts the sweep ONLY on a singleton
  // primary. A venue it cannot open, or a non-primary role, leaves backup off and is logged, never
  // stopping sales (§5). What its own handle buys, and what it USED to buy and no longer does now
  // that the store opens a read connection per file, are both in `backup-supervisor.ts`'s header.
  // Provenance and the disk re-read both read the RAW `base`
  // env, not the merged `env`, so a file-sourced value is distinguishable from an env-sourced one
  // (spec §3.2).
  // The in-process record of each backup destination's last sweep outcome. The sweep the supervisor
  // starts fills it and the backups alert source (assembled just below, once the supervisor exists)
  // reads this same holder — so both refer to one map. It is process-lived and empty until the first
  // sweep tick after boot.
  const backupOutcomes: BackupOutcomeHolder = { failed: new Map() };
  const readRecoveryKey = async (): Promise<string | undefined> =>
    loadRecoveryKey(await loadBoxEnv(base, config.stateDir));
  const backupSupervisor = new BackupSupervisor({
    buildConfig: async () => loadBackupConfig(await loadBoxEnv(base, config.stateDir)),
    isManagedByEnvironment: () => BACKUP_ENV_KEYS.some((k) => !isUnset(base[k])),
    readSingletonRole: () => holders.singletonRole.current,
    venueDir: config.venueDir,
    modules: ALL_MODULES,
    environment: config.environment,
    stateDir: config.stateDir,
    jitterSeed: till.nodeId,
    // The venue's real wall clock (tz + business-day cutover), keyed by this node —
    // the same read `report-api` uses, so an `at: "auto"` / wall-clock schedule fires in the venue's
    // local time rather than the interim UTC placeholder the previous task carried.
    readClock: () =>
      withTransaction(db, async (tx) => {
        return resolveVenueClock(tx, till.nodeId);
      }),
    outcomes: backupOutcomes,
    log,
  });
  await backupSupervisor.reload();

  // Dashboard alerts. Mounted HERE, after the backup supervisor exists, because the backups source
  // reads the supervisor's live status; the claims list comes from every module, but the ongoing
  // checks run only for the enabled set (whose tables are migrated) plus the four server-owned
  // sources below. Route mounts are order-independent among themselves, so sitting beside the other
  // management-api mounts is fine as long as it precedes any catch-all handler.
  //
  // The runtime context each card-provider seat call takes for the battery read — the db handle and
  // the vault key ring — built exactly as `payments-api.ts` builds its
  // `runtimeDeps`, minus the test-only `fetch` (none is injected on this path, so production uses the
  // global fetch). It reuses the same `db`/`ring` bindings, never a second copy.
  const cardRuntimeDeps = (): CardProviderRuntimeDeps => ({
    db,
    ring,
  });
  // The battery reading is reused for five minutes so an open dashboard's minute-by-minute poll does
  // not hammer the provider; the backup freshness for one minute.
  const backupCache = createTtlCache<BackupStatus>({ ttlMs: 60_000, now });
  const batteryCache = createTtlCache<number | null>({ ttlMs: 5 * 60_000, now });
  const backupSource = backupAlertSource({
    listStatus: () =>
      backupCache.get("status", () => backupSupervisor.status().then((s) => s.backupStatus)),
    outcomes: backupOutcomes,
    now,
  });
  const serverAlertSources: AlertSource[] = [
    backupSource,
    awaitingCertAlertSource(awaitingFiscalCert),
    printingAlertSource(),
    batteryAlertSource({
      providers: CARD_PROVIDERS,
      runtimeDeps: cardRuntimeDeps,
      cache: batteryCache,
    }),
  ];
  mountAlertsApi(
    app,
    {
      db,
      registry: createAlertRegistry({
        claims: ALL_ALERT_CLAIMS,
        sources: [...enabledAlertSources(setsToMigrate), ...serverAlertSources],
      }),
      now,
    },
    log,
  );

  mountBoxStatusApi(
    app,
    {
      db,
      cfg: { nodeId: till.nodeId },
      environment: config.environment,
      health,
      now,
      tlsCertPath: config.tls?.certFile,
      // The live backup freshness, read through the supervisor's async `status()` so box-status and the
      // duty share one view (B3). Backup-off is not a distinct wiring: `status()` reports
      // `configured: false` when no destination is configured, exactly the N/A placeholder box-status
      // expects for the undefined-reader case.
      readBackup: () => backupSupervisor.status().then((s) => s.backupStatus),
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

  // The self-eviction endpoint (retire/evict R3): a fenced node retires itself. Mounted
  // UNCONDITIONALLY (a real management endpoint) — `retireSelf`'s ordered guards make it safe on any
  // node: a serving node refuses `node.retire_not_fenced`, and a fenced node whose held chart names no
  // serving primary refuses `node.retire_no_carrier`.
  mountBoxRetireApi(app, { appDb: db, ring, nodeId: till.nodeId }, log);

  // The recovery-bundle download (slice 4b-i): the same management gate as box-status, packing the
  // box's persisted secret files (config.stateDir) into a passphrase-encrypted bundle. Mounted in the
  // trading branch only — a setup box has no provisioned identity to recover.
  mountRecoveryBundleApi(app, { db, stateDir: config.stateDir, now }, log);
  const cloudConnection = cloudOrigin
    ? createCloudConnection({
        stateDir: config.stateDir,
        origin: cloudOrigin,
        localVenueId: till.locationId,
        environment: config.environment === "production" ? "production" : "test",
      })
    : undefined;
  const cloudPrimary = () =>
    holders.mode.current === "primary" && holders.singletonRole.current === "primary" && !fenced;
  cloudServing = cloudPrimary;
  mountCloudApi(
    app,
    {
      db,
      managementOrigin: config.managementOrigin,
      // Roles can change live; fencing takes effect through a server restart.
      isPrimary: cloudPrimary,
      connection: cloudConnection,
    },
    log,
  );

  // The authenticated backup admin routes (BR-1 Task 6): the same management gate as box-status,
  // reading and hot-reloading the SAME `backupSupervisor` above so the wizard can enable/rotate
  // backups without a restart. Writes `backup.env` to `config.stateDir`; refuses a write the env owns
  // or that a non-primary would make.
  mountBackupApi(
    app,
    {
      supervisor: backupSupervisor,
      db,
      stateDir: config.stateDir,
      readRecoveryKey,
    },
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
  // local secondary must not either). `relayUrl` is this primary's own relay coordinates
  // (`loadTunnelConfig`, undefined when no tunnel is configured — the route then refuses
  // `mirror.no_relay`); `boxHostname` is the same box leaf SAN the discovery-api and cert-minting use;
  // `designated` is `config.till` (the four WAITRON_TILL_*_ID). Mounted before the SPA catch-alls below.
  if (isSingletonPrimary) {
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
        accountKey: accountKey.toString("base64"),
      },
      log,
    );
  }

  // The `PromoteDeps` both the in-process promotes and the promote ENDPOINT run against. Assembled
  // once here rather than per call: every field is already bound for the life of this boot.
  const promoteDeps: PromoteDeps = {
    db,
    holders,
    log,
    ring,
    nodeId: till.nodeId,
  };

  // The mirror→primary promote, shared by the in-process `StartedServer.promoteMirrorToPrimary`
  // (boot.promote.test.ts) and the HTTP endpoint's `promoteRun` below. It corrects `trading.env` to the
  // cloud's OWN reserved standard series (spec §4.3) BEFORE the point-of-no-return (inert on a
  // still-read-only mirror), runs the PONR owner transaction, and restarts into `mode=primary` on a real
  // promote — an already-primary re-run is an idempotent no-op that skips the restart. Only a mirror
  // changes its selling series + its `node_roles.mode` on promotion, so this path exists only in
  // mirror mode.
  const promoteMirrorRun = async (
    attestation: FenceAttestation,
  ): Promise<MirrorPromotionResult> => {
    const result = await promoteMirrorToPrimary(
      {
        ...promoteDeps,
        // The promoted primary numbers under its OWN reserved standard series, not the primary's inert
        // `till.seriesId` that adopt wrote; every other value is re-emitted unchanged from the running
        // config. Called BEFORE the PONR (inert on a still-read-only mirror), so a PROCESS crash can
        // never leave the box primary on the primary's series (power-loss residual documented on
        // `MirrorPromoteDeps.persistTradingEnv`).
        persistTradingEnv: async (seriesId) => {
          const next: TradingConfig = {
            tillId: till.tillId,
            nodeId: till.nodeId,
            seriesId,
            locationId: till.locationId,
            environment: config.environment,
            accountKey: accountKey.toString("base64"),
          };
          await writeTradingEnv(config.stateDir, next);
        },
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
  };

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
  mountPromoteApi(app, { appDb: db, nodeId: till.nodeId, run: promoteRun }, log);

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
  // block and SPA mounts above, so the app is complete before it binds. Trading serves the box's OWN
  // minted leaf via the shared fallback (see `startTradingListener`), HTTPS like setup and recovery.
  const server = startTradingListener(config, app, now, log);

  // The change feed is in-process: the transaction that wrote the change hands it over once it has
  // committed (`@waitron/db`'s `withTransaction`). Nothing connects, so nothing can drop and there
  // is no batch of changes to miss, which is why no snapshot refresh is broadcast on startup.
  const unsubscribeFromChanges = subscribeToChanges(changeSubscriber(liveEvents, log));

  // The regime owns the submission transport: `enabledFiscal.drain` builds a per-pass mTLS
  // resolver (one TLS pool for the pass, released in its own `finally`) and runs
  // the pass. The host injects only the vault ring, the deployment identity and the cadence —
  // `config.environment` is the `WAITRON_ENV`-derived value `deployment-guard.ts` pinned
  // against the database at boot, and the regime's `entorno` guard refuses any due registro
  // whose own `entorno` disagrees or is unrecorded. `boot.ts` names no regime package.
  //
  // The restart reset runs only on a node that files: the pass below calls this drain behind both
  // `singletonPass` and the submission policy.
  const fiscalDrain = resetBeforeFirstDrain({
    reset: (at) => enabledFiscal.resetInFlight({ db }, at),
    drain: (at) =>
      enabledFiscal.drain(
        { db, ring, environment: config.environment, skipRetryMs: config.skipRetryMs, log },
        at,
      ),
    skipRetryMs: config.skipRetryMs,
    log,
  });

  const controller = new AbortController();
  const loop = runLoop({
    // The fiscal/settlement duties (drain/reconcile) run ONLY when this node holds the singletons
    // (`singleton_role = 'primary'`) — see `singletonPass` (promotion runbook design §2/§3c; #33 §7).
    // A NON-singleton node gets a trivial empty pass: that covers BOTH a read-only mirror AND a
    // sell-only local secondary (mode=`primary`, singleton_role=`secondary`). The empty pass keeps
    // `/health` advancing (`recordPass` sets `lastPassAt`) and `close()`'s `await loop` identical to
    // the singleton path. Running drain/reconcile on a non-singleton would contact AEAT/Stripe for a
    // host that must file and settle nothing.
    // `holders.singletonRole.current` is read PER PASS below, so a promotion that flips the holder to
    // 'primary' starts these duties on the next tick, no restart.
    // NOTE: because a non-singleton's pass has no duties, `/health` reflects only process liveness and
    // says NOTHING about how current a mirror's copy of the venue is. Nothing copies the primary's rows
    // to a mirror at all now — the PostgreSQL replication that did is deleted and its replacement has
    // not landed (`mirror-bundle.ts`'s header states the same open question) — so there is no data
    // freshness to measure here and no code measuring it: a mirror answers healthy whatever its data.
    // A staleness signal has to arrive with whatever replaces the replication.
    // `withPendingSweep` runs each connected card provider's `resolvePending` sweep around the
    // singleton fiscal pass on EVERY trading node (primary or sell-only secondary), returning the
    // inner `PassReport` unchanged so the `/health` contract is untouched (see its own header). The
    // providers are enumerated per pass (`connectedCardProviderSweep`): the demo/prepare simulator, if
    // one was built, plus every pooled provider this box has a sealed credential for — the
    // money-critical backstop that resolves a SumUp payment whose outcome was lost between the reader
    // push and the first poll (`payment.pending_outcome_unactionable`).
    pass: withPendingSweep(
      singletonPass(
        () => holders.singletonRole.current,
        (at) =>
          runPass(
            {
              drain: (at2) => runFiscalDrain(config, fiscalDrain, at2),
              // Asked per pass, not at boot: a credential provisioned while the host runs is served
              // on the next pass rather than after a restart. An unprovisioned purpose means there
              // is nothing to reconcile, so the pass reports an empty tick rather than running a
              // duty that would fail for want of a key — the gate the vault's enrolment list used
              // to provide by enumerating nobody.
              reconcile: async (at2) =>
                (await credentialProvisioned(db, "payments.stripe"))
                  ? runDue(
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
                      at2,
                    )
                  : NOTHING_TO_RECONCILE,
              awaitingCert: awaitingFiscalCert,
              monotonicMs: () => performance.now(),
              log,
            },
            at,
          ),
      ),
      connectedCardProviderSweep({
        db,
        pool: cardPool,
        contributions: CARD_PROVIDERS,
        simulator: cardProvider,
      }),
      log,
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
  // teardown supplied here: stop the main loop, the outbound tunnel and the backup sweep, then close
  // the venue store. The ordering guarantees (abort the loop and workers together, await the loop,
  // swallow a worker's settle-by-rejection so it can never skip the guaranteed store teardown) are
  // unchanged.
  //
  // Start discovery after the throwing setup steps; the responder skips development and loopback.
  const mdns = startMdnsResponder({
    hostname: BOX_HOSTNAME,
    devMode: config.devMode,
    httpHost: config.httpHost,
    getAddresses: boxAddresses,
    log,
  });
  const cloudController = new AbortController();
  const cloudWorker = cloudConnection
    ? runCloudWorker({
        connection: cloudConnection,
        signal: cloudController.signal,
        isPrimary: cloudPrimary,
        onError: (error) => log("error", "cloud.refresh_failed", { errorCode: codeOf(error) }),
      })
    : undefined;
  return makeStartedServer(
    server,
    health,
    log,
    {
      stopWork: async () => {
        controller.abort();
        cloudController.abort();
        await cloudWorker;
        unsubscribeFromChanges();
        liveEvents.close();
        // Stop the outbound tunnel client — its own controller, aborted here so close() never leaves it
        // dialing; runTunnelClient resolves promptly on abort (it destroys every live socket and
        // cancels every pending backoff nap). Aborted alongside the others, awaited below.
        tunnelController.abort();
        await loop;
        // The outbound tunnel worker, torn down the identical way: tunnelController.abort() above
        // already signalled it, so this only awaits its settle, swallowing a settle-by-rejection so it
        // can never skip the guaranteed store teardown below. It never rejects in production (its slots
        // back off every error), and holds no connection pool of its own — nothing to add to
        // closePools.
        if (tunnelWorker !== undefined) await tunnelWorker.catch(() => {});
        // The scheduled backup duty: the supervisor OWNS its sweep controller and its backup read
        // pool, so `stop()` aborts the sweep, awaits its settle (runBackupSweep swallows its own
        // per-tick faults, so it never rejects in production), AND closes that pool — there is no
        // separate `backupDb` for `closePools` to reach. Done here, before `closePools`, for the same
        // ordering guarantee the tunnel above keeps.
        await backupSupervisor.stop();
      },
      // The venue directory's two files, closed together.
      closePools: () => store.close(),
    },
    mdns,
    // The plain-HTTP trust/landing listener (Task 3) — a trading box serves its own minted leaf, so a
    // newly-arriving phone can trust the CA from this page before the HTTPS interstitial.
    startLandingListener(config, log),
    // Which in-process promote this box exposes is decided ONCE at boot by the deployment mode (captured
    // in `isMirror`), so a mirror surfaces `promoteMirrorToPrimary` and a local secondary
    // `promoteLocalSecondaryToPrimary` — never both. The mirror path (`promoteMirrorRun`, defined above,
    // also the endpoint's mirror delegate) corrects `trading.env` and restarts; the local-secondary path
    // does not. Both run against the shared `promoteDeps`.
    isMirror
      ? { kind: "mirror" as const, run: promoteMirrorRun }
      : {
          kind: "local-secondary" as const,
          run: (attestation: FenceAttestation) =>
            promoteLocalSecondaryToPrimary(promoteDeps, attestation),
        },
  );
}
