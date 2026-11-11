import {
  readDeploymentEnvironment,
  stampDeployment,
  withNodeTransaction,
  type Database,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import {
  deleteNodeMirrorLinkOtherThanTx,
  deleteNodeModeOtherThanTx,
  deleteNodePrimaryKeyOtherThanTx,
  deleteNodeRecoveryKeyOtherThanTx,
  NODE_CLASSIFICATION,
  pinPrimaryKeyTx,
  setNodeModeTx,
  writeMirrorLinkTx,
} from "@waitron/node-db";
import {
  deleteNodePairLinkOtherThanTx,
  deleteNodeSigningKeyOtherThanTx,
  listCredentials,
  loadKeyRing,
  sealNodeSigningKeyTx,
  writePairLinkTx,
  type KeyRing,
} from "@waitron/credentials";
import { verifyEndorsement } from "@waitron/membership";
import {
  assertNoForeignTenant,
  assertNoOperationalVenue,
  readTenantIdentities,
  readOperationalVenueIds,
} from "@waitron/provisioning";
import { enabledModules, parseModuleOverrides, type ModuleConfig } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { makeBreakGlassSecret, mintBreakGlassKeyTx } from "./break-glass.js";
import { keyRingEnv, type EncodedKeyRing } from "./box-secrets.js";
import { assertAuthorityKeyMatches, installVenueAuthority, markJoined } from "./box-tls-install.js";
import type { DeploymentEnvironment } from "./config.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import { assertAdoptionModules, writePendingAdoption } from "./finish-adoption.js";
import type { TradingConfig } from "./trading-config.js";
import { leafHostnamesFor, ownContactUrl } from "./box-name.js";
import "./errors.js";

/**
 * What adopt deletes, per node.db table, of rows keyed by any node id but the one it adopts under:
 * an earlier join that stopped after its node transaction left them under the id it drew (A1280).
 */
const ABANDONED_ROW_SWEEPS: Readonly<
  Record<string, (tx: NodeTransaction, nodeId: string) => Promise<void>>
> = {
  node_mode: deleteNodeModeOtherThanTx,
  node_mirror_link: deleteNodeMirrorLinkOtherThanTx,
  node_recovery_key: deleteNodeRecoveryKeyOtherThanTx,
  node_signing_key: deleteNodeSigningKeyOtherThanTx,
  node_primary_key: deleteNodePrimaryKeyOtherThanTx,
  node_pair_link: deleteNodePairLinkOtherThanTx,
};

/** The handover tables, which adopt leaves whole: they record what this box did, under its ids. */
const NODE_TABLES_KEPT_AT_ADOPT: readonly string[] = [
  "node_handover_operations",
  "node_handover_events",
  "node_handover_restriction",
];

/** The tables of `tables` that adopt neither sweeps nor names as kept. */
export function nodeTablesAdoptLeaves(tables: readonly string[]): string[] {
  return tables.filter(
    (table) => !(table in ABANDONED_ROW_SWEEPS) && !NODE_TABLES_KEPT_AT_ADOPT.includes(table),
  );
}

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
  /** Awaited after `adoptFromPrimary`'s own checks, immediately before its first writing step. */
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
  /** Sends the standby identity so the primary can reserve and endorse it. */
  fetchBundle: (
    primaryUrl: string,
    credential: AdoptCredential,
    standby: {
      nodeId: string;
      publicKey: string;
      contactUrl: string;
      storeUrl: string;
      at: number;
    },
    confirmedCaPem?: string,
  ) => Promise<MirrorBundle>;
  /** Its `ownContactUrl` is sent as this node's `contactUrl`, which the primary records so a till
   * can route here after a failover. */
  advertisedOrigin: string;
  /** This box's store port; its name and this port are sent as the spare's store address (D15). */
  spareStorePort: number;
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
  /** The addresses this box's leaf names beyond 127.0.0.1, as at a setup start. */
  listIpv4: () => string[];
  now: () => Date;
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
  const contactUrl = ownContactUrl(deps.advertisedOrigin, standby.nodeId);
  const storeUrl = new URL(contactUrl);
  storeUrl.protocol = "https:";
  storeUrl.port = String(deps.spareStorePort);
  const bundle = await deps.fetchBundle(
    req.primaryUrl,
    req.credential,
    {
      nodeId: standby.nodeId,
      publicKey: standby.publicKey,
      contactUrl,
      storeUrl: storeUrl.origin,
      at: deps.now().getTime(),
    },
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
  // This proves only that the bundle agrees with itself and with the identity this box sent, not
  // who sent it: that rests on the authority the person confirmed, which `fetchMirrorBundle` trusts
  // before it sends the password (trust and fencing,
  // docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md §6).
  const { endorsement } = bundle.reservedIdentity;
  if (
    endorsement.nodeId !== standby.nodeId ||
    endorsement.publicKey !== standby.publicKey ||
    endorsement.endorsedBy !== designated.nodeId ||
    !verifyEndorsement(endorsement, bundle.primaryPublicKey)
  ) {
    throw new AppError("mirror.bundle_fetch_failed", {});
  }
  assertAuthorityKeyMatches(bundle.boxCaPem, bundle.boxCaKeyPem);
  const ring = loadKeyRing(keyRingEnv(bundle.credentialsRing));
  const recovery = makeBreakGlassSecret();

  await hooks.beforeFirstWrite();
  // Before the main box's ring replaces this box's, so a join stopped at any later point leaves
  // the marker.
  await markJoined(deps.stateDir, designated.nodeId);
  await stampDeployment(deps.ownerDb, bundle.environment);
  await deps.persistCredentialsRing(bundle.credentialsRing);
  await installVenueAuthority({
    stateDir: deps.stateDir,
    authority: { certPem: bundle.boxCaPem, keyPem: bundle.boxCaKeyPem },
    hostnames: leafHostnamesFor(standby.nodeId),
    listIpv4: deps.listIpv4,
    now: deps.now,
  });
  // One transaction, so node.db never holds a mirror with no link, key or pin. The key is sealed
  // here, before finishing adoption puts its public half in venue.db, as everywhere a signing key
  // is first made: a public key with no private half could never sign as this box.
  const recoveryKeyName = await withNodeTransaction(deps.ownerNode, async (tx) => {
    for (const { table } of NODE_CLASSIFICATION) {
      await ABANDONED_ROW_SWEEPS[table]?.(tx, standby.nodeId);
    }
    await setNodeModeTx(tx, standby.nodeId, "mirror");
    await sealNodeSigningKeyTx(tx, ring, standby.nodeId, standby.privateKey);
    await writeMirrorLinkTx(tx, standby.nodeId, {
      originUrl: bundle.primaryUrl,
      boxHostname: bundle.boxHostname,
      boxCaPem: bundle.boxCaPem,
      // The PRIMARY's id, which the venue's rows carry, not the standby's own.
      originNodeId: designated.nodeId,
    });
    await writePairLinkTx(tx, ring, standby.nodeId, {
      role: "serves",
      state: "awaiting_copy",
      peerNodeId: designated.nodeId,
      peerPublicKey: bundle.primaryPublicKey,
      storeUrl: storeUrl.origin,
      ...bundle.store,
    });
    const { name } = await mintBreakGlassKeyTx(deps.ownerDb, tx, standby.nodeId, recovery);
    await pinPrimaryKeyTx(tx, standby.nodeId, {
      primaryNodeId: designated.nodeId,
      publicKey: bundle.primaryPublicKey,
    });
    return name;
  });
  // Unconditional, even `{}`, so a re-adopt overwrites.
  await deps.persistModuleConfig(moduleConfig);
  await writePendingAdoption(deps.stateDir, {
    standby: { nodeId: standby.nodeId, publicKey: standby.publicKey },
    nodeName: `${bundle.primaryNode.name} (standby)`,
    filingModule: bundle.primaryNode.filingModule,
    taxModule: bundle.primaryNode.taxModule,
    reserved: bundle.reservedIdentity,
    originNodeId: designated.nodeId,
  });
  await deps.persistTrading({
    // The mirror runs under its OWN id, not the primary's.
    nodeId: standby.nodeId,
    environment: bundle.environment,
    accountKey: bundle.accountKey,
  });
  // Returned exactly once and never logged; only its verifier is stored.
  return { breakGlassSecret: recovery.secret, breakGlassKeyName: recoveryKeyName };
}
