import { sql } from "drizzle-orm";
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
import { chainHeads, fiscalHoldings, fiscalLacking, text } from "./handover-holdings.js";
import { fiscalUnreturned, otherChainsToReturn } from "./handover-unreturned.js";
import { liveBackupQuery } from "@waitron/db";

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
  /** SHA-256 of the submission answers and their states, ordered by record id. */
  readonly submissionsSha256: string;
  readonly enviandoIds: readonly string[];
};

function nullableText(value: BackupValue | undefined): string | null {
  return value === null ? null : text(value);
}

function isEnvioState(value: string): value is EnvioState {
  return (ENVIO_STATES as readonly string[]).includes(value);
}

/** One entry per (node, SIF) pair that has a record, ordered by those two. Reads only. */
export async function summariseChains(query: BackupQuery): Promise<ChainSummary[]> {
  const summaries: ChainSummary[] = [];
  for await (const chain of chainHeads(query)) {
    const { nodeId, sifId, headRegistroId, headHuella } = chain;

    const envios = Object.fromEntries(ENVIO_STATES.map((state) => [state, 0])) as Record<
      EnvioState,
      number
    >;
    const enviandoIds: string[] = [];
    const submissions: (string | null)[][] = [];
    for await (const envio of query.rows(
      `select e.registro_id, e.estado, e.csv, e.codigo_error, e.mensaje_error,
              e.enviado_en, e.confirmado_en from verifactu_submissions e
       join verifactu_records r on r.id = e.registro_id
       where r.node_id = ? and r.sif_id = ? order by e.registro_id`,
      [nodeId, sifId],
    )) {
      const state = text(envio.estado);
      if (!isEnvioState(state)) throw new Error(`unknown envio state ${state}`);
      envios[state]++;
      const id = text(envio.registro_id);
      if (state === "enviando") enviandoIds.push(id);
      submissions.push([
        id,
        state,
        nullableText(envio.csv),
        nullableText(envio.codigo_error),
        nullableText(envio.mensaje_error),
        nullableText(envio.enviado_en),
        nullableText(envio.confirmado_en),
      ]);
    }

    summaries.push({
      nodeId,
      sifId,
      idSistemaInformatico: chain.idSistemaInformatico,
      numeroInstalacion: chain.numeroInstalacion,
      count: chain.count,
      headRegistroId,
      headHuella,
      envios,
      submissionsSha256: createHash("sha256").update(JSON.stringify(submissions)).digest("hex"),
      enviandoIds,
    });
  }
  return summaries;
}

export const VERIFACTU_HANDOVER: ModuleHandoverContribution = {
  summarise: summariseChains,
  checkCopy: checkFiscalChains,
  holdings: fiscalHoldings,
  lacking: fiscalLacking,
  unreturned: fiscalUnreturned,
  returnRecords: {
    read: async (tx, source) =>
      makeReturnedBatches(await readReturnedOriginals(tx, source)) as unknown as CanonicalValue[],
    readOthers: async (tx, source, destination, mainHoldings) => {
      if (mainHoldings === undefined) {
        const held = tx.get(sql`select 1 from verifactu_records
          where node_id not in (${source}, ${destination}) limit 1`);
        return held === undefined ? [] : null;
      }
      const ranges = await otherChainsToReturn(
        liveBackupQuery(tx),
        mainHoldings,
        source,
        destination,
      );
      if (ranges.length === 0) return [];
      return makeReturnedBatches(
        await readReturnedOriginals(tx, ranges),
      ) as unknown as CanonicalValue[];
    },
    acceptPermission: FISCAL_REMEDY,
    inspect: async (tx, source, batch) =>
      inspectReturnedPayments(tx, source, readReturnedBatch(batch)),
    receive: async (tx, source, batch, now, owner) => {
      const originals = readReturnedBatch(batch);
      const absent = absentInvoiceIds(
        tx,
        originals.records.map((row) => String(row.id)),
      );
      const result = await receiveReturnedOriginals(tx, source, originals, now, owner);
      await markReturnedInvoices(tx, absent, now);
      return result.refusal ? { refusal: result.refusal } : result.complete;
    },
  },
};
