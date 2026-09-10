// The PRIMARY side of the cloud-mirror adopt flow (design §10). `assembleMirrorBundle` reads the
// venue's tenant identity + the designated node's descriptor, reserves the standby's dormant
// identity, and returns a `MirrorBundle` the endpoint serves. Since swap step 4 the mirror no longer
// pulls an outbox: it establishes a NATIVE subscription (initial COPY of every published table), so
// the bundle carries the primary's replication CONNECTION (the `waitron_repl` credential + advertise
// address) instead of a per-peer sync token, and no longer carries the venue's parent ROWS — the
// COPY brings those.
//
// The deployment holds one tenant per database. The tenant row and the designated node row are
// selected by id; `app_user` holds SELECT on both in the core baseline. The replication password
// rides the bundle in PLAINTEXT and is returned ONCE; it is SECRET and never logged (the old
// syncToken discipline).
import "./errors.js";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  AppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  tenantId as brandTenantId,
} from "@waitron/shared";
import { nodes, readDeploymentEnvironment, tenants, withTenant, type Database } from "@waitron/db";
import { endorseKey, type Endorsement } from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
import type { AdoptResult } from "@waitron/provisioning";
import type { ReplicationConfig } from "./config.js";
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
 * Everything the mirror needs to adopt this venue and establish a native subscription to the primary.
 * `designated` are the five ids the primary till was provisioned with (`config.till.*`), so the
 * mirror knows which node/tenant it mirrors; the venue's parent rows are NOT carried — the native
 * initial COPY brings them (swap step 4). `tenant` is the venue's `(country, taxId)` identity, for the
 * mirror-side foreign-tenant + environment guards. `primaryNode` is the designated node's descriptor
 * (name + filing/tax modules), the shape the reserved standby identity mirrors. `replication` is the
 * primary's `waitron_repl` connection the mirror's `CREATE SUBSCRIPTION` dials — SECRET, returned once.
 * `reservedIdentity` is the standby's dormant identity the primary reserves + endorses (design §6 R2).
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
  /**
   * The primary's native-replication CONNECTION the mirror's subscription dials: the advertise
   * host/port, the database name, and the `waitron_repl` password. The `user` is the well-known
   * `REPLICATION_ROLE` and is not carried. SECRET in whole (the password) — returned exactly once in
   * the bundle response and NEVER logged, the discipline the sync token held before it.
   */
  replication: { host: string; port: number; database: string; password: string };
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
 * standby's endorsement; `standby` is the node the primary vouches for. `designated` are the five ids
 * the till was provisioned with (`config.till.*`); `stateDir` locates the box CA;
 * `relayUrl`/`boxHostname` are the box's dial-in. `replication` is this primary's own
 * native-replication credential + advertise address (`config.replication`); `database` is the name of
 * the primary's database, so a subscription's conninfo names the right dbname to COPY from.
 */
export interface AssembleDeps {
  appDb: Database;
  ring: KeyRing;
  stateDir: string;
  relayUrl: string;
  boxHostname: string;
  designated: AdoptResult;
  standby: { nodeId: string; publicKey: string };
  /** This primary's own `waitron_repl` credential + advertise address (`config.replication`). */
  replication: ReplicationConfig;
  /** The name of the primary's database, dialled in a subscription's conninfo `dbname`. */
  database: string;
  accountKey: string;
  /** The box's WireGuard public key (swap S2); the box image supplies it in S7, absent in dev/fixture. */
  wireguardPublicKey?: string;
}

/**
 * Assemble the mirror bundle: the venue's tenant + designated-node identity, the deployment
 * environment, the box's CA + dial details, the primary's replication connection, and the reserved
 * standby identity. Throws `mirror.not_provisioned` if the database carries no deployment stamp (there
 * is nothing to mirror). No token is minted and no parent rows travel — the mirror's native initial
 * COPY brings the venue data, and the bundle's `replication` connection is what its subscription dials.
 */
export async function assembleMirrorBundle(deps: AssembleDeps): Promise<MirrorBundle> {
  const { tenant, primaryNode } = await withTenant(
    deps.appDb,
    deps.designated.tenantId,
    async (tx) => {
      // `[0]!` is safe: `designated.tenantId`/`nodeId` are the primary till's provisioned ids
      // (`config.till`), whose tenant + node rows are minted as its FK parents at provision, so both
      // by-id lookups always return exactly one row.
      const t = (
        await tx
          .select({ country: tenants.country, taxId: tenants.taxId })
          .from(tenants)
          .where(eq(tenants.id, deps.designated.tenantId))
      )[0]!;
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
    },
  );

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
  // IN PARALLEL — the three have no data dependency. The reservation shares ONE `withTenant`
  // transaction, so every module's reads and its allocation are consistent with each other. What a
  // module reserves, and what it throws when the primary is not in a state to reserve, is the module's
  // own business; nothing is caught here. The endorsement is MEMBERSHIP's, computed below from the
  // primary's identity PRIVATE key: `endorseKey` signs canonicalize({nodeId, publicKey}) so it chains
  // the standby's key back to the primary's setup-established trust anchor (design §4).
  const [reserved, primaryPrivateKey, boxCaPem] = await Promise.all([
    withTenant(deps.appDb, deps.designated.tenantId, async (tx) => {
      const primary = {
        tenantId: brandTenantId(deps.designated.tenantId),
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
    readNodeIdentityKey(deps.appDb, deps.ring, deps.designated.tenantId),
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
    replication: {
      host: deps.replication.advertiseHost,
      port: deps.replication.advertisePort,
      database: deps.database,
      password: deps.replication.password,
    },
    accountKey: deps.accountKey,
    reservedIdentity: { ...reserved, endorsement },
    moduleOverrides: serializeModuleConfig(moduleConfig),
    wireguardPublicKey: deps.wireguardPublicKey,
  };
}
