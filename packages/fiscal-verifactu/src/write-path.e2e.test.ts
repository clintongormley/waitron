import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import type { RecordSaleLine } from "@waitron/core";
import { buildQrPayload, computeHuella } from "@waitron/verifactu";
import type { RegistroAlta } from "@waitron/verifactu";
import { CORE_MIGRATIONS, asAppUser, incidents, saleLines, sales, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { VerifactuBackend } from "./backend.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { fromRegistroRow } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";
import { cadenas } from "./schema/cadenas.js";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";

let backend: VerifactuBackend;
let tenantId: TenantId;
let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

/**
 * This IS the end-to-end test — the one place both sides of the boundary may be imported
 * together (`packages/core`, which is English and must never see `RegistroAlta`/`computeHuella`,
 * and this module, which may depend on `@waitron/core`, `@waitron/verifactu` and `@waitron/db`
 * alike). It follows `packages/verifactu/src/conformance.test.ts`'s precedent: a test file with no
 * sibling source, the established slot for a cross-cutting policy test.
 *
 * What this proves that `FakeFiscalBackend` cannot (packages/core's own suite proves everything
 * else — orchestration, ordering, atomicity from core's side, "no fiscal condition blocks a
 * sale"): a registro exists, its stored huella recomputes from its own stored columns, the chain
 * head advanced to it, the second sale's predecessor pointer carries the first sale's ACTUAL
 * hash, and a `pendiente` sidecar row exists. The fake writes to none of these tables at all, so
 * every one of these assertions would pass against a module that silently no-ops.
 */
const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS] });

beforeEach(async () => {
  ({ tenantId, tillId, nodeId, seriesId } = await seedTenantWithSif(pg.db));
  // **Deviation from the brief.** The brief constructed `new VerifactuBackend({ clock:
  // steadyClock })`. The real constructor also requires `db`: `pendingCount(tenantId, nodeId)` is the one
  // `FiscalBackend` method with no `tx` parameter at all, so it cannot participate in a caller's
  // transaction and needs its own connection to query against (`backend.ts`'s own doc comment on
  // `VerifactuBackendOptions.db`).
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: pg.db,
    resolveClient: staticResolver(fakeClient),
  });
});

async function sell(overrides: Record<string, unknown> = {}) {
  return withTenant(pg.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordSale(tx, backend, saleInput({ tenantId, tillId, nodeId, seriesId, ...overrides }));
  });
}

/** Reads one `registros_facturacion` row via a raw, untyped `execute` — the snake_case
 * `RegistroRow` shape `fromRegistroRow`/`computeHuella`/`buildQrPayload` need, never Drizzle's
 * own camelCase `.select()` shape (see `./registro-row.ts`'s own doc comment on `RegistroRow` for
 * why the two are not interchangeable: a `timestamptz` column renders differently through each
 * path). Mirrors `./verify.ts`'s and `./chain.test.ts`'s identical convention. */
async function rawRegistro(saleId: string): Promise<RegistroRow> {
  const { rows } = await pg.db.execute<RegistroRow>(
    sql`select * from registros_facturacion where sale_id = ${saleId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`rawRegistro: no row for sale ${saleId}`);
  return row;
}

describe("the write path against the real Veri*Factu backend", () => {
  it("inserts one registro de alta carrying the sale's identity", async () => {
    const { saleId } = await sell();
    const rows = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tipoRegistro).toBe("alta");
    expect(rows[0]?.numSerieFactura).toBe("A/1");
    expect(rows[0]?.secuencia).toBe(1);
  });

  it("marks the first record of a chain as PrimerRegistro", async () => {
    // **Deviation from the brief.** `db.select().from(registrosFacturacion)` with no `where` at
    // all reads whichever row happens to be first in the WHOLE table — harmless in the brief's
    // own implied fresh-database-per-test world, but this suite shares one PGlite instance
    // across every test in the file (booting a fresh WASM PostgreSQL per test would be far
    // slower) and reseeds a new tenant per test rather than truncating, so an earlier test's row
    // would otherwise be read here instead of this test's own. Scoped by `saleId`.
    const { saleId } = await sell();
    const [row] = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    expect(row?.primerRegistro).toBe(true);
  });

  it("stores a huella that recomputes from its own stored columns", async () => {
    // The single strongest assertion available. A module that stored a plausible 64-hex string,
    // or that hashed a record different from the one it persisted, passes every core-level test
    // and fails only here.
    const { saleId } = await sell();
    const row = await rawRegistro(saleId);
    expect(computeHuella(fromRegistroRow(row))).toBe(row.huella);
  });

  it("stores the sale's actual monetary figures, not merely a self-consistent hash", async () => {
    // Task 16 review, Minor 2. The previous test proves the stored huella recomputes from the
    // stored columns — self-consistency only. A registro whose base/cuota amounts were computed
    // WRONG but hashed consistently would pass every test above and this file's other six. This
    // is the one place that reads the persisted `desglose`/`cuota_total`/`importe_total` and
    // checks their actual content against `write-path-fixtures.ts`'s own `saleInput`: two lines,
    // 10.00 base + 2.10 cuota at 21% and 2.10 base + 0.21 cuota at 10%, taxable total 14.41.
    // Exact `text` literal comparisons throughout, never a numeric round-trip — Task 12's own
    // rule for this table, because "123.1" and "123.10" are numerically equal but hash
    // differently.
    const { saleId } = await sell();
    const row = await rawRegistro(saleId);
    expect(row.importe_total).toBe("14.41");
    expect(row.cuota_total).toBe("2.31");
    expect(row.desglose).toEqual([
      expect.objectContaining({
        CalificacionOperacion: "S1",
        BaseImponibleOimporteNoSujeto: "10.00",
        CuotaRepercutida: "2.10",
      }),
      expect.objectContaining({
        CalificacionOperacion: "S1",
        BaseImponibleOimporteNoSujeto: "2.10",
        CuotaRepercutida: "0.21",
      }),
    ]);
  });

  it("advances the chain head to the record it just wrote", async () => {
    const { saleId } = await sell();
    const [registro] = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    const [head] = await pg.db.select().from(cadenas).where(eq(cadenas.nodeId, nodeId));
    expect(head?.secuencia).toBe(1);
    expect(head?.ultimaHuella).toBe(registro?.huella);
    expect(head?.ultimoRegistroId).toBe(registro?.id);
  });

  it("chains the second sale onto the first sale's actual huella", async () => {
    const first = await sell();
    const second = await sell();
    const [a] = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, first.saleId));
    const [b] = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, second.saleId));
    expect(b?.primerRegistro).toBe(false);
    expect(b?.anteriorHuella).toBe(a?.huella);
    expect(b?.anteriorNumSerieFactura).toBe("A/1");
    expect(b?.secuencia).toBe(2);
  });

  it("inserts the submission sidecar row as pending, with nothing sent", async () => {
    const { saleId } = await sell();
    const [registro] = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.saleId, saleId));
    const [sidecar] = await pg.db.select().from(envios).where(eq(envios.registroId, registro!.id));
    expect(sidecar?.estado).toBe("pendiente");
    expect(sidecar?.intentos).toBe(0);
    // The CSV is unrecoverable once lost and arrives only with a submission response, so it must
    // be null at this point. A non-null value here would mean the write path had contacted AEAT,
    // which it must never do.
    expect(sidecar?.csv).toBeNull();
    expect(sidecar?.enviadoEn).toBeNull();
  });

  it("makes the QR payload derivable from the stored record", async () => {
    // Rendering the receipt is out of scope. The DATA being available is not: if the QR could
    // not be built from what was persisted, the receipt would depend on in-memory state that
    // does not survive a reprint.
    const { saleId } = await sell();
    const row = await rawRegistro(saleId);
    const payload = buildQrPayload(fromRegistroRow(row) as RegistroAlta, "preproduction");
    expect(payload).toContain("nif=");
    expect(payload).toContain("numserie=A%2F1");
  });

  it("hands back a verificationUrl built from the same stored record", async () => {
    // `FiscalRecordRef.verificationUrl` is populated by re-reading the just-inserted row rather
    // than reusing in-memory values (`backend.ts`'s own `qrPayloadFor`) — this pins that it
    // actually agrees with what a caller could independently derive from the stored row.
    const { saleId, fiscal } = await sell();
    const row = await rawRegistro(saleId);
    const payload = buildQrPayload(fromRegistroRow(row) as RegistroAlta, "production");
    expect(fiscal.verificationUrl).toBe(payload);
  });

  it("leaves no registro, no chain movement and no sidecar when the sale rows fail", async () => {
    // Atomicity from the other direction: force the failure AFTER the module has done its work
    // and confirm the module's own tables roll back too. A module holding its own connection
    // would leave all three behind.
    await expect(
      withTenant(pg.db, tenantId, async (tx) => {
        await asAppUser(tx);
        await recordSale(tx, backend, saleInput({ tenantId, tillId, nodeId, seriesId }));
        throw new Error("simulated crash after the fiscal write");
      }),
    ).rejects.toThrow("simulated crash");

    expect(await pg.db.select().from(sales).where(eq(sales.tenantId, tenantId))).toHaveLength(0);
    expect(
      await pg.db
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.tenantId, tenantId)),
    ).toHaveLength(0);
    expect(await pg.db.select().from(envios).where(eq(envios.tenantId, tenantId))).toHaveLength(0);
    // The chain head row itself still exists — `seedTenantWithSif`'s own `registerSif` call
    // created it at provisioning time, in a transaction that already committed — but its
    // `secuencia` is untouched by the rolled-back sale.
    const [head] = await pg.db.select().from(cadenas).where(eq(cadenas.nodeId, nodeId));
    expect(head?.secuencia).toBe(0);
  });

  it("completes a sale with no AEAT connectivity whatsoever", async () => {
    // Spec §4 row three: AEAT outage, submission failure, expired certificate and offline
    // operation have NO EFFECT ON SELLING. The strongest way to assert that is not to simulate an
    // outage but to prove the write path cannot reach the network at all.
    //
    // **Deviation from the brief.** The brief constructed `new VerifactuBackend({ clock, fetch:
    // exploding })`. `VerifactuBackendOptions` (`./backend.ts`) has no `fetch` field at all, and
    // never will while this plan's write path stops at `envios` in `pendiente` — submission
    // (the only place a real backend would ever call `fetch`) is plan 3's drainer, not built
    // here. There is nothing to inject an exploding fetch INTO. The structural proof instead:
    // every source file this write path actually runs never references a network primitive —
    // proven by reading their own text, the same "read the source, don't just trust the
    // interface" shape `vocabulary-scope.test.ts` and `packages/fiscal/src/no-regime-vocabulary.
    // test.ts` already use for an analogous property.
    const NETWORK_PRIMITIVE = /\bfetch\s*\(|XMLHttpRequest|from\s+["']node:https?["']/;
    const WRITE_PATH_SOURCES = [
      "./backend.ts",
      "./chain.ts",
      "./registro-sif.ts",
      "./verify.ts",
      "./registro-row.ts",
    ];
    for (const relative of WRITE_PATH_SOURCES) {
      const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
      expect(source).not.toMatch(NETWORK_PRIMITIVE);
    }

    // Having proved there is nothing to reach the network WITH, complete an ordinary sale through
    // the real backend and confirm it fully succeeds: the sale exists, the registro is chained,
    // the sidecar is untouched (still `pendiente`, nothing sent — the existing "inserts the
    // submission sidecar row as pending, with nothing sent" test above already pins that), and no
    // incident was raised, because nothing here failed.
    const { saleId } = await sell();

    expect(await pg.db.select().from(sales).where(eq(sales.id, saleId))).toHaveLength(1);
    expect(
      await pg.db
        .select()
        .from(registrosFacturacion)
        .where(eq(registrosFacturacion.saleId, saleId)),
    ).toHaveLength(1);
    expect(await pg.db.select().from(incidents).where(eq(incidents.tillId, tillId))).toHaveLength(
      0,
    );
  });
});

describe("parent_line_id is not part of the huella", () => {
  // The parent_line_id counterpart of verify.test.ts's "entorno is not part of the huella" — the
  // §5 invariant "never put our own metadata into a hash", applied to Task 5's self-link. A filed
  // MODIFIER child line carries `sale_lines.parent_line_id`, presentation/reporting metadata that
  // is NEVER hashed: `backend.recordSale` receives only `total` + `vatBreakdown`, never the
  // individual `sale_lines`, so `parent_line_id` cannot reach `computeHuella`'s input at all.
  //
  // Two sales built from IDENTICAL input, differing ONLY in whether one child line names a parent,
  // must therefore produce the same huella. Getting two BYTE-IDENTICAL huellas is the hard part:
  // two COMMITTED altas under one obligado can never share a NumSerieFactura (registros_identidad_uq
  // on tenant + IDEmisorFactura + NumSerieFactura + fecha + tipo), and NumSerieFactura is itself a
  // huella input; two under different obligados differ by NIF, also a huella input. So each sale is
  // recorded, its stored huella read back INSIDE its transaction, and the transaction then ROLLED
  // BACK — which reverts `invoice_series.next_number` and the `cadenas` head, so the next sale
  // re-allocates the identical `A/1` against the same still-empty chain, same tenant, same NIF,
  // same fixed clock. Every huella input is then equal across the two except the one under test:
  // one child line's parentLineNo, which stays in `sale_lines` and never travels to the backend.
  const ROLLBACK = new Error("rollback: huella captured");

  async function huellaFor(parentLineNo: number | null): Promise<string> {
    let huella: string | undefined;
    await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const { saleId } = await recordSale(
        tx,
        backend,
        saleInput({
          tenantId,
          tillId,
          nodeId,
          seriesId,
          // Identical two-line basket in both variants — the SAME total (14.41) and the SAME
          // per-rate breakdown reach the backend either way. Only `parentLineNo` on the child
          // line differs between the two calls.
          lines: [
            {
              lineNo: 1,
              descriptions: { "es-ES": "Hamburguesa" },
              quantity: "2",
              unitPrice: "5.00",
              vatRate: "21.00",
              lineTotal: "10.00",
            },
            {
              lineNo: 2,
              descriptions: { "es-ES": "Extra de queso" },
              quantity: "1",
              unitPrice: "2.10",
              vatRate: "10.00",
              lineTotal: "2.10",
              parentLineNo,
            },
          ],
        }),
      );

      const { rows } = await tx.execute<{ huella: string }>(
        sql`select huella from registros_facturacion where sale_id = ${saleId}`,
      );
      huella = rows[0]!.huella;

      // Self-contained guard, mirroring verify.test.ts's own: without it, a regression that stopped
      // `recordSale` writing `parent_line_id` at all would leave BOTH huellas equal for the wrong
      // reason and this test would still pass. When a parent IS named, assert the child line
      // actually stored a non-null `parent_line_id` pointing at the dish line's generated id — the
      // very column proven excluded from the huella. Read HERE, inside the transaction, because the
      // rollback below erases the rows.
      if (parentLineNo !== null) {
        const lines = await tx.select().from(saleLines).where(eq(saleLines.saleId, saleId));
        const dish = lines.find((l) => l.lineNo === 1)!;
        const modifier = lines.find((l) => l.lineNo === 2)!;
        expect(dish.parentLineId).toBeNull();
        expect(modifier.parentLineId).toBe(dish.id);
      }

      // Roll the whole sale back so the next call re-allocates the identical NumSerieFactura against
      // the same empty chain — see the block comment above.
      throw ROLLBACK;
    }).catch((error) => {
      if (error !== ROLLBACK) throw error;
    });
    return huella!;
  }

  it("hashes identically whether or not a child line names its parent", async () => {
    const withParent = await huellaFor(1);
    const withoutParent = await huellaFor(null);
    expect(withParent).toBe(withoutParent);
  });
});

describe("line note/doneness are not part of the huella", () => {
  // The note/doneness counterpart of the "parent_line_id is not part of the huella" block above and
  // verify.test.ts's "entorno is not part of the huella" — the §5 invariant "never put our own metadata
  // into a hash", applied to the per-line kitchen customisation (spec §2/§3). A line's `note` (free-text
  // kitchen instruction) and `doneness` (the meat-doneness enum) are NON-FISCAL KDS metadata: they live
  // ONLY on `working_order_lines` and — snapshotted at fire — `ticket_items`, and never on the fiscal
  // projection. `RecordSaleLine` (packages/core/src/record-sale.ts) carries no such field, `sale_lines`
  // has no such column, and `backend.recordSale` is handed only `total` + `vatBreakdown` +
  // `descriptionOfOperation` — so a line's note/doneness have no channel into `computeHuella`'s input at
  // all.
  //
  // This is a REGRESSION GUARD, not a red-first test: because there is no channel today, it passes the
  // day it is written (map §4 — no line data feeds computeHuella). It earns its place by failing the day
  // someone threads a line field into the record — PROVEN by construction in Task 3 (temporarily folding
  // a line's `note` into the hashed `DescripcionOperacion` in `record-sale.ts` turned the two huellas
  // apart, then reverted). The two variants below carry DIFFERENT note+doneness — attached to a line via
  // a spread, since these fields deliberately do NOT exist on `RecordSaleLine`, and that absence IS the
  // boundary — and must hash IDENTICALLY.
  //
  // **Deviation from the brief**, which named `verify.test.ts`. That suite operates purely at the
  // abstract chain layer (`altaFor` has no per-line structure at all), so a note/doneness hash
  // comparison cannot even be expressed there; this file is the one place the REAL `recordSale` →
  // `computeHuella` path runs, exactly where a line field could wrongly leak — the same reasoning that
  // put the parent_line_id guard here. `record-sale.ts:348` already points callers at "the
  // huella-invariance test in packages/fiscal-verifactu's write-path e2e" for precisely this property.
  //
  // Byte-identical huellas need the same NumSerieFactura against the same empty chain, so — exactly as
  // the parent_line_id block above — each sale is recorded, its huella read back INSIDE its transaction,
  // and the transaction then ROLLED BACK, reverting `invoice_series.next_number` and the `cadenas` head
  // so the next call re-allocates the identical `A/1` against the same still-empty chain.
  const ROLLBACK = new Error("rollback: huella captured");

  /** The default two-line basket, with `note`/`doneness` spread onto the dish line — a wider shape than
   *  `RecordSaleLine` on purpose (those fields are not on it). All amounts stay the saleInput defaults,
   *  so the total and the default settlement still balance; only the KDS metadata differs between calls. */
  function linesWith(note: string, doneness: string) {
    const dish: RecordSaleLine = {
      lineNo: 1,
      descriptions: { "es-ES": "Café solo" },
      quantity: "2",
      unitPrice: "5.00",
      vatRate: "21.00",
      lineTotal: "10.00",
    };
    const water: RecordSaleLine = {
      lineNo: 2,
      descriptions: { "es-ES": "Agua" },
      quantity: "1",
      unitPrice: "2.10",
      vatRate: "10.00",
      lineTotal: "2.10",
    };
    return [{ ...dish, note, doneness }, water];
  }

  async function huellaFor(note: string, doneness: string): Promise<string> {
    let huella: string | undefined;
    await withTenant(pg.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const { saleId } = await recordSale(
        tx,
        backend,
        saleInput({ tenantId, tillId, nodeId, seriesId, lines: linesWith(note, doneness) }),
      );
      const { rows } = await tx.execute<{ huella: string }>(
        sql`select huella from registros_facturacion where sale_id = ${saleId}`,
      );
      huella = rows[0]!.huella;
      // Roll the whole sale back so the next call re-allocates the identical NumSerieFactura against the
      // same empty chain — see the block comment above.
      throw ROLLBACK;
    }).catch((error) => {
      if (error !== ROLLBACK) throw error;
    });
    return huella!;
  }

  it("hashes identically regardless of a line's note/doneness, because neither reaches the record", async () => {
    const rare = await huellaFor("no mayo", "rare");
    const wellDone = await huellaFor("extra mayo", "well_done");
    expect(rare).toBe(wellDone);
  });

  it("keeps note and doneness off the fiscal sale_lines projection entirely", async () => {
    // The structural reason the hashes above can never diverge: the sale/fiscal projection has no
    // column for either field, so nothing a kitchen line carries can ride into a filed record. If a
    // future migration ever added `note`/`doneness` to `sale_lines`, this fails — the earliest possible
    // warning that the NON-FISCAL boundary has moved.
    const { rows } = await pg.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'sale_lines'`,
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).not.toContain("note");
    expect(cols).not.toContain("doneness");
  });
});
