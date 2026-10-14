import { type SQL, and, eq, inArray, isNull, sql } from "drizzle-orm";
import { partyTablesName } from "@waitron/shared";
import type { Transaction } from "./client.js";
import { diningTables } from "./schema/dining-tables.js";
import { floorTodayJoins, floorTodayJoinTables, floorTodayTables } from "./schema/floor-plans.js";
import { partyTables } from "./schema/parties.js";

function shown(row: { label: string; name: string | null; joinName: string | null }): string {
  return row.joinName ?? row.name ?? row.label;
}

function readShownNames(tx: Transaction, where: SQL | undefined) {
  return tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      name: floorTodayTables.name,
      joinName: floorTodayJoins.name,
    })
    .from(diningTables)
    .leftJoin(floorTodayTables, eq(floorTodayTables.tableId, diningTables.id))
    .leftJoin(floorTodayJoinTables, eq(floorTodayJoinTables.tableId, diningTables.id))
    .leftJoin(floorTodayJoins, eq(floorTodayJoins.id, floorTodayJoinTables.joinId))
    .where(where);
}

/** A party's active table, with the names {@link partyTableLabels} and {@link tableNames} read. */
interface ActiveTable {
  id: string;
  label: string;
  name: string | null;
  joinId: string | null;
  joinName: string | null;
}

/** Each party's active tables, in the order they joined it, keyed by each party asked about. */
async function readActiveTables(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, ActiveTable[]>> {
  const byParty = new Map(partyIds.map((id) => [id, [] as ActiveTable[]]));
  if (partyIds.length === 0) return byParty;
  const rows = await tx
    .select({
      partyId: partyTables.partyId,
      id: partyTables.tableId,
      label: diningTables.label,
      name: floorTodayTables.name,
      joinId: floorTodayJoins.id,
      joinName: floorTodayJoins.name,
    })
    .from(partyTables)
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .leftJoin(floorTodayTables, eq(floorTodayTables.tableId, partyTables.tableId))
    .leftJoin(floorTodayJoinTables, eq(floorTodayJoinTables.tableId, partyTables.tableId))
    .leftJoin(floorTodayJoins, eq(floorTodayJoins.id, floorTodayJoinTables.joinId))
    .where(and(inArray(partyTables.partyId, [...partyIds]), isNull(partyTables.leftAt)))
    .orderBy(partyTables.joinedAt, sql`${partyTables}.rowid`);
  for (const { partyId, ...table } of rows) byParty.get(partyId)!.push(table);
  return byParty;
}

/** One party's tables' shown names, a named group's name once. */
function shownLabels(tables: readonly ActiveTable[]): string[] {
  const listedGroups = new Set<string | null>();
  const labels: string[] = [];
  for (const table of tables) {
    if (table.joinName !== null) {
      if (listedGroups.has(table.joinId)) continue;
      listedGroups.add(table.joinId);
    }
    labels.push(shown(table));
  }
  return labels;
}

function namesOf(table: ActiveTable): TableNames {
  return { id: table.id, name: table.name ?? table.label, shown: shown(table) };
}

function mapValues<T, U>(map: ReadonlyMap<string, T>, to: (value: T) => U): Map<string, U> {
  return new Map([...map].map(([key, value]) => [key, to(value)]));
}

/**
 * Each party's active tables' shown names — its group's today's name, else its own, else its saved
 * label — in the order the tables joined it, a named group's name once.
 */
export async function partyTableLabels(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, string[]>> {
  return mapValues(await readActiveTables(tx, partyIds), shownLabels);
}

/** A table's own name (today's, else its saved label) and its shown name ({@link partyTableLabels}). */
export interface TableNames {
  id: string;
  name: string;
  shown: string;
}

/** Each of `tableIds` that exists, by its own name and its shown name, in any location. */
export async function tableNames(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<Map<string, TableNames>> {
  if (tableIds.length === 0) return new Map();
  const rows = await readShownNames(tx, inArray(diningTables.id, [...tableIds]));
  return new Map(
    rows.map((row) => [row.id, { id: row.id, name: row.name ?? row.label, shown: shown(row) }]),
  );
}

/** The party at the end of each party's chain of merges, by id and name ({@link partySurvivors}). */
async function readSurvivors(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, { id: string; name: string | null }>> {
  const { rows } = await tx.execute<{ start: string; id: string; name: string | null }>(sql`
    with recursive chain(start, id, next, name) as (
      select p.id, p.id, p.merged_into_party_id, p.name from parties p
      where p.id in (select value from json_each(${JSON.stringify(partyIds)}))
      union
      select c.start, p.id, p.merged_into_party_id, p.name from parties p join chain c on p.id = c.next
    )
    select start, id, name from chain where next is null
  `);
  return new Map(rows.map((row) => [row.start, { id: row.id, name: row.name }]));
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
  return mapValues(await readSurvivors(tx, partyIds), (end) => end.id);
}

/**
 * The tables each party's bill is at: its active tables, or, once it holds none, those of the party
 * at the end of its merges as `survivorOf` gives it (else as {@link partySurvivors} reads it); empty
 * when that party holds none either, or when the chain has no end.
 */
async function billActiveTables(
  tx: Transaction,
  partyIds: readonly string[],
  survivorOf?: ReadonlyMap<string, string>,
): Promise<Map<string, ActiveTable[]>> {
  const tables = await readActiveTables(tx, partyIds);
  const seatless = partyIds.filter((id) => tables.get(id)!.length === 0);
  if (seatless.length === 0) return tables;
  const ends = survivorOf ?? (await partySurvivors(tx, seatless));
  const unread = [...new Set(seatless.flatMap((id) => ends.get(id) ?? []))].filter(
    (id) => !tables.has(id),
  );
  const survivors = await readActiveTables(tx, unread);
  for (const id of seatless) {
    const end = ends.get(id);
    if (end !== undefined) tables.set(id, tables.get(end) ?? survivors.get(end)!);
  }
  return tables;
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
  return mapValues(await billActiveTables(tx, partyIds), shownLabels);
}

/**
 * The tables a party's bill is at, keyed by each party asked about, as {@link billPartyTableLabels}
 * chooses them — the party's active tables, else those of the party at the end of its merges — each
 * by {@link tableNames}; empty under the same conditions.
 */
export async function billPartyTables(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, TableNames[]>> {
  return mapValues(await billActiveTables(tx, partyIds), (tables) => tables.map(namesOf));
}

/** Where a party's bill is: {@link billPartyTables}, {@link billPartyTableLabels}, and its survivor. */
export interface BillParty {
  tables: TableNames[];
  labels: string[];
  /** The party at the end of its merges ({@link partySurvivors}); undefined when there is none. */
  survivor: { id: string; name: string | null } | undefined;
}

/** {@link BillParty} for each of `partyIds`, keyed by party. */
export async function billParties(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, BillParty>> {
  if (partyIds.length === 0) return new Map();
  const survivors = await readSurvivors(tx, partyIds);
  const tables = await billActiveTables(
    tx,
    partyIds,
    mapValues(survivors, (end) => end.id),
  );
  return new Map(
    [...tables].map(([id, held]) => [
      id,
      { tables: held.map(namesOf), labels: shownLabels(held), survivor: survivors.get(id) },
    ]),
  );
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
 * when that list is empty. Any other order names the shown name, as {@link partyTableLabels} reads
 * it, of the table of `locationId` it is delivered to, else the name kept when that table was let
 * go, else its own label; null for an unlabelled walk-up.
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
  const shownById = new Map(
    deliveredTo.length === 0
      ? []
      : (
          await readShownNames(
            tx,
            and(eq(diningTables.locationId, locationId), inArray(diningTables.id, deliveredTo)),
          )
        ).map((row) => [row.id, shown(row)]),
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
