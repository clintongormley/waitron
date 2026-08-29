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
import { AppError } from "@waitron/shared";
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
import type { AdoptResult, AdoptVenueRows } from "@waitron/provisioning";
import { caCertPath } from "./box-secrets.js";

/**
 * Everything the mirror needs to adopt this venue and pull from the box. `rows` + `designated` are the
 * `adoptVenue` inputs (camelCase Drizzle rows, matching its `$inferInsert`); the remaining fields are
 * the connection handshake. `syncToken` is the plaintext bearer, returned exactly once.
 */
export interface MirrorBundle {
  rows: AdoptVenueRows;
  designated: AdoptResult;
  environment: "production" | "preproduction";
  boxHostname: string;
  boxCaPem: string;
  relayUrl: string;
  syncToken: string;
}

/**
 * `appDb` reads the venue rows under RLS as `app_user`; `retentionDb` (a `sync_retention` member) mints
 * the peer token via `enrolPeer` — the two roles that hold exactly the privileges each step needs. No
 * `ring`: the token is not sealed on the primary. `designated` are the five ids the till was provisioned
 * with (`config.till.*`); `stateDir` locates the box CA; `relayUrl`/`boxHostname` are the box's dial-in.
 */
export interface AssembleDeps {
  appDb: Database;
  retentionDb: Database;
  stateDir: string;
  relayUrl: string;
  boxHostname: string;
  designated: AdoptResult;
}

/**
 * Assemble the mirror bundle: the venue's parent rows, the deployment environment, the box's CA + dial
 * details, and a freshly minted per-peer sync token. Throws `mirror.not_provisioned` if the database
 * carries no deployment stamp (there is nothing to mirror). The token's subscriber is the designated
 * node id: the mirror authenticates AS that node when it pulls.
 */
export async function assembleMirrorBundle(deps: AssembleDeps): Promise<MirrorBundle> {
  const rows: AdoptVenueRows = await withTenant(
    deps.appDb,
    deps.designated.tenantId,
    async (tx) => ({
      tenant: (await tx.select().from(tenants).where(eq(tenants.id, deps.designated.tenantId)))[0]!,
      locations: await tx.select().from(locations), // RLS scopes each of these to the tenant
      nodes: await tx.select().from(nodes),
      tills: await tx.select().from(tills),
      invoiceSeries: await tx.select().from(invoiceSeries),
    }),
  );

  const environment = await readDeploymentEnvironment(deps.appDb);
  if (environment === null) throw new AppError("mirror.not_provisioned", {});

  const boxCaPem = await readFile(caCertPath(deps.stateDir), "utf8");

  const { token } = await enrolPeer(deps.retentionDb, {
    subscriberId: deps.designated.nodeId,
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
  };
}
