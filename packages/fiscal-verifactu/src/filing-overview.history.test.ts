import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invoiceSeries, stampDeployment, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { nodeId as brandNodeId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import {
  appendPendingAlta,
  insertPendingAlta,
  seedPendingEnvios,
  type SeededDrain,
} from "../test/drain-fixtures.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import type { RecoveryApproval } from "./allocation-types.js";
import { readFilingOverview } from "./filing-overview.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { fiscalSeriesConflicts } from "./schema/series-conflicts.js";
import { registroSif } from "./schema/sif.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function installationOf(sifId: string): Promise<string> {
  const [row] = await suite.db
    .select({ name: registroSif.numeroInstalacion })
    .from(registroSif)
    .where(eq(registroSif.id, sifId));
  return row!.name;
}

/** A new identity for the seeded node, with its activation row, as an activation writes both. */
async function activate(
  seeded: SeededDrain,
  options: {
    installation: string;
    activatedAt: string;
    handover?: boolean;
    environment?: "production" | "preproduction";
    sifId?: string;
  },
): Promise<string> {
  return inTx(async (tx) => {
    const sifId =
      options.sifId ??
      (
        await seedFixtureSif(tx, {
          nodeId: brandNodeId(seeded.nodeId),
          nif: seeded.nif,
          idSistemaInformatico: "WT",
          numeroInstalacion: options.installation,
        })
      ).id;
    const environment = options.environment ?? "production";
    const fields = {
      eventId: `event-${options.installation}`,
      operatorId: "administrator",
      sourceId: "source",
      targetNodeId: seeded.nodeId,
      noParallelRecovery: true,
      confirmedAt: options.activatedAt,
      incidentEvidence: "evidence",
    };
    const approval: RecoveryApproval =
      options.handover === true
        ? {
            ...fields,
            version: 2,
            oldMachineRelinquished: true,
            oldMachineOffline: false,
            oldMachineAbsent: false,
          }
        : { ...fields, version: 1, oldMachineOffline: true, oldMachineAbsent: false };
    await tx.insert(fiscalAllocations).values({
      eventKey: `event-${options.installation}`,
      allocationKey: `allocation-${options.installation}`,
      nodeId: seeded.nodeId,
      sifId,
      taxpayerNif: seeded.nif,
      softwareId: "WT",
      environment,
      installationIdentity: options.installation,
      allocation: {
        version: 1,
        allocationId: `allocation-${options.installation}`,
        taxpayerNif: seeded.nif,
        softwareId: "WT",
        environment,
        installationIdentity: options.installation,
        series: [],
        source: "hour",
        reservationEvidence: null,
        issuedAt: options.activatedAt,
      },
      approval,
      bases: [],
      result: { activationEventId: `event-${options.installation}`, sifId, series: [] },
      activatedAt: new Date(options.activatedAt),
    });
    return sifId;
  });
}

async function seriesConflict(seeded: SeededDrain, code: string, number: string, at: string) {
  const [series] = await suite.db
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, seeded.nodeId), eq(invoiceSeries.code, code)));
  await suite.db.insert(fiscalSeriesConflicts).values({
    sifId: seeded.sifId,
    seriesId: series!.id,
    invoiceIdentity: number,
    recordedAt: new Date(at),
    evidence: {
      source: "consulta",
      invoice: {
        IDEmisorFactura: seeded.nif,
        NumSerieFactura: number,
        FechaExpedicionFactura: "19-07-2026",
      },
      reference: "never-shown",
      state: "Correcto",
      fingerprint: "A".repeat(64),
      system: { taxId: "B00000000", softwareId: "XX", installation: "elsewhere" },
    },
  });
  return series!.id;
}

async function retire(seriesId: string) {
  await suite.db
    .update(invoiceSeries)
    .set({ retiredAt: new Date("2026-07-21T00:00:00.000Z") })
    .where(eq(invoiceSeries.id, seriesId));
}

function read(seeded: SeededDrain) {
  return inTx((tx) => readFilingOverview(tx, { nodeId: seeded.nodeId, limit: 200 }));
}

describe("readFilingOverview: possibly missing history", () => {
  it("lists an invoice AEAT holds under a retired series, and not one under a live series", async () => {
    await stampDeployment(suite.db, "production");
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    await retire(await seriesConflict(seeded, "S1", "S1/7", "2026-07-21T05:00:00.000Z"));
    await seriesConflict(seeded, "S2", "S2/7", "2026-07-21T04:00:00.000Z");

    const overview = await read(seeded);

    expect(overview.missingHistory.notIssuedHere).toEqual([
      {
        seriesCode: "S1",
        recordedAt: "2026-07-21T05:00:00.000Z",
        invoice: {
          IDEmisorFactura: seeded.nif,
          NumSerieFactura: "S1/7",
          FechaExpedicionFactura: "19-07-2026",
        },
        state: "Correcto",
        fingerprint: "A".repeat(64),
        system: { taxId: "B00000000", softwareId: "XX", installation: "elsewhere" },
      },
    ]);
  });

  it("reports an identity change without a handover, naming the earlier identity's highest-sequence record", async () => {
    await stampDeployment(suite.db, "production");
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await appendPendingAlta(suite.db, seeded, 2, { generadoEn: "2026-07-20T08:00:00+01:00" });
    const first = await installationOf(seeded.sifId);
    await activate(seeded, {
      installation: first,
      sifId: seeded.sifId,
      activatedAt: "2026-07-20T00:00:00.000Z",
    });
    const restored = await activate(seeded, {
      installation: "B",
      activatedAt: "2026-07-21T00:00:00.000Z",
    });
    await appendPendingAlta(suite.db, { ...seeded, sifId: restored }, 3);
    await activate(seeded, {
      installation: "C",
      activatedAt: "2026-07-22T00:00:00.000Z",
      handover: true,
    });

    const overview = await read(seeded);

    expect(overview.missingHistory.identityChanges).toEqual([
      {
        installationName: "B",
        earlierInstallationName: first,
        lastHeldInvoice: { numSerieFactura: "S2/1", fechaExpedicionFactura: "2026-07-20" },
        activatedAt: "2026-07-21T00:00:00.000Z",
      },
    ]);
  });

  it("names the earlier identity's last record even when it was generated after the new identity's activation time", async () => {
    await stampDeployment(suite.db, "production");
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await appendPendingAlta(suite.db, seeded, 2, { generadoEn: "2026-07-25T12:00:00+01:00" });
    const first = await installationOf(seeded.sifId);
    await activate(seeded, {
      installation: "B",
      activatedAt: "2026-07-21T00:00:00.000Z",
    });

    const overview = await read(seeded);

    expect(overview.missingHistory.identityChanges).toEqual([
      {
        installationName: "B",
        earlierInstallationName: first,
        lastHeldInvoice: { numSerieFactura: "S2/1", fechaExpedicionFactura: "2026-07-20" },
        activatedAt: "2026-07-21T00:00:00.000Z",
      },
    ]);
  });

  it("never names a record, an activation or a series of the other environment", async () => {
    await stampDeployment(suite.db, "production");
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await insertPendingAlta(suite.db, {
      locationId: seeded.locationId,
      nodeId: seeded.nodeId,
      sifId: seeded.sifId,
      nif: seeded.nif,
      secuencia: 2,
      huella: "2".padStart(64, "0"),
      fecha: "2026-07-20",
      entorno: "preproduction",
    });
    const first = await installationOf(seeded.sifId);
    await activate(seeded, {
      installation: "B",
      activatedAt: "2026-07-21T00:00:00.000Z",
    });
    await activate(seeded, {
      installation: "C",
      activatedAt: "2026-07-22T00:00:00.000Z",
      environment: "preproduction",
    });
    const rehearsal = await seedPendingEnvios(suite.db, {
      count: 1,
      entorno: "preproduction",
      identity: { locationId: seeded.locationId, nodeId: seeded.nodeId, nif: seeded.nif },
    });
    const rehearsalSeries = rehearsal.facturaKeys[0]!.split("|")[1]!.split("/")[0]!;
    await retire(
      await seriesConflict(
        rehearsal,
        rehearsalSeries,
        `${rehearsalSeries}/7`,
        "2026-07-23T00:00:00.000Z",
      ),
    );

    const overview = await read(seeded);

    expect(overview.missingHistory).toEqual({
      notIssuedHere: [],
      identityChanges: [
        {
          installationName: "B",
          earlierInstallationName: first,
          lastHeldInvoice: { numSerieFactura: "S1/1", fechaExpedicionFactura: "2026-07-20" },
          activatedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
    });
  });
});
