import { setDeploymentMode, stampDeployment, writeMirrorConfig, type Database } from "@waitron/db";
import {
  assertNoForeignTenant,
  readTenantIdentities,
  REPLICATION_ROLE,
} from "@waitron/provisioning";
import { assertReplicationReady } from "@waitron/provisioning";
import {
  buildConninfo,
  createSubscription,
  dropSubscription,
  enableSubscription,
  publicationName,
  readSubscriptionStatus,
  subscriptionName,
  type SubscriptionStatus,
} from "@waitron/sync";
import { parseModuleOverrides, type ModuleConfig } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import type { DeploymentEnvironment } from "./config.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import { writePendingAdoption } from "./finish-adoption.js";
import type { TradingConfig } from "./trading-config.js";
import "./errors.js";

/** The setup-api `persistTrading` dep shape — an alias for `TradingConfig` (trading-config.ts), the
 * env the supervisor sources on the next boot so the mirror enters the trading branch (design §6). */
export type PersistTradingArgs = TradingConfig;

/** The admin login the operator supplies for the PRIMARY (design §8), the SAME shape the primary's
 * `POST /management-api/mirror-bundle` authenticates by id (`loginManagerById`). `totp` is present
 * only when the admin has TOTP enrolled. It authorises the bundle mint on the primary; it never
 * touches the mirror's own database. */
export interface AdoptCredential {
  personId: string;
  password: string;
  totp?: string;
}

/** The operator's two inputs (design §8): the primary's address and the admin login for it. */
export interface AdoptRequest {
  primaryUrl: string;
  credential: AdoptCredential;
}

/**
 * The native-replication verbs the orchestrator drives against the mirror's OWN replication pool,
 * injected so `adopt.test.ts` can assert the ORDER (readiness → create → status → enable) and the
 * CLEANUP (drop on a missing publication or a mid-orchestration throw) WITHOUT a live publisher.
 * Defaults to the real `@waitron/sync`/`@waitron/provisioning` implementations. `assertReady` is the
 * cluster-wide replication-readiness precondition; `create` is the disabled initial-copy subscription;
 * `readStatus` reports `tablesTotal` (the whole publication-missing signal, probe C); `enable` starts
 * the apply worker after the mirror's config is committed; `drop` removes the subscription on failure.
 */
export interface ReplicationVerbs {
  assertReady: (db: Database) => Promise<void>;
  create: (
    db: Database,
    opts: {
      name: string;
      conninfo: string;
      publications: readonly string[];
      copyData: boolean;
      enabled: boolean;
    },
  ) => Promise<void>;
  readStatus: (db: Database, name: string) => Promise<SubscriptionStatus>;
  enable: (db: Database, name: string) => Promise<void>;
  drop: (db: Database, name: string) => Promise<void>;
}

const REAL_REPLICATION: ReplicationVerbs = {
  assertReady: assertReplicationReady,
  create: createSubscription,
  readStatus: readSubscriptionStatus,
  enable: enableSubscription,
  drop: dropSubscription,
};

export interface AdoptDeps {
  /** The OWNER connection to the mirror's database (`migrationsDatabaseUrl`) — stamps `deployment`,
   * writes `mirror_config`, mints the break-glass verifier. `app_user` holds none of those writes. */
  ownerDb: Database;
  /** The dedicated OWNER replication pool (M8) the subscription verbs run over — the migrator holds
   * `pg_create_subscription` and owns the subscription it creates. Kept distinct from `ownerDb`. */
  replicationDb: Database;
  /** Fetches the bundle from the primary, carrying the mirror's own `standby` identity so the primary
   * can reserve + endorse it (membership promotion R2). Injected so the HTTP call is stubbable and the
   * orchestration is testable against a hand-built bundle. Throws `mirror.bundle_fetch_failed` on a
   * failed fetch — surfaced by the fetcher, not this orchestrator. */
  fetchBundle: (
    primaryUrl: string,
    credential: AdoptCredential,
    standby: { nodeId: string; publicKey: string; contactUrl: string },
  ) => Promise<MirrorBundle>;
  /** This node's own advertised origin (`config.advertisedOrigin`), sent to the primary as the joining
   * node's `contactUrl`: the primary records it in the membership document so a till can route here
   * after a failover (till-reroute design §3.3). */
  advertisedOrigin: string;
  /** This box's deployment environment (`config.environment`). Adopt refuses a bundle whose
   * environment differs (`mirror.environment_mismatch`) — one database serves one environment (§5). */
  environment: DeploymentEnvironment;
  /** Persists `trading.env` so the next boot enters the trading branch (bound to `writeTradingEnv`). */
  persistTrading: (args: PersistTradingArgs) => Promise<void>;
  /** Persists `<stateDir>/modules.json` so the mirror's next boot sees the primary's enabled set
   * (SP-1d). Injected — bound to `writeModuleConfig(config.stateDir, …)` in boot. */
  persistModuleConfig: (config: ModuleConfig) => Promise<void>;
  /** The box's persisted state dir — where `pending-adoption.json` (the finish-worker latch) is
   * written so a mirror boot can establish the reserved identity once the initial copy completes. */
  stateDir: string;
  /** The app-pool connection string, written into `trading.env` as `DATABASE_URL`. */
  databaseUrl: string;
  /** The owner connection string, written into `trading.env` as `WAITRON_MIGRATIONS_DATABASE_URL`. */
  migrationsDatabaseUrl: string;
  /** The NAME of the mirror's own database, echoed by `provisioning.foreign_tenant` when a bundle for
   * a DIFFERENT tenant is adopted into a database that already holds one. */
  database: string;
  /** The native-replication verbs seam (defaults to the real implementations). */
  replication?: ReplicationVerbs;
}

/**
 * Adopt an existing venue into this mirror's own database by establishing a NATIVE subscription to the
 * primary (swap step 4, design §5), the mirror-side analogue of `provisionVenue`. It mints the
 * standby's identity in memory, fetches the primary's bundle (sending that identity for reservation +
 * endorsement), refuses a bundle for a different environment or a foreign tenant, then creates a
 * DISABLED subscription that COPIES every published table. Because a native COPY cannot coexist with
 * pre-inserted rows (derived fact 1), adopt no longer inserts scaffold rows and never `registerSif`s —
 * it forks no fiscal chain (CLAUDE.md §5). The reserved standby identity is DORMANT and is established
 * later by the boot-time finish worker (Task 5), once every table has finished its initial copy; adopt
 * only records the latch (`writePendingAdoption`).
 *
 * The order is load-bearing. `assertReady` runs before any subscription work. A publication name the
 * primary does not serve only WARNs and copies nothing (probe C), so adopt reads the subscription
 * status, sees `tablesTotal === 0`, DROPS the subscription and throws `sync.publication_missing` —
 * never leaving a dead subscription behind. The mirror's config is committed inside a try/catch that
 * DROPS the subscription on any throw, so a partial failure leaves neither a half-adopted database nor
 * an orphan subscription. Only after the config is durable is the subscription ENABLED — a crash before
 * that leaves an inert, dropped-on-retry subscription, never a mirror applying rows into a database
 * whose stamp/mirror_config are not yet written.
 *
 * This function does NOT restart the box; the `/setup-api/adopt` endpoint does that after `trading.env`
 * is persisted, the same persist-then-restart transition `provision` uses.
 */
export async function adoptFromPrimary(
  deps: AdoptDeps,
  req: AdoptRequest,
): Promise<{ tenantId: string; breakGlassSecret: string }> {
  const replication = deps.replication ?? REAL_REPLICATION;

  // Mint the standby's own identity in memory BEFORE the fetch (design §6 R2): its public half + nodeId
  // go to the primary, which reserves the standby's fiscal identity and endorses its key, returning
  // both in `bundle.reservedIdentity`. This node's advertised origin rides along as the joining node's
  // `contactUrl`, which the primary appends to the membership document (till-reroute §3.3).
  const standby = generateStandbyIdentity();
  const bundle = await deps.fetchBundle(req.primaryUrl, req.credential, {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    contactUrl: deps.advertisedOrigin,
  });
  const { designated } = bundle;

  // SP-1d: validate the primary's enabled-module set FIRST — fail fast, before any side effect. It is a
  // bare override map (bundle wire value), re-validated against THIS node's ALL_MODULES: an
  // unknown/malformed override from a skewed or hostile primary throws `module.config_*` here, before
  // any mutation.
  const moduleConfig = parseModuleOverrides(bundle.moduleOverrides, ALL_MODULES);

  // One database serves one environment (§5). A bundle for a DIFFERENT environment can never be adopted
  // here — a preproduction mirror holding a production venue's chain would leave a permanent hole in
  // the production series. Refused before any subscription or stamp.
  if (bundle.environment !== deps.environment) {
    throw new AppError("mirror.environment_mismatch", {
      expected: deps.environment,
      actual: bundle.environment,
    });
  }

  // Refuse a FOREIGN tenant before any mutation, the third caller of the shared one-tenant guard
  // (`tenant-guard.ts`; the siblings: `provisionVenue`, the `venue` CLI). The applied identity is the
  // bundle tenant's `(country, tax_id)` — the venue rows are not in the bundle any more (the COPY
  // brings them), so the identity travels as its own field.
  assertNoForeignTenant(
    await readTenantIdentities(deps.ownerDb),
    { country: bundle.tenant.country, taxId: bundle.tenant.taxId },
    deps.database,
  );

  // The instance must be replication-ready before a subscription is created — the app provisioner only
  // VERIFIES the superuser/box-image bootstrap (`provisioning.replication_not_ready`), never performs it.
  await replication.assertReady(deps.replicationDb);

  const name = subscriptionName(bundle.environment, standby.nodeId);
  const publications = [
    publicationName(bundle.environment, "ledger"),
    publicationName(bundle.environment, "state"),
  ];
  // Create the initial-copy subscription DISABLED: `pg_subscription_rel` is populated at CREATE (probe
  // C), so the status read below sees every table to copy. The conninfo carries the primary's
  // `waitron_repl` password and is SECRET — `createSubscription` logs only a SQLSTATE on failure.
  await replication.create(deps.replicationDb, {
    name,
    conninfo: buildConninfo({ ...bundle.replication, user: REPLICATION_ROLE }),
    publications,
    copyData: true,
    enabled: false,
  });

  // A publication name absent on the publisher only WARNs and leaves `pg_subscription_rel` EMPTY (probe
  // C) — so a subscription that copies NOTHING is a silent mis-wire. Detect it by `tablesTotal === 0`,
  // DROP the dead subscription, and fail loud rather than boot a mirror that never copies its venue.
  const status = await replication.readStatus(deps.replicationDb, name);
  if (status.tablesTotal === 0) {
    await replication.drop(deps.replicationDb, name);
    throw new AppError("sync.publication_missing", { subscription: name });
  }

  // Commit the mirror's config behind a cleanup guard: any throw here DROPS the subscription so no
  // orphan is left applying into a half-stamped database. `stampDeployment` runs BEFORE
  // `setDeploymentMode` (the `mode` UPDATE needs the singleton row). The environment is the primary's
  // (immutable, one database per environment, §5).
  let breakGlassSecret: string;
  try {
    await stampDeployment(deps.ownerDb, bundle.environment);
    await setDeploymentMode(deps.ownerDb, "mirror");
    await writeMirrorConfig(deps.ownerDb, {
      relayUrl: bundle.relayUrl,
      boxHostname: bundle.boxHostname,
      boxCaPem: bundle.boxCaPem,
      // The sync ORIGIN — the PRIMARY's node id (membership promotion R3a): the node whose replicated
      // rows this mirror holds, distinct from the standby's OWN id it runs under.
      originNodeId: designated.nodeId,
    });
    // SP-1d: persist the module set validated up-front, so the mirror's next boot sees the primary's
    // enabled set (unconditional, even `{}`, so a re-adopt is an idempotent overwrite).
    await deps.persistModuleConfig(moduleConfig);
    // The finish-worker latch (derived fact 1 / C6): the reserved standby identity is DORMANT and its
    // establish (which FKs to the copied tenant/location rows) waits until the initial copy completes.
    // Boot's `runFinishAdoption` reads this file, establishes once every `pg_subscription_rel` row
    // reaches `r`, then unlinks it.
    await writePendingAdoption(deps.stateDir, {
      tenantId: designated.tenantId,
      locationId: designated.locationId,
      standby,
      nodeName: `${bundle.primaryNode.name} (standby)`,
      filingModule: bundle.primaryNode.filingModule,
      taxModule: bundle.primaryNode.taxModule,
      reserved: bundle.reservedIdentity,
      originNodeId: designated.nodeId,
    });
    await deps.persistTrading({
      tenantId: designated.tenantId,
      locationId: designated.locationId,
      tillId: designated.tillId,
      // The mirror's OWN node id (the standby minted above), NOT `designated.nodeId` — from R3a the
      // mirror runs under its own identity (the subscriber it applies as, the origin it stamps its own
      // writes with once promoted). `seriesId` stays `designated.*` (inert on a read-only mirror),
      // corrected to the cloud's own reserved series at R3b.
      nodeId: standby.nodeId,
      seriesId: designated.seriesId,
      databaseUrl: deps.databaseUrl,
      migrationsDatabaseUrl: deps.migrationsDatabaseUrl,
      environment: bundle.environment,
    });
    // Mint the offline break-glass secret AFTER the mirror is stamped: this is the ONLY promotable
    // node, so adopt is the right enrolment point. The raw secret is returned exactly once; only its
    // scrypt verifier is persisted, and it is NEVER logged.
    breakGlassSecret = await mintBreakGlassSecret(deps.ownerDb);
  } catch (error) {
    await replication.drop(deps.replicationDb, name).catch(() => {});
    throw error;
  }

  // Only now, with the mirror's config durable, ENABLE the subscription so the initial copy begins.
  await replication.enable(deps.replicationDb, name);

  return { tenantId: designated.tenantId, breakGlassSecret };
}
