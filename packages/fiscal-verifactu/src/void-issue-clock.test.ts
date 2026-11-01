import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deployment,
  invoiceSeries,
  locations,
  nodes,
  sales,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { recordSale } from "@waitron/core";
import { prepareIssueClock, type TrustedClock } from "@waitron/fiscal";
import { decimal, locationId, nodeId, seriesId, saleId, type SaleId } from "@waitron/shared";
import * as fiscal from "./index.js";
import { withOperationAuthority } from "@waitron/module";
import { createEmergencyAllocationPreparation } from "./emergency-preparation.js";
import { decodeRegistroRow } from "./registro-row.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif, type SeededNodeWithSif } from "../test/fixtures.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const AT = "2026-10-14T23:30:00.000Z";
let seededNode: SeededNodeWithSif;
const scratch: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true });
});
const source: TrustedClock = {
  ...steadyClock,
  now: () => ({ ...steadyClock.now(), instant: new Date(AT), offsetMinutes: 0 }),
};
const backend = (clock = source) =>
  fiscal.FISCAL_SLOT.makeBackend({ db: suite.db, clock, environment: "preproduction" });
beforeEach(async () => {
  seededNode = await seedTenantWithSif(suite.db);
  await suite.db
    .update(locations)
    .set({ timeZone: "Europe/Madrid" })
    .where(eq(locations.id, seededNode.locationId));
});
async function prepare(tx: Transaction, id: SaleId, clock = source) {
  return fiscal.prepareFiscalVoidClock(tx, id, clock);
}
const original = () =>
  withTransaction(suite.db, (tx) =>
    recordSale(
      tx,
      backend(),
      saleInput({ ...seededNode, clock: source, settlement: { kind: "deferred" } }),
    ),
  );
const annul = (id: SaleId) =>
  withTransaction(suite.db, async (tx) =>
    backend(await prepare(tx, id)).recordVoid(tx, id, "Operator error"),
  );
function snapshot() {
  return Object.fromEntries(
    ["sales", "invoice_series", "registros_facturacion", "cadenas", "envios"].map((name) => [
      name,
      suite.db.all(sql`select * from ${sql.identifier(name)} order by rowid`),
    ]),
  );
}
function records(id: string) {
  return suite.db
    .all<fiscal.RegistroRow>(
      sql`select * from registros_facturacion where sale_id = ${id} order by secuencia`,
    )
    .map((r) => fiscal.fromRegistroRow(decodeRegistroRow(r)));
}

describe("the void caller's original writing location", () => {
  it("keeps the offset-zero original day and prepares the new annulment from Madrid", async () => {
    const old = await original();
    const before = records(old.saleId)[0];
    const numbers = await suite.db.select().from(invoiceSeries);
    expect(await annul(old.saleId)).toMatchObject({ issuedAt: new Date(AT), offsetMinutes: 120 });
    expect(records(old.saleId)).toHaveLength(2);
    expect(records(old.saleId)[0]).toEqual(before);
    expect(records(old.saleId)[1]).toMatchObject({
      IDFactura: { FechaExpedicionFacturaAnulada: "14-10-2026" },
      FechaHoraHusoGenRegistro: "2026-10-15T01:30:00+02:00",
      Encadenamiento: { RegistroAnterior: { Huella: before!.Huella } },
    });
    expect(await suite.db.select().from(invoiceSeries)).toEqual(numbers);
  });
  it.each(["", "  ", "Invalid/Zone", "+02:00"])(
    "refuses unusable original zone %j without appending or allocating",
    async (timeZone) => {
      const old = await original();
      await suite.db
        .update(locations)
        .set({ timeZone })
        .where(eq(locations.id, seededNode.locationId));
      const before = snapshot();
      await expect(annul(old.saleId)).rejects.toMatchObject({
        code: "venue.time_zone_invalid",
        params: { reason: timeZone.trim() === "" ? "missing" : "invalid" },
      });
      expect(snapshot()).toEqual(before);
    },
  );
  it("refuses an unfiled sale before reading its clock", async () => {
    const before = snapshot();
    const clock = {
      ...source,
      now: () => {
        throw new Error("must not read source");
      },
    };
    await expect(
      withTransaction(suite.db, (tx) => prepare(tx, saleId(randomUUID()), clock)),
    ).rejects.toMatchObject({ code: "fiscal.sale_not_recorded" });
    expect(snapshot()).toEqual(before);
  });
  it("refuses disagreement between the saved sale node and the original alta", async () => {
    const other = await seedTenantWithSif(suite.db);
    const old = await withTransaction(suite.db, async (tx) => {
      const [row] = await tx
        .insert(sales)
        .values({
          nodeId: other.nodeId,
          seriesId: other.seriesId,
          id: randomUUID(),
          source: "readiness_test",
          invoiceNumber: 1,
          issuedAt: AT,
          issuedOffsetMinutes: 0,
          total: 1441,
          vatBreakdown: [],
          locale: "en-GB",
          invoiceLocales: ["en-GB"],
          fiscalBackend: "verifactu",
          fiscalState: "recorded",
        })
        .returning();
      await backend().recordSale(tx, {
        origin: saleInput(seededNode).origin,
        saleId: saleId(row!.id),
        nodeId: seededNode.nodeId,
        seriesId: seededNode.seriesId,
        seriesCode: "A",
        invoiceNumber: 1,
        issuedAt: new Date(AT),
        offsetMinutes: 0,
        descriptionOfOperation: "Restaurant service",
        total: decimal("14.41"),
        vatBreakdown: [
          { rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") },
          { rate: decimal("10.00"), base: decimal("2.10"), tax: decimal("0.21") },
        ],
        counterparty: null,
      });
      return saleId(row!.id);
    });
    const before = snapshot();
    await expect(annul(old)).rejects.toMatchObject({
      code: "venue.time_zone_target_invalid",
      params: { reason: "mismatch" },
    });
    expect(snapshot()).toEqual(before);
  });
});

it("an active emergency identity uses the caller's issue instant rather than allocation time", async () => {
  const [freshNode] = await suite.db
    .insert(nodes)
    .values({ locationId: seededNode.locationId, name: "Emergency node" })
    .returning();
  const node = { nodeId: nodeId(freshNode!.id), locationId: locationId(seededNode.locationId) };
  await suite.db.insert(invoiceSeries).values({ nodeId: node.nodeId, code: "A" });
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  const binding = {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: "clock-emergency",
    sourceId: "archive-clock",
    targetNodeId: node.nodeId,
  };
  const operatorId = {
    kind: "recovery-key" as const,
    nodeId: node.nodeId,
    eventId: binding.eventId,
  };
  const bases = [{ code: "A", purpose: "standard" }];
  const approval = {
    version: 1,
    eventId: binding.eventId,
    operatorId,
    sourceId: binding.sourceId,
    targetNodeId: node.nodeId,
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    confirmedAt: "2026-10-13T10:00:00.000Z",
    incidentEvidence: "fixture/emergency-clock",
  };
  const directory = await mkdtemp(join(tmpdir(), "zone-emergency-"));
  scratch.push(directory);
  const confirmationPath = join(directory, "confirmation.json");
  const current = await withTransaction(suite.db, (tx) => fiscal.currentSif(tx, seededNode.nodeId));
  await writeFile(
    confirmationPath,
    JSON.stringify({
      version: 1,
      priorActivation: "none",
      binding,
      operatorId,
      taxpayerNif: current.nif,
      environment: "preproduction",
      requiredBases: bases,
      incidentEvidence: approval.incidentEvidence,
      knownIdentities: null,
      uncertaintyRecorded: true,
    }),
  );
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T10:00:00.000Z") });
  const activation = await withOperationAuthority(binding, operatorId, (authority) =>
    createEmergencyAllocationPreparation({
      confirmationPath,
      incidentDirectory: directory,
    }).prepare(
      { binding, authority, input: { emergency: { version: 1 }, approval } },
      (operation) =>
        withTransaction(suite.db, (tx) =>
          fiscal.activatePreparedModuleAllocation(tx, node, operation),
        ),
    ),
  );
  vi.useRealTimers();
  const allocations = await suite.db.select().from(fiscal.fiscalAllocations);
  expect(allocations).toHaveLength(1);
  expect(allocations[0]).toMatchObject({
    allocation: { source: "emergency", issuedAt: "2026-10-13T10:00:00.000Z" },
    activatedAt: new Date("2026-10-13T10:00:00.000Z"),
  });
  const active = await withTransaction(suite.db, (tx) => fiscal.currentSif(tx, node.nodeId));
  expect(active.numeroInstalacion).toMatch(/^E[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  const issued = await withTransaction(suite.db, async (tx) => {
    const clock = await prepareIssueClock(tx, node, source);
    return recordSale(
      tx,
      backend(clock),
      saleInput({
        ...seededNode,
        nodeId: node.nodeId,
        seriesId: seriesId(activation.series[0]!.id),
        clock,
        settlement: { kind: "deferred" },
      }),
    );
  });
  expect(records(issued.saleId)[0]).toMatchObject({
    IDFactura: {
      FechaExpedicionFactura: "15-10-2026",
      NumSerieFactura: `${activation.series[0]!.code}/1`,
    },
    FechaHoraHusoGenRegistro: "2026-10-15T01:30:00+02:00",
    SistemaInformatico: { NumeroInstalacion: active.numeroInstalacion },
  });
  expect(await suite.db.select().from(fiscal.fiscalAllocations)).toEqual(allocations);
});
