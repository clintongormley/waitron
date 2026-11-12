import { FISCAL_REMEDY } from "./permissions.js";
import { inspectReturnedRecords } from "./handover-return-clashes.js";
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
import { checkFiscalChains } from "./handover-chain-check.js";

/** The states `envios_estado_ck` admits. */
export const ENVIO_STATES = [
  "pendiente",
  "enviando",
  "aceptado",
  "aceptado_con_errores",
  "rechazado",
  "detenido",
  "retenido",
] as const;
export type EnvioState = (typeof ENVIO_STATES)[number];

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

function text(value: BackupValue | undefined): string {
  return String(value);
}

function nullableText(value: BackupValue | undefined): string | null {
  return value === null ? null : text(value);
}

function isEnvioState(value: string): value is EnvioState {
  return (ENVIO_STATES as readonly string[]).includes(value);
}

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
      [nodeId, chain.head!],
    )) {
      headRegistroId = text(head.id);
      headHuella = text(head.huella);
    }

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
      `select a.registro_id, a.submitted_at, a.csv, a.state, a.delivered_at from acks a
       join registros_facturacion r on r.id = a.registro_id
       where r.node_id = ? and r.sif_id = ? order by a.registro_id`,
      [nodeId, sifId],
    ))
      acks.push([
        text(ack.registro_id),
        text(ack.submitted_at),
        nullableText(ack.csv),
        text(ack.state),
        nullableText(ack.delivered_at),
      ]);

    summaries.push({
      nodeId,
      sifId,
      idSistemaInformatico: text(chain.id_sistema_informatico),
      numeroInstalacion: text(chain.numero_instalacion),
      count: Number(chain.records),
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
    inspect: async (tx, source, batch) => {
      const returned = readReturnedBatch(batch);
      return [
        ...inspectReturnedRecords(tx, source, returned),
        ...(await inspectReturnedPayments(tx, source, returned)),
      ];
    },
    receive: async (tx, source, batch, now, accepted, priorAccepted) =>
      (
        await receiveReturnedOriginals(
          tx,
          source,
          readReturnedBatch(batch),
          now,
          accepted,
          priorAccepted,
        )
      ).complete,
  },
};
