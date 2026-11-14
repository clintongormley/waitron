import { readSettings, VENUE_SETTINGS } from "@waitron/db";
import { seedFixtureSif as registerSif } from "./sif-fixture.js";
import { sql } from "drizzle-orm";
import { invoiceSeries, newId, nodes, sales, type Database } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import type { RegistroAlta, VerifactuClient } from "@waitron/verifactu";
import type { FakeAeat } from "@waitron/verifactu/testing";
import { envios } from "../src/schema/envios.js";
import { registrosFacturacion } from "../src/schema/registros.js";
import { cadenas } from "../src/schema/cadenas.js";
import { registroSif } from "../src/schema/sif.js";
import { currentSif } from "../src/registro-sif.js";
import { decodeRegistroRow, fromRegistroRow } from "../src/registro-row.js";
import type { Entorno, RegistroRow } from "../src/registro-row.js";
import { TEST_SISTEMA, nifWithControlLetter } from "../src/testing/seed.js";
import { seedTenantWithSif } from "./fixtures.js";
import { steadyClock } from "./write-path-fixtures.js";
import { seedDevice, seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";

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
  identity?: { nodeId: string; nif: string };
  /** Stamps a generation time after the fake AEAT's `serverNow`, which the fake answers with
   * warning 2004 (AceptadoConErrores). A future invoice date is refused outright (1112) instead. */
  futureDated?: boolean;
  /**
   * The `entorno` every seeded row carries, which `drain` compares against
   * `DrainDeps.environment`. Defaults to `"production"`; `null` exercises
   * `fiscal.environment_unknown`.
   */
  entorno?: Entorno | null;
  /** The producer tax number each record's software block names. Defaults to `TEST_SISTEMA`'s. */
  producerNif?: string;
}

export interface SeededDrain {
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
let pinnedInstallationSequence = 900;

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
    nodeId: string;

    deviceId?: string;
    sifId: string;
    nif: string;
    secuencia: number;
    huella: string;
    fecha: string;
    /** Defaults to `ISSUED_AT`. */
    generadoEn?: string;
    /** Required here: the default is applied once, at `seedPendingEnvios`. */
    entorno: Entorno | null;
    /** Defaults to `"Waitron SL"`. */
    nombreRazonEmisor?: string | undefined;
    /** Defaults to `TEST_SISTEMA`'s. */
    producerNif?: string | undefined;
    /** Defaults to none, as on a simplified F2. */
    destinatarios?: unknown;
    /** An R5 by replacement of the chain's previous record, for a sale made on `fechaOperacion`. */
    replacement?: { fechaOperacion: string };
  },
): Promise<{ registroId: string; numSerieFactura: string }> {
  const numSerieFactura = `S${String(params.secuencia)}/1`;
  const deviceId = params.deviceId ?? (await seedDevice(db, {})).deviceId;
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
    NIF: params.producerNif ?? TEST_SISTEMA.NIF,
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
      nombreRazonEmisor: params.nombreRazonEmisor ?? "Waitron SL",
      tipoFactura: params.replacement === undefined ? "F2" : "R5",
      ...(params.replacement !== undefined &&
        previous !== undefined && {
          tipoRectificativa: "S",
          facturasRectificadas: {
            IDFacturaRectificada: [
              {
                IDEmisorFactura: previous.id_emisor_factura,
                NumSerieFactura: previous.num_serie_factura,
                FechaExpedicionFactura: toAeatDate(previous.fecha_expedicion_factura),
              },
            ],
          },
          importeRectificacion: { BaseRectificada: "0.00", CuotaRectificada: "0.00" },
          fechaOperacion: params.replacement.fechaOperacion,
        }),
      descripcionOperacion: "Venta en establecimiento",
      destinatarios: params.destinatarios ?? null,
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
          nodeId: brandNodeId(opts.identity.nodeId),
        };
  const { nodeId } = seeded;
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
  const { deviceId } = await seedDevice(db, {});

  for (let offset = 0; offset < opts.count; offset += 1) {
    const sequence = firstSequence + offset;
    // Deterministic, distinct, and hex-valid for `registros_huella_ck` (`^[0-9A-F]{64}$`).
    const huella = String(sequence).padStart(64, "0");
    const { registroId, numSerieFactura } = await insertPendingAlta(db, {
      nodeId,
      deviceId,
      sifId: sif.id,
      nif: sif.nif,
      secuencia: sequence,
      huella,
      fecha,
      generadoEn,
      entorno,
      producerNif: opts.producerNif,
    });
    registroIds.push(registroId);
    facturaKeys.push(`${sif.nif}|${numSerieFactura}|${toAeatDate(fecha)}`);
    await db.insert(envios).values({ registroId, proximoIntentoEn: DUE_AT });
  }

  return {
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
  options: {
    nombreRazonEmisor?: string;
    generadoEn?: string;
    destinatarios?: unknown;
    replacement?: { fechaOperacion: string };
  } = {},
): Promise<{ registroId: string; facturaKey: string }> {
  const huella = String(secuencia).padStart(64, "0");
  // `DEFAULT_ENTORNO`, so the appended row agrees with the chain it extends.
  const { registroId, numSerieFactura } = await insertPendingAlta(db, {
    nodeId: seeded.nodeId,
    sifId: seeded.sifId,
    nif: seeded.nif,
    secuencia,
    huella,
    fecha: PAST_FECHA,
    entorno: DEFAULT_ENTORNO,
    nombreRazonEmisor: options.nombreRazonEmisor,
    generadoEn: options.generadoEn,
    destinatarios: options.destinatarios,
    replacement: options.replacement,
  });
  await db.insert(envios).values({ registroId, proximoIntentoEn: DUE_AT });
  return { registroId, facturaKey: `${seeded.nif}|${numSerieFactura}|${toAeatDate(PAST_FECHA)}` };
}

type StoredRegistro = typeof registrosFacturacion.$inferSelect;

/** The latest record on the chain `record` sits on. */
function chainHeadOf(records: readonly StoredRegistro[], record: StoredRegistro): StoredRegistro {
  return records
    .filter((row) => row.sifId === record.sifId)
    .sort((a, b) => b.secuencia - a.secuencia)[0]!;
}

/** The fields by which a new record names the record before it on its chain. */
function followingRecord(head: StoredRegistro) {
  return {
    anteriorIdEmisorFactura: head.idEmisorFactura,
    anteriorNumSerieFactura: head.numSerieFactura,
    anteriorFechaExpedicionFactura: head.fechaExpedicionFactura,
    anteriorHuella: head.huella,
  };
}

async function advanceChainPointer(
  db: Database,
  seeded: SeededDrain,
  secuencia: number,
  id: string,
  huella: string,
): Promise<void> {
  await db.execute(sql`
    update cadenas set secuencia = ${secuencia}, ultimo_registro_id = ${id}, ultima_huella = ${huella}
    where node_id = ${seeded.nodeId}
  `);
}

/**
 * A pending cancellation of `originalId` at `secuencia`, on the original's own chain, whose pointer
 * in `seeded` moves on to it. `sinRegistroPrevio: "S"` makes it the absent-original cancellation.
 *
 * With `otherChainHeadId` it goes on ANOTHER chain instead, after that chain's record: a box
 * cancelling an invoice that another box's chain issued. The row is then built from that head, and
 * no chain pointer moves.
 */
export async function appendCancellation(
  db: Database,
  seeded: SeededDrain,
  originalId: string,
  secuencia: number,
  options: { sinRegistroPrevio?: "S"; otherChainHeadId?: string } = {},
): Promise<string> {
  const records = await db.select().from(registrosFacturacion);
  const original = records.find((row) => row.id === originalId)!;
  const onOtherChain = options.otherChainHeadId !== undefined;
  const head = onOtherChain
    ? records.find((row) => row.id === options.otherChainHeadId)!
    : chainHeadOf(records, original);
  const id = newId();
  const huella = (onOtherChain ? "F" : "C").repeat(63) + String(secuencia % 10);
  await db.insert(registrosFacturacion).values({
    ...(onOtherChain ? head : original),
    id,
    secuencia,
    saleId: original.saleId,
    tipoRegistro: "anulacion",
    idEmisorFactura: original.idEmisorFactura,
    numSerieFactura: original.numSerieFactura,
    fechaExpedicionFactura: original.fechaExpedicionFactura,
    tipoFactura: null,
    descripcionOperacion: null,
    desglose: null,
    cuotaTotal: null,
    importeTotal: null,
    primerRegistro: false,
    sinRegistroPrevio: options.sinRegistroPrevio ?? null,
    ...followingRecord(head),
    huella,
  });
  if (!onOtherChain) await advanceChainPointer(db, seeded, secuencia, id, huella);
  await db.insert(envios).values({ registroId: id, proximoIntentoEn: DUE_AT });
  return id;
}

/** A pending correction (Subsanacion=S) of the alta `originalId`, appended to its own chain at
 * `secuencia`: the same invoice, replacing that version. */
export async function appendCorrection(
  db: Database,
  seeded: SeededDrain,
  originalId: string,
  secuencia: number,
): Promise<string> {
  const records = await db.select().from(registrosFacturacion);
  const original = records.find((row) => row.id === originalId)!;
  const id = newId();
  const huella = "D".repeat(63) + String(secuencia % 10);
  await db.insert(registrosFacturacion).values({
    ...original,
    id,
    secuencia,
    correctsRegistroId: originalId,
    subsanacion: "S",
    rechazoPrevio: "X",
    primerRegistro: false,
    ...followingRecord(chainHeadOf(records, original)),
    huella,
  });
  await advanceChainPointer(db, seeded, secuencia, id, huella);
  await db.insert(envios).values({ registroId: id, proximoIntentoEn: DUE_AT });
  return id;
}

/** AEAT already holds another fingerprint under the record's identity: a Route B conflict. */
export async function collideAtAeat(
  db: Database,
  aeat: FakeAeat,
  seeded: SeededDrain,
  registroId: string,
): Promise<void> {
  const raw = await db.execute<Record<string, unknown>>(sql`
    select * from registros_facturacion where id = ${registroId}
  `);
  const ours = fromRegistroRow(decodeRegistroRow<RegistroRow>(raw.rows[0]!)) as RegistroAlta;
  await aeat
    .client()
    .submit({ ObligadoEmision: { NombreRazon: seeded.legalName, NIF: seeded.nif } }, [
      { RegistroAlta: { ...ours, Huella: "D".repeat(64) } },
    ]);
}

/**
 * Adds a SECOND, independent chain — a new node with its own live SIF registration, so
 * its own `sif_id` — under an ALREADY-seeded venue, with one pending alta at `secuencia`.
 */
export async function seedSecondChain(
  db: Database,
  seeded: SeededDrain,
  secuencia: number,
): Promise<{ registroId: string; facturaKey: string }> {
  const existing = await readSettings(db, VENUE_SETTINGS);
  await seedVenueSettings(db, {
    invoiceLocales: ["es"],
    operationDescription: "Venta en establecimiento",
  });
  await seedBusinessDay(db, {});
  if (existing.revision === 0) await seedVenueSettings(db, { name: "Sala B" });
  const [node] = await db.insert(nodes).values({ name: "Node B" }).returning({ id: nodes.id });
  const nodeId = brandNodeId(node!.id);
  await db.insert(invoiceSeries).values({ nodeId, code: "B" });
  // Same `nif` and `idSistemaInformatico` as `seeded`'s chain: `registerSif` mints installation
  // numbers per (nif, idSistemaInformatico), so a new node gets its OWN `sif_id`.
  const sif = await db.transaction((tx) =>
    registerSif(tx, { nodeId, nif: seeded.nif, idSistemaInformatico: "WT" }),
  );

  const huella = `B${String(secuencia).padStart(63, "0")}`;
  const { registroId, numSerieFactura } = await insertPendingAlta(db, {
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
  const existing = await readSettings(db, VENUE_SETTINGS);
  if (existing.revision === 0) await seedVenueSettings(db, { name: "Sala Z" });
  const [node] = await db.insert(nodes).values({ name: "Node Z" }).returning({ id: nodes.id });
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
    numeroInstalacion: "1",
  });

  const entorno = params.entorno === undefined ? DEFAULT_ENTORNO : params.entorno;
  // 64 hex digits for `registros_huella_ck`, prefixed apart from `seedSecondChain`'s "B".
  const huella = `E${String(params.secuencia).padStart(63, "0")}`;
  const { registroId, numSerieFactura } = await insertPendingAlta(db, {
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

/**
 * Adds a chain under an ALREADY-seeded venue, on its own node, whose `registro_sif` row has the
 * EXPLICIT `sifId` (so the chain's place in `order by r.sif_id` is the test's choice), the same
 * `nif` as `seeded`, and one pending alta per entry of `rows`, chained in order from
 * `firstSecuencia`. Chains sharing a `nif` need disjoint secuencia ranges, because the invoice
 * number is derived from it and AEAT's record identity is the issuer, number and date. The returned
 * `chain` extends it through `appendPendingAlta`.
 */
export async function seedPinnedChain(
  db: Database,
  seeded: SeededDrain,
  params: {
    sifId: string;
    firstSecuencia: number;
    rows: { nombreRazonEmisor: string; generadoEn: string }[];
    entorno?: Entorno;
  },
): Promise<{ chain: SeededDrain; registroIds: string[] }> {
  const existing = await readSettings(db, VENUE_SETTINGS);
  if (existing.revision === 0)
    await seedVenueSettings(db, { name: `Sala ${params.sifId.slice(0, 4)}` });
  const [node] = await db
    .insert(nodes)
    .values({ name: `Node ${params.sifId.slice(0, 4)}` })
    .returning({ id: nodes.id });
  const nodeId = brandNodeId(node!.id);
  pinnedInstallationSequence += 1;
  await db.insert(registroSif).values({
    id: params.sifId,
    nodeId,
    nif: seeded.nif,
    idSistemaInformatico: "WT",
    numeroInstalacion: String(pinnedInstallationSequence),
  });
  await db.insert(cadenas).values({ nodeId });

  const { deviceId } = await seedDevice(db, {});
  const registroIds: string[] = [];
  const facturaKeys: string[] = [];
  for (const [index, row] of params.rows.entries()) {
    const secuencia = params.firstSecuencia + index;
    const huella = `A${String(secuencia).padStart(63, "0")}`;
    const { registroId, numSerieFactura } = await insertPendingAlta(db, {
      nodeId,
      deviceId,
      sifId: params.sifId,
      nif: seeded.nif,
      secuencia,
      huella,
      fecha: PAST_FECHA,
      generadoEn: row.generadoEn,
      entorno: params.entorno ?? DEFAULT_ENTORNO,
      nombreRazonEmisor: row.nombreRazonEmisor,
    });
    await db.insert(envios).values({ registroId, proximoIntentoEn: DUE_AT });
    registroIds.push(registroId);
    facturaKeys.push(`${seeded.nif}|${numSerieFactura}|${toAeatDate(PAST_FECHA)}`);
  }
  return {
    chain: {
      ...seeded,
      nodeId,
      sifId: params.sifId,
      registroIds,
      facturaKeys,
    },
    registroIds,
  };
}

/** AEAT's consulta names the stored copy's error, which the fake AEAT sends only for 2007. */
export const consultaNames = (client: VerifactuClient, codigo: number): VerifactuClient => ({
  submit: (...args) => client.submit(...args),
  consultar: async (...args) => {
    const respuesta = await client.consultar(...args);
    return {
      ...respuesta,
      registros: respuesta.registros.map((r) =>
        r.EstadoRegistro === "AceptadoConErrores"
          ? { ...r, CodigoErrorRegistro: codigo, DescripcionErrorRegistro: `Error ${codigo}` }
          : r,
      ),
    };
  },
});

export const seedNonproductionHistory = (db: Database) =>
  seedPendingEnvios(db, { count: 1, entorno: "preproduction" });

/**
 * AEAT's response schema carries a stored record's FechaOperacion (RespuestaConsultaLR.xsd,
 * `RespuestaDatosRegistroFacturacionType`); the fake leaves it out, so this adds it to `ref`'s record.
 */
export const answersFechaOperacion = (
  client: VerifactuClient,
  ref: string,
  fechaOperacion: string,
): VerifactuClient => ({
  submit: (cabecera, registros) => client.submit(cabecera, registros),
  consultar: async (cabecera, filtro) => {
    const answer = await client.consultar(cabecera, filtro);
    return {
      ...answer,
      registros: answer.registros.map((record) =>
        record.DatosRegistroFacturacion.RefExterna === ref
          ? {
              ...record,
              DatosRegistroFacturacion: {
                ...record.DatosRegistroFacturacion,
                FechaOperacion: fechaOperacion,
              },
            }
          : record,
      ),
    };
  },
});
