import { sql } from "drizzle-orm";
import { invoiceSeries, locations, nodes, sales, type Database } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { envios } from "../src/schema/envios.js";
import { registrosFacturacion } from "../src/schema/registros.js";
import { registroSif } from "../src/schema/sif.js";
import { currentSif, registerSif } from "../src/registro-sif.js";
import type { Entorno } from "../src/registro-row.js";
import { TEST_SISTEMA, nifWithControlLetter } from "../src/testing/seed.js";
import { seedTenantWithSif } from "./fixtures.js";
import { steadyClock } from "./write-path-fixtures.js";
import { seedDevice } from "@waitron/db/testing/seed.js";

/**
 * Every row here is inserted through its TABLE DEFINITION, for the reason `./fixtures.ts`'s own
 * header gives: the `$defaultFn` generators are drizzle-side, and a raw statement reaches none.
 */

/** The sale's issue instant, carrying the `+01:00` that `issued_offset_minutes` (60) records. */
const ISSUED_AT = "2026-07-20T19:20:30+01:00";

/**
 * The `proximo_intento_en` every seeded envío carries: the fake AEAT's `serverNow`, so `drain` sees
 * the batch as due. A `Date`, so the `ts` column writes the canonical `.000Z` spelling: `drain`
 * compares this column as TEXT, and a bare `Z` sorts AFTER `.000Z` for the same instant.
 */
const DUE_AT = new Date("2026-07-21T00:00:00Z");

const DEFAULT_ENTORNO: Entorno = "production";

export interface SeededDrainOptions {
  count: number;
  /** Reuse an operational venue's fiscal identity instead of creating another venue. */
  identity?: { locationId: string; nodeId: string; nif: string };
  /** Stamps a generation time after the fake AEAT's `serverNow`, which the fake answers with
   * warning 2004 (AceptadoConErrores). A future invoice date is refused outright (1112) instead. */
  futureDated?: boolean;
  /**
   * The `entorno` every seeded row carries, which `drain` compares against
   * `DrainDeps.environment`. Defaults to `"production"`; `null` exercises
   * `fiscal.environment_unknown`.
   */
  entorno?: Entorno | null;
}

export interface SeededDrain {
  locationId: string;
  nodeId: NodeId;
  sifId: string;
  nif: string;
  legalName: string;
  /** `registros_facturacion.id` per seeded row — the RefExterna `drain` is expected to stamp. */
  registroIds: string[];
  /** `keyOf(record)` per row (from `@waitron/verifactu`'s fake AEAT), for `aeat.reject`/
   * `aeat.dropRegistroDuplicadoDetail`. */
  facturaKeys: string[];
  clock: TrustedClock;
}

// Fixed either side of the `serverNow` (2026-07-21T00:00:00Z) every suite's fake AEAT uses.
const PAST_FECHA = "2026-07-20";
const FUTURE_GENERATED_AT = "2026-07-22T00:00:00+01:00";
let reusedIdentitySequence = 10_000;
let independentNifSequence = 0;

/** AEAT's `sf:fecha` ("DD-MM-YYYY") from this file's own ISO ("YYYY-MM-DD") literals. */
function toAeatDate(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split("-");
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * A pending alta, modelled on `seedSoldRegistro` (./fixtures.ts) but with a configurable
 * `fecha_expedicion_factura` and generation time.
 */
export async function insertPendingAlta(
  db: Database,
  params: {
    locationId: string;
    nodeId: string;
    sifId: string;
    nif: string;
    secuencia: number;
    huella: string;
    fecha: string;
    /** Defaults to `ISSUED_AT`. */
    generadoEn?: string;
    /** Required here: the default is applied once, at `seedPendingEnvios`. */
    entorno: Entorno | null;
  },
): Promise<{ registroId: string; numSerieFactura: string }> {
  const numSerieFactura = `S${String(params.secuencia)}/1`;
  const { deviceId } = await seedDevice(db, { locationId: params.locationId });
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId: params.nodeId, code: `S${String(params.secuencia)}` })
    .returning({ id: invoiceSeries.id });
  const [sale] = await db
    .insert(sales)
    .values({
      source: "device",
      deviceId,
      nodeId: params.nodeId,
      seriesId: series!.id,
      invoiceNumber: params.secuencia,
      issuedAt: ISSUED_AT,
      issuedOffsetMinutes: 60,
      total: 0,
      vatBreakdown: [],
      locale: "es",
      invoiceLocales: ["es"],
      fiscalBackend: "verifactu",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  // Fed to the REAL `serializeEnvio` through `client.submit`, so the alta columns carry a
  // well-formed F2 line rather than NULL, which the serialiser cannot handle.
  const desglose = [
    {
      BaseImponibleOimporteNoSujeto: "10.00",
      TipoImpositivo: "21.00",
      CuotaRepercutida: "2.10",
      ClaveRegimen: "01",
      CalificacionOperacion: "S1",
    },
  ];
  // Chained as `appendToChain` chains a real record: the first on a node is the chain start, every
  // later one names its predecessor. The fake AEAT answers a repeated first record for the same
  // issuer and software identity with warning 2007, as AEAT did in the verifactu library's
  // preproduction run 36350894099 (its `COMPLIANCE-AUDIT.md`, "Complete live result, 27 September
  // 2026").
  const head = await db.execute<{
    id_emisor_factura: string;
    num_serie_factura: string;
    fecha_expedicion_factura: string;
    huella: string;
  }>(sql`
    select r.id_emisor_factura, r.num_serie_factura, r.fecha_expedicion_factura, r.huella
    from cadenas c join registros_facturacion r on r.id = c.ultimo_registro_id
    where c.node_id = ${params.nodeId}
  `);
  const previous = head.rows[0];
  const sif = await db.execute<{ numero_instalacion: number }>(sql`
    select numero_instalacion from registro_sif where id = ${params.sifId}
  `);
  const sistemaInformatico = {
    ...TEST_SISTEMA,
    NumeroInstalacion: String(sif.rows[0]!.numero_instalacion),
  };
  const [registro] = await db
    .insert(registrosFacturacion)
    .values({
      source: "device",
      deviceId,
      nodeId: params.nodeId,
      sifId: params.sifId,
      saleId: sale!.id,
      secuencia: params.secuencia,
      tipoRegistro: "alta",
      idEmisorFactura: params.nif,
      numSerieFactura,
      fechaExpedicionFactura: params.fecha,
      nombreRazonEmisor: "Waitron SL",
      tipoFactura: "F2",
      descripcionOperacion: "Venta en establecimiento",
      desglose,
      cuotaTotal: "2.10",
      importeTotal: "12.10",
      primerRegistro: previous === undefined,
      anteriorIdEmisorFactura: previous?.id_emisor_factura,
      anteriorNumSerieFactura: previous?.num_serie_factura,
      anteriorFechaExpedicionFactura: previous?.fecha_expedicion_factura,
      anteriorHuella: previous?.huella,
      sistemaInformatico,
      fechaHoraHusoGenRegistro: new Date(params.generadoEn ?? ISSUED_AT),
      offsetMinutos: 60,
      tipoHuella: "01",
      huella: params.huella,
      entorno: params.entorno,
    })
    .returning({ id: registrosFacturacion.id });
  const registroId = registro?.id;
  /* v8 ignore start */
  if (registroId === undefined) {
    // Structurally unreachable: the insert always returns exactly one row.
    throw new Error("insertPendingAlta: insert returned no row");
  }
  /* v8 ignore stop */
  await db.execute(sql`
    update cadenas
    set secuencia = ${params.secuencia}, ultimo_registro_id = ${registroId}, ultima_huella = ${params.huella}
    where node_id = ${params.nodeId}
  `);
  return { registroId, numSerieFactura };
}

/**
 * Seeds a till device + live SIF identity (`seedTenantWithSif`), then `opts.count` pending altas, each
 * with its `pendiente` `envios` row due at the fake AEAT's `serverNow`.
 */
export async function seedPendingEnvios(
  db: Database,
  opts: SeededDrainOptions,
): Promise<SeededDrain> {
  const seeded =
    opts.identity === undefined
      ? await seedTenantWithSif(db)
      : {
          locationId: opts.identity.locationId,
          nodeId: brandNodeId(opts.identity.nodeId),
        };
  const { locationId, nodeId } = seeded;
  const sif = await db.transaction((tx) =>
    opts.identity === undefined
      ? currentSif(tx, nodeId)
      : registerSif(tx, { nodeId, nif: opts.identity.nif, idSistemaInformatico: "WT" }),
  );
  const firstSequence = opts.identity === undefined ? 1 : reusedIdentitySequence;
  if (opts.identity !== undefined) reusedIdentitySequence += opts.count;

  const tenantRow = await db.execute<{ legal_name: string }>(sql`
    select legal_name from tenants limit 1
  `);
  const legalName = tenantRow.rows[0]?.legal_name ?? "Waitron SL";

  const fecha = PAST_FECHA;
  const generadoEn = opts.futureDated === true ? FUTURE_GENERATED_AT : undefined;
  // An EXPLICIT `null` must survive, so not `??`.
  const entorno = opts.entorno === undefined ? DEFAULT_ENTORNO : opts.entorno;
  const registroIds: string[] = [];
  const facturaKeys: string[] = [];

  for (let offset = 0; offset < opts.count; offset += 1) {
    const sequence = firstSequence + offset;
    // Deterministic, distinct, and hex-valid for `registros_huella_ck` (`^[0-9A-F]{64}$`).
    const huella = String(sequence).padStart(64, "0");
    const { registroId, numSerieFactura } = await insertPendingAlta(db, {
      locationId,
      nodeId,
      sifId: sif.id,
      nif: sif.nif,
      secuencia: sequence,
      huella,
      fecha,
      generadoEn,
      entorno,
    });
    registroIds.push(registroId);
    facturaKeys.push(`${sif.nif}|${numSerieFactura}|${toAeatDate(fecha)}`);
    await db.insert(envios).values({ registroId, proximoIntentoEn: DUE_AT });
  }

  return {
    locationId,
    nodeId,
    sifId: sif.id,
    nif: sif.nif,
    legalName,
    registroIds,
    facturaKeys,
    clock: steadyClock,
  };
}

/**
 * Appends ONE more pending alta onto an ALREADY-seeded chain, for tests that need new work to
 * land on a chain that already has state.
 */
export async function appendPendingAlta(
  db: Database,
  seeded: SeededDrain,
  secuencia: number,
): Promise<{ registroId: string; facturaKey: string }> {
  const huella = String(secuencia).padStart(64, "0");
  // `DEFAULT_ENTORNO`, so the appended row agrees with the chain it extends.
  const { registroId, numSerieFactura } = await insertPendingAlta(db, {
    locationId: seeded.locationId,
    nodeId: seeded.nodeId,
    sifId: seeded.sifId,
    nif: seeded.nif,
    secuencia,
    huella,
    fecha: PAST_FECHA,
    entorno: DEFAULT_ENTORNO,
  });
  await db.insert(envios).values({ registroId, proximoIntentoEn: DUE_AT });
  return { registroId, facturaKey: `${seeded.nif}|${numSerieFactura}|${toAeatDate(PAST_FECHA)}` };
}

/**
 * Adds a SECOND, independent chain — a new location and node with its own live SIF registration, so
 * its own `sif_id` — under an ALREADY-seeded venue, with one pending alta at `secuencia`.
 */
export async function seedSecondChain(
  db: Database,
  seeded: SeededDrain,
  secuencia: number,
): Promise<{ registroId: string; facturaKey: string }> {
  const [location] = await db
    .insert(locations)
    .values({
      name: "Sala B",
      invoiceLocales: ["es"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const [node] = await db
    .insert(nodes)
    .values({ locationId: location!.id, name: "Node B" })
    .returning({ id: nodes.id });
  const nodeId = brandNodeId(node!.id);
  await db.insert(invoiceSeries).values({ nodeId, code: "B" });
  // Same `nif` and `idSistemaInformatico` as `seeded`'s chain: `registerSif` mints installation
  // numbers per (nif, idSistemaInformatico), so a new node gets its OWN `sif_id`.
  const sif = await db.transaction((tx) =>
    registerSif(tx, { nodeId, nif: seeded.nif, idSistemaInformatico: "WT" }),
  );

  const huella = `B${String(secuencia).padStart(63, "0")}`;
  const { registroId, numSerieFactura } = await insertPendingAlta(db, {
    locationId: location!.id,
    nodeId,
    sifId: sif.id,
    nif: seeded.nif,
    secuencia,
    huella,
    fecha: PAST_FECHA,
    entorno: DEFAULT_ENTORNO,
  });
  await db.insert(envios).values({ registroId, proximoIntentoEn: DUE_AT });
  return { registroId, facturaKey: `${seeded.nif}|${numSerieFactura}|${toAeatDate(PAST_FECHA)}` };
}

/**
 * Mints an INDEPENDENT chain's `registro_sif` row with an EXPLICIT `sifId`, bypassing
 * `registerSif`'s counter bookkeeping: `drain` never reads `registro_sif`; it groups chains by
 * `registros_facturacion.sif_id`. The explicit id lets a test force this chain to sort
 * deterministically under `claimBatch`'s `order by r.sif_id, r.secuencia`.
 *
 * The all-`f` literal sorts after every `registerSif`-minted id: those are `randomUUID()` v4 ids
 * in lowercase hex, compared byte by byte, and position 14 holds the version digit `4` where the
 * literal holds `f`.
 */
export async function seedIndependentChain(
  db: Database,
  params: { sifId: string; secuencia: number; entorno?: Entorno | null },
): Promise<{ registroId: string; facturaKey: string }> {
  const [location] = await db
    .insert(locations)
    .values({
      name: "Sala Z",
      invoiceLocales: ["es"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const [node] = await db
    .insert(nodes)
    .values({ locationId: location!.id, name: "Node Z" })
    .returning({ id: nodes.id });
  const nodeId = brandNodeId(node!.id);
  await db.insert(invoiceSeries).values({ nodeId, code: "Z" });
  // A fresh nif, so this fixed installation number cannot collide with another chain's.
  independentNifSequence += 1;
  const nif = nifWithControlLetter(30_000_000 + independentNifSequence);
  await db.insert(registroSif).values({
    id: params.sifId,
    nodeId,
    nif,
    idSistemaInformatico: "INDEP",
    numeroInstalacion: 1,
  });

  const entorno = params.entorno === undefined ? DEFAULT_ENTORNO : params.entorno;
  // 64 hex digits for `registros_huella_ck`, prefixed apart from `seedSecondChain`'s "B".
  const huella = `E${String(params.secuencia).padStart(63, "0")}`;
  const { registroId, numSerieFactura } = await insertPendingAlta(db, {
    locationId: location!.id,
    nodeId,
    sifId: params.sifId,
    nif,
    secuencia: params.secuencia,
    huella,
    fecha: PAST_FECHA,
    entorno,
  });
  await db.insert(envios).values({ registroId, proximoIntentoEn: DUE_AT });
  return { registroId, facturaKey: `${nif}|${numSerieFactura}|${toAeatDate(PAST_FECHA)}` };
}
