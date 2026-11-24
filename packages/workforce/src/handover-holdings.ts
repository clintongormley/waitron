import { MalformedHoldingsError, type ModuleHandoverContribution } from "@waitron/module";
import type { BackupQuery } from "@waitron/store";

type HoldingsValue = Parameters<NonNullable<ModuleHandoverContribution["lacking"]>>[1];

/**
 * One box's working-time chain, by its last row. No count: an append takes the next position and a
 * returned batch must continue from the row before, so positions on a chain are contiguous.
 */
export type WorkforceHolding = {
  readonly nodeId: string;
  readonly sequenceNo: number;
  readonly entryHash: string;
};

export type WorkforceLackingReason = "record_missing" | "hash_differs";

export type WorkforceLackingChain = {
  readonly nodeId: string;
  readonly reason: WorkforceLackingReason;
};

export async function workforceHoldings(query: BackupQuery): Promise<WorkforceHolding[]> {
  const holdings: WorkforceHolding[] = [];
  for await (const row of query.rows(
    `select t.node_id, t.sequence_no, t.entry_hash from time_entries t
     join (select node_id, max(sequence_no) as head from time_entries group by node_id) h
       on h.node_id = t.node_id and h.head = t.sequence_no
     order by t.node_id`,
  ))
    holdings.push({
      nodeId: String(row.node_id),
      sequenceNo: Number(row.sequence_no),
      entryHash: String(row.entry_hash),
    });
  return holdings;
}

function readHoldings(holdings: HoldingsValue): WorkforceHolding[] {
  const malformed = () => new MalformedHoldingsError("malformed working-time holdings");
  if (!Array.isArray(holdings)) throw malformed();
  return holdings.map((entry: HoldingsValue) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw malformed();
    const { nodeId, sequenceNo, entryHash } = entry as Readonly<Record<string, HoldingsValue>>;
    if (
      typeof nodeId !== "string" ||
      typeof entryHash !== "string" ||
      typeof sequenceNo !== "number" ||
      !Number.isSafeInteger(sequenceNo) ||
      sequenceNo < 1
    )
      throw malformed();
    return { nodeId, sequenceNo, entryHash };
  });
}

/** Each chain in `holdings` this database does not hold through its last row, and why. */
export async function workforceLacking(
  query: BackupQuery,
  holdings: HoldingsValue,
): Promise<WorkforceLackingChain[]> {
  const lacking: WorkforceLackingChain[] = [];
  for (const holding of readHoldings(holdings)) {
    let held: string | null = null;
    for await (const row of query.rows(
      "select entry_hash from time_entries where node_id = ? and sequence_no = ?",
      [holding.nodeId, holding.sequenceNo],
    ))
      held = String(row.entry_hash);
    if (held === null) lacking.push({ nodeId: holding.nodeId, reason: "record_missing" });
    else if (held !== holding.entryHash)
      lacking.push({ nodeId: holding.nodeId, reason: "hash_differs" });
  }
  return lacking;
}
