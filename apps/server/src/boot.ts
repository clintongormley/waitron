import { createCloudSnapshotWorker } from "./cloud-snapshot-worker.js";
import { createCloudSnapshotArchive } from "./cloud-snapshot-archive.js";
import { runCloudSnapshotLoop } from "./cloud-snapshot-loop.js";
import { uploadCloudCaptureFile } from "./cloud-backup-upload.js";
import { mountCloudPublic } from "./cloud-remote.js";
import { runCloudWorker } from "./cloud-worker.js";
import { createCloudConnection, loadCloudOrigin } from "./cloud-client.js";
import { createCloudReplacement } from "./cloud-replacement.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
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
  applicationVersion,
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
  sealedStateAlertSource,
  firstStartAlertSource,
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
import { stageRestoreRequest, stageStreamRestore } from "./restore-request.js";
import { stageResetRequest } from "./reset-request.js";
import { refuseIfArchiveSourceLive } from "./restore-stream.js";
import { boundObjectStore } from "./bounded-store.js";
import { RESTORE_STAGING_DIR, validateArtifact } from "./restore.js";
import { errnoOf } from "./errno.js";
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
import { ensureBoxSecrets, mintedBoxLeaf, tightenTlsDir } from "./box-secrets.js";
import { resolveTradingTls } from "./trading-tls.js";
import {
  assertRestoredMembershipReadable,
  deferFirstStart,
  readBucketPointerTerm,
  runFirstStart,
} from "./rebuild-first-start.js";
import { buildLandingApp } from "./landing-app.js";
import { closeListener } from "./close-listener.js";
import { mountBoxStatusApi } from "./box-status.js";
import { mountBoxRetireApi } from "./box-retire.js";
import { mountRecoveryBundleApi } from "./recovery-bundle-api.js";
import { mountBackupApi } from "./backup-api.js";
import { createSealedStateRefresher, type SealedStateStatus } from "./sealed-state.js";
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
import { StreamHost, type StreamHostDeps } from "./stream-host.js";
import { mountStreamApi } from "./stream-api.js";
import { createTurns } from "./backup-turns.js";
import { writeRecoveryKey } from "./backup-env-writer.js";
import {
  createS3ObjectStore,
  parseRecoveryKit,
  probeBucket,
  type BucketConfig,
} from "@waitron/stream";
import { Server as HttpsServer } from "node:https";
import "./errors.js";
// `DEFAULTS` is not imported: `loadConfig` already applied the scheduler's defaults.

export interface StartedServer {
  health: HealthState;
  /**
   * Promote a local secondary to primary in-process, with no restart. Present only on a non-mirror
   * trading box. Refuses without a fence attestation (`promotion.fence_not_attested`).
   */
  promoteLocalSecondaryToPrimary?: (attestation: FenceAttestation) => Promise<PromotionResult>;
  /**
   * Promote a read-only mirror to the venue's primary in-process, then restart into `mode=primary`.
   * `trading.env` is rewritten with the mirror's own reserved series BEFORE the point of no return
   * (owner decision 2026-09-04, see `promote.ts` `MirrorPromoteDeps.persistTradingEnv`). Present only
   * in mirror mode. Refuses without a fence attestation (`promotion.fence_not_attested`).
   */
  promoteMirrorToPrimary?: (attestation: FenceAttestation) => Promise<MirrorPromotionResult>;
  /**
   * Resolves once background work has stopped, the listeners are closed and the venue store is
   * closed; rejects if any of that fails.
   */
  close(): Promise<void>;
}

/**
 * The mode-specific half of `close()` (see `makeStartedServer`). `stopWork` must not reject: a
 * rejection skips `closePools`.
 */
interface BootTeardown {
  stopWork: () => Promise<void>;
  closePools: () => Promise<void>;
}

/**
 * Next to the bundle, where `scripts/copy-migrations.mjs` puts them. Run from source this resolves to
 * a directory that does not exist; `WAITRON_MIGRATIONS_DIR` is the from-source route. `fileURLToPath`,
 * not `.pathname`: a path containing a space would otherwise arrive percent-encoded.
 *
 * Exported so `boot.test.ts` can assert this exact value is absolute and named `drizzle`.
 */
export const DEFAULT_MIGRATIONS_ROOT = fileURLToPath(new URL("drizzle", import.meta.url));

/**
 * The default store for the box's self-signed cert and generated secrets, beside the server entry
 * point. `WAITRON_STATE_DIR` overrides it. The from-source default is gitignored because it holds
 * SECRETS.
 */
export const DEFAULT_STATE_ROOT = fileURLToPath(new URL("state", import.meta.url));

/** The `WAITRON_BACKUP_*` env vars whose presence in the RAW base env marks the backup config as
 * env-injected rather than written by the wizard (`isManagedByEnvironment`). */
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
 * The box's mDNS hostname: the name the responder answers for, discovery advertises and the leaf's
 * SANs cover must agree, or the trust flow hits a certificate-hostname mismatch.
 *
 * Copies outside this process (the image's `WAITRON_MANAGEMENT_RP_ID` / `WAITRON_MANAGEMENT_ORIGIN`,
 * compose's defaults, `waitron.sh`'s QR URL) are pinned to this line, read as text, by
 * `scripts/deploy-image-env.test.ts`.
 */
export const BOX_HOSTNAME = "waitron.local";

/** The dNSName SANs on the box's self-signed leaf, whether minted or re-issued after a restore. */
const BOX_LEAF_HOSTNAMES = [BOX_HOSTNAME, "localhost"];

/**
 * The upper bound on a single product-image upload, in bytes: how large an upload the server will
 * buffer. A constant rather than config: it is a DoS ceiling, not an operator knob.
 */
export const MAX_UPLOAD_BYTES = DEFAULT_MAX_UPLOAD_BYTES;

/** What `reconcile` reports when the Stripe credential is not provisioned: the shape `runDue`
 * returns for a tick with no work, so `runPass` and `health.ts` need no special case. */
const NOTHING_TO_RECONCILE: TickResult = {
  ran: [],
  deferred: 0,
  beyondHorizon: 0,
  skipped: [],
  nextDueAt: null,
};

/**
 * The local simulator for a Demo or default-Prepare till; `undefined` otherwise, because every other
 * card sale routes to its reader's own provider through the pool at collect time.
 *
 * Exported for a direct test (`boot-card-provider.test.ts`).
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

/** Run each card provider's `resolvePending` sweep on every tick, around (not instead of) the
 * singleton fiscal pass: a sell-only local secondary must sweep its own `attempting` card rows even
 * though it never drains or reconciles. Log-only, NOT a health-tracked `Duty`: every `ALL_DUTIES`
 * member is seeded on every node, so a duty that never runs on a no-card node would read stale and
 * fail `/health`. A stuck sweep surfaces only as `resolve_pending.failed`. The providers are
 * enumerated each pass, so one connected while the host runs is swept without a restart.
 *
 * Exported for a direct test (`boot-pending-sweep.test.ts`). */
export function withPendingSweep(
  inner: (now: Date) => Promise<PassReport>,
  sweepProviders: () => Promise<readonly PaymentProvider[]>,
  log: Logger,
): (now: Date) => Promise<PassReport> {
  return async (now) => {
    const report = await inner(now);
    // An enumeration failure is a sweep failure and never propagates: the fiscal `report` must be
    // returned whatever the card backstop does.
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
 * plus every pooled card provider this tenant has a sealed credential for. A provider with no sealed
 * credential is not swept: its `resolvePending` would only fail on the missing credential.
 *
 * Exported for a direct test (`boot-pending-sweep.test.ts`). */
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
        out.push(await deps.pool.get(c.providerId));
      }
    }
    return out;
  };
}

/**
 * Bind the one HTTP listener and wire its listen-failure handler. Called LAST in each branch, so the
 * mounted app is complete before it binds.
 */
function startListening(
  config: ServerConfig,
  app: Hono,
  now: () => Date,
  log: Logger,
): ReturnType<typeof serve> {
  let bound = false;
  // "listening" is logged from `serve`'s `listeningListener`, not after this call: the socket binds
  // asynchronously, after `serve()` has returned.
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
  // A bind failure arrives here AFTER `startServer` has returned, so unlike every other boot failure
  // it cannot escape as a rejection; logging and exiting here keeps the same fail-loud posture.
  // `bound` keeps a later, unrelated 'error' on a healthy listener from exiting the process as a
  // bind failure.
  server.on("error", (error: NodeJS.ErrnoException) => {
    /* v8 ignore start */
    if (bound) return;
    /* v8 ignore stop */
    const failure = new AppError("server.listen_failed", {
      port: config.httpPort,
      // `code` is optional on the error TYPE; the fallback is type-required.
      /* v8 ignore start */
      code: error.code ?? "unknown",
      /* v8 ignore stop */
    });
    // Exit from the write's completion callback: on a pipe stdout writes are asynchronous, so exiting
    // straight after `log(...)` can drop the line. `process.exitCode` alone is not enough while the
    // background loop keeps the process alive.
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

/** Bind a TRADING listener over the box's own minted leaf: an operator `WAITRON_TLS_*` still wins,
 * and a leaf-less box keeps plain HTTP. Every trading bind goes through here so none can fall back to
 * plain HTTP and break phones that already trust the leaf. The setup bind uses the secrets it has
 * just ensured instead. */
function startTradingListener(
  config: ServerConfig,
  app: Hono,
  now: () => Date,
  log: Logger,
): ReturnType<typeof serve> {
  return startListening({ ...config, tls: resolveTradingTls(config) }, app, now, log);
}

/**
 * Bind the plain-HTTP trust/landing listener on `config.landingPort`, beside the HTTPS one. A phone
 * opening the HTTPS origin on an untrusted self-signed leaf hits the certificate interstitial before
 * any of our JS runs, so the "trust the CA" page must be served over plain HTTP. It never redirects
 * and sends no HSTS — both would strand the phone back on the interstitial.
 *
 * `undefined` when the port is 0 (disabled), when operator TLS is set, or when the box has no minted
 * leaf: the page appears only when the HTTPS origin presents the box's own self-signed leaf.
 *
 * Takes only the fields it reads so the recovery entrypoint, which never runs `loadConfig`, can build
 * one (`node-entry.ts`).
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
  const server = serve(
    buildServeOptions(
      { fetch: app.fetch, port: config.landingPort, hostname: config.httpHost },
      undefined,
    ),
    (info) => log("info", "landing.listening", { port: info.port }),
  );
  // Unlike the main listener, a landing bind failure must not take the box down: it is a convenience
  // surface, and a low port may need a privilege a dev host lacks. Without a handler Node would crash
  // the process on the unhandled 'error'.
  server.on("error", (error: NodeJS.ErrnoException) => {
    log("warn", "landing.listen_failed", {
      port: config.landingPort,
      /* v8 ignore start */
      code: error.code ?? "unknown",
      /* v8 ignore stop */
    });
  });
  return {
    close: () => closeListener(server),
  };
}

/**
 * The `StartedServer` every mode returns, with the shared `close()` sequence written once. `close()`
 * is idempotent, and stops advertising `waitron.local` before anything else comes apart.
 */
function makeStartedServer(
  server: ReturnType<typeof serve>,
  health: HealthState,
  log: Logger,
  teardown: BootTeardown,
  mdns: MdnsResponder,
  landing: { close(): Promise<void> } | undefined,
  promote?:
    | { kind: "mirror"; run: (a: FenceAttestation) => Promise<MirrorPromotionResult> }
    | { kind: "local-secondary"; run: (a: FenceAttestation) => Promise<PromotionResult> },
): StartedServer {
  // Checked and set before the first `await`, so a second concurrent `close()` returns at once
  // rather than repeating the sequence; it does not wait for the first to finish.
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
      // A reject here must never skip the store teardown below.
      await mdns.stop().catch(() => {});
      // Outside the try/finally: a rejecting `stopWork` skips `closePools`, so it must not reject.
      await teardown.stopWork();
      // `finally`: a rejecting listener close must still close the store.
      try {
        // closeListener drops idle keep-alive sockets (then all, after a grace) so this resolves —
        // Node's server.close() otherwise waits forever on the setup page's poll connection.
        await closeListener(server);
      } finally {
        // A reject here must not skip the store teardown below.
        if (landing !== undefined) await landing.close().catch(() => {});
        await teardown.closePools();
      }
      log("info", "server.stopped");
    },
  };
}

/** Test seams; production leaves them unset. */
export interface StartServerSeams {
  stream?: Pick<StreamHostDeps, "walLimitBytes">;
}

/**
 * The one place the real implementations meet.
 *
 * Boot failures ESCAPE, deliberately: invalid config, an unloadable key ring, a failed migration or
 * a venue database it cannot open exit non-zero and let the supervisor decide. A host that boots
 * half-configured and retries in the background is a host whose operator believes it is working.
 */
export async function startServer(
  env: Record<string, string | undefined>,
  base: NodeJS.ProcessEnv = {},
  seams: StartServerSeams = {},
): Promise<StartedServer> {
  const undoOnFailure: Array<() => Promise<void>> = [];
  try {
    return await bootServer(env, base, seams, undoOnFailure);
  } catch (error) {
    // Newest first, so anything that runs on the venue store stops before the store closes. An undo
    // that fails is dropped: the boot's own error is the one the supervisor has to see.
    for (const undo of undoOnFailure.reverse()) {
      try {
        await undo();
      } catch {
        // Dropped; see above.
      }
    }
    throw error;
  }
}

/**
 * `startServer`'s body. Whatever it starts that must be stopped if a later step throws is pushed onto
 * `undoOnFailure`; nothing there runs once it has returned a server, whose own `close()` takes over.
 */
async function bootServer(
  env: Record<string, string | undefined>,
  base: NodeJS.ProcessEnv,
  seams: StartServerSeams,
  undoOnFailure: Array<() => Promise<void>>,
): Promise<StartedServer> {
  const now = () => new Date();
  const config = loadConfig(env, DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT);
  const cloudOrigin = loadCloudOrigin(env);
  // The addresses this box tells the LAN to reach it on: the leaf's IP SANs, discovery's URLs and the
  // mDNS answers all read this one resolver.
  //
  // It does NOT keep them agreeing over time: the leaf is minted once and reused (except on the first
  // start after a restore, `rebuild-first-start.ts`), while discovery and mDNS resolve per request.
  // Changing `WAITRON_BOX_ADDRESSES` on a box that already holds `<stateDir>/tls/server.key` moves the
  // QR and mDNS answers to an address the certificate does not cover. Set it on the FIRST boot of a
  // state dir, or discard the `tls/` files to re-mint.
  const boxAddresses = (): string[] => config.boxAddresses ?? listBoxIpv4();
  // Before any surface that gates on a management session is mounted, in either mode.
  registerModulePermissions(ALL_MODULE_PERMISSIONS);
  const verbosity = createVerbosityController({ defaultLevel: "info", now });
  const stdoutSink = (line: string) => process.stdout.write(line);
  // Stdout only: it reports that the file sink has failed.
  const stdoutLog = createLogger(stdoutSink, now);
  // Logging never throws into a request path: a lost log directory loses the file, not the sale.
  const fileSink = createRotatingFileSink(
    { dir: config.logDir, maxBytes: config.logMaxBytes, maxFiles: config.logMaxFiles },
    () => stdoutLog("warn", "log.file_unavailable"),
  );
  const reader = createLogReader({ dir: config.logDir, maxFiles: config.logMaxFiles });
  // The two halves are deliberately NOT filtered alike. The FILE half masks URL credentials, because
  // the recovery page serves that file's tail to anyone on the venue's LAN with no login. The STDOUT
  // half is left whole: it is the installer's channel, reachable only with a shell on the box, and
  // masking it would erase the difference between a wrong password and none at all. Pinned by
  // `recovery-surface.test.ts` → "the caught error's own words on the page".
  const log = createLogger(tee(stdoutSink, fileSink), now, () => verbosity.current());
  // Here rather than in `loadConfig`: `health.ts` imports from `config.ts` to build `DUTY_BUDGET_MS`,
  // so `config.ts` importing it back would be a cycle. An idle host sleeps `config.maxTickMs`
  // verbatim, so a ceiling at or past the drain budget would read the drain duty as stale.
  if (config.maxTickMs >= DUTY_BUDGET_MS[DRAIN_DUTY]) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_MAX_TICK_MS",
      reason: "at_or_above_drain_budget",
    });
  }
  // Each configured built-SPA directory must hold an `index.html`; checked before the store is opened
  // or migrations run, and in both modes, so a wrong or never-built dir fails the boot loudly.
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
  // stop here. A short-lived open, closed before `applyMigrations` opens the directory itself.
  const stampProbe = await openVenueDatabase(config.venueDir);
  try {
    await assertDeploymentMatches(stampProbe.venue, config.environment);
  } finally {
    await stampProbe.close();
  }

  // `applyMigrations` opens and closes its own store, so running it BEFORE the long-lived open below
  // keeps the two from overlapping and leaves nothing open behind a failed migration. Setup mode
  // migrates the FULL schema, which the wizard needs; trading mode migrates only the enabled set.
  const moduleConfig = await readModuleConfig(config.stateDir);
  const setsToMigrate =
    config.till === undefined ? ALL_MODULES : enabledModules(ALL_MODULES, moduleConfig);
  await withDevMigrationHint(log, config.devMode, () =>
    applyMigrations(
      config.venueDir,
      migrationOptionsFor(orderedMigrationSets(setsToMigrate), config.migrationsRoot),
    ),
  );
  // The long-lived open. On a primary with a backup configured, the backup supervisor opens its own
  // beside it.
  const store = await openVenueDatabase(config.venueDir);
  undoOnFailure.push(() => store.close());
  const db = store.venue;

  // Drift visibility: log the enabled set against what the database has actually migrated. A
  // soft-disabled module's data is kept; it is simply not migrated.
  let appliedModuleVersions: Record<string, number> = {};
  if (config.till !== undefined) {
    const myModuleVersions = await schemaVersionsByModule(db, ALL_MODULES);
    appliedModuleVersions = myModuleVersions;
    const migrated = new Set(
      Object.entries(myModuleVersions)
        .filter(([, v]) => v > 0)
        .map(([n]) => n),
    );
    const r = reconcile(
      setsToMigrate.map((m) => m.name),
      migrated,
    );
    if (r.softDisabled.length > 0 || r.toMigrate.length > 0) {
      log("info", "module.reconcile", { softDisabled: r.softDisabled, toMigrate: r.toMigrate });
    }
  }

  const health = createHealthState(now());
  const app = healthApp(health, now, { venueDir: config.venueDir });
  // Registered before every surface below, so it wraps all of them; `/health`, registered above, is
  // deliberately left out of the request log.
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
    // SETUP MODE — this box is bound to no venue. It serves only `/health` and the unauthenticated
    // setup surface, and runs no background work: there is nothing to submit yet.
    //
    // `ensureBoxSecrets` runs regardless of `config.tls`: the box's own vault key must exist whichever
    // front-door cert is served. An operator's `WAITRON_TLS_*` pair still wins as the served cert.
    const ensured = await ensureBoxSecrets({
      stateDir: config.stateDir,
      hostnames: BOX_LEAF_HOSTNAMES,
      now,
      listIpv4: boxAddresses,
    });
    // `ensureBoxSecrets` wrote the vault key into `secrets.env` but did not load it into this
    // process's env, so the setup ring is read back off disk.
    const ring = loadKeyRing(
      parseEnvFile(readFileSync(join(config.stateDir, "secrets.env"), "utf8")),
    );
    const accountKey = resolveAccountKey({}, ring);
    const persistTrading = async (cfg: TradingConfig): Promise<void> => {
      await writeTradingEnv(config.stateDir, {
        ...cfg,
        accountKey: cfg.accountKey ?? accountKey.toString("base64"),
      });
    };
    // What `provisioning.foreign_tenant` names: operator-typed configuration rather than a secret,
    // which is why it may be echoed.
    const ownerDatabaseName = config.venueDir;
    const openBoundedBucket = (bucket: BucketConfig) =>
      boundObjectStore(createS3ObjectStore(bucket));
    mountSetup(
      app,
      {
        environment: config.environment,
        devMode: config.devMode,
        operations: createSetupOperationStore(config.stateDir),
        cloudRecovery:
          cloudOrigin && config.environment === "preproduction"
            ? createCloudRecoveryClient({
                stateDir: config.stateDir,
                origin: cloudOrigin,
                environment: config.environment,
              })
            : undefined,
        stageRestore: (request, { oldBoxGone }) =>
          stageRestoreRequest(config.stateDir, request, async (candidate) => {
            const validated = await validateArtifact({
              artifact: candidate.artifact,
              recoveryKey: candidate.recoveryKey,
              stateDir: config.stateDir,
              stagingDir: join(config.stateDir, RESTORE_STAGING_DIR),
              migrationsRoot: config.migrationsRoot,
              modules: ALL_MODULES,
              environment: candidate.environment,
            });
            await refuseIfArchiveSourceLive({
              validated,
              stateDir: config.stateDir,
              oldBoxGone,
              now,
              openStore: openBoundedBucket,
            });
          }),
        stageReset: (operationId) => stageResetRequest(config.stateDir, operationId),
        stageBucketRestore: async ({ kit, environment, oldBoxGone, venueConfirmed }) =>
          stageStreamRestore({
            kit: parseRecoveryKit(kit),
            stateDir: config.stateDir,
            stagingDir: join(config.stateDir, RESTORE_STAGING_DIR),
            migrationsRoot: config.migrationsRoot,
            modules: ALL_MODULES,
            environment,
            litestreamBin: config.litestreamBin,
            oldBoxGone,
            venueConfirmed,
            now,
            log,
            openStore: openBoundedBucket,
          }),
        stageConfiguration: (artifact, passphrase) =>
          stageConfigurationImport(config.stateDir, ring, artifact, passphrase, async (bundle) => {
            const resolvedConfig = venueModuleConfig(
              moduleConfig,
              bundle.venue.location.fiscalTerritory,
            );
            const modules = enabledModules(ALL_MODULES, resolvedConfig);
            validateConfigurationBundle(bundle, modules, await schemaVersionsByModule(db, modules));
          }),
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
            applicationVersion: applicationVersion(process.env),
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
              applicationVersion: applicationVersion(process.env),
            }),
          );
        },
        // The fiscal slot comes from the REQUEST's territory: the box's `moduleConfig` base is
        // default-on, which with two fiscal-slot members would be ambiguous.
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
          const versions = staged === null ? undefined : await schemaVersionsByModule(db, modules);
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
        adopt: (req, hooks) =>
          adoptFromPrimary(
            {
              ownerDb: db,
              fetchBundle: fetchMirrorBundle,
              advertisedOrigin: config.advertisedOrigin,
              environment: config.environment,
              persistTrading,
              persistModuleConfig: async (c) => {
                await writeModuleConfig(config.stateDir, c);
              },
              stateDir: config.stateDir,
              database: ownerDatabaseName,
            },
            req,
            hooks,
          ),
        establishIdentity: (nodeId) => establishNodeIdentity({ ownerDb: db, ring }, nodeId),
        seedMembership: (nodeId) =>
          seedTermZeroMembership({ db, ring }, nodeId, config.advertisedOrigin),
        // Handed to the fiscal contribution's `provisioningSecret.seal` seat, so boot imports no
        // regime package.
        db,
        ring,
        persistTrading,
        requestRestart: () => process.kill(process.pid, "SIGTERM"),
        setupAppDir: config.setupAppDir,
      },
      log,
    );
    const tls = config.tls ?? { certFile: ensured.certFile, keyFile: ensured.keyFile };
    const server = startListening({ ...config, tls }, app, now, log);
    undoOnFailure.push(() => closeListener(server));
    const mdns = startMdnsResponder({
      hostname: BOX_HOSTNAME,
      devMode: config.devMode,
      httpHost: config.httpHost,
      getAddresses: boxAddresses,
      log,
    });
    undoOnFailure.push(() => mdns.stop());
    return makeStartedServer(
      server,
      health,
      log,
      {
        stopWork: () => Promise.resolve(),
        closePools: () => store.close(),
      },
      mdns,
      startLandingListener(config, log),
    );
  }

  // TRADING MODE — a venue is bound.
  //
  // Logged rather than thrown: a certificate folder left readable is no reason to stop selling.
  try {
    await tightenTlsDir(config.stateDir);
  } catch (error: unknown) {
    log("warn", "tls.tighten_failed", { errno: errnoOf(error) });
  }

  // The env straight through: `loadKeyRing` owns the WAITRON_CREDENTIALS_KEY* names and their
  // validation. Loaded here rather than in the shared prefix, so an unprovisioned box needs no key.
  const ring = loadKeyRing(env);
  const accountKey = resolveAccountKey(env, ring);
  const totpKeyRing = {
    current: { version: 1, key: accountPurposeKey(accountKey, "totp") },
  };

  // Adoption-pending boot: adopt records a latch instead of establishing the standby identity, and
  // every boot retries that step. `finish-adoption.ts`'s `PendingAdoption` header says why none can
  // complete it today. In this mode boot serves `/health` and a minimal `/api/box/status`, and reads
  // no deployment axes or membership.
  const pendingAdoption = await readPendingAdoption(config.stateDir);
  if (pendingAdoption !== null) {
    // Unauthenticated and deliberately minimal: no ambient viewer exists yet.
    app.get("/api/box/status", (c) => c.json({ adoption: "pending" }, 200));
    const finishWorker = runFinishAdoption({
      ownerDb: db,
      ring,
      stateDir: config.stateDir,
      modules: setsToMigrate,
      log,
    });
    // A rejection before close() must not become a process-level unhandled rejection.
    finishWorker.catch((err) =>
      log("error", "adoption.worker_rejected", { errorCode: codeOf(err) }),
    );
    undoOnFailure.push(() => finishWorker.catch(() => {}));
    const server = startTradingListener(config, app, now, log);
    undoOnFailure.push(() => closeListener(server));
    const mdns = startMdnsResponder({
      hostname: BOX_HOSTNAME,
      devMode: config.devMode,
      httpHost: config.httpHost,
      getAddresses: boxAddresses,
      log,
    });
    undoOnFailure.push(() => mdns.stop());
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
      startLandingListener(config, log),
    );
  }

  assertSingleOperationalVenue(await readOperationalVenueIds(db), config.till.locationId);

  // Nothing reaches here as a `mirror` today: `adoptFromPrimary` writes `mode='mirror'` together with
  // the adoption-pending latch, and the branch above returns while it is set.
  // Both deployment axes from ONE read of the row, so the initial holder pair is never torn: two
  // separate reads could straddle a concurrent promotion and yield an impossible `(mirror, primary)`.
  const initialAxes = await readDeploymentAxes(db, config.till.nodeId);
  await assertRestoredMembershipReadable(config.stateDir, db);
  // A returned box that died before it was fenced would otherwise boot with a stale chart and SELL
  // while the promoted cloud is also primary — two nodes filing under one NIF (CLAUDE.md §5). So a
  // non-mirror node with a configured cloud peer best-effort fetches the peer's signed chart and
  // persists it if it verifies and is strictly newer. It runs BEFORE the held-membership read below,
  // so a persisted superseding document flows into the `fenced` demote. An unreachable peer lets
  // boot proceed as primary: the MVP's accepted window. Demote-only: it can never self-promote.
  if (initialAxes.mode !== "mirror") {
    const peer = await readMirrorConfig(db, config.till.nodeId);
    if (peer !== null) {
      const [trustSet, held] = await Promise.all([
        readMembershipTrustSet(db),
        readNodeMembership(db),
      ]);
      await reconcileMembershipOnBoot({
        held,
        nodeId: config.till.nodeId,
        // `mirror_config` is owner-written trusted config, so no SSRF screen.
        peerUrl: `${peer.relayUrl.replace(/\/+$/, "")}/management-api/membership`,
        fetchPeerMembership: fetchPeerMembershipDocument,
        // Persist-if-accepted, so a newer verified chart is held even when it does not fence this node.
        acceptDocument: async (incoming, currentTerm) => {
          const result = acceptMembershipDocument(incoming, currentTerm, trustSet);
          if (result.accepted) await persistNodeMembershipIfNewer(db, incoming);
          return result;
        },
        log,
      });
    }
  }
  // Re-read AFTER the reconciliation above, so a persisted superseding chart is reflected here.
  // Read without re-verifying: boot trusts its own held row as it trusts the deployment axes.
  const heldMembership = await readNodeMembership(db);
  const fenced = isFenced(heldMembership, config.till.nodeId);
  let axes = initialAxes;
  if (fenced && axes.singletonRole === "primary") {
    // Demote the singleton axis, which stops every singleton duty. `mode` stays 'primary'; the
    // read-only gate below, not the mode, enforces the fence.
    const ownNodeId = config.till.nodeId;
    await withTransaction(db, async (tx) => {
      await setSingletonRoleTx(tx, ownNodeId, "secondary");
    });
    // Re-read rather than synthesize: both axes from one read of the current row, so `mode` cannot
    // be stale if it flipped since the initial read.
    axes = await readDeploymentAxes(db, config.till.nodeId);
  }
  const holders = createDeploymentHolders(axes.mode, axes.singletonRole);
  // Shared by reference between the fiscal pass that WRITES it and the box-status read that surfaces
  // it: a node without a `fiscal.aeat` cert sells and chains locally, and its drain skips filing.
  const awaitingFiscalCert = { current: false };
  const isMirror = holders.mode.current === "mirror";
  // The boot-captured read-only posture; the gate's own per-request predicate re-reads `mode` live,
  // so a promotion lifts it without a restart.
  const fencedOrMirror = isMirror || fenced;
  // A restored box finishes its restore here (rebuild-first-start.ts), before the trading listener
  // reads the certificate and before the sealed-state refresh below seals it. After the peer
  // reconciliation above, so a peer that answers during THIS start can fence the box before its
  // term moves. A peer that does not answer now is not waited for: a fencing document it serves
  // later at a term no higher than the new one reads as not newer (docs/backlog.md).
  // A mirror or a fenced node defers it: nothing is re-issued or signed, and the bucket copy is
  // held. A failure does not keep the box shut: it sells, does not stream, and raises
  // restore.first_start_failed until a later start finishes. The exception is a restored
  // membership document that fails its signature check (`restore.membership_invalid`): that fails
  // the start.
  const firstStart = fencedOrMirror
    ? await deferFirstStart(config.stateDir, log)
    : await runFirstStart({
        stateDir: config.stateDir,
        db,
        ring,
        nodeId: config.till.nodeId,
        contactUrl: config.advertisedOrigin,
        hostnames: BOX_LEAF_HOSTNAMES,
        listIpv4: boxAddresses,
        now,
        log,
        pointerTerm: () => readBucketPointerTerm(db, ring),
      });
  // The singleton duties gate on this, not on `isMirror`: a sell-only local secondary is not a mirror,
  // and must not dial a second tunnel or write scheduled backups beside the primary.
  // `node_roles_role_valid_ck` rejects `(mirror, primary)`, so a mirror is always 'secondary'.
  //
  // A BOOT decision, deliberately not live: an in-process promotion does not start the duties gated
  // on this without a restart.
  const isSingletonPrimary = holders.singletonRole.current === "primary";
  // FAIL CLOSED before the mirror's ambient full-admin viewer is seeded below: the loopback default
  // of `config.httpHost` is the only thing keeping it off the network, so a non-loopback bind is
  // refused unless the operator opts in (`WAITRON_MIRROR_ALLOW_EXPOSED`).
  assertMirrorBindSafe(config, isMirror, env);
  // Resolved once so the mirror's ambient session and every mounted login surface agree with the
  // listener about whether cookies require HTTPS.
  const secureCookies = resolveTradingTls(config) !== undefined;
  if (fencedOrMirror) {
    app.use(
      "*",
      // A mirror gates by mode, per request, so a live promotion lifts it; a fenced node gates on the
      // boot-captured `fenced`, and leaves the fence only through a fresh boot.
      readOnlyGate(
        () => holders.mode.current === "mirror" || fenced,
        // Retirement and promote writes use their own authentication gates.
        (c) =>
          (fenced && c.req.method === "POST" && c.req.path === "/api/box/retire") ||
          // Exempt on a fenced node too, so it answers the precise `promotion.node_fenced` rather
          // than a generic gate 403.
          (c.req.method === "POST" && c.req.path === "/management-api/promote"),
      ),
    );
  }
  if (isMirror) {
    const viewerToken = await ensureMirrorViewer(db);
    app.use(
      "*",
      mirrorSession(db, secureCookies, () => holders.mode.current, viewerToken),
    );
  } else {
    await endMirrorViewer(db);
  }

  // The node whose DATA the node-scoped read paths display. On a mirror it is the ORIGIN primary,
  // whose node_id the venue's sales carry; `config.till.nodeId` stays the node's own identity for
  // every WRITE path.
  let dataNodeId: string = config.till.nodeId;
  if (isMirror) {
    const loaded = await readMirrorConfig(db, config.till.nodeId);
    if (loaded === null) {
      throw new AppError("server.config_invalid", {
        variable: "mirror_config",
        reason: "mirror_requires_mirror_config",
      });
    }
    dataNodeId = loaded.originNodeId;
  }

  const liveEvents = new LiveEvents();
  const changeSources = setsToMigrate.flatMap((module) => module.changes ?? []);
  await installChangeFeed(db, changeSources);
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

  // Registered before the API mounts so it wraps them. Trading-only: the allow-list reads the held
  // membership document, which a setup box has not provisioned.
  const allowOrigin = createOriginAllowlist({
    advertisedOrigin: config.advertisedOrigin,
    readMembership: () => readNodeMembership(db),
    devMode: config.devMode,
    now: () => Date.now(),
  });
  app.use("/api/*", corsForVenue(allowOrigin));
  // A rerouted till fetches menu photos cross-origin.
  app.use("/media/*", corsForVenue(allowOrigin));

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
  // Both are provisioning-time config, read once at boot rather than per request. `makeFiscalBackend`
  // cross-checks `filingModule` against the enabled fiscal module, so a node whose records were filed
  // under another regime fails the boot rather than chaining under the wrong one (CLAUDE.md §5).
  const [orderFlow, filingModule] = await Promise.all([
    readOrderFlow(db, config.till),
    readFilingModule(db, config.till),
  ]);
  // Resolved through the generic slot so `boot.ts` names no regime package
  // (`scripts/module-seams.test.ts`).
  const enabledFiscal = fiscalSlot(setsToMigrate, filingModule);
  const till: TillConfig = {
    ...config.till,
    orderFlow,
    practiceMode: config.onboardingIntent === "demo" || config.onboardingIntent === "prepare",
  };
  // The venue's default DISPLAY locale. The override is the RAW `till.localeOverride`, not the
  // defaulted `till.locale`, which would mask geography.
  const venueLocale = await readVenueLocale(db, {
    locationId: till.locationId,
    override: till.localeOverride,
  });
  const venueTimeZone = await readVenueTimeZone(db, {
    locationId: till.locationId,
  });
  const cardProvider = await buildCardProvider(
    db,
    config.onboardingIntent,
    config.paymentTestProviders,
  );
  // One pool, shared by the pay route and the payments management surface below, so a reader added
  // or a credential rotated there evicts the exact provider the next sale uses.
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
      backend: makeFiscalBackend(setsToMigrate, filingModule, db, env),
      clock: systemClock(),
      cfg: till,
      // From the ENABLED set: a disabled module's table is not migrated, so its annotator must not run.
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
  // The public role probe a till polls to follow the venue's primary. Mounted on mirror and fenced
  // boots too: their "not accepting sales" is what steers a till away. `!fencedOrMirror` is
  // redundant today; kept so the probe refuses if the role check or the fence demote ever stops.
  mountNodeApi(
    app,
    {
      nodeId: till.nodeId,
      acceptingSales: isSingletonPrimary && !fencedOrMirror,
      environment: config.environment,
      readMembership: () => readNodeMembership(db),
    },
    log,
  );
  // Deliberately outside the `!fencedOrMirror` block: on such a node the refusal (from the read-only
  // gate, or `isPrimary` for a node the gate does not cover) sends the agent to the manual path.
  mountNodeEnrolApi(
    app,
    { db, cfg: till, nodeId: till.nodeId, isPrimary: isSingletonPrimary && !fencedOrMirror },
    log,
  );
  // The operational surface (print agents, devices, pairing, card readers) is not mounted on a
  // read-only node at all, so even its safe-verb reads are absent, not merely its writes refused.
  // Un-mounting at boot rather than gating per request is deliberate; see read-only-gate.ts's header.
  if (!fencedOrMirror) {
    // ONE pairing window for the venue: every surface that has a knock shares this holder. In memory,
    // so a restart or a promotion starts SHUT — a node that has just taken over must not inherit an
    // open door.
    const pairingMode = createPairingMode();
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
    mountJoinApi(app, { db, cfg: till, pairingMode }, log);
    mountPrintApi(
      app,
      {
        db,
        cfg: till,
        readMembership: () => readNodeMembership(db),
        pairingMode,
        venueLocale,
        listIpv4: boxAddresses,
      },
      log,
    );
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
  const resolveAccountEmail = () =>
    resolveEmailDelivery(db, ring, config.devMode || till.practiceMode === true);
  mountLocationSettingsApi(app, { db, cfg: till, fiscal: enabledFiscal }, log);
  mountManagementApi(
    app,
    {
      db,
      cfg: { nodeId: till.nodeId },
      venueCfg: till,
      secureCookies,
      rpId: config.managementRpId,
      origin: config.managementOrigin,
      googleOidc: config.googleOidc,
      venueLocale,
      privacyNoticeUrl: config.privacyNoticeUrl,
      accountActionCodeKey: accountPurposeKey(accountKey, "account-action-code"),
      credentialKeyRing: totpKeyRing,
      // Resolved on every send, so a newly configured or rotated SMTP gateway takes effect at once.
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
  mountDiagnosticsApi(app, { db, reader, verbosity }, log);
  mountCatalogueApi(
    app,
    {
      db,
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
  mountPurchasingApi(app, { db }, log);
  // Every ENABLED module's routes, so a module toggled off mounts nothing. `core.openTab` closes over
  // the full `till` here, so `nodeId`/`tillId` never enter a module's cfg.
  const routeCtx: ModuleRouteContext = {
    db,
    cfg: {
      locationId: till.locationId,
      contentDefaultLanguage: venueLocale,
    },
    maxUploadBytes: MAX_UPLOAD_BYTES,
    core: { openTab: (tx, req) => openTab(tx, till, { tableId: req.tableId }) },
  };
  for (const m of setsToMigrate) m.routes?.mount(app, routeCtx, log);
  // `dataNodeId`, not this node's own id: see its declaration above.
  mountReportApi(app, { db, cfg: { nodeId: dataNodeId } }, log);
  mountWorkforceApi(app, { db, cfg: { nodeId: till.nodeId } }, log);
  mountScheduleApi(app, { db }, log);
  mountMeApi(
    app,
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
  // Provenance and the backup config's disk re-read both use the RAW `base` env, not the merged
  // `env`, so a file-sourced value is distinguishable from an env-sourced one.
  // Filled by the supervisor's sweep and read by the backups alert source below: one map.
  const backupOutcomes: BackupOutcomeHolder = { failed: new Map() };
  const readRecoveryKey = async (): Promise<string | undefined> =>
    loadRecoveryKey(await loadBoxEnv(base, config.stateDir));
  const isBackupManagedByEnvironment = (): boolean =>
    BACKUP_ENV_KEYS.some((k) => !isUnset(base[k]));
  const backupSupervisor = new BackupSupervisor({
    buildConfig: async () => loadBackupConfig(await loadBoxEnv(base, config.stateDir)),
    isManagedByEnvironment: isBackupManagedByEnvironment,
    readSingletonRole: () => holders.singletonRole.current,
    venueDir: config.venueDir,
    modules: ALL_MODULES,
    environment: config.environment,
    stateDir: config.stateDir,
    jitterSeed: till.nodeId,
    // The venue's wall clock, so a wall-clock schedule fires in the venue's local time.
    readClock: () =>
      withTransaction(db, async (tx) => {
        return resolveVenueClock(tx, till.nodeId);
      }),
    outcomes: backupOutcomes,
    log,
  });
  undoOnFailure.push(() => backupSupervisor.stop());
  await backupSupervisor.reload();
  const sealedStateStatus: SealedStateStatus = { failedSince: null };
  // After migrations, so the row's manifest names the schema the database holds.
  const sealedState = createSealedStateRefresher({
    db,
    nodeId: till.nodeId,
    stateDir: config.stateDir,
    modules: ALL_MODULES,
    resolvers: {},
    environment: config.environment,
    readRecoveryKey,
    now,
    log,
    status: sealedStateStatus,
  });
  // Reached by every boot past setup and adoption, standby and mirror included: each node writes its
  // own row by design (one row per node; owner, 2026-09-24).
  await sealedState.refresh();
  // The live copy of venue.db to the owner's bucket, primary only. `start()` returns without
  // waiting for the bucket, so a bucket that never answers cannot hold boot or a sale.
  const streamHost = new StreamHost({
    db,
    ring,
    nodeId: till.nodeId,
    venueDir: config.venueDir,
    stateDir: config.stateDir,
    litestreamBin: config.litestreamBin,
    log,
    now,
    isPrimary: () => holders.singletonRole.current === "primary",
    mayStream: () => firstStart.mayStream,
    ...seams.stream,
  });
  undoOnFailure.push(() => streamHost.stop());
  await streamHost.start();
  health.readStream = () => streamHost.status();

  // Dashboard alerts, mounted after the backup supervisor exists because the backups source reads
  // it. The claims come from every module; the checks run only for the enabled set, whose tables are
  // migrated.
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
    readStream: () => streamHost.status(),
  });
  const serverAlertSources: AlertSource[] = [
    backupSource,
    sealedStateAlertSource(sealedStateStatus),
    firstStartAlertSource(firstStart),
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
      // Read through the supervisor, so box-status and the duty share one view.
      readBackup: () => backupSupervisor.status().then((s) => s.backupStatus),
      readStream: () => streamHost.status(),
      // The same holders the read-only gate and the duty loop read, so the status matches what the
      // box enforces and tracks a live promotion.
      readMode: () => holders.mode.current,
      readSingletonRole: () => holders.singletonRole.current,
      readAwaitingFiscalCertificate: () => awaitingFiscalCert.current,
    },
    log,
  );

  // Mounted on every node: `retireSelf`'s own guards refuse a serving node.
  mountBoxRetireApi(app, { appDb: db, ring, nodeId: till.nodeId }, log);

  mountRecoveryBundleApi(app, { db, stateDir: config.stateDir, now }, log);
  const cloudConnection = cloudOrigin
    ? createCloudConnection({
        stateDir: config.stateDir,
        origin: cloudOrigin,
        localVenueId: till.locationId,
        environment: config.environment === "production" ? "production" : "test",
      })
    : undefined;
  const cloudReplacement =
    cloudConnection && cloudOrigin && config.environment !== "production"
      ? createCloudReplacement({
          stateDir: config.stateDir,
          origin: cloudOrigin,
          localVenueId: till.locationId,
          nodeId: till.nodeId,
          connection: cloudConnection,
        })
      : undefined;
  try {
    await cloudReplacement?.resume();
  } catch (error) {
    log("warn", "cloud.replacement_resume_failed", { errorCode: codeOf(error) });
  }
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
      replacement: cloudReplacement,
    },
    log,
  );

  const backupTurns = createTurns();
  mountBackupApi(
    app,
    {
      supervisor: backupSupervisor,
      db,
      stateDir: config.stateDir,
      readRecoveryKey,
      sealedState,
      readStream: () => streamHost.status(),
      turns: backupTurns,
    },
    log,
  );
  mountStreamApi(
    app,
    {
      db,
      ring,
      stream: streamHost,
      nodeId: till.nodeId,
      venueId: till.locationId,
      isPrimary: () => holders.singletonRole.current === "primary",
      isManagedByEnvironment: isBackupManagedByEnvironment,
      readRecoveryKey,
      writeRecoveryKey: (recoveryKey) =>
        writeRecoveryKey(config.stateDir, { recoveryKey, keyRotatedAt: undefined }),
      sealedState,
      probe: (bucket) => probeBucket(createS3ObjectStore(bucket)),
      turns: backupTurns,
    },
    log,
  );

  // The outbound tunnel: the box sits behind NAT with no inbound ports, so it dials OUT to the relay,
  // which splices a paired cloud client to the box's own served port. A singleton duty: only the
  // singleton primary keeps the one outbound tunnel.
  const tunnelConfig = loadTunnelConfig(env);
  const tunnelController = new AbortController();
  let tunnelWorker: Promise<void> | undefined;
  if (isSingletonPrimary && tunnelConfig !== undefined) {
    tunnelWorker = runTunnelClient({
      relayHost: tunnelConfig.relayHost,
      relayPort: tunnelConfig.relayPort,
      boxId: tunnelConfig.boxId,
      token: tunnelConfig.token,
      localPort: config.httpPort,
      poolSize: tunnelConfig.poolSize,
      sleep: realSleep,
      signal: tunnelController.signal,
      log,
    });
    tunnelWorker.catch((err) => log("error", "tunnel.worker_rejected", { errorCode: codeOf(err) }));
    undoOnFailure.push(async () => {
      tunnelController.abort();
      await tunnelWorker?.catch(() => {});
    });
  } else if (isSingletonPrimary) {
    log("info", "tunnel.disabled", {});
  }

  // The bundle a cloud mirror adopts; only the singleton primary emits one.
  if (isSingletonPrimary) {
    mountMirrorBundleApi(
      app,
      {
        appDb: db,
        ring,
        stateDir: config.stateDir,
        // https: the mirror reaches the box's own certificate end-to-end through the tunnel.
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

  const promoteDeps: PromoteDeps = {
    db,
    holders,
    log,
    ring,
    nodeId: till.nodeId,
  };

  // Shared by the in-process `StartedServer.promoteMirrorToPrimary` and the endpoint's `promoteRun`.
  // An already-primary re-run is a no-op that skips the restart.
  const promoteMirrorRun = async (
    attestation: FenceAttestation,
  ): Promise<MirrorPromotionResult> => {
    const result = await promoteMirrorToPrimary(
      {
        ...promoteDeps,
        // The promoted primary numbers under its OWN reserved series, not the primary's inert
        // `till.seriesId` that adopt wrote. Called BEFORE the point of no return, so a process crash
        // can never leave the box primary on the primary's series (the power-loss residual is on
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
      // On the NEXT tick, so the in-process caller's result is returned first.
      setTimeout(() => process.kill(process.pid, "SIGTERM"), 0);
    }
    return result;
  };

  // The promote endpoint's delegate. On a non-mirror it only reports status; it NEVER calls
  // `promoteLocalSecondaryToPrimary` (shelved active-active).
  const promoteRun = async (attestation: FenceAttestation): Promise<PromoteRunResult> => {
    if (isMirror) {
      const result = await promoteMirrorRun(attestation);
      return { alreadyPrimary: result.alreadyPrimary, restarting: !result.alreadyPrimary };
    }
    const held = await readNodeMembership(db);
    assertNotFenced(held, till.nodeId);
    return { alreadyPrimary: true, restarting: false };
  };

  mountPromoteApi(app, { appDb: db, nodeId: till.nodeId, run: promoteRun }, log);

  // The built front-ends, mounted LAST so the till's root catch-all cannot shadow an API route.
  // Dashboard first so `/manage/*` wins; the till's origin-root catch-all last
  // (`boot.spa-mount.test.ts` pins that order).
  if (config.dashboardAppDir !== undefined) {
    mountSpa(
      app,
      { root: config.dashboardAppDir, basePath: "/manage", navigationPath: "/manage" },
      log,
    );
  }
  if (config.tillAppDir !== undefined) {
    // The origin-root catch-all: MUST be the last GET mounted.
    mountSpa(app, { root: config.tillAppDir, basePath: "", navigationPath: "/tabs" }, log);
  }

  // After every mount above, so the app is complete before it binds.
  const server = startTradingListener(config, app, now, log);
  undoOnFailure.push(() => closeListener(server));

  // The change feed is in-process: the transaction that wrote the change hands it over once it has
  // committed (`@waitron/db`'s `withTransaction`). Nothing connects, so nothing can drop and there
  // is no batch of changes to miss, which is why no snapshot refresh is broadcast on startup.
  const unsubscribeFromChanges = subscribeToChanges(changeSubscriber(liveEvents, log));
  undoOnFailure.push(async () => {
    unsubscribeFromChanges();
    liveEvents.close();
  });

  // `config.environment` is the value `assertDeploymentMatches` pinned against the database at boot.
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
    // Drain and reconcile run ONLY on the node holding `singleton_role = 'primary'`, read per pass so
    // a promotion starts them on the next tick; any other node gets an empty pass that still advances
    // `/health`. So on a non-singleton node `/health` reflects only process liveness: a mirror answers
    // healthy whatever its data.
    pass: withPendingSweep(
      singletonPass(
        () => holders.singletonRole.current,
        (at) =>
          runPass(
            {
              drain: (at2) => runFiscalDrain(config, fiscalDrain, at2),
              // Asked per pass, so a credential provisioned while the host runs is served on the next
              // pass; without one there is nothing to reconcile.
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
  undoOnFailure.push(async () => {
    controller.abort();
    await loop;
  });

  const mdns = startMdnsResponder({
    hostname: BOX_HOSTNAME,
    devMode: config.devMode,
    httpHost: config.httpHost,
    getAddresses: boxAddresses,
    log,
  });
  undoOnFailure.push(() => mdns.stop());
  const cloudController = new AbortController();
  const cloudWorker = cloudConnection
    ? runCloudWorker({
        connection: cloudConnection,
        signal: cloudController.signal,
        isPrimary: cloudPrimary,
        onError: (error) => log("error", "cloud.refresh_failed", { errorCode: codeOf(error) }),
      })
    : undefined;
  const cloudSnapshots = cloudConnection
    ? runCloudSnapshotLoop({
        signal: cloudController.signal,
        onError: (error) => log("error", "cloud.snapshot_failed", { errorCode: codeOf(error) }),
        worker: createCloudSnapshotWorker({
          stateDir: config.stateDir,
          connection: cloudConnection,
          sourceNodeId: till.nodeId,
          isPrimary: cloudPrimary,
          readClock: () => withTransaction(db, (tx) => resolveVenueClock(tx, till.nodeId)),
          createArchive: (grant, at, signal) =>
            createCloudSnapshotArchive(
              {
                db,
                modules: ALL_MODULES,
                environment: config.environment,
                stateDir: config.stateDir,
              },
              grant.recoveryKey,
              at,
              signal,
            ),
          upload: async (grant, file, metadata, signal) => {
            await uploadCloudCaptureFile(grant, file, metadata, { signal });
          },
        }),
      })
    : undefined;
  undoOnFailure.push(async () => {
    cloudController.abort();
    await cloudWorker;
    await cloudSnapshots;
  });
  return makeStartedServer(
    server,
    health,
    log,
    {
      stopWork: async () => {
        controller.abort();
        cloudController.abort();
        await cloudWorker;
        await cloudSnapshots;
        unsubscribeFromChanges();
        liveEvents.close();
        tunnelController.abort();
        await loop;
        // Swallowed: a rejection here must never skip the store teardown.
        if (tunnelWorker !== undefined) await tunnelWorker.catch(() => {});
        await backupSupervisor.stop();
        // Litestream writes venue.db, so it stops before the store closes beneath it.
        await streamHost.stop();
      },
      closePools: () => store.close(),
    },
    mdns,
    startLandingListener(config, log),
    // Decided once at boot: a box exposes one in-process promote, never both.
    isMirror
      ? { kind: "mirror" as const, run: promoteMirrorRun }
      : {
          kind: "local-secondary" as const,
          run: (attestation: FenceAttestation) =>
            promoteLocalSecondaryToPrimary(promoteDeps, attestation),
        },
  );
}
