import {
  readDeploymentEnvironment,
  stampDeployment,
  withNodeTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import {
  pinPrimaryKeyTx,
  setNodeModeTx,
  setRecoveryKeyTx,
  writeMirrorLinkTx,
} from "@waitron/node-db";
import {
  listCredentials,
  loadKeyRing,
  sealNodeSigningKeyTx,
  type KeyRing,
} from "@waitron/credentials";
import { hashSecret } from "@waitron/identity";
import { verifyEndorsement } from "@waitron/membership";
import {
  assertNoForeignTenant,
  generatePassword,
  assertNoOperationalVenue,
  readTenantIdentities,
  readOperationalVenueIds,
} from "@waitron/provisioning";
import { enabledModules, parseModuleOverrides, type ModuleConfig } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { chooseBreakGlassKeyName } from "./break-glass.js";
import { keyRingEnv, writeVenueAuthority, type EncodedKeyRing } from "./box-secrets.js";
import type { DeploymentEnvironment } from "./config.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import { assertAdoptionModules, writePendingAdoption } from "./finish-adoption.js";
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
  /** The main box's authority as the person confirmed it; absent only for a plain-http loopback
   * main box. */
  confirmedCaPem?: string;
}

export interface AdoptHooks {
  /** Awaited after `adoptFromPrimary`'s own checks, immediately before `stampDeployment`, its first
   * writing step. */
  beforeFirstWrite: () => Promise<void>;
}

export interface AdoptDeps {
  /** Writes `deployment`. Nothing in the engine refuses this write;
   * `scripts/write-path-tables.test.ts` is what keeps it in named files. */
  ownerDb: Database;
  /** This box's node.db, where its role, its mirror link, its signing key, its recovery-key check
   * and the main box's public key are written. */
  ownerNode: NodeDatabase;
  /** The ring this box booted with. Adopt replaces it with the bundle's and seals nothing under it. */
  ring: KeyRing;
  /** Replaces `secrets.env` whole with the main box's ring, so the next boot opens what it sealed. */
  persistCredentialsRing: (ring: EncodedKeyRing) => Promise<void>;
  /** Sends the standby identity so the primary can reserve and endorse it. The fetcher, not this
   * orchestrator, throws `mirror.bundle_fetch_failed`. */
  fetchBundle: (
    primaryUrl: string,
    credential: AdoptCredential,
    standby: { nodeId: string; publicKey: string; contactUrl: string },
    confirmedCaPem?: string,
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
 * Every refusal `adoptFromPrimary` raises itself runs before any write to this node, and
 * `stampDeployment` precedes the node.db write because a node's role may be written only to a
 * stamped database. The caller restarts the box.
 */
export async function adoptFromPrimary(
  deps: AdoptDeps,
  req: AdoptRequest,
  hooks: AdoptHooks,
): Promise<{ breakGlassSecret: string; breakGlassKeyName: string }> {
  const standby = generateStandbyIdentity();
  const bundle = await deps.fetchBundle(
    req.primaryUrl,
    req.credential,
    { nodeId: standby.nodeId, publicKey: standby.publicKey, contactUrl: deps.advertisedOrigin },
    req.confirmedCaPem,
  );
  const { designated } = bundle;

  // Validated against THIS node's modules, so a skewed or hostile primary is refused before any
  // write to this node.
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

  // `stampDeployment` refuses this too, but only after `hooks.beforeFirstWrite`; every refusal
  // belongs before it.
  const stamped = await readDeploymentEnvironment(deps.ownerDb);
  if (stamped !== null && stamped !== bundle.environment) {
    throw new AppError("deployment.already_stamped", {
      stamped,
      requested: bundle.environment,
    });
  }

  assertAdoptionModules(enabledModules(ALL_MODULES, moduleConfig));

  // Joining replaces this box's ring with the main box's, so a row sealed under its own would
  // never open again.
  if ((await listCredentials(deps.ownerDb)).length > 0) {
    throw new AppError("mirror.vault_not_empty", {});
  }
  // This proves only that the bundle agrees with itself, not who sent it: checking the main box's
  // certificate fingerprint before the password is sent is the next step (the design's trust
  // section, docs/superpowers/specs/2026-10-21-a947-two-box-failover-design.md).
  const { endorsement } = bundle.reservedIdentity;
  if (
    endorsement.endorsedBy !== designated.nodeId ||
    !verifyEndorsement(endorsement, bundle.primaryPublicKey)
  ) {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }
  const ring = loadKeyRing(keyRingEnv(bundle.credentialsRing));
  const recoverySecret = generatePassword();
  const recoveryVerifier = hashSecret(recoverySecret);

  await hooks.beforeFirstWrite();
  await stampDeployment(deps.ownerDb, bundle.environment);
  await deps.persistCredentialsRing(bundle.credentialsRing);
  await writeVenueAuthority(deps.stateDir, {
    certPem: bundle.boxCaPem,
    keyPem: bundle.boxCaKeyPem,
  });
  // One transaction, so node.db never holds a mirror with no link, key or pin. The key is sealed
  // here, before finishing adoption puts its public half in venue.db, as everywhere a signing key
  // is first made: a public key with no private half could never sign as this box.
  const recoveryKeyName = await withNodeTransaction(deps.ownerNode, async (tx) => {
    await setNodeModeTx(tx, standby.nodeId, "mirror");
    await sealNodeSigningKeyTx(tx, ring, standby.nodeId, standby.privateKey);
    await writeMirrorLinkTx(tx, standby.nodeId, {
      relayUrl: bundle.relayUrl,
      boxHostname: bundle.boxHostname,
      boxCaPem: bundle.boxCaPem,
      // The PRIMARY's id, which the venue's rows carry, not the standby's own.
      originNodeId: designated.nodeId,
    });
    const name = await chooseBreakGlassKeyName(deps.ownerDb, tx, standby.nodeId);
    await setRecoveryKeyTx(tx, standby.nodeId, recoveryVerifier, name);
    await pinPrimaryKeyTx(tx, standby.nodeId, {
      primaryNodeId: designated.nodeId,
      publicKey: bundle.primaryPublicKey,
    });
    return name;
  });
  // Unconditional, even `{}`, so a re-adopt overwrites.
  await deps.persistModuleConfig(moduleConfig);
  await writePendingAdoption(deps.stateDir, {
    locationId: designated.locationId,
    standby: { nodeId: standby.nodeId, publicKey: standby.publicKey },
    nodeName: `${bundle.primaryNode.name} (standby)`,
    filingModule: bundle.primaryNode.filingModule,
    taxModule: bundle.primaryNode.taxModule,
    reserved: bundle.reservedIdentity,
    originNodeId: designated.nodeId,
  });
  await deps.persistTrading({
    locationId: designated.locationId,
    // The mirror runs under its OWN id, not the primary's.
    nodeId: standby.nodeId,
    environment: bundle.environment,
    accountKey: bundle.accountKey,
  });
  // Returned exactly once and never logged; only its verifier is stored.
  return { breakGlassSecret: recoverySecret, breakGlassKeyName: recoveryKeyName };
}
