import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import type { LocationId, TenantId } from "@waitron/shared";
import type { Endorsement } from "@waitron/membership";
import type { Database } from "./client.js";
import {
  CORE_MIGRATIONS,
  insertReservedNodeTx,
  insertReservedSeriesTx,
  readMembershipTrustSet,
  readNodeEndorsement,
  readStandardSeriesId,
  readStandardSeriesIdTx,
  retireNodeSeriesTx,
  insertNodeSeriesTx,
  withTenant,
} from "./index.js";
import { invoiceSeries } from "./schema/series.js";
import { captureError } from "./testing/errors.js";
import { seedNode, seedTenant } from "./testing/seed.js";
import { usePgliteDb } from "./testing/lifecycle.js";

// PGlite, not real Postgres: this proves the query/insert logic (a dormant node lands with its public
// key + endorsement, the reserved series default to next_number 1, the endorsement round-trips and null
// for a keyless node). PGlite connects as superuser, so it cannot show the GRANT enforcement (that the
// *Tx writes need the owner role, the read rides app_user's SELECT); `nodes`' table grants are pinned
// by the privilege matrix in packages/fiscal-verifactu, and its column ACLs by the dumped-ACL diff in
// scripts/schema-equivalence.sh.

const ENDORSEMENT: Endorsement = {
  nodeId: "22222222-2222-2222-2222-222222222222",
  publicKey: "cloudpub",
  endorsedBy: "11111111-1111-1111-1111-111111111111",
  signature: "sig",
};
const CLOUD_NODE = ENDORSEMENT.nodeId;

// There is deliberately no seedLocation helper (only seedTenant/seedNode exist — see seed.test.ts), so
// build the location the node FKs first, exactly as node-identity.test.ts does.
async function seedLocation(
  db: Database,
  tenant: string,
): Promise<ReturnType<typeof brandLocationId>> {
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenant}, 'Test location', ARRAY['es']::text[], 'Restaurant') returning id`);
  return brandLocationId(loc.rows[0]!.id);
}

describe("reserved-identity accessors", () => {
  const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

  let tenantId: TenantId;
  let locationId: LocationId;

  beforeAll(async () => {
    tenantId = await seedTenant(suite.db);
    locationId = await seedLocation(suite.db, tenantId);
  });

  it("insertReservedNodeTx persists a dormant node with its public key + endorsement", async () => {
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedNodeTx(tx, {
        id: CLOUD_NODE,
        tenantId,
        locationId,
        name: "cloud",
        filingModule: null,
        taxModule: null,
        publicKey: "cloudpub",
        endorsement: ENDORSEMENT,
      }),
    );
    expect(await readNodeEndorsement(suite.db, tenantId, CLOUD_NODE)).toEqual(ENDORSEMENT);
    // the dormant node's public key joins the trust set (readMembershipTrustSet reads public_key)
    const trust = await readMembershipTrustSet(suite.db, tenantId);
    expect(trust[CLOUD_NODE]).toBe("cloudpub");
  });

  it("readNodeEndorsement returns null for a node with no endorsement (a primary)", async () => {
    const bare = await seedNode(suite.db, tenantId, locationId);
    expect(await readNodeEndorsement(suite.db, tenantId, bare)).toBeNull();
  });

  it("insertReservedSeriesTx inserts the reserved series at next_number 1", async () => {
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [
        { tenantId, nodeId: CLOUD_NODE, code: "FA-3", purpose: "standard" },
        { tenantId, nodeId: CLOUD_NODE, code: "RF-3", purpose: "rectificative" },
      ]),
    );
    const rows = await withTenant(suite.db, tenantId, (tx) =>
      tx.execute<{ code: string; next_number: number }>(
        sql`select code, next_number from invoice_series where node_id = ${CLOUD_NODE} order by code`,
      ),
    );
    expect(rows.rows.map((r) => [r.code, Number(r.next_number)])).toEqual([
      ["FA-3", 1],
      ["RF-3", 1],
    ]);
  });

  it("readStandardSeriesId returns the node's standard series id, not the rectificative", async () => {
    // A node with both purposes reserved (R2's real shape): the standard series is the one R3b's
    // promote points config.till.seriesId at, never the rectificative sitting beside it.
    const node = await seedNode(suite.db, tenantId, locationId);
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [
        { tenantId, nodeId: node, code: "F-42", purpose: "standard" },
        { tenantId, nodeId: node, code: "R-42", purpose: "rectificative" },
      ]),
    );
    const id = await readStandardSeriesId(suite.db, tenantId, node);
    // it is a real series row, of purpose 'standard'
    const [row] = await withTenant(suite.db, tenantId, (tx) =>
      tx
        .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, id)),
    );
    expect(row).toEqual({ code: "F-42", purpose: "standard" });
  });

  it("readStandardSeriesIdTx refuses a node belonging to a different tenant argument", async () => {
    // Nothing but the helper's own tenant predicate scopes this read, so it must reject the
    // mismatched pair itself.
    const node = await seedNode(suite.db, tenantId, locationId);
    const otherTenant = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [{ tenantId, nodeId: node, code: "FA", purpose: "standard" }]),
    );
    await expect(
      withTenant(suite.db, tenantId, (tx) => readStandardSeriesIdTx(tx, otherTenant, node)),
    ).rejects.toMatchObject({
      code: "series.no_standard_for_node",
      params: { tenantId: otherTenant, nodeId: node },
    });
    await expect(
      withTenant(suite.db, tenantId, (tx) => readStandardSeriesIdTx(tx, tenantId, node)),
    ).resolves.toEqual(expect.any(String));
  });

  it("readStandardSeriesId throws series.no_standard_for_node when the node has none", async () => {
    const bareNode = await seedNode(suite.db, tenantId, locationId);
    const err = await captureError(() => readStandardSeriesId(suite.db, tenantId, bareNode));
    expect(isAppError(err) && err.code).toBe("series.no_standard_for_node");
  });

  it("readStandardSeriesId ignores a RETIRED standard series (a cold restore retires the old one)", async () => {
    const node = await seedNode(suite.db, tenantId, locationId);
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [
        { tenantId, nodeId: node, code: "FA", purpose: "standard" },
        { tenantId, nodeId: node, code: "FA-210441234", purpose: "standard" },
      ]),
    );
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt: new Date() })
      .where(and(eq(invoiceSeries.nodeId, node), eq(invoiceSeries.code, "FA")));
    const id = await readStandardSeriesId(suite.db, tenantId, node);
    const [row] = await suite.db
      .select({ code: invoiceSeries.code })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, id));
    expect(row?.code).toBe("FA-210441234");
  });

  it("readStandardSeriesId is LOUD on two live standard series (a data-integrity corruption)", async () => {
    const node = await seedNode(suite.db, tenantId, locationId);
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [
        { tenantId, nodeId: node, code: "X1", purpose: "standard" },
        { tenantId, nodeId: node, code: "X2", purpose: "standard" },
      ]),
    );
    await expect(readStandardSeriesId(suite.db, tenantId, node)).rejects.toThrow(
      /more than one standard series/,
    );
  });

  it("retireNodeSeriesTx retires every LIVE series of the node and only those", async () => {
    const node = await seedNode(suite.db, tenantId, locationId);
    const other = await seedNode(suite.db, tenantId, locationId);
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [
        { tenantId, nodeId: node, code: "FA", purpose: "standard" },
        { tenantId, nodeId: node, code: "RE", purpose: "rectificative" },
        { tenantId, nodeId: other, code: "FA", purpose: "standard" },
      ]),
    );
    const retired = await withTenant(suite.db, tenantId, (tx) =>
      retireNodeSeriesTx(tx, tenantId, node),
    );
    expect(retired).toBe(2);
    const rows = await suite.db
      .select({ nodeId: invoiceSeries.nodeId, retiredAt: invoiceSeries.retiredAt })
      .from(invoiceSeries)
      .where(inArray(invoiceSeries.nodeId, [node, other]));
    expect(rows.filter((r) => r.nodeId === node).every((r) => r.retiredAt !== null)).toBe(true);
    expect(rows.filter((r) => r.nodeId === other).every((r) => r.retiredAt === null)).toBe(true);
    // Idempotent on the already-retired: nothing left to retire.
    expect(
      await withTenant(suite.db, tenantId, (tx) => retireNodeSeriesTx(tx, tenantId, node)),
    ).toBe(0);
  });

  it("insertNodeSeriesTx refuses duplicate codes within a batch with a domain error", async () => {
    const node = await seedNode(suite.db, tenantId, locationId);
    await expect(
      withTenant(suite.db, tenantId, (tx) =>
        insertNodeSeriesTx(tx, tenantId, node, [
          { code: "FA-7", purpose: "standard" },
          { code: "FA-7", purpose: "rectificative" },
        ]),
      ),
    ).rejects.toMatchObject({ code: "series.code_collision", params: { code: "FA-7" } });
  });

  it("insertNodeSeriesTx inserts at next_number 1 and refuses a code the node holds, live OR retired", async () => {
    const node = await seedNode(suite.db, tenantId, locationId);
    await withTenant(suite.db, tenantId, (tx) =>
      insertReservedSeriesTx(tx, [{ tenantId, nodeId: node, code: "FA", purpose: "standard" }]),
    );
    await withTenant(suite.db, tenantId, (tx) => retireNodeSeriesTx(tx, tenantId, node));
    await withTenant(suite.db, tenantId, (tx) =>
      insertNodeSeriesTx(tx, tenantId, node, [{ code: "FA-7", purpose: "standard" }]),
    );
    const [fresh] = await suite.db
      .select({ nextNumber: invoiceSeries.nextNumber, retiredAt: invoiceSeries.retiredAt })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, node), eq(invoiceSeries.code, "FA-7")));
    expect(fresh).toEqual({ nextNumber: 1, retiredAt: null });
    // Both the retired FA and the live FA-7 reserve their codes.
    for (const code of ["FA", "FA-7"]) {
      const err = await captureError(() =>
        withTenant(suite.db, tenantId, (tx) =>
          insertNodeSeriesTx(tx, tenantId, node, [{ code, purpose: "standard" }]),
        ),
      );
      expect(isAppError(err) && err.code).toBe("series.code_collision");
      expect(isAppError(err) && err.params).toEqual({ code });
    }
    // An empty list is a no-op, not an INSERT with no rows.
    await withTenant(suite.db, tenantId, (tx) => insertNodeSeriesTx(tx, tenantId, node, []));
  });
});
