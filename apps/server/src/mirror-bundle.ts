import "./errors.js";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { AppError, locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import {
  nodes,
  readDeploymentEnvironment,
  readNodeMembership,
  readTenant,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import {
  endorseKey,
  MAX_NODES,
  standingOf,
  type Endorsement,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import type { AdoptResult } from "@waitron/provisioning";
import {
  enabledModules,
  moduleOperationFor,
  serializeModuleConfig,
  snapshotModuleOperations,
  withPreparedModuleOperations,
  type ModuleOperations,
} from "@waitron/module";
import { caCertPath, caKeyPath, type EncodedKeyRing } from "./box-secrets.js";
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

/**
 * Three secrets travel in this bundle, which is sent only to an authenticated admin: `accountKey`,
 * `credentialsRing` (the key ring every sealed row on the main box opens with) and `boxCaKeyPem`
 * (the private key of the main box's certificate authority).
 */
export interface MirrorBundle {
  designated: AdoptResult;
  /** The venue's tenant identity, for the mirror's foreign-tenant guard (one tenant per database). */
  tenant: { country: string; taxId: string };
  /** The designated node's descriptor, so the reserved standby node row mirrors the primary's. */
  primaryNode: { name: string; filingModule: string | null; taxModule: string | null };
  environment: "production" | "preproduction";
  boxHostname: string;
  boxCaPem: string;
  relayUrl: string;
  /** Venue-wide key for encrypted account factors; transferred only inside this authenticated bundle. */
  accountKey: string;
  reservedIdentity: ReservedIdentity;
  /** The primary's module overrides, read at mint time; `{}` when nothing is disabled. */
  moduleOverrides: Record<string, boolean>;
  /** The box's WireGuard public key. */
  wireguardPublicKey?: string;
  /** The designated node's identity public key, which signed `reservedIdentity.endorsement`. */
  primaryPublicKey: string;
  credentialsRing: EncodedKeyRing;
  boxCaKeyPem: string;
}

function encodeKeyRing(ring: KeyRing): EncodedKeyRing {
  const encoded: EncodedKeyRing = {
    key: ring.current.key.toString("base64"),
    version: ring.current.version,
  };
  if (ring.previous !== undefined)
    encoded.previous = {
      key: ring.previous.key.toString("base64"),
      version: ring.previous.version,
    };
  return encoded;
}

// `ring` unseals the primary's identity private key, which signs the standby's endorsement, and
// travels whole as `credentialsRing`.
export interface AssembleDeps {
  appDb: Database;
  node: NodeDatabase;
  ring: KeyRing;
  stateDir: string;
  relayUrl: string;
  boxHostname: string;
  designated: AdoptResult;
  standby: { nodeId: string; publicKey: string };
  accountKey: string;
  wireguardPublicKey?: string;
  moduleOperations?: ModuleOperations;
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
  const standby = {
    nodeId: brandNodeId(deps.standby.nodeId),
    locationId: brandLocationId(deps.designated.locationId),
  };
  const { tenant, primaryNode } = await withTransaction(deps.appDb, async (tx) => {
    // Safe: every provisioned database holds the taxpayer row and the designated node's row.
    const t = (await readTenant(tx))!;
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
    return { tenant: t, primaryNode: n };
  });

  const environment = await readDeploymentEnvironment(deps.appDb);
  if (environment === null) throw new AppError("mirror.not_provisioned", {});

  // Read fresh, not from boot: the operator may have edited modules.json since, and a malformed file
  // must fail before collecting or writing any reservation.
  const moduleConfig = await readModuleConfig(deps.stateDir);
  const modules = enabledModules(ALL_MODULES, moduleConfig);

  for (const name of operations.keys()) {
    if (
      !modules.some((module) => module.name === name && module.provisioning?.standby !== undefined)
    )
      throw new AppError("module.operation_invalid", { module: name });
  }

  // Every module's reservation shares one transaction, so their reads and allocations agree.
  const [reserved, primaryPrivateKey, boxCaPem, boxCaKeyPem] = await Promise.all([
    withPreparedModuleOperations(modules, operations, standby.nodeId, "reserve", (prepared) =>
      withTransaction(deps.appDb, async (tx) => {
        // In the reservation's own transaction, so a removal commits wholly before or after it.
        const held = await readNodeMembership(tx);
        refuseRemovedStandby(held, deps.standby.nodeId);
        refuseFullChart(held, deps.standby.nodeId);
        const primary = {
          locationId: brandLocationId(deps.designated.locationId),
          nodeId: brandNodeId(deps.designated.nodeId),
        };
        const states: Record<string, unknown> = {};
        const series: { code: string; purpose: string }[] = [];
        for (const m of modules) {
          if (m.provisioning?.standby === undefined) continue;
          const operation = moduleOperationFor(prepared, m.name, standby.nodeId, "reserve");
          const r = await m.provisioning.standby.reserve(tx, primary, standby, operation);
          moduleOperationFor(prepared, m.name, standby.nodeId, "reserve");
          if (m.provisioning.standby.series === "on-activation" && (r.series?.length ?? 0) !== 0)
            throw new AppError("module.operation_invalid", { module: m.name });
          states[m.name] = r.state;
          series.push(...(r.series ?? []));
        }
        for (const m of modules) {
          if (m.provisioning?.standby !== undefined)
            moduleOperationFor(prepared, m.name, standby.nodeId, "reserve");
        }
        return { modules: states, series };
      }),
    ),
    readNodeIdentityKey(deps.node, deps.ring, deps.designated.nodeId),
    readFile(caCertPath(deps.stateDir), "utf8"),
    readFile(caKeyPath(deps.stateDir), "utf8"),
  ]);

  const endorsement = endorseKey(
    deps.standby.nodeId,
    deps.standby.publicKey,
    deps.designated.nodeId,
    primaryPrivateKey,
  );

  return {
    designated: { nodeId: deps.designated.nodeId, locationId: deps.designated.locationId },
    tenant: { country: tenant.country, taxId: tenant.taxId },
    primaryNode: {
      name: primaryNode.name,
      filingModule: primaryNode.filingModule,
      taxModule: primaryNode.taxModule,
    },
    environment,
    boxHostname: deps.boxHostname,
    boxCaPem,
    relayUrl: deps.relayUrl,
    accountKey: deps.accountKey,
    reservedIdentity: { ...reserved, endorsement },
    moduleOverrides: serializeModuleConfig(moduleConfig),
    wireguardPublicKey: deps.wireguardPublicKey,
    primaryPublicKey: nodeSigningPublicKey(primaryPrivateKey),
    credentialsRing: encodeKeyRing(deps.ring),
    boxCaKeyPem,
  };
}
