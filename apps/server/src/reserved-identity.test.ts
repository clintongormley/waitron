import { seedFixtureSif as registerSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing, readNodeSigningKey, type KeyRing } from "@waitron/credentials";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { currentSif } from "@waitron/fiscal-verifactu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { Endorsement } from "@waitron/membership";
import type { ReservedIdentity } from "./mirror-bundle.js";
import { ALL_MODULES } from "./modules.js";
import {
  establishReservedStandbyIdentity,
  generateStandbyIdentity,
  type StandbyIdentity,
} from "./reserved-identity.js";
import { standbyContract, allocatedStandbyModules } from "./testing/allocated-contract.js";
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

  let NIF: string;

  // A fresh taxpayer per test: the idempotency case starts from an unsealed vault, so it cannot share a
  // taxpayer with the establish case (which seals one).
  beforeEach(async () => {
    await seedVenue(suite.db, {
      name: "Main room",
      invoiceLocales: ["es-ES"],
    });
    const t = await suite.db.execute<{ tax_id: string }>(
      sql`select tax_id from taxpayer where id = 1`,
    );
    NIF = t.rows[0]!.tax_id;
  });

  it("establishes the spare without creating live fiscal rows or storing its key", async () => {
    const standby = generateStandbyIdentity();
    const fixture = await preparedReservation(standby);
    await fixture.authorised("establish", (operation) =>
      establishReservedStandbyIdentity(
        { ownerDb: suite.db },
        {
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
    expect(await readNodeSigningKey(suite.node, RING, standby.nodeId)).toBeNull();
    expect(
      await suite.db.execute<{ n: number }>(
        sql`select count(*) as n from venue_credentials where purpose = 'membership.node_key'`,
      ).rows[0]!.n,
    ).toBe(0);
    await expect(
      withTransaction(suite.db, (tx) => currentSif(tx, brandNodeId(standby.nodeId))),
    ).rejects.toMatchObject({ code: "sif.not_registered" });
    const series = await withTransaction(suite.db, (tx) =>
      tx.execute<{ n: number }>(
        sql`select cast(count(*) as int) as n from invoice_series where node_id = ${standby.nodeId}`,
      ),
    );
    expect(series.rows[0]!.n).toBe(0);
  });

  it("is idempotent: a second call with a fresh identity is a no-op (keeps the first)", async () => {
    const first = generateStandbyIdentity();
    const base = {
      nodeName: "cloud",
      filingModule: null,
      taxModule: null,
      modules: ALL_MODULES,
    };
    const fixture = await preparedReservation(first);
    await fixture.authorised("establish", (operation) =>
      establishReservedStandbyIdentity(
        { ownerDb: suite.db },
        {
          ...base,
          modules: allocatedStandbyModules(ALL_MODULES, fixture),
          standby: first,
          reserved: {
            modules: { "fiscal-verifactu": fixture.state },
            series: [],
            endorsement: { ...ENDORSEMENT },
          },
          moduleOperations: new Map([["fiscal-verifactu", operation]]),
        },
      ),
    );
    const second = { ...generateStandbyIdentity(), nodeId: first.nodeId };
    await establishReservedStandbyIdentity(
      { ownerDb: suite.db },
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
    const node = await suite.db.execute<{ public_key: string }>(
      sql`select public_key from nodes where id = ${first.nodeId}`,
    );
    expect(node.rows).toEqual([{ public_key: first.publicKey }]);
    expect(
      await suite.db.execute<{ n: number }>(
        sql`select count(*) as n from venue_credentials where purpose = 'membership.node_key'`,
      ).rows[0]!.n,
    ).toBe(0);
    expect(await readNodeSigningKey(suite.node, RING, first.nodeId)).toBeNull();
  });

  it("refuses a bundle whose fiscal reservation is missing, before writing the node", async () => {
    const standby = generateStandbyIdentity();
    const fixture = await preparedReservation(standby);
    await expect(
      fixture.authorised("establish", (operation) =>
        establishReservedStandbyIdentity(
          { ownerDb: suite.db },
          {
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
    expect(await readNodeSigningKey(suite.node, RING, standby.nodeId)).toBeNull();
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
          { ownerDb: suite.db },
          {
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
    expect(await readNodeSigningKey(suite.node, RING, standby.nodeId)).toBeNull();
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    const series = await suite.db.execute(
      sql`select 1 from invoice_series where node_id = ${standby.nodeId}`,
    );
    expect(series.rows).toEqual([]);
  });
  it("refuses premature series before writing the spare's node or key", async () => {
    const standby = generateStandbyIdentity();
    await expect(
      establishReservedStandbyIdentity(
        { ownerDb: suite.db },
        {
          standby,
          nodeName: "Spare",
          filingModule: "fiscal-verifactu",
          taxModule: null,
          modules: ALL_MODULES,
          reserved: {
            modules: {},
            series: [{ code: "FA-PREMATURE", purpose: "standard" }],
            endorsement: { ...ENDORSEMENT, nodeId: standby.nodeId, publicKey: standby.publicKey },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "module.operation_invalid",
      params: { module: "fiscal-verifactu" },
    });
    expect(
      (await suite.db.execute(sql`select 1 from nodes where id = ${standby.nodeId}`)).rows,
    ).toEqual([]);
    expect(await readNodeSigningKey(suite.node, RING, standby.nodeId)).toBeNull();
  });

  it("establishes the node with no reserved series when the bundle carries no `series` key and no module reserves", async () => {
    const standby = generateStandbyIdentity();
    await establishReservedStandbyIdentity(
      { ownerDb: suite.db },
      {
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
  it("refuses with mirror.venue_not_copied before writing the standby's node when no venue row exists", async () => {
    const standby = generateStandbyIdentity();
    await suite.db.execute(sql`delete from settings where module = 'venue'`);
    await expect(
      establishReservedStandbyIdentity(
        { ownerDb: suite.db },
        {
          standby,
          nodeName: "cloud",
          filingModule: null,
          taxModule: null,
          modules: [],
          reserved: {
            modules: {},
            series: [],
            endorsement: { ...ENDORSEMENT, nodeId: standby.nodeId, publicKey: standby.publicKey },
          },
        },
      ),
    ).rejects.toMatchObject({ code: "mirror.venue_not_copied" });
    expect(
      (await suite.db.execute(sql`select 1 from nodes where id = ${standby.nodeId}`)).rows,
    ).toEqual([]);
    expect(
      (await suite.db.execute(sql`select 1 from invoice_series where node_id = ${standby.nodeId}`))
        .rows,
    ).toEqual([]);
  });

  it("refuses a fiscal standby without a venue before recording its reservation", async () => {
    const standby = generateStandbyIdentity();
    const fixture = await preparedReservation(standby);
    await suite.db.execute(sql`pragma foreign_keys = off`);
    try {
      await suite.db.execute(sql`delete from settings where module = 'venue'`);
    } finally {
      await suite.db.execute(sql`pragma foreign_keys = on`);
    }
    await expect(
      fixture.authorised("establish", (operation) =>
        establishReservedStandbyIdentity(
          { ownerDb: suite.db },
          {
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
      ),
    ).rejects.toMatchObject({ code: "mirror.venue_not_copied" });
    expect(
      (await suite.db.execute(sql`select 1 from nodes where id = ${standby.nodeId}`)).rows,
    ).toEqual([]);
    expect(
      (await suite.db.execute(sql`select 1 from invoice_series where node_id = ${standby.nodeId}`))
        .rows,
    ).toEqual([]);
  });

  async function preparedReservation(standby: StandbyIdentity) {
    const primary = {
      nodeId: await seedNode(suite.db),
    };
    await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
    await withTransaction(suite.db, (tx) =>
      registerSif(tx, { nodeId: primary.nodeId, nif: NIF, idSistemaInformatico: "W1" }),
    );
    await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: primary.nodeId, code: "FA", purpose: "standard" });
    return standbyContract(primary.nodeId, standby.nodeId);
  }
});
