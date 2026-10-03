import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordSale } from "@waitron/core";
import { sales, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, saleId as brandSaleId, deviceOrigin } from "@waitron/shared";
import type { DeviceId, NodeId, SeriesId, TillId } from "@waitron/shared";
import { appendToChain } from "./chain.js";
import { VerifactuBackend } from "./backend.js";
import { registrosFacturacion } from "./schema/registros.js";
import { anulacionFor } from "./testing/seed.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

// What this file asserts is decided in application code, before or instead of the insert — a
// refusal, or a warning incident raised beside a record that is written anyway. Nothing here
// depends on two writers racing.
let backend: VerifactuBackend;
let tillId: TillId;
let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

beforeEach(async () => {
  ({ tillId, deviceId, nodeId, seriesId } = await seedTenantWithSif(suite.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

/** Point the seeded series at a code AEAT's character set forbids. A space is the shape an
 * operator actually types ("Serie A"). */
async function useSeriesCode(code: string): Promise<void> {
  await suite.db.execute(sql`update invoice_series set code = ${code} where id = ${seriesId}`);
}

function sell() {
  return withTransaction(suite.db, async (tx) => {
    return recordSale(tx, backend, saleInput({ tillId, nodeId, seriesId }));
  });
}

describe("a record AEAT could not accept never enters the chain", () => {
  it("refuses a sale whose invoice number uses a forbidden character", async () => {
    await useSeriesCode("Serie A");
    await expect(sell()).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: { fields: ["NumSerieFactura"], codes: ["NUMSERIE_CHARSET"] },
    });
  });

  it("writes nothing at all when it refuses", async () => {
    await useSeriesCode("Serie A");
    await expect(sell()).rejects.toMatchObject({ code: "fiscal.record_invalid" });

    const registros = await suite.db.select().from(registrosFacturacion);
    expect(registros).toEqual([]);

    // The sale itself must be gone too — `recordSale` writes the sale and the fiscal record in ONE
    // transaction, so a refusal that left a sale behind would be a sale with no fiscal record.
    const soldRows = await suite.db.select().from(sales);
    expect(soldRows).toEqual([]);

    // And the chain head must not have advanced: a refused record leaves the node exactly where it
    // was, so the next legitimate sale is still the chain's first record.
    const heads = await suite.db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where node_id = ${nodeId}`,
    );
    expect(heads.rows[0]?.secuencia ?? 0).toBe(0);
  });

  it("accepts the same sale once the series code is legal", async () => {
    await useSeriesCode("FS");
    const { saleId } = await sell();
    expect(saleId).toBeDefined();

    const [registro] = await suite.db.select().from(registrosFacturacion);
    expect(registro?.numSerieFactura).toBe("FS/1");
  });

  // The anulación arm reaches `validate` through the SAME `const record =` line as every alta, but
  // "the same line" is an argument, not evidence, so it gets its own case. It cannot be provoked
  // through `recordVoid`: that rebuilds its identity from the original alta's stored columns
  // (backend.ts), which this guard already checked. So the record is appended directly.
  it("refuses an anulación whose voided invoice number is illegal", async () => {
    const bad = anulacionFor(
      { tillId, deviceId },
      brandSaleId("00000000-0000-4000-8000-000000000001"),
      1,
      1,
    );
    const registro = {
      ...bad,
      input: { ...bad.input, NumSerieFacturaAnulada: "Serie A/1" },
    };

    await expect(
      withTransaction(suite.db, (tx) => appendToChain(tx, nodeId, registro)),
    ).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: { fields: ["NumSerieFacturaAnulada"] },
    });
  });
});

describe("a record whose totals disagree with themselves is written, filed and flagged", () => {
  /** A sale whose stated total is far from its own VAT lines, breaching the 10.00 tolerance
   * without breaking any FORMAT rule — the only way to reach a warning without also reaching an
   * error, which the guard would refuse.
   *
   * `settlement: "deferred"` matters and is not incidental: `saleInput`'s default is an IMMEDIATE
   * settlement whose tender matches its original total, and `settleSale` throws
   * `sale.tender_shortfall` when the tendered sum disagrees with the due amount — so an immediate
   * fixture would abort in settlement, before the fiscal record is ever built, and this suite
   * would be testing nothing. A deferred sale still writes the sale and the fiscal record.
   *
   * It also depends on `saleInput` supplying NO `vatBreakdown`: `recordSale` cross-checks a
   * SUPPLIED breakdown against the stated total and throws `sale.total_mismatch`
   * (`packages/core/src/record-sale.ts`) before the fiscal record is built, so a fixture that
   * passed one would abort there and this suite would again be testing nothing. The breakdown this
   * case needs is the DERIVED one, which cannot disagree with itself. It also depends on
   * `saleInput`'s lines being at the cent (10.00 and 2.10, `test/write-path-fixtures.ts`): with a
   * line total past the cent the derived breakdown is checked against the total too, and refused
   * the same way (`deriveVatBreakdown`). */
  function mismatchedSale() {
    return {
      ...saleInput({ tillId, nodeId, seriesId }),
      total: decimal("9999.00"),
      settlement: { kind: "deferred" } as const,
    };
  }

  it("records the sale rather than refusing it", async () => {
    await useSeriesCode("FS");
    const { saleId } = await withTransaction(suite.db, async (tx) => {
      return recordSale(tx, backend, mismatchedSale());
    });
    expect(saleId).toBeDefined();

    const registros = await suite.db.select().from(registrosFacturacion);
    expect(registros).toHaveLength(1);
  });

  it("raises a warning incident against that sale", async () => {
    await useSeriesCode("FS");
    const { saleId } = await withTransaction(suite.db, async (tx) => {
      return recordSale(tx, backend, mismatchedSale());
    });

    const rows = await suite.db.execute<{ code: string; severity: string; sale_id: string }>(
      sql`select code, severity, sale_id from incidents`,
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({
        code: "fiscal.record_totals_disagree",
        severity: "warning",
        sale_id: saleId,
      }),
    ]);
  });

  it("leaves a well-formed sale with no incident at all", async () => {
    await useSeriesCode("FS");
    await sell();

    const rows = await suite.db.execute(sql`select 1 from incidents`);
    expect(rows.rows).toEqual([]);
  });
});

describe("a record's dates are checked against the time it was generated, not this machine's clock", () => {
  // `saleInput` issues at 2026-03-01T13:05:00+01:00 from the trusted clock (`steadyClock`). Only
  // `Date` is faked, so the wall clock is the one thing that moves.
  const GENERATED = new Date("2026-03-01T13:05:00+01:00");

  afterEach(() => {
    vi.useRealTimers();
  });

  async function sellWithWallClockAt(wallClock: Date) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(wallClock);
    await useSeriesCode("FS");
    return sell();
  }

  it("records a sale while the wall clock is days behind it, with no incident", async () => {
    const { saleId } = await sellWithWallClockAt(new Date(GENERATED.getTime() - 3 * 86_400_000));
    expect(saleId).toBeDefined();
    expect((await suite.db.execute(sql`select code from incidents`)).rows).toEqual([]);
  });

  it("raises no incident while the wall clock is two hours behind on the same day", async () => {
    await sellWithWallClockAt(new Date(GENERATED.getTime() - 2 * 3_600_000));
    expect((await suite.db.execute(sql`select code from incidents`)).rows).toEqual([]);
  });

  it("records a sale while the wall clock is years ahead of it, with no incident", async () => {
    const { saleId } = await sellWithWallClockAt(new Date("2029-06-01T12:00:00Z"));
    expect(saleId).toBeDefined();
    expect((await suite.db.execute(sql`select code from incidents`)).rows).toEqual([]);
  });
});

describe("a recipient's name is checked as closely as the issuer's", () => {
  /** A business customer's name is typed or pasted at the till, and `registros_facturacion` is
   * append-only, so a control character stored there could never be taken out again.
   *
   * `packages/core`'s `recordSale` hardcodes `counterparty: null`, so the F1 branch is reached by
   * calling the backend directly — the same bypass `backend.test.ts`'s own F1 cases use. The sale
   * row is inserted on the SAME `withTransaction` transaction, which is what makes the "nothing was
   * written" assertions below meaningful: a refusal rolls back both or neither. */
  let sequence = 0;

  function sellToNamedRecipient(legalName: string) {
    sequence += 1;
    const saleId = `77777777-7777-4777-8777-7777777770${String(sequence).padStart(2, "0")}`;
    const invoiceNumber = 900 + sequence;
    return withTransaction(suite.db, async (tx) => {
      await tx.insert(sales).values({
        id: saleId,
        tillId,
        source: "device",
        deviceId,
        nodeId,
        seriesId,
        invoiceNumber,
        issuedAt: "2026-03-01T12:05:00.000Z",
        issuedOffsetMinutes: 60,
        total: 0,
        vatBreakdown: [],
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      });
      await backend.recordSale(tx, {
        tillId,
        origin: deviceOrigin(deviceId),
        nodeId,
        saleId: brandSaleId(saleId),
        seriesId,
        seriesCode: "FS",
        invoiceNumber,
        issuedAt: new Date("2026-03-01T12:05:00.000Z"),
        offsetMinutes: 60,
        descriptionOfOperation: "Venta en establecimiento",
        total: decimal("12.10"),
        vatBreakdown: [{ rate: decimal("21.00"), base: decimal("10.00"), tax: decimal("2.10") }],
        counterparty: { taxId: "B12345674", legalName, countryCode: "ES" },
      });
    });
  }

  it("refuses an F1 whose recipient name carries a control character", async () => {
    await useSeriesCode("FS");
    await expect(sellToNamedRecipient("Cliente\u0007SL")).rejects.toMatchObject({
      code: "fiscal.record_invalid",
      params: {
        fields: ["Destinatarios.IDDestinatario[0].NombreRazon"],
        codes: ["CONTROL_CHAR"],
      },
    });
  });

  it("writes nothing at all when it refuses", async () => {
    await useSeriesCode("FS");
    await expect(sellToNamedRecipient("Cliente\u0007SL")).rejects.toMatchObject({
      code: "fiscal.record_invalid",
    });

    const registros = await suite.db.select().from(registrosFacturacion);
    expect(registros).toEqual([]);

    const soldRows = await suite.db.select().from(sales);
    expect(soldRows).toEqual([]);

    const heads = await suite.db.execute<{ secuencia: number }>(
      sql`select secuencia from cadenas where node_id = ${nodeId}`,
    );
    expect(heads.rows[0]?.secuencia ?? 0).toBe(0);
  });

  it("records the same sale once the recipient's name is ordinary text", async () => {
    await useSeriesCode("FS");
    await sellToNamedRecipient("Cliente SL");

    const [registro] = await suite.db.select().from(registrosFacturacion);
    expect(registro?.destinatarios).toEqual({
      IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B12345674" }],
    });
  });
});
