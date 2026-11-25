import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "./client.js";

/** The live place and names of an order. */
export interface OrderPlaces {
  orderNumber: number;
  tables: { id: string; name: string }[];
  tableShortNames?: string[];
  names: string[];
  counter: boolean;
  partyName: string | null;
  billName: string | null;
}

export interface PlacedOrder {
  places: OrderPlaces;
  partyId: string | null;
  takeAway: boolean;
  sittingWith: string | null;
}

export interface OrderPlaceFacts {
  tables: { id: string; name: string; shortName: string }[];
  names: string[];
  partyName: string | null;
  sittingWith: string | null;
}

/**
 * A party's own active seats win. Once it has let them all go, follow its merges to the last party.
 * A bill without a party uses only its delivery table. Saved receipt labels can name a former place.
 */
export function orderPlaceFactsSql(
  partyId: SQL,
  deliveryTableId: SQL,
  { searchable = false }: { searchable?: boolean } = {},
): SQL<string> {
  const searchNames = searchable
    ? sql`'searchNames', json((select json_group_array(value) from (
        select shown as value from at_tables union select name from at_tables union select label from at_tables
      ))),`
    : sql``;
  return sql`(
    with recursive chain(id, next, name) as (
      select id, merged_into_party_id, name from parties where id = ${partyId}
      union
      select p.id, p.merged_into_party_id, p.name from parties p join chain c on p.id = c.next
    ), sitting as (
      select case when exists (
        select 1 from party_tables own where own.party_id = ${partyId} and own.left_at is null
      ) then ${partyId} else (select id from chain where next is null) end as id
    ), seats(table_id, joined_at, row_order) as (
      select pt.table_id, pt.joined_at, pt.rowid from party_tables pt join sitting s on s.id = pt.party_id
        where pt.left_at is null
      union all
      select ${deliveryTableId}, '', 0 where ${partyId} is null and ${deliveryTableId} is not null
    ), at_tables as (
      select d.id, d.label, coalesce(d.today_name, d.label) as name, coalesce(d.short_name, d.label) as short_name,
        coalesce(g.name, d.today_name, d.label) as shown, s.joined_at, s.row_order,
        row_number() over (
          partition by g.name is not null, case when g.name is null then d.id else g.id end
          order by s.joined_at, s.row_order
        ) as group_member
      from seats s join dining_tables d on d.id = s.table_id left join table_merges g on g.id = d.merge_id
    )
    select json_object(
      'tables', json((select json_group_array(json_object('id', id, 'name', name, 'shortName', short_name)
        order by joined_at, row_order) from at_tables)),
      'names', json((select json_group_array(shown order by joined_at, row_order) from at_tables where group_member = 1)),
      ${searchNames}
      'partyName', (select name from chain where id = ${partyId}),
      'sittingWith', (select name from chain
        where next is null or (id = ${partyId} and not exists (select 1 from chain where next is null))
      )
    )
  )`;
}

/** An id that names no order has no entry. */
export async function readPlacedOrders(
  tx: Transaction,
  orderIds: readonly string[],
  { withShortNames = false }: { withShortNames?: boolean } = {},
): Promise<Map<string, PlacedOrder>> {
  if (orderIds.length === 0) return new Map();
  const { rows } = await tx.execute<{
    id: string;
    order_number: number;
    party_id: string | null;
    delivery_table_id: string | null;
    bill_name: string | null;
    dining: string;
    place: string;
  }>(sql`
    select wo.id, wo.order_number, wo.party_id, wo.delivery_table_id, wo.bill_name, wo.dining,
      ${orderPlaceFactsSql(sql`wo.party_id`, sql`wo.delivery_table_id`)} as place
    from working_orders wo where wo.id in (select value from json_each(${JSON.stringify(orderIds)}))
  `);
  return new Map(
    rows.map((row) => {
      const { tables, names, partyName, sittingWith } = JSON.parse(row.place) as OrderPlaceFacts;
      return [
        row.id,
        {
          partyId: row.party_id,
          takeAway: row.dining === "takeaway",
          sittingWith,
          places: {
            orderNumber: row.order_number,
            tables: tables.map(({ id, name }) => ({ id, name })),
            ...(withShortNames && tables.length > 0
              ? { tableShortNames: tables.map((table) => table.shortName) }
              : {}),
            names,
            counter: row.party_id === null && row.delivery_table_id === null,
            partyName,
            billName: row.bill_name,
          },
        },
      ];
    }),
  );
}

export async function readOrderPlaces(
  tx: Transaction,
  orderIds: readonly string[],
  options?: { withShortNames?: boolean },
): Promise<Map<string, OrderPlaces>> {
  const placed = await readPlacedOrders(tx, orderIds, options);
  return new Map([...placed].map(([id, order]) => [id, order.places]));
}
