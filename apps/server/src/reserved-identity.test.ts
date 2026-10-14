import { seedFixtureSif as registerSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing, tryGetCredential, type KeyRing } from "@waitron/credentials";
import { deployment, invoiceSeries, locations, nodes, withTransaction } from "@waitron/db";
import { ALLOCATED_FISCAL_STANDBY, currentSif } from "@waitron/fiscal-verifactu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import type { Endorsement } from "@waitron/membership";
import type { ReservedIdentity } from "./mirror-bundle.js";
import { ALL_MODULES } from "./modules.js";
import {
  establishReservedStandbyIdentity,
  generateStandbyIdentity,
  type StandbyIdentity,
} from "./reserved-identity.js";
import { standbyContract, allocatedStandbyModules } from "./testing/allocated-contract.js";
import { fiscalReservations } from "@waitron/fiscal-verifactu/src/schema/reservations.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const ENDORSEMENT: Endorsement = { nodeId: "n", publicKey: "p", endorsedBy: "e", signature: "s" };

describe("establishReservedStandbyIdentity", () => {
  // The full manifest (`manifestSets()`), not just [core, credentials, fiscal]: each module lands on
  // top of its dependencies in one ordered set — the production order.
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });

  let locationId: LocationId;
  let NIF: string;

  // A fresh tenant per test: the idempotency case starts from an unsealed vault, so it cannot share a
  // tenant with the establish case (which seals one). Tenants accumulate for the suite, each on its own
  // NIF via seedTenant's counter.
  beforeEach(async () => {
    await seedTenant(suite.db);
    // Through the table definition: `locations.id` is a `$defaultFn(newId)` value, not a SQL DEFAULT,
    // so a raw insert omitting it returns nothing to brand.
    const [loc] = await suite.db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    locationId = loc!.id as LocationId;
    const t = await suite.db.execute<{ tax_id: string }>(
      sql`select tax_id from tenants where id = 1`,
    );
    NIF = t.rows[0]!.tax_id;
  });

  it("establishes a dormant reservation and opens its supplied SIF and series only at takeover", async () => {
    const standby = generateStandbyIdentity();
    const fixture = await preparedReservation(standby);
    await fixture.authorised("establish", (operation) =>
      establishReservedStandbyIdentity(
        { ownerDb: suite.db, ring: RING },
        {
          locationId,
          standby,
          nodeName: "cloud",
          filingModule: "verifactu",
          taxModule: "vat",
          modules: allocatedStandbyModules(ALL_MODULES, fixture),
          moduleOperations: new Map([["fiscal-verifactu", operation]]),
          reserved: {
            modules: { "fiscal-verifactu": fixture.state },
            series: [],
            endorsement: { ...ENDORSEMENT, nodeId: standby.nodeId, publicKey: standby.publicKey },
          },
        },
      ),
    );
    // sealed private key present
    const cred = await withTransaction(suite.db, (tx) =>
      tryGetCredential(tx, RING, {
        purpose: "membership.node_key",
      }),
    );
    expect(cred?.privateKey).toBe(standby.privateKey);
    const reservations = await suite.db.select().from(fiscalReservations);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.installationIdentity).toBe("P000042");
    expect(reservations[0]?.taxpayerNif).toBe(NIF);
    await expect(
      withTransaction(suite.db, (tx) => currentSif(tx, brandNodeId(standby.nodeId))),
    ).rejects.toMatchObject({ code: "sif.not_registered" });
    const series = await withTransaction(suite.db, (tx) =>
      tx.execute<{ n: number }>(
        sql`select cast(count(*) as int) as n from invoice_series where node_id = ${standby.nodeId}`,
      ),
    );
    expect(series.rows[0]!.n).toBe(0);
    await fixture.transaction(suite.db, "promote", (tx, operation) =>
      ALLOCATED_FISCAL_STANDBY.activate!(
        tx,
        { nodeId: brandNodeId(standby.nodeId), locationId },
        operation,
      ),
    );
    const sif = await withTransaction(suite.db, (tx) =>
      currentSif(tx, brandNodeId(standby.nodeId)),
    );
    expect(sif.numeroInstalacion).toBe("P000042");
    const active = await suite.db.execute<{ code: string; purpose: string }>(sql`
      select code, purpose from invoice_series where node_id = ${standby.nodeId} and retired_at is null order by code
    `);
    expect(active.rows).toEqual([{ code: "FA-P000042", purpose: "standard" }]);
  });

  it("is idempotent: a second call with a fresh identity is a no-op (keeps the first)", async () => {
    const first = generateStandbyIdentity();
    const base = {
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
          modules: {
            "fiscal-verifactu": { nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: 1 },
          },
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
          modules: {
            "fiscal-verifactu": { nif: NIF, idSistemaInformatico: "W1", numeroInstalacion: 2 },
          },
          series: [],
          endorsement: { ...ENDORSEMENT },
        },
      },
    );
    // the vault still holds the FIRST key; the SECOND node has no reserved SIF
    const cred = await withTransaction(suite.db, (tx) =>
      tryGetCredential(tx, RING, {
        purpose: "membership.node_key",
      }),
    );
    expect(cred?.privateKey).toBe(first.privateKey);
    const rows = await withTransaction(suite.db, (tx) =>
      tx.execute<{ n: number }>(
        sql`select cast(count(*) as int) as n from registro_sif where node_id = ${second.nodeId}`,
      ),
    );
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("refuses a bundle whose fiscal reservation is missing, before writing the node", async () => {
    const standby = generateStandbyIdentity();
    const fixture = await preparedReservation(standby);
    await expect(
      fixture.authorised("establish", (operation) =>
        establishReservedStandbyIdentity(
          { ownerDb: suite.db, ring: RING },
          {
            locationId,
            standby,
            nodeName: "cloud",
            filingModule: "verifactu",
            taxModule: "vat",
            modules: allocatedStandbyModules(ALL_MODULES, fixture),
            moduleOperations: new Map([["fiscal-verifactu", operation]]),
            reserved: { modules: {}, series: [], endorsement: ENDORSEMENT },
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
    const node = await suite.db.execute(sql`select 1 from nodes where id = ${standby.nodeId}`);
    expect(node.rows).toEqual([]);
    expect(await tryGetCredential(suite.db, RING, { purpose: "membership.node_key" })).toBeNull();
    expect(await suite.db.select().from(fiscalReservations)).toEqual([]);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    const series = await suite.db.execute(
      sql`select 1 from invoice_series where node_id = ${standby.nodeId}`,
    );
    expect(series.rows).toEqual([]);
  });

  it("refuses a bundle carrying no `modules` key at all, before writing the node", async () => {
    // The other shape of the same wire defect: not an empty map but a bundle whose `modules` (and
    // `series`) keys are absent entirely. The carrier must still reach the module's own refusal —
    // an unguarded index would throw a bare TypeError here instead.
    const standby = generateStandbyIdentity();
    const fixture = await preparedReservation(standby);
    await expect(
      fixture.authorised("establish", (operation) =>
        establishReservedStandbyIdentity(
          { ownerDb: suite.db, ring: RING },
          {
            locationId,
            standby,
            nodeName: "cloud",
            filingModule: "verifactu",
            taxModule: "vat",
            modules: allocatedStandbyModules(ALL_MODULES, fixture),
            moduleOperations: new Map([["fiscal-verifactu", operation]]),
            reserved: { endorsement: ENDORSEMENT } as unknown as ReservedIdentity,
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
    const node = await suite.db.execute(sql`select 1 from nodes where id = ${standby.nodeId}`);
    expect(node.rows).toEqual([]);
    expect(await tryGetCredential(suite.db, RING, { purpose: "membership.node_key" })).toBeNull();
    expect(await suite.db.select().from(fiscalReservations)).toEqual([]);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    const series = await suite.db.execute(
      sql`select 1 from invoice_series where node_id = ${standby.nodeId}`,
    );
    expect(series.rows).toEqual([]);
  });
  it("establishes the node with no reserved series when the bundle carries no `series` key and no module reserves", async () => {
    const standby = generateStandbyIdentity();
    await establishReservedStandbyIdentity(
      { ownerDb: suite.db, ring: RING },
      {
        locationId,
        standby,
        nodeName: "cloud",
        filingModule: null,
        taxModule: null,
        modules: [],
        reserved: { modules: {}, endorsement: ENDORSEMENT } as unknown as ReservedIdentity,
      },
    );
    const node = await suite.db.execute<{ name: string }>(
      sql`select name from nodes where id = ${standby.nodeId}`,
    );
    expect(node.rows).toEqual([{ name: "cloud" }]);
    const series = await suite.db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from invoice_series where node_id = ${standby.nodeId}`,
    );
    expect(series.rows[0]!.n).toBe(0);
  });
  async function preparedReservation(standby: StandbyIdentity) {
    const primary = {
      nodeId: brandNodeId(crypto.randomUUID()),
      locationId: brandLocationId(locationId),
    };
    await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
    await suite.db.insert(nodes).values({ id: primary.nodeId, locationId, name: "Primary" });
    await withTransaction(suite.db, (tx) =>
      registerSif(tx, { nodeId: primary.nodeId, nif: NIF, idSistemaInformatico: "W1" }),
    );
    await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: primary.nodeId, code: "FA", purpose: "standard" });
    return standbyContract(suite.db, primary, standby.nodeId, [
      { code: "FA", purpose: "standard" },
    ]);
  }
});
