import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { tillId as brandTillId } from "@waitron/shared";
import type { TenantId, TillId } from "@waitron/shared";
import { currentSif, registerSif } from "../src/registro-sif.js";
import { seedTenantWithSif } from "./fixtures.js";
import { steadyClock } from "./write-path-fixtures.js";

export interface SeededDrainOptions {
  count: number;
  /**
   * Future task hook (Task 9's error-2004/AceptadoConErrores path) — the fake AEAT this suite
   * uses defaults `serverNow` to 2026-07-21T00:00:00Z, so a `futureDated` row is stamped
   * `FUTURE_FECHA` (after it) instead of `PAST_FECHA` (before it). Nothing in Task 6 asserts on
   * this: happy-path `drain` marks every claimed row `aceptado` unconditionally, regardless of
   * which fecha it carries — the fake's own per-line "AceptadoConErrores" distinction only starts
   * to matter once `persistResponse` reads per-line state (Task 9).
   */
  futureDated?: boolean;
}

/**
 * Full shape defined once here — later tasks (Route B / error-3000 resolution, rejection
 * handling, flow control) read `facturaKeys`/`clock`, which nothing in Task 6 itself consumes.
 * Do not narrow this interface for one task's convenience.
 */
export interface SeededDrain {
  tenantId: TenantId;
  tillId: TillId;
  sifId: string;
  nif: string;
  legalName: string;
  /** `registros_facturacion.id` per seeded row — the RefExterna `drain` is expected to stamp. */
  registroIds: string[];
  /** `keyOf(record)` per row (`@waitron/verifactu/src/testing/fake-aeat.js`), for `aeat.reject`/
   * `aeat.dropRegistroDuplicadoDetail` in Tasks 9-10. */
  facturaKeys: string[];
  clock: TrustedClock;
}

// The suite-wide convention: every `createFakeAeat({ serverNow })` in this task's tests uses this
// instant, so PAST/FUTURE below are fixed relative to it rather than threaded through as a param
// (`SeededDrainOptions` carries no `serverNow` field — matching the brief's interface literally).
const PAST_FECHA = "2026-07-20";
const FUTURE_FECHA = "2026-07-22";

/** AEAT's `sf:fecha` ("DD-MM-YYYY") from this file's own ISO ("YYYY-MM-DD") literals. */
function toAeatDate(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split("-");
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * A pending alta, modelled on `seedSoldRegistro` (./fixtures.ts) but with a configurable
 * `fecha_expedicion_factura` — `seedSoldRegistro` hardcodes '2026-07-20', which cannot express
 * `SeededDrainOptions.futureDated`'s 2004/AceptadoConErrores case. Duplicated rather than
 * extending `seedSoldRegistro`'s own signature, to avoid touching a fixture other suites
 * (registro-sif.test.ts) already depend on for this task's own narrower need.
 */
async function insertPendingAlta(
  db: Database,
  params: {
    tenantId: string;
    tillId: string;
    sifId: string;
    nif: string;
    secuencia: number;
    huella: string;
    fecha: string;
  },
): Promise<{ registroId: string; numSerieFactura: string }> {
  const numSerieFactura = `S${String(params.secuencia)}/1`;
  const series = await db.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, till_id, code)
    values (${params.tenantId}, ${params.tillId}, ${"S" + String(params.secuencia)})
    returning id
  `);
  const seriesId = series.rows[0]?.id;
  const sale = await db.execute<{ id: string }>(sql`
    insert into sales (
      tenant_id, till_id, series_id, invoice_number,
      issued_at, issued_offset_minutes,
      total, tip_amount, amount_charged,
      locale, invoice_locales, fiscal_backend, fiscal_state
    ) values (
      ${params.tenantId}, ${params.tillId}, ${seriesId}, ${params.secuencia},
      '2026-07-20T19:20:30+01:00', 60,
      '0.00', '0.00', '0.00',
      'es', array['es'], 'verifactu', 'recorded'
    )
    returning id
  `);
  const saleId = sale.rows[0]?.id;
  // Unlike `seedSoldRegistro` (whose only consumer, registro-sif.test.ts, never serialises the
  // row), a row seeded here is fed to the REAL `serializeEnvio` via `client.submit` — `drain.ts`
  // rebuilds it with `fromRegistroRow` and hands it to AEAT. `tipo_factura`/`descripcion_operacion`/
  // `desglose`/`cuota_total`/`importe_total` are therefore populated with a genuine, well-formed
  // "F2" line, not left NULL: `registroAlta` (packages/verifactu/src/xml/serialize.ts) reads
  // `DescripcionOperacion`/`TipoFactura` as required strings and `.map`s over `Desglose`
  // unconditionally, so a NULL here throws inside `escapeXml`/crashes on `null.map` — confirmed
  // live while implementing this task.
  const desglose = JSON.stringify([
    {
      BaseImponibleOimporteNoSujeto: "10.00",
      TipoImpositivo: "21.00",
      CuotaRepercutida: "2.10",
      CalificacionOperacion: "S1",
    },
  ]);
  const registro = await db.execute<{ id: string }>(sql`
    insert into registros_facturacion (
      tenant_id, till_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella
    ) values (
      ${params.tenantId}, ${params.tillId}, ${params.sifId}, ${saleId}, ${params.secuencia}, 'alta',
      ${params.nif}, ${numSerieFactura}, ${params.fecha}, 'Waitron SL',
      'F2', 'Venta en establecimiento', ${desglose}::jsonb, '2.10', '12.10',
      true, '{}'::jsonb,
      '2026-07-20T19:20:30+01:00', 60, '01', ${params.huella}
    )
    returning id
  `);
  const registroId = registro.rows[0]?.id;
  /* v8 ignore start */
  if (registroId === undefined) {
    // Structurally unreachable: the insert above carries no WHERE clause, so it always inserts
    // and returns exactly one row (mirrors seedSoldRegistro's identical, un-ignored assumption —
    // ignored here only because THIS file's coverage is held to the same 98%/95% package gate).
    throw new Error("insertPendingAlta: insert returned no row");
  }
  /* v8 ignore stop */
  await db.execute(sql`
    update cadenas
    set secuencia = ${params.secuencia}, ultimo_registro_id = ${registroId}, ultima_huella = ${params.huella}
    where tenant_id = ${params.tenantId} and till_id = ${params.tillId}
  `);
  return { registroId, numSerieFactura };
}

/**
 * Seeds a tenant + till + live SIF identity (`seedTenantWithSif`), then `opts.count` pending
 * altas: a `registros_facturacion` row per `insertPendingAlta` above, plus the `envios` sidecar
 * row `seedSoldRegistro`/`seedTenantWithSif` do not create — `estado` takes the column's own
 * `'pendiente'` default, `proximo_intento_en` is stamped `2026-07-21T00:00:00Z` to match this
 * task's fake AEAT's `serverNow`, so `drain` sees the batch as due.
 *
 * `sif_id`/`nif` are resolved via `currentSif` (./src/registro-sif.js) — the same function
 * `VerifactuBackend` itself uses — rather than re-deriving them from a second, hand-written
 * `registro_sif` query.
 */
export async function seedPendingEnvios(
  db: Database,
  opts: SeededDrainOptions,
): Promise<SeededDrain> {
  const { tenantId, tillId } = await seedTenantWithSif(db);
  const sif = await db.transaction((tx) => currentSif(tx, tenantId, tillId));

  const tenantRow = await db.execute<{ legal_name: string }>(sql`
    select legal_name from tenants where id = ${tenantId}
  `);
  const legalName = tenantRow.rows[0]?.legal_name ?? "Waitron SL";

  const fecha = opts.futureDated === true ? FUTURE_FECHA : PAST_FECHA;
  const registroIds: string[] = [];
  const facturaKeys: string[] = [];

  for (let i = 1; i <= opts.count; i += 1) {
    // Deterministic, distinct, and hex-valid (registros_huella_ck: /^[0-9A-F]{64}$/) — digits
    // alone already satisfy that character class, so no hex letters are needed.
    const huella = String(i).padStart(64, "0");
    const { registroId, numSerieFactura } = await insertPendingAlta(db, {
      tenantId,
      tillId,
      sifId: sif.id,
      nif: sif.nif,
      secuencia: i,
      huella,
      fecha,
    });
    registroIds.push(registroId);
    facturaKeys.push(`${sif.nif}|${numSerieFactura}|${toAeatDate(fecha)}`);
    await db.execute(sql`
      insert into envios (registro_id, tenant_id, proximo_intento_en)
      values (${registroId}, ${tenantId}, '2026-07-21T00:00:00Z')
    `);
  }

  return {
    tenantId,
    tillId,
    sifId: sif.id,
    nif: sif.nif,
    legalName,
    registroIds,
    facturaKeys,
    clock: steadyClock,
  };
}

/**
 * Appends ONE more pending alta onto an ALREADY-seeded chain (`seedPendingEnvios`) — for tests
 * that need new work to land on a chain that already has state, e.g. Task 9's
 * Incidencia-while-open test, which needs a record enqueued AFTER an earlier one in the SAME
 * chain was rejected and its successors halted. Reuses `insertPendingAlta` (this file's own
 * `seedPendingEnvios` helper) rather than re-deriving the same raw-SQL insert, and follows its
 * identical PAST_FECHA convention.
 */
export async function appendPendingAlta(
  db: Database,
  seeded: SeededDrain,
  secuencia: number,
): Promise<{ registroId: string; facturaKey: string }> {
  const huella = String(secuencia).padStart(64, "0");
  const { registroId, numSerieFactura } = await insertPendingAlta(db, {
    tenantId: seeded.tenantId,
    tillId: seeded.tillId,
    sifId: seeded.sifId,
    nif: seeded.nif,
    secuencia,
    huella,
    fecha: PAST_FECHA,
  });
  await db.execute(sql`
    insert into envios (registro_id, tenant_id, proximo_intento_en)
    values (${registroId}, ${seeded.tenantId}, '2026-07-21T00:00:00Z')
  `);
  return { registroId, facturaKey: `${seeded.nif}|${numSerieFactura}|${toAeatDate(PAST_FECHA)}` };
}

/**
 * Adds a SECOND, entirely independent chain — a new till, its own live SIF registration (same
 * `nif`, a new `IdSistemaInformatico`/installation pair, so its own distinct `sif_id`) — under an
 * ALREADY-seeded tenant, with one pending alta on it at `secuencia`.
 *
 * For tests that need to prove one tenant's chains are isolated from one another: Task 9's
 * `haltOpenChainClaims` (./src/drain.ts) must halt a claim on a chain with an open
 * `rechazado`/`detenido` row WITHOUT also halting or skipping a claim on a DIFFERENT, healthy
 * chain of the SAME tenant claimed in the same batch — a property `seedPendingEnvios`'s
 * single-chain shape cannot exercise on its own.
 */
export async function seedSecondChain(
  db: Database,
  seeded: SeededDrain,
  secuencia: number,
): Promise<{ registroId: string; facturaKey: string }> {
  // Untransacted — matching `seedPendingEnvios`'s own convention (plain sequential `db.execute`
  // calls; only `currentSif`/`registerSif`, which are typed against `Transaction`, get their own
  // `db.transaction(...)` wrapper below).
  const location = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${seeded.tenantId}, 'Sala B', array['es'], 'Venta en establecimiento')
    returning id
  `);
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${seeded.tenantId}, ${location.rows[0]!.id}, 'Till B')
    returning id
  `);
  const tillId = brandTillId(till.rows[0]!.id);
  await db.execute(sql`
    insert into invoice_series (tenant_id, till_id, code) values (${seeded.tenantId}, ${tillId}, 'B')
  `);
  // Same `nif`, same `idSistemaInformatico` ("WT" — `seedTenantWithSif`'s own literal) as
  // `seeded`'s own chain: `registerSif` mints installation numbers per (nif,
  // idSistemaInformatico), so a NEW till under that pair gets its OWN `sif_id` — a second,
  // independent chain for the SAME obligado, exactly like two tills at one shop.
  const sif = await db.transaction((tx) =>
    registerSif(tx, {
      tenantId: seeded.tenantId,
      tillId,
      nif: seeded.nif,
      idSistemaInformatico: "WT",
    }),
  );

  const huella = `B${String(secuencia).padStart(63, "0")}`;
  const { registroId, numSerieFactura } = await insertPendingAlta(db, {
    tenantId: seeded.tenantId,
    tillId,
    sifId: sif.id,
    nif: seeded.nif,
    secuencia,
    huella,
    fecha: PAST_FECHA,
  });
  await db.execute(sql`
    insert into envios (registro_id, tenant_id, proximo_intento_en)
    values (${registroId}, ${seeded.tenantId}, '2026-07-21T00:00:00Z')
  `);
  return { registroId, facturaKey: `${seeded.nif}|${numSerieFactura}|${toAeatDate(PAST_FECHA)}` };
}
