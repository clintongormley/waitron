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

export type PersistTradingArgs = TradingConfig;

/** The admin login for the PRIMARY: it authorises the bundle mint there and never touches this
 * mirror's own database. `totp` is present only when the admin has TOTP enrolled. */
export interface AdoptCredential {
  personId: string;
  password: string;
  totp?: string;
}

export interface AdoptRequest {
  primaryUrl: string;
  credential: AdoptCredential;
}

export interface AdoptDeps {
  /** Writes `deployment`, `node_roles` and `mirror_config`. Nothing in the engine refuses these
   * writes; `scripts/write-path-tables.test.ts` is what keeps them in named files. */
  ownerDb: Database;
  /** Sends the standby identity so the primary can reserve and endorse it. The fetcher, not this
   * orchestrator, throws `mirror.bundle_fetch_failed`. */
  fetchBundle: (
    primaryUrl: string,
    credential: AdoptCredential,
    standby: { nodeId: string; publicKey: string; contactUrl: string },
  ) => Promise<MirrorBundle>;
  /** Sent as this node's `contactUrl`, which the primary records so a till can route here after a
   * failover. */
  advertisedOrigin: string;
  environment: DeploymentEnvironment;
  /** Persists `trading.env` so the next boot enters the trading branch. */
  persistTrading: (args: PersistTradingArgs) => Promise<void>;
  /** So the mirror's next boot sees the primary's enabled module set. */
  persistModuleConfig: (config: ModuleConfig) => Promise<void>;
  /** Where the finish-adoption latch is written. `PendingAdoption` in `finish-adoption.ts` says why
   * that step cannot complete today. */
  stateDir: string;
  /** The mirror's database NAME, echoed by `provisioning.foreign_tenant`. */
  database: string;
}

/**
 * Adopts an existing venue into this mirror's own database. It inserts no scaffold rows and registers
 * no SIF, so it forks no fiscal chain; the reserved standby identity stays dormant.
 *
 * Every refusal runs before any mutation, and `stampDeployment` precedes `setDeploymentMode` because
 * a node's role may be written only to a stamped database. The caller restarts the box.
 */
export async function adoptFromPrimary(
  deps: AdoptDeps,
  req: AdoptRequest,
): Promise<{ breakGlassSecret: string }> {
  const standby = generateStandbyIdentity();
  const bundle = await deps.fetchBundle(req.primaryUrl, req.credential, {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    contactUrl: deps.advertisedOrigin,
  });
  const { designated } = bundle;

  // Validated against THIS node's modules, so a skewed or hostile primary is refused before any
  // mutation.
  const moduleConfig = parseModuleOverrides(bundle.moduleOverrides, ALL_MODULES);

  // One database serves one environment (CLAUDE.md §5).
  if (bundle.environment !== deps.environment) {
    throw new AppError("mirror.environment_mismatch", {
      expected: deps.environment,
      actual: bundle.environment,
    });
  }

  assertNoForeignTenant(
    await readTenantIdentities(deps.ownerDb),
    { country: bundle.tenant.country, taxId: bundle.tenant.taxId },
    deps.database,
  );
  assertNoOperationalVenue(await readOperationalVenueIds(deps.ownerDb));

  await stampDeployment(deps.ownerDb, bundle.environment);
  await setDeploymentMode(deps.ownerDb, standby.nodeId, "mirror");
  await writeMirrorConfig(deps.ownerDb, standby.nodeId, {
    relayUrl: bundle.relayUrl,
    boxHostname: bundle.boxHostname,
    boxCaPem: bundle.boxCaPem,
    // The PRIMARY's id, which the venue's rows carry, not the standby's own.
    originNodeId: designated.nodeId,
  });
  // Unconditional, even `{}`, so a re-adopt overwrites.
  await deps.persistModuleConfig(moduleConfig);
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
    // The mirror runs under its OWN id, not the primary's.
    nodeId: standby.nodeId,
    seriesId: designated.seriesId,
    environment: bundle.environment,
    accountKey: bundle.accountKey,
  });
  // Returned exactly once and never logged; only its verifier is stored.
  const breakGlassSecret = await mintBreakGlassSecret(deps.ownerDb, standby.nodeId);

  return { breakGlassSecret };
}
