import { eq, getTableColumns, sql, type Column } from "drizzle-orm";
import { newId, type Database, type Transaction } from "@waitron/db";
import type { NodeId } from "@waitron/shared";
import {
  buildAltaRecord,
  buildAnulacionRecord,
  validate,
  type Encadenamiento,
} from "@waitron/verifactu";
import { altaFor, seedNode, seedSale } from "../src/testing/seed.js";
import { readChainHead, type PendingRegistro } from "../src/chain.js";
import { pointerTo, toRegistroRow } from "../src/registro-row.js";
import { currentSif } from "../src/registro-sif.js";
import { cadenas } from "../src/schema/cadenas.js";
import { envios } from "../src/schema/envios.js";
import { registrosFacturacion } from "../src/schema/registros.js";

export async function appendPreReplacementRecord(
  tx: Transaction,
  nodeId: NodeId,
  pending: PendingRegistro,
): Promise<void> {
  const head = await readChainHead(tx, nodeId);
  let link: Encadenamiento = { PrimerRegistro: "S" };
  if (head.ultimoRegistroId !== null) {
    const [previous] = await tx
      .select({
        idEmisorFactura: registrosFacturacion.idEmisorFactura,
        numSerieFactura: registrosFacturacion.numSerieFactura,
        fechaExpedicionFactura: registrosFacturacion.fechaExpedicionFactura,
        huella: registrosFacturacion.huella,
      })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.id, head.ultimoRegistroId));
    if (previous === undefined) throw new Error("Missing historical fixture predecessor");
    link = { RegistroAnterior: pointerTo(previous) };
  }
  const record =
    pending.tipo === "alta"
      ? buildAltaRecord({ ...pending.input, Encadenamiento: link })
      : buildAnulacionRecord({ ...pending.input, Encadenamiento: link });
  const errors = validate(record, { now: pending.input.generadoEn }).filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length > 0)
    throw new Error(`Invalid historical fiscal fixture: ${errors.map((issue) => issue.code)}`);
  const sif = await currentSif(tx, nodeId);
  const id = newId();
  const row = {
    ...toRegistroRow(record, {
      origin: pending.origin,
      nodeId,
      sifId: sif.id,
      saleId: pending.saleId,
      secuencia: head.secuencia + 1,
      offsetMinutes: pending.input.offsetMinutes,
      entorno: pending.entorno,
      ...(pending.tipo === "anulacion" ? { nombreRazonEmisor: pending.nombreRazonEmisor } : {}),
    }),
    id,
    creadoEn: new Date(),
  };
  const columns = getTableColumns(registrosFacturacion);
  const entries = Object.entries(row).filter(
    ([key, value]) =>
      value !== undefined && !["subsanacion", "rechazoPrevio", "sinRegistroPrevio"].includes(key),
  );
  const names = entries.map(([key]) => sql.identifier(columns[key as keyof typeof columns].name));
  const values = entries.map(([key, value]) => {
    const column: Column = columns[key as keyof typeof columns];
    return sql`${value === null ? null : column.mapToDriverValue(value)}`;
  });
  await tx.execute(sql`
    insert into registros_facturacion (${sql.join(names, sql`, `)})
    values (${sql.join(values, sql`, `)})
  `);
  await tx
    .update(cadenas)
    .set({ secuencia: head.secuencia + 1, ultimoRegistroId: id, ultimaHuella: record.Huella })
    .where(eq(cadenas.nodeId, nodeId));
}

/** Historical inserts name their columns so today's schema cannot add columns to the old writer. */
export async function seedPreReplacementRegistro(db: Database) {
  const node = await seedNode(db);
  const saleId = await seedSale(db, node, 1);
  const pending = altaFor(node, saleId, 1, 0, "production");
  const record = buildAltaRecord({
    ...pending.input,
    Encadenamiento: { PrimerRegistro: "S" },
  });
  const registroId = newId();
  await db.execute(sql`
    insert into registros_facturacion (
      id, source, device_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico, fecha_hora_huso_gen_registro,
      offset_minutos, tipo_huella, huella, entorno, creado_en
    ) values (
      ${registroId}, 'device', ${node.deviceId}, ${node.nodeId}, ${node.sifId}, ${saleId},
      1, 'alta', ${record.IDFactura.IDEmisorFactura}, ${record.IDFactura.NumSerieFactura},
      '2026-07-20', ${record.NombreRazonEmisor}, ${record.TipoFactura},
      ${record.DescripcionOperacion}, ${JSON.stringify(record.Desglose)},
      ${record.CuotaTotal}, ${record.ImporteTotal}, 1,
      ${JSON.stringify(record.SistemaInformatico)},
      ${pending.input.generadoEn.toISOString()}, ${pending.input.offsetMinutes},
      ${record.TipoHuella}, ${record.Huella}, 'production', '2026-07-21T00:00:00.000Z'
    )
  `);
  await db
    .update(cadenas)
    .set({ secuencia: 1, ultimoRegistroId: registroId, ultimaHuella: record.Huella })
    .where(eq(cadenas.nodeId, node.nodeId));
  return { nodeId: node.nodeId, registroId };
}

export async function seedPreReplacementEnvio(db: Database) {
  const seeded = await seedPreReplacementRegistro(db);
  await db.insert(envios).values({
    registroId: seeded.registroId,
    proximoIntentoEn: new Date("2026-07-21T00:00:00.000Z"),
  });
  return { nodeId: seeded.nodeId, registroIds: [seeded.registroId] };
}
