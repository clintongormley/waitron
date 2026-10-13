import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { partyTablesName } from "@waitron/shared";
import type { Transaction } from "./client.js";
import { diningTables } from "./schema/dining-tables.js";
import { floorTodayJoins, floorTodayJoinTables, floorTodayTables } from "./schema/floor-plans.js";
import { partyTables } from "./schema/parties.js";

const shownName = {
  label: diningTables.label,
  name: floorTodayTables.name,
  joinName: floorTodayJoins.name,
};

function shown(row: { label: string; name: string | null; joinName: string | null }): string {
  return row.joinName ?? row.name ?? row.label;
}

/**
 * Each party's active tables' shown names ({@link shownTableNames}), in the order the tables joined
 * it, a group's name once.
 */
export async function partyTableLabels(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, string[]>> {
  const labels = new Map(partyIds.map((id) => [id, [] as string[]]));
  if (partyIds.length === 0) return labels;
  const rows = await tx
    .select({ partyId: partyTables.partyId, ...shownName })
    .from(partyTables)
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .leftJoin(floorTodayTables, eq(floorTodayTables.tableId, partyTables.tableId))
    .leftJoin(floorTodayJoinTables, eq(floorTodayJoinTables.tableId, partyTables.tableId))
    .leftJoin(floorTodayJoins, eq(floorTodayJoins.id, floorTodayJoinTables.joinId))
    .where(and(inArray(partyTables.partyId, [...partyIds]), isNull(partyTables.leftAt)))
    .orderBy(partyTables.joinedAt, partyTables.id);
  for (const row of rows) {
    const list = labels.get(row.partyId)!;
    const name = shown(row);
    if (!list.includes(name)) list.push(name);
  }
  return labels;
}

/** Each of `tableIds`' shown name (D10): its group's today's name, else its own, else its saved label. */
export async function shownTableNames(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<Map<string, string>> {
  if (tableIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: diningTables.id, ...shownName })
    .from(diningTables)
    .leftJoin(floorTodayTables, eq(floorTodayTables.tableId, diningTables.id))
    .leftJoin(floorTodayJoinTables, eq(floorTodayJoinTables.tableId, diningTables.id))
    .leftJoin(floorTodayJoins, eq(floorTodayJoins.id, floorTodayJoinTables.joinId))
    .where(inArray(diningTables.id, [...tableIds]));
  return new Map(rows.map((row) => [row.id, shown(row)]));
}

/**
 * The party each of `partyIds` was merged into, following the chain of merges to its end, keyed by
 * each party asked about; a party never merged answers itself, and one whose chain has no end (a
 * cycle of merges, or no such party) has no entry.
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
 * at the end of the chain of merges; empty when that party holds none either, or when the chain has
 * no end (a cycle of merges, or no such party).
 */
export async function billPartyTableLabels(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, string[]>> {
  const labels = await partyTableLabels(tx, partyIds);
  const seatless = partyIds.filter((id) => labels.get(id)!.length === 0);
  if (seatless.length === 0) return labels;
  const survivorOf = await partySurvivors(tx, seatless);
  const unread = [...new Set(survivorOf.values())].filter((id) => !labels.has(id));
  const survivors = await partyTableLabels(tx, unread);
  for (const id of seatless) {
    const survivor = survivorOf.get(id);
    if (survivor !== undefined) labels.set(id, labels.get(survivor) ?? survivors.get(survivor)!);
  }
  return labels;
}

/** What {@link orderTableLabels} reads of an order. */
interface LabelledOrder {
  id: string;
  partyId: string | null;
  deliveryTableId: string | null;
  deliveryTableLabel: string | null;
  label: string | null;
}

/**
 * The table each order belongs to, keyed by order. A party bill names the tables
 * {@link billPartyTableLabels} gives its party, together ({@link partyTablesName}), or its own label
 * when that list is empty. Any other order names the shown name ({@link shownTableNames}) of the
 * table of `locationId` it is delivered to, else the name kept when that table was let go, else its
 * own label; null for an unlabelled walk-up.
 */
export async function orderTableLabels(
  tx: Transaction,
  locationId: string,
  orders: readonly LabelledOrder[],
): Promise<Map<string, string | null>> {
  const partyIds = [...new Set(orders.flatMap((order) => order.partyId ?? []))];
  const byParty = await billPartyTableLabels(tx, partyIds);
  const deliveredTo = [
    ...new Set(
      orders.flatMap((order) => (order.partyId === null ? (order.deliveryTableId ?? []) : [])),
    ),
  ];
  const inLocation =
    deliveredTo.length === 0
      ? []
      : await tx
          .select({ id: diningTables.id })
          .from(diningTables)
          .where(
            and(eq(diningTables.locationId, locationId), inArray(diningTables.id, deliveredTo)),
          );
  const shownById = await shownTableNames(
    tx,
    inLocation.map((table) => table.id),
  );
  const labels = new Map<string, string | null>();
  for (const order of orders) {
    if (order.partyId !== null) {
      const partyLabels = byParty.get(order.partyId)!;
      labels.set(order.id, partyLabels.length === 0 ? order.label : partyTablesName(partyLabels));
      continue;
    }
    const name = order.deliveryTableId === null ? undefined : shownById.get(order.deliveryTableId);
    labels.set(order.id, name ?? order.deliveryTableLabel ?? order.label);
  }
  return labels;
}
