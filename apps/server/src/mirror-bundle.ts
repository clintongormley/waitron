import "./errors.js";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { AppError, nodeId as brandNodeId } from "@waitron/shared";
import {
  nodes,
  readDeploymentEnvironment,
  readNodeMembership,
  readTaxpayer,
  withTransaction,
  type Database,
  type NodeDatabase,
  type Transaction,
} from "@waitron/db";
import {
  endorseKey,
  MAX_NODES,
  standingOf,
  type Endorsement,
  type SignedMembershipDocument,
} from "@waitron/membership";
import {
  encodeKeyRing,
  nodeSigningPublicKey,
  type EncodedKeyRing,
  type KeyRing,
} from "@waitron/credentials";
import type { AdoptResult } from "@waitron/provisioning";
import {
  enabledModules,
  moduleOperationFor,
  serializeModuleConfig,
  snapshotModuleOperations,
  withPreparedModuleOperations,
  type ModuleConfig,
  type ModuleOperations,
} from "@waitron/module";
import { caCertPath, caKeyPath } from "./box-secrets.js";
import { readBackupSettings } from "./backup-env-writer.js";
import { readModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";
import { readNodeIdentityKey } from "./node-identity.js";

/**
 * What each module reserves is opaque here. `endorsement` is the primary's signature over the
 * standby's identity key, so other members can trust a document the standby later signs.
 */
export interface ReservedIdentity {
  /** Module name → the opaque state that module's `provisioning.standby.reserve` returned. */
  modules: Record<string, unknown>;
  /** The standby's invoice series, codes derived disjoint from the primary's by the reserving module. */
  series: { code: string; purpose: string }[];
  endorsement: Endorsement;
}

/** The access key the main box will use to stream into the spare's store. */
export interface PairStoreKey {
  accessKeyId: string;
  secretAccessKey: string;
  venueId: string;
}

export interface MirrorBundle {
  designated: AdoptResult;
  /** The venue's taxpayer identity, for the mirror's foreign-taxpayer guard (one taxpayer per database). */
  taxpayer: { country: string; taxId: string };
  /** The designated node's descriptor, so the reserved standby node row mirrors the primary's. */
  primaryNode: { name: string; filingModule: string | null; taxModule: string | null };
  environment: "production" | "preproduction";
  boxHostname: string;
  boxCaPem: string;
  /** The main box's own contact URL. */
  primaryUrl: string;
  store: PairStoreKey;

  reservedIdentity: ReservedIdentity;
  /** The primary's module overrides, read at mint time; `{}` when nothing is disabled. */
  moduleOverrides: Record<string, boolean>;
  /** The box's WireGuard public key. */
  wireguardPublicKey?: string;
  /** The designated node's identity public key, which signed `reservedIdentity.endorsement`. */
  primaryPublicKey: string;
  credentialsRing: EncodedKeyRing;
  /** The main box's `backup.env`, its values only; `null` when it holds none. */
  backupSettings: Record<string, string> | null;
  boxCaKeyPem: string;
}

// `ring` travels whole as `credentialsRing`, and unseals the primary's identity private key, which
// signs the standby's endorsement, when `primaryPrivateKey` does not carry it.
export interface AssembleDeps {
  appDb: Database;
  node: NodeDatabase;
  ring: KeyRing;
  stateDir: string;
  primaryUrl: string;
  store: PairStoreKey;
  boxHostname: string;
  designated: AdoptResult;
  standby: { nodeId: string; publicKey: string };

  wireguardPublicKey?: string;
  moduleOperations?: ModuleOperations;
  /** module settings as the caller read it for this request; read here when absent. */
  moduleConfig?: ModuleConfig;
  /** The designated node's private key, when the caller has already unsealed it. */
  primaryPrivateKey?: string;
  /**
   * Opens the transaction every module reserves in, so a caller's own writes in it commit with the
   * reservation or not at all. Defaults to one `withTransaction` on `appDb`.
   */
  reservationTransaction?: <T>(
    endorsement: Endorsement,
    reserve: (tx: Transaction) => Promise<T>,
  ) => Promise<T>;
}

export function refuseRemovedStandby(
  held: SignedMembershipDocument | null,
  standbyNodeId: string,
): void {
  if (held !== null && standingOf(held, standbyNodeId) === "evicted") {
    throw new AppError("mirror.standby_removed", {});
  }
}

/**
 * A standby the held chart does not list would be its (MAX_NODES + 1)th machine, which no receiver
 * verifies. A listed one adds nothing, so it is served.
 */
export function refuseFullChart(
  held: SignedMembershipDocument | null,
  standbyNodeId: string,
): void {
  if (
    held !== null &&
    held.body.nodes.length >= MAX_NODES &&
    !held.body.nodes.some((n) => n.nodeId === standbyNodeId)
  ) {
    throw new AppError("mirror.membership_full", { limit: MAX_NODES });
  }
}

// Throws `mirror.not_provisioned` when the database carries no deployment stamp,
// `mirror.standby_removed` when the held chart lists the standby as `evicted` or has cleared it, and
// `mirror.membership_full` when it has no place left for the standby.
export async function assembleMirrorBundle(deps: AssembleDeps): Promise<MirrorBundle> {
  const operations = snapshotModuleOperations(deps.moduleOperations);
  const standby = { nodeId: brandNodeId(deps.standby.nodeId) };
  const { taxpayer, primaryNode } = await withTransaction(deps.appDb, async (tx) => {
    // Safe: every provisioned database holds the taxpayer row and the designated node's row.
    const t = (await readTaxpayer(tx))!;
    const n = (
      await tx
        .select({
          name: nodes.name,
          filingModule: nodes.filingModule,
          taxModule: nodes.taxModule,
        })
        .from(nodes)
        .where(eq(nodes.id, deps.designated.nodeId))
    )[0]!;
    return { taxpayer: t, primaryNode: n };
  });

  const environment = await readDeploymentEnvironment(deps.appDb);
  if (environment === null) throw new AppError("mirror.not_provisioned", {});

  const moduleConfig = deps.moduleConfig ?? (await readModuleConfig(deps.appDb));
  const modules = enabledModules(ALL_MODULES, moduleConfig);
  const backupSettings = await readBackupSettings(deps.stateDir);

  for (const name of operations.keys()) {
    if (
      !modules.some((module) => module.name === name && module.provisioning?.standby !== undefined)
    )
      throw new AppError("module.operation_invalid", { module: name });
  }
  // A module whose series open on activation writes its dormant setup when the spare is switched
  // on, so the join reserves nothing for it, whatever operation the request carries.
  const reserving = modules.flatMap((module) => {
    const provision = module.provisioning?.standby;
    return provision === undefined || provision.series === "on-activation"
      ? []
      : [{ module, provision }];
  });
  const reservingOperations = new Map(
    [...operations].filter(([name]) => reserving.some(({ module }) => module.name === name)),
  );

  // Read before reserving, so a missing file fails the join before the caller's writes commit.
  const [primaryPrivateKey, boxCaPem, boxCaKeyPem] = await Promise.all([
    deps.primaryPrivateKey ?? readNodeIdentityKey(deps.node, deps.ring, deps.designated.nodeId),
    readFile(caCertPath(deps.stateDir), "utf8"),
    readFile(caKeyPath(deps.stateDir), "utf8"),
  ]);
  const endorsement = endorseKey(
    deps.standby.nodeId,
    deps.standby.publicKey,
    deps.designated.nodeId,
    primaryPrivateKey,
  );
  const reservationTransaction =
    deps.reservationTransaction ??
    (<T>(_: Endorsement, reserve: (tx: Transaction) => Promise<T>) =>
      withTransaction(deps.appDb, reserve));

  // Every module's reservation shares one transaction, so their reads and allocations agree.
  const reserved = await withPreparedModuleOperations(
    reserving.map(({ module }) => module),
    reservingOperations,
    standby.nodeId,
    "reserve",
    (prepared) =>
      reservationTransaction(endorsement, async (tx) => {
        // In the reservation's own transaction, so a removal commits wholly before or after it.
        const held = await readNodeMembership(tx);
        refuseRemovedStandby(held, deps.standby.nodeId);
        refuseFullChart(held, deps.standby.nodeId);
        const primary = { nodeId: brandNodeId(deps.designated.nodeId) };
        const states: Record<string, unknown> = {};
        const series: { code: string; purpose: string }[] = [];
        for (const { module, provision } of reserving) {
          const operation = moduleOperationFor(prepared, module.name, standby.nodeId, "reserve");
          const r = await provision.reserve(tx, primary, standby, operation);
          moduleOperationFor(prepared, module.name, standby.nodeId, "reserve");
          states[module.name] = r.state;
          series.push(...(r.series ?? []));
        }
        for (const { module } of reserving)
          moduleOperationFor(prepared, module.name, standby.nodeId, "reserve");
        return { modules: states, series };
      }),
  );

  return {
    designated: { nodeId: deps.designated.nodeId },
    taxpayer: { country: taxpayer.country, taxId: taxpayer.taxId },
    primaryNode: {
      name: primaryNode.name,
      filingModule: primaryNode.filingModule,
      taxModule: primaryNode.taxModule,
    },
    environment,
    boxHostname: deps.boxHostname,
    boxCaPem,
    primaryUrl: deps.primaryUrl,
    store: deps.store,

    reservedIdentity: { ...reserved, endorsement },
    moduleOverrides: serializeModuleConfig(moduleConfig),
    wireguardPublicKey: deps.wireguardPublicKey,
    primaryPublicKey: nodeSigningPublicKey(primaryPrivateKey),
    credentialsRing: encodeKeyRing(deps.ring),
    backupSettings,
    boxCaKeyPem,
  };
}
