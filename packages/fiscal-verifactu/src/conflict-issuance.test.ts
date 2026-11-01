import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { recordSale } from "@waitron/core";
import { invoiceSeries, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { SaleForFiscalRecord } from "@waitron/fiscal";
import { decimal, jobOrigin, saleId as brandSaleId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { openFilingCase, recordCaseEvent } from "./filing-cases.js";
import type { FilingCaseCause } from "./filing-cases.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let backend: VerifactuBackend;
let venue: Awaited<ReturnType<typeof seedTenantWithSif>>;
let original: Awaited<ReturnType<typeof recordSale>>;

beforeEach(async () => {
  venue = await seedTenantWithSif(suite.db);
  backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    deploymentEnvironment: "production",
    resolveClient: staticResolver(fakeClient),
  });
  original = await withTransaction(suite.db, (tx) => recordSale(tx, backend, saleInput(venue)));
});

async function conflict(cause: FilingCaseCause, resolved = false) {
  await withTransaction(suite.db, async (tx) => {
    const opened = await openFilingCase(tx, {
      registroId: original.fiscal.recordId,
      cause,
      evidence: { codigo: 3000, mensaje: "Conflicting invoice identity", csv: null },
      now: steadyClock.now().instant,
    });
    if (resolved)
      await recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: randomUUID(),
        kind: "resolved",
        personId: randomUUID(),
        action: "Recorded an administrator note",
        now: steadyClock.now().instant,
      });
  });
}

async function candidate(): Promise<SaleForFiscalRecord> {
  const [row] = await suite.db.select().from(sales).where(eq(sales.id, original.saleId));
  const [series] = await suite.db
    .select()
    .from(invoiceSeries)
    .where(eq(invoiceSeries.id, venue.seriesId));
  const id = brandSaleId(randomUUID());
  await suite.db.insert(sales).values({ ...row!, id, invoiceNumber: 2 });
  return {
    origin: jobOrigin("readiness_test"),
    nodeId: venue.nodeId,
    saleId: id,
    seriesId: venue.seriesId,
    seriesCode: series!.code,
    invoiceNumber: 2,
    issuedAt: steadyClock.now().instant,
    offsetMinutes: 60,
    descriptionOfOperation: "Restaurant sale",
    total: decimal("14.41"),
    vatBreakdown: [
      { rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") },
      { rate: decimal("10.00"), base: decimal("2.10"), tax: decimal("0.21") },
    ],
    counterparty: null,
  };
}

const builders = ["sale", "void", "correction", "substitution"] as const;
async function build(kind: (typeof builders)[number]) {
  const sale = await candidate();
  return withTransaction(suite.db, (tx) => {
    if (kind === "void") return backend.recordVoid(tx, original.saleId, "Incorrect invoice");
    if (kind === "correction")
      return backend.recordCorrection(
        tx,
        {
          ...sale,
          total: decimal("-14.41"),
          vatBreakdown: [
            { rate: decimal("21.00"), base: decimal("-10.00"), tax: decimal("-2.10") },
            { rate: decimal("10.00"), base: decimal("-2.10"), tax: decimal("-0.21") },
          ],
        },
        { correctsSaleId: original.saleId },
      );
    if (kind === "substitution")
      return backend.recordSubstitution(
        tx,
        {
          ...sale,
          counterparty: { taxId: "89890001K", legalName: "Invoice customer", countryCode: "ES" },
        },
        { substitutedSaleIds: [original.saleId] },
      );
    return backend.recordSale(tx, sale);
  });
}

describe("final fiscal builder conflict check", () => {
  it("does not stop an unrelated node's new sale", async () => {
    await conflict("fiscal.huella_divergente");
    const other = await seedTenantWithSif(suite.db);
    await expect(
      withTransaction(suite.db, (tx) => recordSale(tx, backend, saleInput(other))),
    ).resolves.toMatchObject({ fiscal: { backend: "verifactu", state: "pending" } });
  });

  it("does not stop the current identity for a retired identity's conflict", async () => {
    await conflict("fiscal.duplicado_anulado");
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`update registro_sif set revocado_en = ${steadyClock.now().instant.toISOString()} where node_id = ${venue.nodeId}`,
      );
      await tx.execute(sql`insert into registro_sif (id, node_id, nif, id_sistema_informatico, numero_instalacion, registrado_en)
        select ${randomUUID()}, node_id, nif, id_sistema_informatico, '2', registrado_en from registro_sif where node_id = ${venue.nodeId}`);
    });
    await expect(
      withTransaction(suite.db, (tx) => recordSale(tx, backend, saleInput(venue))),
    ).resolves.toMatchObject({ fiscal: { backend: "verifactu", state: "pending" } });
    expect((await suite.db.execute(sql`select id from filing_cases`)).rows).toHaveLength(1);
  });

  for (const kind of builders) {
    it.each(["fiscal.huella_divergente", "fiscal.duplicado_anulado"] as const)(
      `${kind} refuses the first active %s without appending a record`,
      async (cause) => {
        await conflict(cause, true);
        const before = await suite.db.execute(sql`select * from registros_facturacion`);
        const head = await suite.db.execute(sql`select * from cadenas`);
        await expect(build(kind)).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "conflict_requires_administrator" },
        });
        expect(await suite.db.execute(sql`select * from registros_facturacion`)).toEqual(before);
        expect(await suite.db.execute(sql`select * from cadenas`)).toEqual(head);
      },
    );
    it(`${kind} still builds beside an unrelated filing refusal`, async () => {
      await conflict("fiscal.registro_rechazado");
      await expect(build(kind)).resolves.toMatchObject({ backend: "verifactu", state: "pending" });
      expect((await suite.db.execute(sql`select id from registros_facturacion`)).rows).toHaveLength(
        2,
      );
    });
  }
});
