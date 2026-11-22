import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoiceSeries, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { registerSif, verifactuIdentities } from "@waitron/fiscal-verifactu";
import { nodeId as brandNodeId } from "@waitron/shared";
import {
  freshFiscalIds,
  insertFiscalRegistro,
  insertFiscalSale,
} from "./testing/fiscal-fixtures.js";
import { readChainHeight } from "./chain-height.js";
import { ALL_MODULES } from "./modules.js";

// The full manifest, because `applyVenue` provisions every module's tables.
const LOCALE = "es-ES";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const NIF = "72000001K";

/** Provision one venue as the owner; the fixture mirrors `management-api.status.test.ts`'s `setupVenue()`. */
async function setupVenue(): Promise<{ nodeId: string }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: NIF,
        legalName: "Deli Test SL",
        name: "Main room",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "A",
        correctiveSeriesCode: "R",
        admin: {
          displayName: "Administrator",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  return { nodeId: venue.nodeId };
}

describe("readChainHeight", () => {
  let nodeId: string;
  const recordedAt = "2026-08-29T10:00:00.000Z";

  beforeEach(async () => {
    ({ nodeId } = await setupVenue());
  });

  async function placeRecord() {
    const [series] = await suite.db
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.nodeId, nodeId));
    const [identity] = await suite.db
      .select()
      .from(verifactuIdentities)
      .where(eq(verifactuIdentities.nodeId, nodeId));
    const ids = freshFiscalIds({ nodeId, seriesId: series!.id, sifId: identity!.id });
    await insertFiscalSale(suite.db, ids);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(recordedAt));
    try {
      await insertFiscalRegistro(suite.db, ids, { secuencia: 7 });
    } finally {
      vi.useRealTimers();
    }
    return identity!;
  }

  it("returns 0 / null for an unknown node", async () => {
    expect(await withTransaction(suite.db, (tx) => readChainHeight(tx, randomUUID()))).toEqual({
      height: 0,
      lastAt: null,
    });
  });

  it("returns 0 / null for a provisioned node with no record", async () => {
    expect(await withTransaction(suite.db, (tx) => readChainHeight(tx, nodeId))).toEqual({
      height: 0,
      lastAt: null,
    });
  });

  it("returns the latest record's position and creation time", async () => {
    await placeRecord();
    expect(await withTransaction(suite.db, (tx) => readChainHeight(tx, nodeId))).toEqual({
      height: 7,
      lastAt: recordedAt,
    });
  });

  it("keeps the last record time after registering a fresh identity", async () => {
    const old = await placeRecord();
    await withTransaction(suite.db, (tx) =>
      registerSif(tx, {
        nodeId: brandNodeId(nodeId),
        nif: old.nif,
        idSistemaInformatico: old.idSistemaInformatico,
        numeroInstalacion: "P000042",
      }),
    );
    expect(await withTransaction(suite.db, (tx) => readChainHeight(tx, nodeId))).toEqual({
      height: 7,
      lastAt: recordedAt,
    });
  });
});
