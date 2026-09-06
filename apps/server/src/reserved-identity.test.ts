import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing, tryGetCredential, type KeyRing } from "@waitron/credentials";
import { withTenant } from "@waitron/db";
import { currentSif } from "@waitron/fiscal-verifactu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { tenantId as brandTenantId, nodeId as brandNodeId } from "@waitron/shared";
import type { LocationId, TenantId } from "@waitron/shared";
import type { Endorsement } from "@waitron/membership";
import type { ReservedIdentity } from "./mirror-bundle.js";
import { ALL_MODULES } from "./modules.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";

// PGlite, not real Postgres: `establishReservedStandbyIdentity` seals a credential, inserts the
// standby's own node (public_key + endorsement), and persists a reserved SIF + series, all under
// one `withTenant`. PGlite exercises this round-trip and its behavioural assertions on a
// superuser connection; it does not check grants. CLAUDE.md §4.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const ENDORSEMENT: Endorsement = { nodeId: "n", publicKey: "p", endorsedBy: "e", signature: "s" };

describe("establishReservedStandbyIdentity", () => {
  // The full manifest, not just [core, credentials, fiscal]: fiscal's SP-3a capture migration
  // needs sync's `sync_capture()`, so the whole manifest is applied (sync before fiscal) — the
  // production order.
  const suite = usePgliteDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });

  let tenantId: TenantId;
  let locationId: LocationId;
  let NIF: string;

  // A fresh tenant per test: the idempotency case starts from an unsealed vault, so it cannot share a
  // tenant with the establish case (which seals one). Tenants accumulate for the suite, each on its own
  // NIF via seedTenant's counter.
  beforeEach(async () => {
    tenantId = await seedTenant(suite.db);
    const loc = await suite.db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
    locationId = loc.rows[0]!.id as LocationId;
    const t = await suite.db.execute<{ tax_id: string }>(
      sql`select tax_id from tenants where id = ${tenantId}`,
    );
    NIF = t.rows[0]!.tax_id;
  });

  it("establishes a dormant identity: sealed key, reserved node, reserved SIF, reserved series", async () => {
    const standby = generateStandbyIdentity();
    await establishReservedStandbyIdentity(
      { ownerDb: suite.db, ring: RING },
      {
        tenantId,
        locationId,
        standby,
        nodeName: "cloud",
        filingModule: "verifactu",
        taxModule: "iva",
        modules: ALL_MODULES,
        reserved: {
          modules: { fiscal: { nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: 7 } },
          series: [{ code: "FA-7", purpose: "standard" }],
          endorsement: { ...ENDORSEMENT, nodeId: standby.nodeId, publicKey: standby.publicKey },
        },
      },
    );
    // sealed private key present
    const cred = await withTenant(suite.db, brandTenantId(tenantId), (tx) =>
      tryGetCredential(tx, RING, {
        tenantId: brandTenantId(tenantId),
        purpose: "membership.node_key",
      }),
    );
    expect(cred?.privateKey).toBe(standby.privateKey);
    // reserved SIF is the cloud node's live identity with the supplied number
    const sif = await withTenant(suite.db, brandTenantId(tenantId), (tx) =>
      currentSif(tx, brandTenantId(tenantId), brandNodeId(standby.nodeId)),
    );
    expect(sif.numeroInstalacion).toBe(7);
    // reserved series landed for the standby's node
    const series = await withTenant(suite.db, brandTenantId(tenantId), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from invoice_series where node_id = ${standby.nodeId}`,
      ),
    );
    expect(series.rows[0]!.n).toBe(1);
  });

  it("is idempotent: a second call with a fresh identity is a no-op (keeps the first)", async () => {
    const first = generateStandbyIdentity();
    const base = {
      tenantId,
      locationId,
      nodeName: "cloud",
      filingModule: null,
      taxModule: null,
      modules: ALL_MODULES,
    };
    await establishReservedStandbyIdentity(
      { ownerDb: suite.db, ring: RING },
      {
        ...base,
        standby: first,
        reserved: {
          modules: { fiscal: { nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: 1 } },
          series: [],
          endorsement: { ...ENDORSEMENT },
        },
      },
    );
    const second = generateStandbyIdentity();
    await establishReservedStandbyIdentity(
      { ownerDb: suite.db, ring: RING },
      {
        ...base,
        standby: second,
        reserved: {
          modules: { fiscal: { nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: 2 } },
          series: [],
          endorsement: { ...ENDORSEMENT },
        },
      },
    );
    // the vault still holds the FIRST key; the SECOND node has no reserved SIF
    const cred = await withTenant(suite.db, brandTenantId(tenantId), (tx) =>
      tryGetCredential(tx, RING, {
        tenantId: brandTenantId(tenantId),
        purpose: "membership.node_key",
      }),
    );
    expect(cred?.privateKey).toBe(first.privateKey);
    const rows = await withTenant(suite.db, brandTenantId(tenantId), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from registro_sif where node_id = ${second.nodeId}`,
      ),
    );
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("refuses a bundle whose fiscal reservation is missing, before writing the node", async () => {
    const standby = generateStandbyIdentity();
    await expect(
      establishReservedStandbyIdentity(
        { ownerDb: suite.db, ring: RING },
        {
          tenantId,
          locationId,
          standby,
          nodeName: "cloud",
          filingModule: "verifactu",
          taxModule: "iva",
          modules: ALL_MODULES,
          reserved: { modules: {}, series: [], endorsement: ENDORSEMENT },
        },
      ),
    ).rejects.toMatchObject({ code: "sif.reservation_invalid" });
    const node = await suite.db.execute(sql`select 1 from nodes where id = ${standby.nodeId}`);
    expect(node.rows).toEqual([]); // the one transaction rolled back
  });

  it("refuses a bundle carrying no `modules` key at all, before writing the node", async () => {
    // The other shape of the same wire defect: not an empty map but a bundle whose `modules` (and
    // `series`) keys are absent entirely. The carrier must still reach the module's own refusal —
    // an unguarded index would throw a bare TypeError here instead.
    const standby = generateStandbyIdentity();
    await expect(
      establishReservedStandbyIdentity(
        { ownerDb: suite.db, ring: RING },
        {
          tenantId,
          locationId,
          standby,
          nodeName: "cloud",
          filingModule: "verifactu",
          taxModule: "iva",
          modules: ALL_MODULES,
          reserved: { endorsement: ENDORSEMENT } as unknown as ReservedIdentity,
        },
      ),
    ).rejects.toMatchObject({ code: "sif.reservation_invalid" });
    const node = await suite.db.execute(sql`select 1 from nodes where id = ${standby.nodeId}`);
    expect(node.rows).toEqual([]); // the one transaction rolled back
  });
});
