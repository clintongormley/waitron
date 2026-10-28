import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { captureError, sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { Counterparty, SaleForFiscalRecord } from "@waitron/fiscal";
import { cadenas, envios, registrosFacturacion, VerifactuBackend } from "@waitron/fiscal-verifactu";
import {
  decodeRegistroRow,
  fromRegistroRow,
  type RegistroRow,
} from "@waitron/fiscal-verifactu/src/registro-row.js";
import { seedTenantWithSif } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { steadyClock } from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError, decimal, jobOrigin, saleId } from "@waitron/shared";
import { validate, type Destinatario, type RegistroAlta } from "@waitron/verifactu";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const issuedAt = new Date("2026-03-01T12:05:00.000Z");
let seeded: Awaited<ReturnType<typeof seedTenantWithSif>>;
let backend: VerifactuBackend;

beforeEach(async () => {
  seeded = await seedTenantWithSif(suite.db);
  backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    deploymentEnvironment: "production",
    resolveClient: () => {
      throw new Error("Recipient recording must not contact AEAT");
    },
  });
});

async function sale(counterparty: Counterparty | null, invoiceNumber: number) {
  const id = saleId(randomUUID());
  await suite.db.insert(sales).values({
    id,
    ...jobOrigin("readiness_test"),
    nodeId: seeded.nodeId,
    seriesId: seeded.seriesId,
    invoiceNumber,
    issuedAt: issuedAt.toISOString(),
    issuedOffsetMinutes: 60,
    total: 0,
    vatBreakdown: [],
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded",
  });
  return {
    origin: jobOrigin("readiness_test"),
    nodeId: seeded.nodeId,
    saleId: id,
    seriesId: seeded.seriesId,
    seriesCode: "A",
    invoiceNumber,
    issuedAt,
    offsetMinutes: 60,
    descriptionOfOperation: "Restaurant meal",
    total: decimal("12.10"),
    vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
    counterparty,
  } satisfies SaleForFiscalRecord;
}

async function record(input: SaleForFiscalRecord, kind: "F1" | "F3") {
  if (kind === "F1") {
    return withTransaction(suite.db, (tx) => backend.recordSale(tx, input));
  }
  const original = await sale(null, 1);
  await withTransaction(suite.db, (tx) => backend.recordSale(tx, original));
  return withTransaction(suite.db, (tx) =>
    backend.recordSubstitution(tx, input, { substitutedSaleIds: [original.saleId] }),
  );
}

const accepted: { title: string; recipient: Counterparty; expected: Destinatario }[] = [
  {
    title: "Spanish NIF with a French postal country",
    recipient: { taxId: " b12345674 ", legalName: "Customer Ltd", countryCode: "FR" },
    expected: { NombreRazon: "Customer Ltd", NIF: "B12345674" },
  },
  {
    title: "explicit Spanish tax identity with a French postal country",
    recipient: {
      taxId: " b12345674 ",
      legalName: "Customer Ltd",
      countryCode: "FR",
      identifierType: "tax-number",
      identifierCountryCode: " es ",
    },
    expected: { NombreRazon: "Customer Ltd", NIF: "B12345674" },
  },
  {
    title: "passport with a lowercase issuer and mixed-case document text",
    recipient: {
      taxId: " Ab-09 ",
      legalName: "Customer Ltd",
      countryCode: "ES",
      identifierType: "passport",
      identifierCountryCode: " fr ",
    },
    expected: {
      NombreRazon: "Customer Ltd",
      IDOtro: { CodigoPais: "FR", IDType: "03", ID: " Ab-09 " },
    },
  },
  ...(
    [
      ["vat-number", "02", "FR", "FR40303265045"],
      ["passport", "03", "FR", " Ab-09 "],
      ["residence-country-id", "04", "FR", "Id-009"],
      ["residence-certificate", "05", "FR", "Cert-009"],
      ["other-document", "06", "FR", "Doc-009"],
      ["passport", "03", "ES", "AAB123456"],
    ] as const
  ).map(([identifierType, IDType, identifierCountryCode, taxId]) => ({
    title: `${identifierCountryCode} ${identifierType} with a Spanish postal country`,
    recipient: {
      taxId,
      legalName: "Customer Ltd",
      countryCode: "ES",
      identifierType,
      identifierCountryCode,
    },
    expected: {
      NombreRazon: "Customer Ltd",
      IDOtro: { CodigoPais: identifierCountryCode, IDType, ID: taxId },
    },
  })),
];

describe.each(["F1", "F3"] as const)("%s accepted recipient identity", (kind) => {
  it.each(accepted)("files $title without deriving identity from postal country", async (test) => {
    const input = await sale(test.recipient, 2);
    const ref = await record(input, kind);
    const [stored] = await suite.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.id, ref.recordId));
    expect(stored?.tipoFactura).toBe(kind);
    expect(stored?.destinatarios).toEqual({ IDDestinatario: [test.expected] });
    const rows = suite.db.all<RegistroRow>(
      // Read the persisted record rather than validating an independently rebuilt input.
      sql`select * from registros_facturacion where id = ${ref.recordId}`,
    );
    const registro = fromRegistroRow(decodeRegistroRow(rows[0]!)) as RegistroAlta;
    expect(validate(registro, { now: issuedAt })).toEqual([]);
    expect(
      await withTransaction(suite.db, (tx) => backend.checkIntegrity(tx, seeded.nodeId)),
    ).toEqual({ ok: true, checked: kind === "F1" ? 1 : 2, issues: [] });
  });
});

const passport = {
  taxId: "Ab-09",
  legalName: "Customer Ltd",
  countryCode: "ES",
  identifierType: "passport",
  identifierCountryCode: "FR",
};
const invalid: { title: string; recipient: unknown; field: string }[] = [
  { title: "missing document value", recipient: { ...passport, taxId: " " }, field: "taxId" },
  { title: "null document value", recipient: { ...passport, taxId: null }, field: "taxId" },
  {
    title: "unknown type",
    recipient: { ...passport, identifierType: "07" },
    field: "identifierType",
  },
  {
    title: "missing type",
    recipient: {
      taxId: "Ab-09",
      countryCode: "ES",
      legalName: "Customer Ltd",
      identifierCountryCode: "FR",
    },
    field: "identifierType",
  },
  {
    title: "missing issuer",
    recipient: {
      taxId: "Ab-09",
      countryCode: "ES",
      legalName: "Customer Ltd",
      identifierType: "passport",
    },
    field: "identifierCountryCode",
  },
  {
    title: "unknown issuer",
    recipient: { ...passport, identifierCountryCode: "ZZ" },
    field: "identifierCountryCode",
  },
  {
    title: "array issuer",
    recipient: { ...passport, identifierCountryCode: ["FR"] },
    field: "identifierCountryCode",
  },
  {
    title: "oversized document",
    recipient: { ...passport, taxId: "A".repeat(21) },
    field: "taxId",
  },
  {
    title: "invalid XML character",
    recipient: { ...passport, taxId: "Ab\u0000-09" },
    field: "taxId",
  },
  {
    title: "Spanish non-passport foreign document",
    recipient: { ...passport, identifierCountryCode: "ES", identifierType: "other-document" },
    field: "identifierType",
  },
  {
    title: "foreign tax-number type",
    recipient: { ...passport, identifierType: "tax-number" },
    field: "identifierType",
  },
  {
    title: "invalid Spanish NIF",
    recipient: { taxId: "B12345678", legalName: "Customer Ltd", countryCode: "ES" },
    field: "taxId",
  },
];

describe.each(["F1", "F3"] as const)("%s refused recipient identity", (kind) => {
  it.each(invalid)("refuses $title without appending a record", async ({ recipient, field }) => {
    const original = await sale(null, 1);
    await withTransaction(suite.db, (tx) => backend.recordSale(tx, original));
    const input = await sale(recipient as Counterparty, 2);
    const before = {
      records: await suite.db.select().from(registrosFacturacion),
      head: await suite.db.select().from(cadenas),
      outbox: await suite.db.select().from(envios),
    };
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        kind === "F1"
          ? backend.recordSale(tx, input)
          : backend.recordSubstitution(tx, input, { substitutedSaleIds: [original.saleId] }),
      ),
    );
    expect(error).toBeInstanceOf(AppError);
    if (!(error instanceof AppError)) throw error;
    expect(error.code).toBe("fiscal.record_invalid");
    expect(error.params).toEqual({ fields: [field], codes: ["RECIPIENT_IDENTIFIER_INVALID"] });
    expect(await suite.db.select().from(registrosFacturacion)).toEqual(before.records);
    expect(await suite.db.select().from(cadenas)).toEqual(before.head);
    expect(await suite.db.select().from(envios)).toEqual(before.outbox);
  });
});
