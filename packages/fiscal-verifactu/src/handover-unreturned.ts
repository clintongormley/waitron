import type { CanonicalValue } from "@waitron/membership";
import type { UnreturnedChain, UnreturnedRecord } from "@waitron/module";
import type { BackupQuery } from "@waitron/store";
import {
  chainHeads,
  readHoldings,
  required,
  text,
  type ChainHolding,
} from "./handover-holdings.js";

/** Whether this database's chain matches the main box's through the main box's last record. */
async function matchesThrough(query: BackupQuery, held: ChainHolding): Promise<boolean> {
  let huella: string | null = null;
  let records = 0;
  for await (const row of query.rows(
    `select (select huella from verifactu_records
              where node_id = ? and sif_id = ? and secuencia = ?) as huella,
            (select count(*) from verifactu_records
              where node_id = ? and sif_id = ? and secuencia <= ?) as records`,
    [held.nodeId, held.sifId, held.secuencia, held.nodeId, held.sifId, held.secuencia],
  )) {
    huella = row.huella === null ? null : text(row.huella);
    records = Number(required(row.records));
  }
  return huella === held.huella && records === held.count;
}

/**
 * For each chain in this database, the records after the main box's last matching record, or the
 * whole chain when the main box lacks it or its summary does not match. Reads only.
 */
export async function fiscalUnreturned(
  query: BackupQuery,
  mainHoldings: CanonicalValue | undefined,
): Promise<UnreturnedChain[]> {
  const held = mainHoldings === undefined ? [] : readHoldings(mainHoldings);
  const main = new Map(held.map((h) => [`${h.nodeId}\n${h.sifId}`, h]));
  const unreturned: UnreturnedChain[] = [];
  for await (const head of chainHeads(query)) {
    const held = main.get(`${head.nodeId}\n${head.sifId}`);
    const whole = held === undefined || !(await matchesThrough(query, held));
    const after = whole ? 0 : held.secuencia;
    if (after >= head.secuencia) continue;
    const records: UnreturnedRecord[] = [];
    for await (const row of query.rows(
      `select r.sale_id, r.secuencia, r.tipo_registro, r.creado_en, s.estado
       from verifactu_records r left join verifactu_submissions s on s.registro_id = r.id
       where r.node_id = ? and r.sif_id = ? and r.secuencia > ? order by r.secuencia`,
      [head.nodeId, head.sifId, after],
    ))
      records.push({
        saleId: text(row.sale_id),
        number: Number(required(row.secuencia)),
        type: text(row.tipo_registro) === "anulacion" ? "cancellation" : "issue",
        createdAt: text(row.creado_en),
        filingState: row.estado === null ? null : text(row.estado),
      });
    unreturned.push({
      ids: {
        nodeId: head.nodeId,
        sifId: head.sifId,
        idSistemaInformatico: head.idSistemaInformatico,
        numeroInstalacion: head.numeroInstalacion,
      },
      whole,
      records,
    });
  }
  return unreturned;
}
