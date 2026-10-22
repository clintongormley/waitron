import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { incidents, invoiceSeries, tenants, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  recordCorrection,
  recordSale,
  recordSubstitution,
  recordVoid,
  withIssuanceTransaction,
} from "@waitron/core";
import { hashPin, loginWithPin, persons } from "@waitron/identity";
import { deviceOrigin, seriesId as brandSeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { saleInput, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";

const fault = vi.hoisted(() => ({
  mode: "none" as "none" | "wrong" | "mixed" | "format" | "invalid",
  issues: [] as Array<{ code: string; field: string }>,
}));

vi.mock("@waitron/verifactu", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/verifactu")>();
  function alter<
    T extends
      ReturnType<typeof real.buildAltaRecord> | ReturnType<typeof real.buildAnulacionRecord>,
  >(record: T): T {
    if (fault.mode === "mixed" && "ImporteTotal" in record) record.ImporteTotal = "99.99";
    if (fault.mode === "invalid") record.IDVersion = "invalid" as typeof record.IDVersion;
    if (fault.mode === "format") record.Huella = "bad";
    if (fault.mode === "wrong" || fault.mode === "mixed") {
      record.Huella = (record.Huella[0] === "A" ? "B" : "A") + record.Huella.slice(1);
    }
    fault.issues = real.validate(record, { now: new Date("2026-03-01T12:05:00Z") });
    return record;
  }
  return {
    ...real,
    buildAltaRecord: (...args: Parameters<typeof real.buildAltaRecord>) =>
      alter(real.buildAltaRecord(...args)),
    buildAnulacionRecord: (...args: Parameters<typeof real.buildAnulacionRecord>) =>
      alter(real.buildAnulacionRecord(...args)),
  };
});

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let till: Awaited<ReturnType<typeof seedTenantWithSif>>;
let backend: VerifactuBackend;
let fullSeries: ReturnType<typeof brandSeriesId>;
let correctionSeries: ReturnType<typeof brandSeriesId>;
let sessionId: string;
const resolveClient = vi.fn(() => {
  throw new Error("issuance must not resolve transport");
});
const recipient = { taxId: "B12345674", legalName: "Business Customer Ltd", countryCode: "ES" };

beforeEach(async () => {
  fault.mode = "none";
  fault.issues = [];
  resolveClient.mockClear();
  till = await seedTenantWithSif(suite.db);
  await suite.db.update(tenants).set({ taxpayerDomicile: "1 Market Street" });
  const [full, correction] = await suite.db
    .insert(invoiceSeries)
    .values([
      { nodeId: till.nodeId, code: "F", purpose: "full" },
      { nodeId: till.nodeId, code: "R", purpose: "rectificative" },
    ])
    .returning();
  fullSeries = brandSeriesId(full!.id);
  correctionSeries = brandSeriesId(correction!.id);
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Manager", role: "admin", pinHash: hashPin("1234") })
    .returning();
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { personId: person!.id, deviceId: till.deviceId, pin: "1234" }),
  );
  sessionId = session.id;
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient,
  });
});

afterEach(() => {
  fault.mode = "none";
});

function input() {
  return saleInput({
    nodeId: till.nodeId,
    seriesId: till.seriesId,
    origin: deviceOrigin(till.deviceId),
  });
}

function snapshot() {
  const result: Record<string, unknown> = {};
  for (const name of [
    "invoice_series",
    "sales",
    "sale_lines",
    "tenders",
    "sale_settlements",
    "sale_voids",
    "sale_substitutions",
    "cadenas",
    "registros_facturacion",
    "envios",
  ]) {
    if (!/^[a-z_]+$/.test(name)) throw new Error("invalid snapshot identifier");
    result[name] = suite.db.all(sql.raw(`select * from "${name}" order by rowid`));
  }
  return result;
}

async function operation(kind: "F2" | "F1" | "R5" | "F3" | "cancellation") {
  const original = ["R5", "F3", "cancellation"].includes(kind)
    ? await withIssuanceTransaction(suite.db, (tx) => recordSale(tx, backend, input()))
    : undefined;
  return (tx: Transaction) => {
    const value = input();
    if (kind === "cancellation")
      return recordVoid(tx, backend, original!.saleId, "Staff error", { sessionId });
    if (kind === "R5")
      return recordCorrection(tx, backend, {
        origin: value.origin,
        nodeId: till.nodeId,
        seriesId: correctionSeries,
        correctsSaleId: original!.saleId,
        total: "-14.41",
        lines: value.lines.map((line) => ({
          ...line,
          quantity: `-${line.quantity}`,
          lineTotal: `-${line.lineTotal}`,
        })),
        authz: { sessionId },
        clock: steadyClock,
      });
    if (kind === "F3")
      return recordSubstitution(tx, backend, {
        origin: value.origin,
        nodeId: till.nodeId,
        seriesId: fullSeries,
        substitutedSaleIds: [original!.saleId],
        counterparty: recipient,
        total: value.total,
        lines: value.lines,
        locale: value.locale,
        invoiceLocales: value.invoiceLocales,
        clock: steadyClock,
      });
    return recordSale(
      tx,
      backend,
      kind === "F1"
        ? {
            ...value,
            seriesId: fullSeries,
            counterparty: recipient,
            recipientAddress: "2 Customer Road",
          }
        : value,
    );
  };
}

describe("new-record fingerprint refusal", () => {
  it.each(["F2", "F1", "R5", "F3", "cancellation"] as const)(
    "refuses a well-formed wrong fingerprint for %s, then retries the unused number",
    async (kind) => {
      const issue = await operation(kind);
      const before = snapshot();
      fault.mode = "wrong";
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(withIssuanceTransaction(suite.db, issue)).rejects.toMatchObject({
          code: "fiscal.fingerprint_mismatch",
          params: {},
        });
        expect(fault.issues.map((issue) => issue.code)).toContain("HUELLA_MISMATCH");
        expect(fault.issues.map((issue) => issue.code)).not.toContain("HUELLA_FORMAT");
        expect(snapshot()).toEqual(before);
      }
      const alerts = await suite.db.select().from(incidents);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        code: "fiscal.fingerprint_mismatch",
        params: {},
        saleId: null,
        deviceId: till.deviceId,
        severity: "error",
        detectedAt: "2026-03-01T12:05:00.000Z",
      });
      fault.mode = "none";
      await withIssuanceTransaction(suite.db, issue);
      const after = snapshot();
      const previousRecords = before.registros_facturacion as unknown[];
      expect(after.registros_facturacion).toHaveLength(previousRecords.length + 1);
      expect(after.envios).toHaveLength(previousRecords.length + 1);
      const counters = await suite.db.select().from(invoiceSeries);
      expect(counters.map((row) => row.nextNumber)).toEqual(
        kind === "cancellation"
          ? [2, 1, 1]
          : kind === "R5"
            ? [2, 1, 2]
            : kind === "F3"
              ? [2, 2, 1]
              : kind === "F1"
                ? [1, 2, 1]
                : [2, 1, 1],
      );
      expect(await suite.db.select().from(incidents)).toEqual(alerts);
      expect(resolveClient).not.toHaveBeenCalled();
    },
  );

  it("ordinary caller transactions refuse and roll back without a durable incident", async () => {
    const issue = await operation("F2");
    const before = snapshot();
    fault.mode = "wrong";
    await expect(withTransaction(suite.db, issue)).rejects.toMatchObject({
      code: "fiscal.fingerprint_mismatch",
    });
    expect(snapshot()).toEqual(before);
    expect(await suite.db.select().from(incidents)).toEqual([]);
  });

  it("reports a bad stored predecessor and continues without changing its bytes", async () => {
    await withIssuanceTransaction(suite.db, (tx) => recordSale(tx, backend, input()));
    const triggers = suite.db.all<{ name: string; sql: string }>(sql`
      select name, sql from sqlite_master where type = 'trigger' and tbl_name = 'registros_facturacion'
    `);
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) {
      suite.db.run(sql.raw(`drop trigger "${trigger.name.replaceAll('"', '""')}"`));
    }
    try {
      suite.db.run(sql`update registros_facturacion set huella = ${"F".repeat(64)}`);
    } finally {
      for (const trigger of triggers) suite.db.run(sql.raw(trigger.sql));
    }
    const [before] = suite.db.all(sql`select * from registros_facturacion`);
    await withIssuanceTransaction(suite.db, (tx) => recordSale(tx, backend, input()));
    const rows = suite.db.all(sql`select * from registros_facturacion order by secuencia`);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(before);
    expect(rows[1]).toMatchObject({ anterior_huella: "F".repeat(64), secuencia: 2 });
    expect((await suite.db.select().from(incidents)).map((row) => row.code)).toEqual([
      "chain.verification_failed",
    ]);
    expect(resolveClient).not.toHaveBeenCalled();
  });

  it.each(["format", "invalid"] as const)(
    "keeps the existing record-invalid refusal for %s",
    async (mode) => {
      const issue = await operation("F2");
      const before = snapshot();
      fault.mode = mode;
      await expect(withIssuanceTransaction(suite.db, issue)).rejects.toMatchObject({
        code: "fiscal.record_invalid",
      });
      expect(snapshot()).toEqual(before);
      expect(await suite.db.select().from(incidents)).toEqual([]);
    },
  );

  it("gives mismatch priority over a totals warning", async () => {
    const issue = await operation("F2");
    const before = snapshot();
    fault.mode = "mixed";
    await expect(withIssuanceTransaction(suite.db, issue)).rejects.toMatchObject({
      code: "fiscal.fingerprint_mismatch",
      params: {},
    });
    expect(fault.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["HUELLA_MISMATCH", "IMPORTE_TOTAL_MISMATCH"]),
    );
    expect(snapshot()).toEqual(before);
    expect((await suite.db.select().from(incidents)).map((row) => row.code)).toEqual([
      "fiscal.fingerprint_mismatch",
    ]);
  });
});
