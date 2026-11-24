import type { CanonicalValue } from "@waitron/membership";
import type { UnreturnedChain, UnreturnedRecord } from "@waitron/module";
import type { BackupQuery } from "@waitron/store";
import {
  chainHeads,
  readHoldings,
  required,
  text,
  type ChainHead,
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

type PastMain = { readonly head: ChainHead; readonly whole: boolean; readonly after: number };

/**
 * Each chain in this database, other than those of the boxes in `skipped`, with records after the
 * main box's last matching record. A chain whose summary does not match is yielded whole under
 * `"whole"`, and left out under `"skip"`.
 */
async function* chainsPastMain(
  query: BackupQuery,
  held: readonly ChainHolding[],
  onMismatch: "whole" | "skip",
  skipped: ReadonlySet<string> = new Set(),
): AsyncGenerator<PastMain> {
  const main = new Map(held.map((h) => [`${h.nodeId}\n${h.sifId}`, h]));
  for await (const head of chainHeads(query)) {
    if (skipped.has(head.nodeId)) continue;
    const holding = main.get(`${head.nodeId}\n${head.sifId}`);
    const mismatch = holding !== undefined && !(await matchesThrough(query, holding));
    if (mismatch && onMismatch === "skip") continue;
    const whole = holding === undefined || mismatch;
    const after = whole ? 0 : holding.secuencia;
    if (after >= head.secuencia) continue;
    yield { head, whole, after };
  }
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
  const unreturned: UnreturnedChain[] = [];
  for await (const { head, whole, after } of chainsPastMain(query, held, "whole")) {
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

export type ChainRange = {
  readonly nodeId: string;
  readonly sifId: string;
  readonly after: number;
};

/**
 * The chains of boxes other than the two named that this database can extend on the main box: from
 * position 0 when the main box holds none of the chain, or past its matching last record. A chain
 * the two disagree on is left out. Without the main box's summary: `null` while this database holds
 * a record of another box, else none. Reads only.
 */
export async function otherChainsToReturn(
  query: BackupQuery,
  mainHoldings: CanonicalValue | undefined,
  sourceNodeId: string,
  destinationNodeId: string,
): Promise<ChainRange[] | null> {
  if (mainHoldings === undefined) {
    for await (const _ of query.rows(
      `select 1 from verifactu_records where node_id not in (?, ?) limit 1`,
      [sourceNodeId, destinationNodeId],
    ))
      return null;
    return [];
  }
  const ranges: ChainRange[] = [];
  for await (const { head, after } of chainsPastMain(
    query,
    readHoldings(mainHoldings),
    "skip",
    new Set([sourceNodeId, destinationNodeId]),
  ))
    ranges.push({ nodeId: head.nodeId, sifId: head.sifId, after });
  return ranges;
}
