import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordSale } from "@waitron/core";
import type { RecordSaleInput } from "@waitron/core";
import { locations, nodes, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { hashPassword, loginManager, loginManagerById, type TotpKeyRing } from "@waitron/identity";
import type { TrustedClock } from "@waitron/fiscal";
import {
  deviceOrigin,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { applyVenue as applyDirectVenue } from "./venue-apply.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";
import { applyAllocatedTestVenue as applyVenue } from "../test/allocated-venue.js";
import { seedDevice } from "@waitron/db/testing/seed.js";

const TOTP_KEY_RING: TotpKeyRing = { current: { version: 1, key: Buffer.alloc(32, 0x5) } };

/**
 * "Sellable": a venue provisioned by the real `applyVenue` can immediately chain a sale through the
 * real Veri*Factu backend, with nothing seeded by hand between the two.
 */
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

const steadyClock: TrustedClock = {
  now: () => ({
    instant: new Date("2026-03-01T13:05:00+01:00"),
    offsetMinutes: 60,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("steadyClock: anchor() is not used by recordSale");
  },
  currentAnchor: () => null,
};

function request(taxId = "B12345674", adminEmail = "owner@example.test"): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Deli SL",
    location: {
      name: "Mostrador",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "venta en establecimiento",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    },
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: hashPassword("dashPass123"),
      email: adminEmail,
    },
  };
}

/** A well-formed sale — the reconciled figures from `write-path-fixtures.ts`'s `saleInput`. */
function saleInput(ids: { deviceId: string; nodeId: string; seriesId: string }): RecordSaleInput {
  return {
    origin: deviceOrigin(ids.deviceId),
    nodeId: brandNodeId(ids.nodeId),
    seriesId: brandSeriesId(ids.seriesId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        name: "Café solo",
        descriptions: { "es-ES": "Café solo" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        name: "Agua",
        descriptions: { "es-ES": "Agua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    settlement: {
      kind: "immediate",
      tenders: [
        {
          method: "card",
          amount: "16.31",
          tipAmount: "1.90",
          settledAt: steadyClock.now().instant,
        },
      ],
    },
    clock: steadyClock,
  };
}

describe("a venue provisioned by applyVenue is immediately sellable", () => {
  it("chains a real sale through the Veri*Factu backend against the provisioned node", async () => {
    const venue = await applyVenue(planVenue(request(), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const backend = new VerifactuBackend({
      deploymentEnvironment: "preproduction",
      clock: steadyClock,
      db: suite.db,
      // Required by the constructor; recordSale never submits.
      resolveClient: () => Promise.resolve(createFakeAeat().client()),
    });

    const standardSeriesId = venue.seriesIds[0]!;
    const { deviceId } = await seedDevice(suite.db, {
      locationId: brandLocationId(venue.locationId),
    });

    const { saleId, fiscal } = await withTransaction(suite.db, async (tx) => {
      return recordSale(
        tx,
        backend,
        saleInput({
          deviceId,
          nodeId: venue.nodeId,
          seriesId: standardSeriesId,
        }),
      );
    });

    expect(saleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fiscal.verificationUrl).toContain("nif=");

    const chained = await suite.db.execute<{
      registros: number;
      secuencia: number;
      head_secuencia: number;
    }>(sql`
      select
        (select count(*) from registros_facturacion where node_id = ${venue.nodeId}) as registros,
        (select secuencia from registros_facturacion where sale_id = ${saleId}) as secuencia,
        (select secuencia from cadenas where node_id = ${venue.nodeId}) as head_secuencia`);
    expect(chained.rows[0]).toEqual({ registros: 1, secuencia: 1, head_secuencia: 1 });
  });
});

describe("the provisioned admin authenticates by id with its password", () => {
  it("loginManagerById succeeds with the provisioned password and rejects a wrong one", async () => {
    // The mirror-bundle path authenticates the admin by id, independently of the email.
    await applyVenue(planVenue(request("B33333333"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const admin = await suite.db.execute<{ id: string }>(sql`
      select id from persons where role = 'admin'`);
    const personId = admin.rows[0]?.id;
    expect(personId).toBeDefined();

    const session = await withTransaction(suite.db, async (tx) => {
      return loginManagerById(tx, {
        personId: personId!,
        password: "dashPass123",
        totpKeyRing: TOTP_KEY_RING,
      });
    });
    expect(session.personId).toBe(personId);

    await expect(
      withTransaction(suite.db, async (tx) => {
        return loginManagerById(tx, {
          personId: personId!,
          password: "wrongpass1",
          totpKeyRing: TOTP_KEY_RING,
        });
      }),
    ).rejects.toMatchObject({ code: "password.invalid" });
  });
});

describe("the onboarding-provisioned admin authenticates by email", () => {
  it("loginManager (the email path) succeeds with the provisioned email + password and rejects a wrong one", async () => {
    const adminEmail = "owner@venue.example";
    await applyVenue(planVenue(request("B44444444", adminEmail), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });

    const admin = await suite.db.execute<{ id: string }>(sql`
      select id from persons where role = 'admin'`);
    const personId = admin.rows[0]?.id;
    expect(personId).toBeDefined();

    const session = await withTransaction(suite.db, async (tx) => {
      return loginManager(tx, {
        email: adminEmail,
        password: "dashPass123",
        totpKeyRing: TOTP_KEY_RING,
      });
    });
    expect(session.personId).toBe(personId);

    await expect(
      withTransaction(suite.db, async (tx) => {
        return loginManager(tx, {
          email: adminEmail,
          password: "wrongpass1",
          totpKeyRing: TOTP_KEY_RING,
        });
      }),
    ).rejects.toMatchObject({ code: "password.invalid" });
  });
});

describe("direct action country zone preflight", () => {
  it.each([
    [undefined, "missing"],
    [null, "missing"],
    ["", "missing"],
    ["  ", "missing"],
    [120, "invalid"],
    ["+02:00", "invalid"],
    ["Invalid/Zone", "invalid"],
    ["Europe/London", "country"],
  ])("refuses zone %j before module preparation or any seed", async (timeZone, reason) => {
    let preparations = 0;
    let seeds = 0;
    const module = fakeModule("zone-probe", {
      operations: {
        prepare: async (operation, run) => {
          preparations++;
          return run(operation);
        },
      },
      provisioning: {
        seed: {
          summary: "zone probe",
          run: async () => {
            seeds++;
            return "seeded";
          },
        },
      },
    });
    const actions = planVenue(request(), [module]);
    for (const action of actions)
      if (action.kind === "create-location") action.timeZone = timeZone as string;
    const refusal = await applyDirectVenue(actions, {
      db: suite.db,
      modules: [module],
      moduleInputs: new Map([
        [module.name, { eventId: "zone-test", sourceId: "zone-test", input: {} }],
      ]),
    }).catch((error: unknown) => error);
    expect(await suite.db.select().from(locations)).toEqual([]);
    expect(await suite.db.select().from(tenants)).toEqual([]);
    expect(await suite.db.select().from(nodes)).toEqual([]);
    expect({ preparations, seeds }).toEqual({ preparations: 0, seeds: 0 });
    expect(refusal).toMatchObject({ code: "venue.time_zone_invalid", params: { reason } });
  });

  it("checks every create-location action before the first seed", async () => {
    let seeds = 0;
    const module = fakeModule("zone-probe", {
      provisioning: {
        seed: {
          summary: "zone probe",
          run: async () => {
            seeds++;
            return "seeded";
          },
        },
      },
    });
    const actions = planVenue(request(), [module]);
    const location = actions.find((action) => action.kind === "create-location")!;
    actions.push({ ...location, timeZone: "Europe/London" });
    const refusal = await applyDirectVenue(actions, { db: suite.db, modules: [module] }).catch(
      (error: unknown) => error,
    );
    expect(seeds).toBe(0);
    expect(await suite.db.select().from(locations)).toEqual([]);
    expect(refusal).toMatchObject({
      code: "venue.time_zone_invalid",
      params: { reason: "country" },
    });
  });

  it("refuses an invalid saved zone before reuse conversion without repairing it", async () => {
    const actions = planVenue(request(), []);
    const venue = await applyDirectVenue(actions, { db: suite.db, modules: [] });
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`update locations set time_zone = 'Invalid/Zone' where id = ${venue.locationId}`,
      );
    });
    const before = (await suite.db.execute(sql`select * from locations`)).rows;
    const refusal = await applyDirectVenue(actions, { db: suite.db, modules: [] }).catch(
      (error: unknown) => error,
    );
    expect((await suite.db.execute(sql`select * from locations`)).rows).toEqual(before);
    expect(refusal).toMatchObject({
      code: "venue.time_zone_invalid",
      params: { reason: "invalid" },
    });
  });

  it("normalizes a direct action without mutating its caller", async () => {
    const actions = planVenue(request(), []);
    const action = actions.find((action) => action.kind === "create-location")!;
    action.timeZone = " Europe/Madrid ";
    await applyDirectVenue(actions, { db: suite.db, modules: [] });
    expect(await suite.db.select({ timeZone: locations.timeZone }).from(locations)).toEqual([
      { timeZone: "Europe/Madrid" },
    ]);
    expect(action.timeZone).toBe(" Europe/Madrid ");
  });
});

it("rechecks saved zone inside the transaction after outside preparation", async () => {
  let preparations = 0;
  let seeds = 0;
  const module = fakeModule("zone-probe", {
    operations: {
      prepare: async (operation, run) => {
        preparations++;
        const installed = await applyDirectVenue(planVenue(request(), []), {
          db: suite.db,
          modules: [],
        });
        await withTransaction(suite.db, async (tx) => {
          await tx.execute(
            sql`update locations set time_zone = 'Invalid/Zone' where id = ${installed.locationId}`,
          );
        });
        return run(operation);
      },
    },
    provisioning: {
      seed: {
        summary: "zone probe",
        run: async () => {
          seeds++;
          return "seeded";
        },
      },
    },
  });
  await expect(
    applyDirectVenue(planVenue(request(), [module]), {
      db: suite.db,
      modules: [module],
      moduleInputs: new Map([
        [module.name, { eventId: "zone-test", sourceId: "zone-test", input: {} }],
      ]),
    }),
  ).rejects.toMatchObject({ code: "venue.time_zone_invalid", params: { reason: "invalid" } });
  expect({ preparations, seeds }).toEqual({ preparations: 1, seeds: 0 });
  expect(await suite.db.select({ timeZone: locations.timeZone }).from(locations)).toEqual([
    { timeZone: "Invalid/Zone" },
  ]);
});

it.each(["Europe/London", "US/Eastern"])(
  "does not treat the valid saved zone %s as repair eligibility",
  async (timeZone) => {
    const actions = planVenue(request(), []);
    const installed = await applyDirectVenue(actions, { db: suite.db, modules: [] });
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`update locations set time_zone = ${timeZone} where id = ${installed.locationId}`,
      );
    });
    await expect(applyDirectVenue(actions, { db: suite.db, modules: [] })).rejects.toMatchObject({
      code: "provisioning.second_venue",
    });
    expect(await suite.db.select({ timeZone: locations.timeZone }).from(locations)).toEqual([
      { timeZone },
    ]);
  },
);
