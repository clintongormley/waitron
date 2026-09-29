import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { diningTables } from "./schema/dining-tables.js";
import { partyTables } from "./schema/parties.js";

/** Each party's active tables' labels, in the order the tables joined it. */
export async function partyTableLabels(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, string[]>> {
  const labels = new Map(partyIds.map((id) => [id, [] as string[]]));
  if (partyIds.length === 0) return labels;
  const rows = await tx
    .select({ partyId: partyTables.partyId, label: diningTables.label })
    .from(partyTables)
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .where(and(inArray(partyTables.partyId, [...partyIds]), isNull(partyTables.leftAt)))
    .orderBy(partyTables.joinedAt, partyTables.id);
  for (const row of rows) labels.get(row.partyId)!.push(row.label);
  return labels;
}

/**
 * The party each of `partyIds` was merged into, following the chain of merges to its end, keyed by
 * each party asked about; a party never merged answers itself.
 */
export async function partySurvivors(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, string>> {
  const { rows } = await tx.execute<{ start: string; id: string }>(sql`
    with recursive chain(start, id, next) as (
      select p.id, p.id, p.merged_into_party_id from parties p
      where p.id in (select value from json_each(${JSON.stringify(partyIds)}))
      union
      select c.start, p.id, p.merged_into_party_id from parties p join chain c on p.id = c.next
    )
    select start, id from chain where next is null
  `);
  return new Map(rows.map((row) => [row.start, row.id]));
}

/**
 * The tables a party's bill is named after, keyed by each party asked about: the party's active
 * tables ({@link partyTableLabels}), or, once it holds none, those of the party it was merged into
 * at the end of the chain of merges; empty when that party holds none either.
 */
export async function billPartyTableLabels(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, string[]>> {
  const own = await partyTableLabels(tx, partyIds);
  const seatless = partyIds.filter((id) => own.get(id)!.length === 0);
  if (seatless.length === 0) return own;
  const survivorOf = await partySurvivors(tx, seatless);
  const survivors = await partyTableLabels(tx, [...new Set(survivorOf.values())]);
  return new Map(
    partyIds.map((id) => [
      id,
      own.get(id)!.length > 0 ? own.get(id)! : survivors.get(survivorOf.get(id)!)!,
    ]),
  );
}
