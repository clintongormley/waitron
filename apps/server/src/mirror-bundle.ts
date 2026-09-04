// The PRIMARY side of the C2b cloud-mirror operator flow (design §10). `assembleMirrorBundle` reads a
// venue's parent rows + the box's connection details and mints ONE per-peer sync token, returning a
// `MirrorBundle` a later task's endpoint serves and the mirror consumes via `adoptVenue`.
//
// The rows are read as `app_user` under `withTenant`: RLS scopes locations/nodes/tills/invoiceSeries to
// the tenant, and the tenant itself is a single keyed select. `app_user` holds SELECT on ALL FIVE
// parent tables — tenants + locations + tills (0001_tenancy_rls.sql), invoice_series (0003) and nodes
// (0017_nodes_rls.sql) — so no broader connection is needed and none is used (CLAUDE.md §3: never widen
// a grant). The token is minted in PLAINTEXT via `enrolPeer` and returned ONCE; it is NOT sealed here —
// sealing is mirror-side, a later task (design §10) — and it is never logged.
import "./errors.js";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { AppError, nodeId as brandNodeId, tenantId as brandTenantId } from "@waitron/shared";
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
import {
  currentSif,
  deriveReservedSeriesCodes,
  reserveInstallationNumber,
} from "@waitron/fiscal-verifactu";
import { endorseKey, type Endorsement } from "@waitron/membership";
import type { KeyRing } from "@waitron/credentials";
import type { AdoptResult, AdoptVenueRows } from "@waitron/provisioning";
import { serializeModuleConfig } from "@waitron/module";
import { caCertPath } from "./box-secrets.js";
import { readModuleConfig } from "./module-config.js";
import { readNodeIdentityKey } from "./node-identity.js";

/**
 * The dormant fiscal + membership identity the PRIMARY reserves for a standby at adopt
 * (reserved-standby-identity design §4/§6 R2). The primary is the sole allocator per NIF: it bumps ITS
 * OWN `contadores_instalacion` to mint a fresh `numeroInstalacion` the standby will persist inert (via
 * `writeReservedSif`, Task 3) and activate on promotion — a standby's DB is a copy and must never mint.
 * `series` are DISJOINT codes (`${primaryCode}-${numeroInstalacion}`), one per primary series, purpose
 * preserved: the installation number is globally unique + never-reused per NIF, so the suffix makes the
 * standby's series provably disjoint from the primary's. `endorsement` vouches for the standby's
 * identity key, signed by the primary's identity key — the chain-back-to-setup that lets other members
 * trust a document the standby later signs (Task 5 consumes this shape verbatim).
 */
export interface ReservedIdentity {
  nif: string;
  idSistemaInformatico: string;
  numeroInstalacion: number;
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
 * `appDb` reads the venue rows under RLS as `app_user`; `retentionDb` (a `sync_retention` member) mints
 * the peer token via `enrolPeer` — the two roles that hold exactly the privileges each step needs.
 * `appDb` ALSO computes the reservation: `app_user` holds SELECT/INSERT/UPDATE on
 * `contadores_instalacion`/`registro_sif`/`cadenas` (`0001_registros_inmutables.sql`) and SELECT on
 * `invoice_series`, so the counter bump + fiscal/series reads all run as `app_user` (CLAUDE.md §3:
 * never widen a grant). `ring` unseals the primary's identity PRIVATE key (`readNodeIdentityKey`, as
 * `app_user`) to sign the standby's endorsement; `standby` is the node the primary vouches for.
 * `designated` are the five ids the till was provisioned with (`config.till.*`); `stateDir` locates the
 * box CA; `relayUrl`/`boxHostname` are the box's dial-in.
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
      // `[0]!` is safe: `designated.tenantId` is the primary till's provisioned tenant (`config.till`),
      // and a provisioned till always has its tenant row (minted as its FK parent at provision), so the
      // by-id lookup under that same tenant's RLS scope always returns exactly one row.
      tenant: (await tx.select().from(tenants).where(eq(tenants.id, deps.designated.tenantId)))[0]!,
      locations: await tx.select().from(locations), // RLS scopes each of these to the tenant
      nodes: await tx.select().from(nodes),
      tills: await tx.select().from(tills),
      invoiceSeries: await tx.select().from(invoiceSeries),
    }),
  );

  const environment = await readDeploymentEnvironment(deps.appDb);
  if (environment === null) throw new AppError("mirror.not_provisioned", {});

  // Reserve the standby's dormant fiscal identity (reserved-standby-identity design §6 R2) and unseal
  // the primary's identity key IN PARALLEL — the two have no data dependency (the endorsement needs only
  // the private key + `deps.standby`, never `reserved`).
  //
  // The reservation's counter bump + SIF/series reads share ONE `withTenant` transaction so it is
  // consistent: `currentSif` reads the primary's live SIF, `reserveInstallationNumber` bumps the
  // primary's OWN `contadores_instalacion` (the primary is the sole allocator per NIF), and the series
  // codes are derived disjoint from the number just reserved. `currentSif` throwing `sif.not_registered`
  // correctly surfaces an unprovisioned primary — an impossible state for a trading primary — and is left
  // to propagate.
  //
  // The primary's identity PRIVATE key is unsealed as `app_user` inside `readNodeIdentityKey`'s own
  // transaction; `endorseKey` (below) signs canonicalize({nodeId, publicKey}) so the endorsement chains
  // the standby's key back to the primary's setup-established trust anchor (reserved-standby-identity §4).
  const [reserved, primaryPrivateKey] = await Promise.all([
    withTenant(deps.appDb, deps.designated.tenantId, async (tx) => {
      const primarySif = await currentSif(
        tx,
        brandTenantId(deps.designated.tenantId),
        brandNodeId(deps.designated.nodeId),
      );
      const numeroInstalacion = await reserveInstallationNumber(tx, {
        nif: primarySif.nif,
        idSistemaInformatico: primarySif.idSistemaInformatico,
      });
      const primarySeries = await tx
        .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.nodeId, brandNodeId(deps.designated.nodeId)));
      const series = deriveReservedSeriesCodes(primarySeries, numeroInstalacion);
      return {
        nif: primarySif.nif,
        idSistemaInformatico: primarySif.idSistemaInformatico,
        numeroInstalacion,
        series,
      };
    }),
    readNodeIdentityKey(deps.appDb, deps.ring, deps.designated.tenantId),
  ]);

  const endorsement = endorseKey(
    deps.standby.nodeId,
    deps.standby.publicKey,
    deps.designated.nodeId,
    primaryPrivateKey,
  );

  // The two READS have no data dependency, so run them together: the box CA, and — SP-1d — a snapshot
  // of the primary's enabled-module set so the mirror inherits it at adopt. `moduleOverrides` is read
  // FRESH here, not from boot: the operator may have edited modules.json since the primary booted, so
  // the mint reflects the current desired set, and a malformed primary file surfaces its
  // module.config_* code here (fail loud) — do not ship an unparseable set.
  const [boxCaPem, moduleOverrides] = await Promise.all([
    readFile(caCertPath(deps.stateDir), "utf8"),
    readModuleConfig(deps.stateDir).then(serializeModuleConfig),
  ]);

  // `enrolPeer` INSERTs a `sync_peers` row (not idempotent, not auto-reaped), so it runs AFTER the
  // reads have succeeded — never concurrently with them. Were it folded into the Promise.all above, a
  // rejected read (a missing CA, or the fail-loud malformed-modules.json path) would abandon an
  // already-committed peer row on every retry.
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
    moduleOverrides,
  };
}
