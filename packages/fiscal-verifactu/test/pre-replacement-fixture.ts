import { eq, sql } from "drizzle-orm";
import { newId, type Database } from "@waitron/db";
import { buildAltaRecord } from "@waitron/verifactu";
import { altaFor, seedNode, seedSale } from "../src/testing/seed.js";
import { cadenas } from "../src/schema/cadenas.js";
import { envios } from "../src/schema/envios.js";

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
