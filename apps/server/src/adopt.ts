import { setDeploymentMode, stampDeployment, writeMirrorConfig, type Database } from "@waitron/db";
import {
  assertNoForeignTenant,
  assertNoOperationalVenue,
  readTenantIdentities,
  readOperationalVenueIds,
} from "@waitron/provisioning";
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

export interface AdoptDeps {
  /** The OWNER connection to the mirror's database (`adminDatabaseUrl`) — stamps `deployment`,
   * writes `mirror_config`, mints the break-glass verifier. `app_user` holds none of those writes. */
  ownerDb: Database;
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
   * written, because adopt scaffolds no venue rows and so cannot establish the reserved identity
   * itself. `runFinishAdoption` retries that step on every boot and cannot complete it today:
   * `finish-adoption.ts`'s `PendingAdoption` header is the one place that says why. */
  stateDir: string;
  /** The NAME of the mirror's own database, echoed by `provisioning.foreign_tenant` when a bundle for
   * a DIFFERENT tenant is adopted into a database that already holds one. */
  database: string;
}

/**
 * Adopt an existing venue into this mirror's own database, the mirror-side analogue of
 * `provisionVenue`. It mints the standby's identity in memory, fetches the primary's bundle (sending
 * that identity for reservation + endorsement), refuses a bundle for a different environment or a
 * foreign tenant, then stamps this database as a mirror and persists its config. Adopt inserts no
 * scaffold rows and never `registerSif`s — it forks no fiscal chain (CLAUDE.md §5). The reserved
 * standby identity is DORMANT: adopt only records the latch (`writePendingAdoption`), which the
 * boot-time finish worker retries and cannot complete today — see `finish-adoption.ts`'s
 * `PendingAdoption` header.
 *
 * The order is load-bearing: every refusal — a skewed module set, the wrong environment, a foreign
 * tenant, an operational venue already here — runs BEFORE any mutation. `stampDeployment` runs before
 * `setDeploymentMode`, because the `mode` UPDATE needs the singleton row. The environment is the
 * primary's (immutable, one database per environment, §5).
 *
 * This function does NOT restart the box; the `/setup-api/adopt` endpoint does that after `trading.env`
 * is persisted, the same persist-then-restart transition `provision` uses.
 */
export async function adoptFromPrimary(
  deps: AdoptDeps,
  req: AdoptRequest,
): Promise<{ breakGlassSecret: string }> {
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
  // the production series. Refused before any stamp.
  if (bundle.environment !== deps.environment) {
    throw new AppError("mirror.environment_mismatch", {
      expected: deps.environment,
      actual: bundle.environment,
    });
  }

  // Refuse a FOREIGN tenant before any mutation, the third caller of the shared one-tenant guard
  // (`tenant-guard.ts`; the siblings: `provisionVenue`, the `venue` CLI). The applied identity is the
  // bundle tenant's `(country, tax_id)`: the venue rows themselves do not travel in the bundle, so the
  // identity travels as its own field.
  assertNoForeignTenant(
    await readTenantIdentities(deps.ownerDb),
    { country: bundle.tenant.country, taxId: bundle.tenant.taxId },
    deps.database,
  );
  assertNoOperationalVenue(await readOperationalVenueIds(deps.ownerDb));

  await stampDeployment(deps.ownerDb, bundle.environment);
  await setDeploymentMode(deps.ownerDb, "mirror");
  await writeMirrorConfig(deps.ownerDb, {
    relayUrl: bundle.relayUrl,
    boxHostname: bundle.boxHostname,
    boxCaPem: bundle.boxCaPem,
    // The ORIGIN — the PRIMARY's node id (membership promotion R3a): the node whose id the venue's
    // rows carry, and so what this mirror's node-scoped reads resolve against, distinct from the
    // standby's OWN id it runs under.
    originNodeId: designated.nodeId,
  });
  // SP-1d: persist the module set validated up-front, so the mirror's next boot sees the primary's
  // enabled set (unconditional, even `{}`, so a re-adopt is an idempotent overwrite).
  await deps.persistModuleConfig(moduleConfig);
  // The finish-worker latch: the reserved standby identity is DORMANT and its establish (which FKs to
  // the venue's `locations` row) is attempted by boot's `runFinishAdoption`, which reads this file and
  // unlinks it once the step succeeds — which it cannot on a mirror today (`finish-adoption.ts`'s
  // `PendingAdoption` header).
  await writePendingAdoption(deps.stateDir, {
    locationId: designated.locationId,
    standby,
    nodeName: `${bundle.primaryNode.name} (standby)`,
    filingModule: bundle.primaryNode.filingModule,
    taxModule: bundle.primaryNode.taxModule,
    reserved: bundle.reservedIdentity,
    originNodeId: designated.nodeId,
  });
  await deps.persistTrading({
    locationId: designated.locationId,
    tillId: designated.tillId,
    // The mirror's OWN node id (the standby minted above), NOT `designated.nodeId` — from R3a the
    // mirror runs under its own identity (the origin it stamps its own writes with once promoted).
    // `seriesId` stays `designated.*` (inert on a read-only mirror), corrected to the cloud's own
    // reserved series at R3b.
    nodeId: standby.nodeId,
    seriesId: designated.seriesId,
    environment: bundle.environment,
    accountKey: bundle.accountKey,
  });
  // Mint the offline break-glass secret AFTER the mirror is stamped: this is the ONLY promotable
  // node, so adopt is the right enrolment point. The raw secret is returned exactly once; only its
  // scrypt verifier is persisted, and it is NEVER logged.
  const breakGlassSecret = await mintBreakGlassSecret(deps.ownerDb);

  return { breakGlassSecret };
}
