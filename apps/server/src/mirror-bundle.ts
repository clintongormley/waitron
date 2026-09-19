// The PRIMARY side of the cloud-mirror adopt flow (design §10). `assembleMirrorBundle` reads the
// venue's tenant identity + the designated node's descriptor, reserves the standby's dormant
// identity, and returns a `MirrorBundle` the endpoint serves. The bundle carries IDENTITY and DIAL
// details only — it carries no per-peer credential and none of the venue's parent ROWS. How a mirror
// obtains the venue's data is an open question: the PostgreSQL replication that used to answer it is
// deleted and its replacement has not landed.
//
// The deployment holds one tenant per database. The tenant row and the designated node row are
// selected by id; `app_user` holds SELECT on both in the core baseline.
import "./errors.js";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { AppError, locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import {
  nodes,
  readDeploymentEnvironment,
  readTenant,
  withTransaction,
  type Database,
} from "@waitron/db";
import { endorseKey, type Endorsement } from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
import type { AdoptResult } from "@waitron/provisioning";
import { enabledModules, serializeModuleConfig } from "@waitron/module";
import { caCertPath } from "./box-secrets.js";
import { readModuleConfig } from "./module-config.js";
import { ALL_MODULES } from "./modules.js";
import { readNodeIdentityKey } from "./node-identity.js";

/**
 * The dormant identity the PRIMARY reserves for a standby at adopt (reserved-standby-identity design
 * §4/§6 R2). What each module reserves is that module's own business and opaque here — the carrier
 * neither reads nor validates it. `endorsement` vouches for the standby's identity key, signed by the
 * primary's identity key — the chain-back-to-setup that lets other members trust a document the
 * standby later signs.
 */
export interface ReservedIdentity {
  /** Module name → the opaque state that module's `provisioning.standby.reserve` returned. */
  modules: Record<string, unknown>;
  /** The standby's invoice series, codes derived disjoint from the primary's by the reserving module. */
  series: { code: string; purpose: string }[];
  endorsement: Endorsement;
}

/**
 * Everything the mirror needs to adopt this venue's IDENTITY. `designated` are the four ids the primary
 * till was provisioned with (`config.till.*`), so the mirror knows which node/tenant it mirrors; the
 * venue's parent rows are NOT carried. `tenant` is the venue's `(country, taxId)` identity, for the
 * mirror-side foreign-tenant + environment guards. `primaryNode` is the designated node's descriptor
 * (name + filing/tax modules), the shape the reserved standby identity mirrors. `reservedIdentity` is
 * the standby's dormant identity the primary reserves + endorses (design §6 R2).
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
  /**
   * The primary's enabled-module set as a sparse override map (SP-1b's modules.json inner map), read
   * fresh at mint time. `{}` when nothing is disabled (default-on). The mirror re-validates it against
   * its own ALL_MODULES and writes its own modules.json from it (SP-1d adopt bootstrap).
   */
  moduleOverrides: Record<string, boolean>;
  /**
   * The box's WireGuard public key, swap S2 (spec §2.3: "the token goes, the key comes"). Additive
   * and optional — no consumer until Track B item 2 proves the tunnel end to end.
   */
  wireguardPublicKey?: string;
}

/**
 * `appDb` reads the venue rows as `app_user` and runs the modules' reservations: `app_user` holds the
 * reads and writes each enabled module's `provisioning.standby.reserve` needs (for fiscal,
 * SELECT/INSERT/UPDATE on `contadores_instalacion`/`registro_sif`/`cadenas`, and SELECT on
 * `invoice_series`), so no broader connection is used (CLAUDE.md §3: never widen a grant). `ring`
 * unseals the primary's identity PRIVATE key (`readNodeIdentityKey`, as `app_user`) to sign the
 * standby's endorsement; `standby` is the node the primary vouches for. `designated` are the four ids
 * the till was provisioned with (`config.till.*`); `stateDir` locates the box CA;
 * `relayUrl`/`boxHostname` are the box's dial-in.
 */
export interface AssembleDeps {
  appDb: Database;
  ring: KeyRing;
  stateDir: string;
  relayUrl: string;
  boxHostname: string;
  designated: AdoptResult;
  standby: { nodeId: string; publicKey: string };
  accountKey: string;
  /** The box's WireGuard public key (swap S2); the box image supplies it in S7, absent in dev/fixture. */
  wireguardPublicKey?: string;
}

/**
 * Assemble the mirror bundle: the venue's tenant + designated-node identity, the deployment
 * environment, the box's CA + dial details, and the reserved standby identity. Throws
 * `mirror.not_provisioned` if the database carries no deployment stamp (there is nothing to mirror).
 * No credential is minted and no parent rows travel.
 */
export async function assembleMirrorBundle(deps: AssembleDeps): Promise<MirrorBundle> {
  const { tenant, primaryNode } = await withTransaction(deps.appDb, async (tx) => {
    // The non-null assertions are safe on both reads: the taxpayer row is the one row every
    // provisioned database holds, and `designated.nodeId` is the primary till's provisioned id
    // (`config.till`), whose node row is minted as its FK parent at provision.
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

  // The primary's enabled-module set, read FRESH at mint time rather than from boot — the operator may
  // have edited modules.json since the primary booted, and a malformed file surfaces its
  // `module.config_*` code HERE, before the reservation bumps any counter. It both decides which
  // modules reserve below and travels to the mirror as `moduleOverrides`.
  const moduleConfig = await readModuleConfig(deps.stateDir);
  const modules = enabledModules(ALL_MODULES, moduleConfig);

  // Reserve the standby's dormant identity through each enabled module's provisioning seat
  // (reserved-standby-identity design §6 R2), unseal the primary's identity key, and read the box CA
  // IN PARALLEL — the three have no data dependency. The reservation shares ONE `withTransaction`
  // transaction, so every module's reads and its allocation are consistent with each other. What a
  // module reserves, and what it throws when the primary is not in a state to reserve, is the module's
  // own business; nothing is caught here. The endorsement is MEMBERSHIP's, computed below from the
  // primary's identity PRIVATE key: `endorseKey` signs canonicalize({nodeId, publicKey}) so it chains
  // the standby's key back to the primary's setup-established trust anchor (design §4).
  const [reserved, primaryPrivateKey, boxCaPem] = await Promise.all([
    withTransaction(deps.appDb, async (tx) => {
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
