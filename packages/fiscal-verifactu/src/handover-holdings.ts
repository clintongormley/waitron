import type { CanonicalValue } from "@waitron/membership";
import { MalformedHoldingsError } from "@waitron/module";
import type { BackupQuery, BackupValue } from "@waitron/store";

export type ChainHead = {
  readonly nodeId: string;
  readonly sifId: string;
  readonly idSistemaInformatico: string;
  readonly numeroInstalacion: string;
  readonly count: number;
  readonly secuencia: number;
  readonly headRegistroId: string;
  readonly headHuella: string;
};

/** A chain is one box's records under one SIF registration. */
export type ChainHolding = {
  readonly nodeId: string;
  readonly sifId: string;
  readonly idSistemaInformatico: string;
  readonly numeroInstalacion: string;
  readonly count: number;
  readonly secuencia: number;
  readonly huella: string;
};

export const LACKING_REASONS = ["record_missing", "hash_differs", "fewer_records"] as const;
export type LackingReason = (typeof LACKING_REASONS)[number];

export type LackingChain = {
  readonly nodeId: string;
  readonly sifId: string;
  readonly idSistemaInformatico: string;
  readonly numeroInstalacion: string;
  readonly reason: LackingReason;
};

export function required(value: BackupValue | undefined): BackupValue {
  if (value === undefined) throw new Error("incomplete fiscal summary row");
  return value;
}

export function text(value: BackupValue | undefined): string {
  return String(required(value));
}

/** One entry per (node, SIF) pair that has a record, ordered by those two, with its last record. */
export async function* chainHeads(query: BackupQuery): AsyncGenerator<ChainHead> {
  for await (const chain of query.rows(
    `select r.node_id, r.sif_id, s.id_sistema_informatico, s.numero_instalacion,
       count(*) as records, max(r.secuencia) as head
     from verifactu_records r join verifactu_identities s on s.id = r.sif_id
     group by r.node_id, r.sif_id order by r.node_id, r.sif_id`,
  )) {
    const nodeId = text(chain.node_id);
    let headRegistroId = "";
    let headHuella = "";
    for await (const head of query.rows(
      "select id, huella from verifactu_records where node_id = ? and secuencia = ?",
      [nodeId, required(chain.head)],
    )) {
      headRegistroId = text(head.id);
      headHuella = text(head.huella);
    }
    if (headRegistroId === "") throw new Error("missing fiscal summary head");
    yield {
      nodeId,
      sifId: text(chain.sif_id),
      idSistemaInformatico: text(chain.id_sistema_informatico),
      numeroInstalacion: text(chain.numero_instalacion),
      count: Number(required(chain.records)),
      secuencia: Number(required(chain.head)),
      headRegistroId,
      headHuella,
    };
  }
}

export async function fiscalHoldings(query: BackupQuery): Promise<ChainHolding[]> {
  const holdings: ChainHolding[] = [];
  for await (const head of chainHeads(query))
    holdings.push({
      nodeId: head.nodeId,
      sifId: head.sifId,
      idSistemaInformatico: head.idSistemaInformatico,
      numeroInstalacion: head.numeroInstalacion,
      count: head.count,
      secuencia: head.secuencia,
      huella: head.headHuella,
    });
  return holdings;
}

const TEXT_FIELDS = ["nodeId", "sifId", "idSistemaInformatico", "numeroInstalacion", "huella"];
const COUNT_FIELDS = ["count", "secuencia"];

function isPositiveWhole(value: CanonicalValue | undefined): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readHoldings(holdings: CanonicalValue): ChainHolding[] {
  if (!Array.isArray(holdings)) throw new MalformedHoldingsError("malformed fiscal holdings");
  return holdings.map((entry: CanonicalValue) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw new MalformedHoldingsError("malformed fiscal holdings");
    const record = entry as Readonly<Record<string, CanonicalValue>>;
    if (
      !TEXT_FIELDS.every((field) => typeof record[field] === "string") ||
      !COUNT_FIELDS.every((field) => isPositiveWhole(record[field]))
    )
      throw new MalformedHoldingsError("malformed fiscal holdings");
    return record as unknown as ChainHolding;
  });
}

async function reasonLacking(
  query: BackupQuery,
  holding: ChainHolding,
): Promise<LackingReason | null> {
  let huella: string | null = null;
  for await (const row of query.rows(
    "select huella from verifactu_records where node_id = ? and sif_id = ? and secuencia = ?",
    [holding.nodeId, holding.sifId, holding.secuencia],
  ))
    huella = text(row.huella);
  if (huella === null) return "record_missing";
  if (huella !== holding.huella) return "hash_differs";
  let held = 0;
  for await (const row of query.rows(
    `select count(*) as records from verifactu_records
     where node_id = ? and sif_id = ? and secuencia <= ?`,
    [holding.nodeId, holding.sifId, holding.secuencia],
  ))
    held = Number(required(row.records));
  return held < holding.count ? "fewer_records" : null;
}

/** Each chain in `holdings` this database does not hold through its last record, and why. */
export async function fiscalLacking(
  query: BackupQuery,
  holdings: CanonicalValue,
): Promise<LackingChain[]> {
  const lacking: LackingChain[] = [];
  for (const holding of readHoldings(holdings)) {
    const reason = await reasonLacking(query, holding);
    if (reason === null) continue;
    lacking.push({
      nodeId: holding.nodeId,
      sifId: holding.sifId,
      idSistemaInformatico: holding.idSistemaInformatico,
      numeroInstalacion: holding.numeroInstalacion,
      reason,
    });
  }
  return lacking;
}
