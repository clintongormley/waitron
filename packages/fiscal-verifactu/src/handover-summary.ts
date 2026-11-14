import { getTableName } from "drizzle-orm";
import { acks } from "./schema/acks.js";
import { absentInvoiceIds, markReturnedInvoices } from "./returned-invoices.js";
import { FISCAL_REMEDY } from "./permissions.js";
import { createHash } from "node:crypto";
import type { CanonicalValue } from "@waitron/membership";
import type { ModuleHandoverContribution } from "@waitron/module";
import {
  makeReturnedBatches,
  inspectReturnedPayments,
  readReturnedOriginals,
  receiveReturnedOriginals,
  readReturnedBatch,
} from "./handover-return.js";
import type { BackupQuery, BackupValue } from "@waitron/store";
import { ENVIO_STATES, type EnvioState } from "./filing-states.js";
import { checkFiscalChains } from "./handover-chain-check.js";

export { ENVIO_STATES, type EnvioState };

export type ChainSummary = {
  readonly nodeId: string;
  readonly sifId: string;
  readonly idSistemaInformatico: string;
  readonly numeroInstalacion: string;
  readonly count: number;
  readonly headRegistroId: string;
  readonly headHuella: string;
  readonly envios: Readonly<Record<EnvioState, number>>;
  /** SHA-256 of `[registro_id, submitted_at, csv, state, delivered_at]` per ack, by registro id. */
  readonly acksSha256: string;
  readonly enviandoIds: readonly string[];
};

function required(value: BackupValue | undefined): BackupValue {
  if (value === undefined) throw new Error("incomplete fiscal summary row");
  return value;
}

function text(value: BackupValue | undefined): string {
  return String(required(value));
}

function nullableText(value: BackupValue | undefined): string | null {
  return value === null ? null : text(value);
}

function isEnvioState(value: string): value is EnvioState {
  return (ENVIO_STATES as readonly string[]).includes(value);
}

const ACK_COLUMNS = [acks.registroId, acks.submittedAt, acks.csv, acks.state, acks.deliveredAt];
const ACK_SELECT = ACK_COLUMNS.map((column) => `a."${column.name.replaceAll('"', '""')}"`).join(
  ", ",
);
const ACK_TABLE = `"${getTableName(acks).replaceAll('"', '""')}"`;
const ACK_REGISTRO = `a."${acks.registroId.name.replaceAll('"', '""')}"`;

/** One entry per (node, SIF) pair that has a record, ordered by those two. Reads only. */
export async function summariseChains(query: BackupQuery): Promise<ChainSummary[]> {
  const summaries: ChainSummary[] = [];
  for await (const chain of query.rows(
    `select r.node_id, r.sif_id, s.id_sistema_informatico, s.numero_instalacion,
       count(*) as records, max(r.secuencia) as head
     from registros_facturacion r join registro_sif s on s.id = r.sif_id
     group by r.node_id, r.sif_id order by r.node_id, r.sif_id`,
  )) {
    const nodeId = text(chain.node_id);
    const sifId = text(chain.sif_id);

    let headRegistroId = "";
    let headHuella = "";
    for await (const head of query.rows(
      "select id, huella from registros_facturacion where node_id = ? and secuencia = ?",
      [nodeId, required(chain.head)],
    )) {
      headRegistroId = text(head.id);
      headHuella = text(head.huella);
    }

    if (headRegistroId === "") throw new Error("missing fiscal summary head");

    const envios = Object.fromEntries(ENVIO_STATES.map((state) => [state, 0])) as Record<
      EnvioState,
      number
    >;
    const enviandoIds: string[] = [];
    for await (const envio of query.rows(
      `select e.registro_id, e.estado from envios e
       join registros_facturacion r on r.id = e.registro_id
       where r.node_id = ? and r.sif_id = ? order by e.registro_id`,
      [nodeId, sifId],
    )) {
      const state = text(envio.estado);
      if (!isEnvioState(state)) throw new Error(`unknown envio state ${state}`);
      envios[state]++;
      if (state === "enviando") enviandoIds.push(text(envio.registro_id));
    }

    const acks: (string | null)[][] = [];
    for await (const ack of query.rows(
      `select ${ACK_SELECT} from ${ACK_TABLE} a
       join registros_facturacion r on r.id = ${ACK_REGISTRO}
       where r.node_id = ? and r.sif_id = ? order by ${ACK_REGISTRO}`,
      [nodeId, sifId],
    ))
      acks.push(
        ACK_COLUMNS.map((column) =>
          column.notNull ? text(ack[column.name]) : nullableText(ack[column.name]),
        ),
      );

    summaries.push({
      nodeId,
      sifId,
      idSistemaInformatico: text(chain.id_sistema_informatico),
      numeroInstalacion: text(chain.numero_instalacion),
      count: Number(required(chain.records)),
      headRegistroId,
      headHuella,
      envios,
      acksSha256: createHash("sha256").update(JSON.stringify(acks)).digest("hex"),
      enviandoIds,
    });
  }
  return summaries;
}

export const VERIFACTU_HANDOVER: ModuleHandoverContribution = {
  summarise: summariseChains,
  checkCopy: checkFiscalChains,
  returnRecords: {
    read: async (tx, source) =>
      makeReturnedBatches(await readReturnedOriginals(tx, source)) as unknown as CanonicalValue[],
    acceptPermission: FISCAL_REMEDY,
    inspect: async (tx, source, batch) =>
      inspectReturnedPayments(tx, source, readReturnedBatch(batch)),
    receive: async (tx, source, batch, now, accepted) => {
      const originals = readReturnedBatch(batch);
      const absent = absentInvoiceIds(
        tx,
        originals.records.map((row) => String(row.id)),
      );
      const result = await receiveReturnedOriginals(tx, source, originals, now, accepted);
      await markReturnedInvoices(tx, absent, now);
      return result.refusal ? { refusal: result.refusal } : result.complete;
    },
  },
};
