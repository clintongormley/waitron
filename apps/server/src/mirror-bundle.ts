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
} from "@waitron/db";
import {
  endorseKey,
  MAX_NODES,
  standingOf,
  type Endorsement,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
import type { AdoptResult } from "@waitron/provisioning";
import { enabledModules, serializeModuleConfig } from "@waitron/module";
import { caCertPath } from "./box-secrets.js";
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
}

// `ring` unseals the primary's identity private key, which signs the standby's endorsement.
export interface AssembleDeps {
  appDb: Database;
  ring: KeyRing;
  stateDir: string;
  relayUrl: string;
  boxHostname: string;
  designated: AdoptResult;
  standby: { nodeId: string; publicKey: string };
  accountKey: string;
  wireguardPublicKey?: string;
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
  // must fail here, before the reservation bumps any counter.
  const moduleConfig = await readModuleConfig(deps.stateDir);
  const modules = enabledModules(ALL_MODULES, moduleConfig);

  // Every module's reservation shares one transaction, so their reads and allocations agree.
  const [reserved, primaryPrivateKey, boxCaPem] = await Promise.all([
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
        const r = await m.provisioning.standby.reserve(tx, primary);
        states[m.name] = r.state;
        series.push(...(r.series ?? []));
      }
      return { modules: states, series };
    }),
    readNodeIdentityKey(deps.appDb, deps.ring),
    readFile(caCertPath(deps.stateDir), "utf8"),
  ]);

  const endorsement = endorseKey(
    deps.standby.nodeId,
    deps.standby.publicKey,
    deps.designated.nodeId,
    primaryPrivateKey,
  );

  return {
    designated: deps.designated,
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
  };
}
