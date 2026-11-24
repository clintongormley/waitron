import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  invoiceSeries,
  newId,
  now,
  stampDeployment,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { nodeId as brandNodeId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import {
  appendPendingAlta,
  insertPendingAlta,
  seedIndependentChain,
  seedPendingEnvios,
  type SeededDrain,
} from "../test/drain-fixtures.js";
import { withoutIdentityTriggers } from "../test/sif-fixture.js";
import type { RecoveryApproval } from "./allocation-types.js";
import { readFilingOverview } from "./filing-overview.js";
import { verifactuSeriesConflicts } from "./schema/verifactu-series-conflicts.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function installationOf(sifId: string): Promise<string> {
  const [row] = await suite.db
    .select({ name: verifactuIdentities.numeroInstalacion })
    .from(verifactuIdentities)
    .where(eq(verifactuIdentities.id, sifId));
  return row!.name;
}

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
  const write = async (tx: Transaction) => {
    const sifId = options.sifId ?? newId();
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
    const allocation = {
      eventKey: `event-${options.installation}`,
      allocationKey: `allocation-${options.installation}`,
      environment,
      allocation: {
        version: 1 as const,
        allocationId: `allocation-${options.installation}`,
        taxpayerNif: seeded.nif,
        softwareId: "WT",
        environment,
        installationIdentity: options.installation,
        series: [],
        source: "hour" as const,
        reservationEvidence: null,
        issuedAt: options.activatedAt,
      },
      approval,
      bases: [],
      result: { activationEventId: `event-${options.installation}`, sifId, series: [] },
      registradoEn: new Date(options.activatedAt),
    };
    if (options.sifId !== undefined) {
      await tx.update(verifactuIdentities).set(allocation).where(eq(verifactuIdentities.id, sifId));
    } else {
      await tx
        .update(verifactuIdentities)
        .set({ revocadoEn: now() })
        .where(
          and(
            eq(verifactuIdentities.nodeId, seeded.nodeId),
            isNull(verifactuIdentities.revocadoEn),
          ),
        );
      await tx.insert(verifactuIdentities).values({
        ...allocation,
        id: sifId,
        nodeId: seeded.nodeId,
        nif: seeded.nif,
        idSistemaInformatico: "WT",
        numeroInstalacion: options.installation,
      });
    }
    return sifId;
  };
  // Add captured approval facts to already seeded chains without changing their record IDs.
  return options.sifId === undefined ? inTx(write) : withoutIdentityTriggers(suite.db, write);
}

async function seriesConflict(seeded: SeededDrain, code: string, number: string, at: string) {
  const [series] = await suite.db
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, seeded.nodeId), eq(invoiceSeries.code, code)));
  await suite.db.insert(verifactuSeriesConflicts).values({
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
      identity: { nodeId: seeded.nodeId, nif: seeded.nif },
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

  it("names the identity a handover brought in, holding no invoice, when the next change is not a handover", async () => {
    await stampDeployment(suite.db, "production");
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await activate(seeded, {
      installation: await installationOf(seeded.sifId),
      sifId: seeded.sifId,
      activatedAt: "2026-07-20T00:00:00.000Z",
    });
    await activate(seeded, {
      installation: "B",
      activatedAt: "2026-07-21T00:00:00.000Z",
      handover: true,
    });
    await activate(seeded, { installation: "C", activatedAt: "2026-07-22T00:00:00.000Z" });

    const overview = await read(seeded);

    expect(overview.missingHistory.identityChanges).toEqual([
      {
        installationName: "C",
        earlierInstallationName: "B",
        lastHeldInvoice: null,
        activatedAt: "2026-07-22T00:00:00.000Z",
      },
    ]);
  });

  it("names, for each change, the identity inserted just before it, even one holding no invoice", async () => {
    await stampDeployment(suite.db, "production");
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const first = await installationOf(seeded.sifId);
    await activate(seeded, { installation: "B", activatedAt: "2026-07-21T00:00:00.000Z" });
    await activate(seeded, { installation: "C", activatedAt: "2026-07-22T00:00:00.000Z" });

    const overview = await read(seeded);

    expect(overview.missingHistory.identityChanges).toEqual([
      {
        installationName: "B",
        earlierInstallationName: first,
        lastHeldInvoice: { numSerieFactura: "S1/1", fechaExpedicionFactura: "2026-07-20" },
        activatedAt: "2026-07-21T00:00:00.000Z",
      },
      {
        installationName: "C",
        earlierInstallationName: "B",
        lastHeldInvoice: null,
        activatedAt: "2026-07-22T00:00:00.000Z",
      },
    ]);
  });

  it("lists identity changes in insertion order whatever their activation clocks say", async () => {
    await stampDeployment(suite.db, "production");
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const first = await installationOf(seeded.sifId);
    const b = await activate(seeded, {
      installation: "B",
      activatedAt: "2026-07-23T00:00:00.000Z",
    });
    await appendPendingAlta(suite.db, { ...seeded, sifId: b }, 2);
    await activate(seeded, { installation: "C", activatedAt: "2026-07-21T00:00:00.000Z" });
    await activate(seeded, { installation: "D", activatedAt: "2026-07-25T00:00:00.000Z" });

    const overview = await read(seeded);

    expect(
      overview.missingHistory.identityChanges.map((change) => [
        change.installationName,
        change.earlierInstallationName,
        change.lastHeldInvoice?.numSerieFactura ?? null,
      ]),
    ).toEqual([
      ["B", first, "S1/1"],
      ["C", "B", "S2/1"],
      ["D", "C", null],
    ]);
  });

  it("lists invoices AEAT holds under retired series in the order they were found, whatever their found times say", async () => {
    await stampDeployment(suite.db, "production");
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    await retire(await seriesConflict(seeded, "S1", "S1/7", "2026-07-21T05:00:00.000Z"));
    await retire(await seriesConflict(seeded, "S2", "S2/7", "2026-07-21T04:00:00.000Z"));
    await retire(await seriesConflict(seeded, "S3", "S3/7", "2026-07-21T06:00:00.000Z"));

    const overview = await read(seeded);

    expect(
      overview.missingHistory.notIssuedHere.map((found) => found.invoice.NumSerieFactura),
    ).toEqual(["S1/7", "S2/7", "S3/7"]);
  });

  it("never names another tax number's identity, activation or retired-series invoice", async () => {
    await stampDeployment(suite.db, "production");
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const first = await installationOf(seeded.sifId);
    const otherSifId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await seedIndependentChain(suite.db, { sifId: otherSifId, secuencia: 5 });
    const [other] = await suite.db
      .select({ nodeId: verifactuIdentities.nodeId, nif: verifactuIdentities.nif })
      .from(verifactuIdentities)
      .where(eq(verifactuIdentities.id, otherSifId));
    const otherTaxpayer = {
      ...seeded,
      ...other!,
      nodeId: brandNodeId(other!.nodeId),
      sifId: otherSifId,
    };
    await activate(otherTaxpayer, {
      installation: "O",
      sifId: otherSifId,
      activatedAt: "2026-07-21T00:00:00.000Z",
    });
    await retire(await seriesConflict(otherTaxpayer, "Z", "Z/7", "2026-07-21T05:00:00.000Z"));
    await activate(seeded, { installation: "B", activatedAt: "2026-07-22T00:00:00.000Z" });

    const overview = await read(seeded);

    expect(overview.missingHistory).toEqual({
      notIssuedHere: [],
      identityChanges: [
        {
          installationName: "B",
          earlierInstallationName: first,
          lastHeldInvoice: { numSerieFactura: "S1/1", fechaExpedicionFactura: "2026-07-20" },
          activatedAt: "2026-07-22T00:00:00.000Z",
        },
      ],
    });
  });
});
