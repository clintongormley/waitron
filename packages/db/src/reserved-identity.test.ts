import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import type { Endorsement } from "@waitron/membership";
import type { Database } from "./client.js";
import {
  CORE_MIGRATIONS,
  insertReservedNodeTx,
  insertReservedSeriesTx,
  readMembershipTrustSet,
  readNodeEndorsement,
  readStandardSeriesId,
  retireNodeSeriesTx,
  insertNodeSeriesTx,
  withTransaction,
} from "./index.js";
import { invoiceSeries } from "./schema/series.js";
import { locations } from "./schema/tenants.js";
import { captureError } from "./testing/errors.js";
import { seedNode, seedTenant } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

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
// Drizzle rather than raw SQL, for two things the raw insert relied on PostgreSQL for. Run against
// this engine the old statement is refused at prepare with `near "['es']": syntax error` (node
// v26.7.0, `node:sqlite`) — there is no array literal and no `::text[]` cast. And `locations.id` is
// `id("id").primaryKey().$defaultFn(newId)`, a JavaScript generator rather than a SQL DEFAULT, so a
// raw insert that omits the column reaches nothing to fill it. Both are handled by going through
// drizzle, which encodes `invoiceLocales` as the JSON text the column now holds and calls the
// generator; `seedNode` in `./testing/seed.ts` is built the same way.
async function seedLocation(db: Database): Promise<ReturnType<typeof brandLocationId>> {
  const [row] = await db
    .insert(locations)
    .values({
      name: "Test location",
      invoiceLocales: ["es"],
      operationDescription: "Restaurant",
    })
    .returning({ id: locations.id });
  return brandLocationId(row!.id);
}

describe("reserved-identity accessors", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
    timeoutMs: 60_000,
    resetPerTest: false,
  });

  let locationId: LocationId;

  beforeAll(async () => {
    await seedTenant(suite.db);
    locationId = await seedLocation(suite.db);
  });

  it("insertReservedNodeTx persists a dormant node with its public key + endorsement", async () => {
    await withTransaction(suite.db, (tx) =>
      insertReservedNodeTx(tx, {
        id: CLOUD_NODE,
        locationId,
        name: "cloud",
        filingModule: null,
        taxModule: null,
        publicKey: "cloudpub",
        endorsement: ENDORSEMENT,
      }),
    );
    expect(await readNodeEndorsement(suite.db, CLOUD_NODE)).toEqual(ENDORSEMENT);
    // the dormant node's public key joins the trust set (readMembershipTrustSet reads public_key)
    const trust = await readMembershipTrustSet(suite.db);
    expect(trust[CLOUD_NODE]).toBe("cloudpub");
  });

  it("readNodeEndorsement returns null for a node with no endorsement (a primary)", async () => {
    const bare = await seedNode(suite.db, locationId);
    expect(await readNodeEndorsement(suite.db, bare)).toBeNull();
  });

  it("readNodeEndorsement returns null for a node that has no row at all", async () => {
    expect(await readNodeEndorsement(suite.db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("insertReservedSeriesTx inserts the reserved series at next_number 1", async () => {
    await withTransaction(suite.db, (tx) =>
      insertReservedSeriesTx(tx, [
        { nodeId: CLOUD_NODE, code: "FA-3", purpose: "standard" },
        { nodeId: CLOUD_NODE, code: "RF-3", purpose: "rectificative" },
      ]),
    );
    const rows = await withTransaction(suite.db, (tx) =>
      tx.execute<{ code: string; next_number: number }>(
        sql`select code, next_number from invoice_series where node_id = ${CLOUD_NODE} order by code`,
      ),
    );
    expect(rows.rows.map((r) => [r.code, Number(r.next_number)])).toEqual([
      ["FA-3", 1],
      ["RF-3", 1],
    ]);
  });

  it("insertReservedSeriesTx writes nothing at all for an empty list", async () => {
    // A node reserved with no series must not emit an INSERT with no rows — drizzle builds invalid
    // SQL for an empty values list, so the early return is what keeps the caller's transaction
    // alive rather than a nicety.
    //
    // The two counts below were written `count(*)::int` for a PostgreSQL driver that returned a
    // BigInt. Run against this engine that statement is refused at prepare with
    // `unrecognized token: ":"` (node v26.7.0, `node:sqlite`), and the cast has nothing left to do:
    // `select count(*) as count` on a two-row table hands back `2` with `typeof === "number"`,
    // measured the same way. The `Number(...)` wrappers below are left in place — they are a no-op
    // on a number and they are what the assertion already said.
    const before = await withTransaction(suite.db, (tx) =>
      tx.execute<{ count: number }>(sql`select count(*) as count from invoice_series`),
    );
    await expect(
      withTransaction(suite.db, (tx) => insertReservedSeriesTx(tx, [])),
    ).resolves.toBeUndefined();
    const after = await withTransaction(suite.db, (tx) =>
      tx.execute<{ count: number }>(sql`select count(*) as count from invoice_series`),
    );
    expect(Number(after.rows[0]!.count)).toBe(Number(before.rows[0]!.count));
  });

  it("readStandardSeriesId returns the node's standard series id, not the rectificative", async () => {
    // A node with both purposes reserved (R2's real shape): the standard series is the one R3b's
    // promote points config.till.seriesId at, never the rectificative sitting beside it.
    const node = await seedNode(suite.db, locationId);
    await withTransaction(suite.db, (tx) =>
      insertReservedSeriesTx(tx, [
        { nodeId: node, code: "F-42", purpose: "standard" },
        { nodeId: node, code: "R-42", purpose: "rectificative" },
      ]),
    );
    const id = await readStandardSeriesId(suite.db, node);
    // it is a real series row, of purpose 'standard'
    const [row] = await withTransaction(suite.db, (tx) =>
      tx
        .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, id)),
    );
    expect(row).toEqual({ code: "F-42", purpose: "standard" });
  });

  it("readStandardSeriesId throws series.no_standard_for_node when the node has none", async () => {
    const bareNode = await seedNode(suite.db, locationId);
    const err = await captureError(() => readStandardSeriesId(suite.db, bareNode));
    expect(isAppError(err) && err.code).toBe("series.no_standard_for_node");
    expect(isAppError(err) && err.params).toEqual({ nodeId: bareNode });
  });

  it("readStandardSeriesId ignores a RETIRED standard series (a cold restore retires the old one)", async () => {
    const node = await seedNode(suite.db, locationId);
    await withTransaction(suite.db, (tx) =>
      insertReservedSeriesTx(tx, [
        { nodeId: node, code: "FA", purpose: "standard" },
        { nodeId: node, code: "FA-210441234", purpose: "standard" },
      ]),
    );
    await suite.db
      .update(invoiceSeries)
      .set({ retiredAt: new Date() })
      .where(and(eq(invoiceSeries.nodeId, node), eq(invoiceSeries.code, "FA")));
    const id = await readStandardSeriesId(suite.db, node);
    const [row] = await suite.db
      .select({ code: invoiceSeries.code })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, id));
    expect(row?.code).toBe("FA-210441234");
  });

  it("readStandardSeriesId is LOUD on two live standard series (a data-integrity corruption)", async () => {
    const node = await seedNode(suite.db, locationId);
    await withTransaction(suite.db, (tx) =>
      insertReservedSeriesTx(tx, [
        { nodeId: node, code: "X1", purpose: "standard" },
        { nodeId: node, code: "X2", purpose: "standard" },
      ]),
    );
    await expect(readStandardSeriesId(suite.db, node)).rejects.toThrow(
      /more than one standard series/,
    );
  });

  it("retireNodeSeriesTx retires every LIVE series of the node and only those", async () => {
    const node = await seedNode(suite.db, locationId);
    const other = await seedNode(suite.db, locationId);
    await withTransaction(suite.db, (tx) =>
      insertReservedSeriesTx(tx, [
        { nodeId: node, code: "FA", purpose: "standard" },
        { nodeId: node, code: "RE", purpose: "rectificative" },
        { nodeId: other, code: "FA", purpose: "standard" },
      ]),
    );
    const retired = await withTransaction(suite.db, (tx) => retireNodeSeriesTx(tx, node));
    expect(retired).toBe(2);
    const rows = await suite.db
      .select({ nodeId: invoiceSeries.nodeId, retiredAt: invoiceSeries.retiredAt })
      .from(invoiceSeries)
      .where(inArray(invoiceSeries.nodeId, [node, other]));
    expect(rows.filter((r) => r.nodeId === node).every((r) => r.retiredAt !== null)).toBe(true);
    expect(rows.filter((r) => r.nodeId === other).every((r) => r.retiredAt === null)).toBe(true);
    // Idempotent on the already-retired: nothing left to retire.
    expect(await withTransaction(suite.db, (tx) => retireNodeSeriesTx(tx, node))).toBe(0);
  });

  it("insertNodeSeriesTx refuses duplicate codes within a batch with a domain error", async () => {
    const node = await seedNode(suite.db, locationId);
    await expect(
      withTransaction(suite.db, (tx) =>
        insertNodeSeriesTx(tx, node, [
          { code: "FA-7", purpose: "standard" },
          { code: "FA-7", purpose: "rectificative" },
        ]),
      ),
    ).rejects.toMatchObject({ code: "series.code_collision", params: { code: "FA-7" } });
  });

  it("insertNodeSeriesTx inserts at next_number 1 and refuses a code the node holds, live OR retired", async () => {
    const node = await seedNode(suite.db, locationId);
    await withTransaction(suite.db, (tx) =>
      insertReservedSeriesTx(tx, [{ nodeId: node, code: "FA", purpose: "standard" }]),
    );
    await withTransaction(suite.db, (tx) => retireNodeSeriesTx(tx, node));
    await withTransaction(suite.db, (tx) =>
      insertNodeSeriesTx(tx, node, [{ code: "FA-7", purpose: "standard" }]),
    );
    const [fresh] = await suite.db
      .select({ nextNumber: invoiceSeries.nextNumber, retiredAt: invoiceSeries.retiredAt })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, node), eq(invoiceSeries.code, "FA-7")));
    expect(fresh).toEqual({ nextNumber: 1, retiredAt: null });
    // Both the retired FA and the live FA-7 reserve their codes.
    for (const code of ["FA", "FA-7"]) {
      const err = await captureError(() =>
        withTransaction(suite.db, (tx) =>
          insertNodeSeriesTx(tx, node, [{ code, purpose: "standard" }]),
        ),
      );
      expect(isAppError(err) && err.code).toBe("series.code_collision");
      expect(isAppError(err) && err.params).toEqual({ code });
    }
    // An empty list is a no-op, not an INSERT with no rows.
    await withTransaction(suite.db, (tx) => insertNodeSeriesTx(tx, node, []));
  });
});
