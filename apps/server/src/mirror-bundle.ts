// The PRIMARY side of the C2b cloud-mirror operator flow (design §10). `assembleMirrorBundle`
// reads a venue's parent rows + the box's connection details and mints ONE per-peer sync token,
// returning a `MirrorBundle` the endpoint serves and the mirror consumes via `adoptVenue`.
//
// The deployment holds one tenant per database. The tenant row is selected by id; locations,
// nodes, tills and invoice series are read without tenant predicates. `app_user` holds SELECT on
// these parent tables in the core baseline. The token is minted in PLAINTEXT via `enrolPeer` and
// returned ONCE; sealing is mirror-side (design §10), and the token is never logged.
import "./errors.js";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  AppError,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  tenantId as brandTenantId,
} from "@waitron/shared";
import {
  invoiceSeries,
  locations,
  nodes,
  readDeploymentEnvironment,
  tenants,
  tills,
  withTenant,
  type Database,
} from "@waitron/db";
import { enrolPeer } from "@waitron/sync";
import { endorseKey, type Endorsement } from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
import type { AdoptResult, AdoptVenueRows } from "@waitron/provisioning";
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
 * Everything the mirror needs to adopt this venue and pull from the box. `rows` + `designated` are the
 * `adoptVenue` inputs (camelCase Drizzle rows, matching its `$inferInsert`); the remaining fields are
 * the connection handshake. `syncToken` is the plaintext bearer, returned exactly once.
 * `reservedIdentity` is the standby's dormant identity the primary reserves + endorses
 * (reserved-standby-identity design §6 R2).
 */
export interface MirrorBundle {
  rows: AdoptVenueRows;
  designated: AdoptResult;
  environment: "production" | "preproduction";
  boxHostname: string;
  boxCaPem: string;
  relayUrl: string;
  syncToken: string;
  reservedIdentity: ReservedIdentity;
  /**
   * The primary's enabled-module set as a sparse override map (SP-1b's modules.json inner map), read
   * fresh at mint time. `{}` when nothing is disabled (default-on). The mirror re-validates it against
   * its own ALL_MODULES and writes its own modules.json from it (SP-1d adopt bootstrap).
   */
  moduleOverrides: Record<string, boolean>;
}

/**
 * `appDb` reads the venue rows as `app_user`; `retentionDb` mints the peer token via `enrolPeer`.
 * Both operations use grants held by `app_user`. `appDb` ALSO runs the modules' reservations:
 * `app_user` holds the reads and writes each enabled module's `provisioning.standby.reserve`
 * needs (for fiscal, SELECT/INSERT/UPDATE on `contadores_instalacion`/`registro_sif`/`cadenas`,
 * `packages/fiscal-verifactu/drizzle/0001_fiscal_baseline_sql.sql`, and SELECT on
 * `invoice_series`), so no broader connection is used (CLAUDE.md §3: never widen a grant). `ring`
 * unseals the primary's identity PRIVATE key (`readNodeIdentityKey`, as `app_user`) to sign the
 * standby's endorsement; `standby` is the node the primary vouches for. `designated` are the five
 * ids the till was provisioned with (`config.till.*`); `stateDir` locates the box CA;
 * `relayUrl`/`boxHostname` are the box's dial-in.
 */
export interface AssembleDeps {
  appDb: Database;
  retentionDb: Database;
  ring: KeyRing;
  stateDir: string;
  relayUrl: string;
  boxHostname: string;
  designated: AdoptResult;
  standby: { nodeId: string; publicKey: string };
}

/**
 * Assemble the mirror bundle: the venue's parent rows, the deployment environment, the box's CA + dial
 * details, and a freshly minted per-peer sync token. Throws `mirror.not_provisioned` if the database
 * carries no deployment stamp (there is nothing to mirror). The token's subscriber is the STANDBY's
 * OWN node id (`deps.standby.nodeId`), not the primary's: from membership promotion R3a the mirror
 * runs under its own identity and authenticates AS itself when it pulls, while the ORIGIN it pulls
 * (the primary's node) travels separately in `mirror_config.origin_node_id`. The local pull cursor is
 * keyed (subscriber = own id, origin = primary, lane); the source ignores the request-body subscriber.
 */
export async function assembleMirrorBundle(deps: AssembleDeps): Promise<MirrorBundle> {
  const rows: AdoptVenueRows = await withTenant(
    deps.appDb,
    deps.designated.tenantId,
    async (tx) => ({
      // `[0]!` is safe: `designated.tenantId` is the primary till's provisioned tenant
      // (`config.till`), and a provisioned till always has its tenant row (minted as its FK
      // parent at provision), so the by-id lookup always returns exactly one row.
      tenant: (await tx.select().from(tenants).where(eq(tenants.id, deps.designated.tenantId)))[0]!,
      locations: await tx.select().from(locations), // The deployment holds one tenant per database. These reads are unfiltered.
      nodes: await tx.select().from(nodes),
      tills: await tx.select().from(tills),
      invoiceSeries: await tx.select().from(invoiceSeries),
    }),
  );

  const environment = await readDeploymentEnvironment(deps.appDb);
  if (environment === null) throw new AppError("mirror.not_provisioned", {});

  // The primary's enabled-module set, read FRESH at mint time rather than from boot — the
  // operator may have edited modules.json since the primary booted, and a malformed file surfaces its
  // `module.config_*` code HERE, before the reservation bumps any counter. It both decides which
  // modules reserve below and travels to the mirror as `moduleOverrides`.
  const moduleConfig = await readModuleConfig(deps.stateDir);
  const modules = enabledModules(ALL_MODULES, moduleConfig);

  // Reserve the standby's dormant identity through each enabled module's provisioning seat
  // (reserved-standby-identity design §6 R2), unseal the primary's identity key, and read the box CA
  // IN PARALLEL — the three have no data dependency (the endorsement needs only the private key +
  // `deps.standby`, never `reserved`, and the CA is a file read).
  //
  // The reservation shares ONE `withTenant` transaction, so every module's reads and its allocation are
  // consistent with each other. What a module reserves, and what it throws when the primary is not in a
  // state to reserve, is the module's own business; nothing is caught here.
  //
  // The endorsement is MEMBERSHIP's, not any module's: it is computed below from the primary's identity
  // PRIVATE key, unsealed as `app_user` inside `readNodeIdentityKey`'s own transaction, and `endorseKey`
  // signs canonicalize({nodeId, publicKey}) so the endorsement chains the standby's key back to the
  // primary's setup-established trust anchor (reserved-standby-identity §4).
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

  // `enrolPeer` INSERTs a `sync_peers` row (not idempotent, not auto-reaped), so it runs AFTER the
  // reads have succeeded — never concurrently with them. Were it folded in with a read, a rejected
  // read (a missing CA) would abandon an already-committed peer row on every retry.
  const { token } = await enrolPeer(deps.retentionDb, {
    subscriberId: deps.standby.nodeId,
    name: "cloud mirror",
  });

  return {
    rows,
    designated: deps.designated,
    environment,
    boxHostname: deps.boxHostname,
    boxCaPem,
    relayUrl: deps.relayUrl,
    syncToken: token,
    reservedIdentity: { ...reserved, endorsement },
    moduleOverrides: serializeModuleConfig(moduleConfig),
  };
}
