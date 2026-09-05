import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { recordSale, recordVoid } from "@waitron/core";
import { computeHuella } from "@waitron/verifactu";
import { asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { hashPin, loginWithPin } from "@waitron/identity";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { VerifactuBackend } from "./backend.js";
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
// recordVoid now requires `sale.void`; this is a manager shift session that authorizes every void
// in this suite (only the void's authorization matters here, not who rang the sale).
let voidSessionId: string;

/**
 * The end-to-end counterpart to `./write-path.e2e.test.ts`, for the same reason that file exists:
 * this is the one place both sides of the boundary may be imported together
 * (`packages/core`'s `recordVoid`, which is English and must never see `RegistroAnulacion`/
 * `computeHuella`, and this module, which may depend on `@waitron/core`, `@waitron/verifactu` and
 * `@waitron/db` alike).
 *
 * What this proves that `packages/core`'s own `record-void.test.ts` (against `FakeFiscalBackend`)
 * cannot: alta and anulación interleave in ONE chain in generation order, the anulación gets its
 * own huella recomputable from its own stored columns, its own pending sidecar row, and it advances
 * the REAL chain head — none of which a fake backend's own bookkeeping tables can demonstrate.
 */
// TEST_MIGRATIONS is the full manifest (identity migrates before fiscal): recordVoid now calls
// `authorize`, which reads identity's persons/sessions, and fiscal's SP-3a capture migration needs
// sync_capture() from the sync set. See ../test/migrations.ts.
const pg = usePgliteDb({ migrations: TEST_MIGRATIONS });

beforeEach(async () => {
  ({ tenantId, tillId, nodeId, seriesId } = await seedTenantWithSif(pg.db));
  // Seed a manager (holds `sale.void`) as the superuser owner and open its session — the void path
  // under test now needs an authorizer, mirroring packages/core/src/record-correction.test.ts.
  const { rows } = await pg.db.execute<{ id: string }>(
    sql`insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'P', ${hashPin("1234")}, 'manager') returning id`,
  );
  const session = await withTenant(pg.db, tenantId, (tx) =>
    loginWithPin(tx, { tenantId, tillId, personId: rows[0]!.id, pin: "1234" }),
  );
  voidSessionId = session.id;
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: pg.db,
    resolveClient: staticResolver(fakeClient),
  });
});

async function sell() {
  return withTenant(pg.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordSale(tx, backend, saleInput({ tenantId, tillId, nodeId, seriesId }));
  });
}

async function voidSale(saleId: SaleId, reason = "staff error") {
  return withTenant(pg.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return recordVoid(tx, backend, saleId, reason, { sessionId: voidSessionId });
  });
}

/** Raw, untyped `execute` — the snake_case `RegistroRow` shape `fromRegistroRow`/`computeHuella`
 * need, never Drizzle's own camelCase `.select()` shape (`./registro-row.ts`'s own doc comment;
 * `./write-path.e2e.test.ts`'s identical `rawRegistro`). Scoped to `tipo_registro = 'anulacion'`
 * because a voided sale has TWO rows sharing the same `sale_id` — the alta AND the anulación that
 * annuls it both carry it, per `packages/fiscal-verifactu/src/chain.ts`'s own `PendingRegistro`
 * shape (the anulación's `saleId` is the sale it annuls, not an identity of its own). */
async function rawAnulacion(saleId: string): Promise<RegistroRow> {
  const { rows } = await pg.db.execute<RegistroRow>(
    sql`select * from registros_facturacion where sale_id = ${saleId} and tipo_registro = 'anulacion'`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`rawAnulacion: no anulación row for sale ${saleId}`);
  return row;
}

describe("alta and anulación interleave in one chain", () => {
  it("chains the anulación onto the chronologically previous record, not the one it annuls", async () => {
    // THE assertion of this task. Sell A, sell B, then void A. The anulación's predecessor is B —
    // the record generated immediately before it — even though the record it annuls is A. Chaining
    // it onto A instead produces a chain that verifies against itself locally and is rejected
    // wholesale by AEAT, and no core-level test (against a fake with no chain at all) can tell the
    // two apart.
    const a = await sell();
    const b = await sell();
    await voidSale(a.saleId);

    const rows = await pg.db
      .select()
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.tenantId, tenantId))
      .orderBy(asc(registrosFacturacion.secuencia));

    expect(rows.map((r) => r.tipoRegistro)).toEqual(["alta", "alta", "anulacion"]);
    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3]);

    const anulacion = rows[2]!;
    // **Deviation from the brief.** The brief's illustrative snippet asserted
    // `anulacion.encadenamientoHuella` and `anulacion.numSerieFacturaAnulada` — neither column
    // exists. The predecessor pointer's stored column is `anteriorHuella` (`./schema/registros.ts`),
    // and the ANNULLED invoice's own identity lives in the SAME `numSerieFactura`/`idEmisorFactura`
    // columns an alta uses for its own identity (`./registro-row.ts`'s `toRegistroRow`: "one set of
    // columns serves both directions") — confirmed by `backend.test.ts`'s own already-passing
    // "appends an anulación referencing the original alta's own identity" test, which asserts on
    // `.numSerieFactura` for exactly this reason.
    expect(anulacion.anteriorHuella).toBe(rows[1]!.huella);
    expect(anulacion.anteriorHuella).not.toBe(rows[0]!.huella);
    expect(anulacion.numSerieFactura).toBe("A/1");
    void b;
  });

  it("gives the anulación its own huella, recomputable from its own columns", async () => {
    const a = await sell();
    await voidSale(a.saleId);
    // **Deviation from the brief.** The brief read the row via Drizzle's typed `.select()` and
    // passed it through an undefined `toRegistro` helper. `computeHuella` needs `fromRegistroRow`'s
    // reconstruction from the RAW snake_case row (`./registro-row.ts`'s own doc comment on why a
    // `timestamptz` column renders differently through each path) — the same convention
    // `./write-path.e2e.test.ts`'s identical assertion for an alta already uses.
    const row = await rawAnulacion(a.saleId);
    expect(computeHuella(fromRegistroRow(row))).toBe(row.huella);
  });

  it("gives the anulación its own pending sidecar row", async () => {
    const a = await sell();
    await voidSale(a.saleId);
    const rows = await pg.db.select().from(envios).where(eq(envios.tenantId, tenantId));
    // Two registros, two sidecars. An anulación that shared the alta's row would be submitted to
    // AEAT never or twice, both unrecoverable.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.estado === "pendiente")).toBe(true);
  });

  it("advances the chain head to the anulación", async () => {
    const a = await sell();
    await voidSale(a.saleId);
    const row = await rawAnulacion(a.saleId);
    const [head] = await pg.db.select().from(cadenas).where(eq(cadenas.nodeId, nodeId));
    expect(head?.secuencia).toBe(2);
    expect(head?.ultimaHuella).toBe(row.huella);
  });
});
