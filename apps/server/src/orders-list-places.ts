import { orderPlaceFactsSql, type OrderPlaceFacts, type Transaction } from "@waitron/db";
import { sql } from "drizzle-orm";

export const LIVE_ORDER_PLACE = sql`r.kind = 'bill' and r.status in ('open', 'waiting_for_payment')`;
const livePlace = orderPlaceFactsSql(sql`r.party_id`, sql`r.delivery_table_id`, {
  searchable: true,
});
export const liveSearchTableNames = sql`(${livePlace} -> '$.searchNames')`;

export function recordedTableNamesSql(partyId: SQL) {
  return sql`(select json_group_array(distinct d.label order by pt.joined_at, pt.rowid)
    from party_tables pt join dining_tables d on d.id = pt.table_id where pt.party_id = ${partyId})`;
}

export function ordersWordRank(words: string) {
  return sql`case when ${LIVE_ORDER_PLACE} then (
      with place as materialized (select ${livePlace} as facts)
      select waitron_search_rank(${words}, r.bill_name, facts ->> '$.sittingWith',
        (select group_concat(value, ' ') from json_each(facts -> '$.searchNames'))) from place
    )
    else waitron_search_rank(${words}, r.party_name, r.delivery_label,
      coalesce(
        (select group_concat(dt.label, ' ') from party_tables pt join dining_tables dt on dt.id = pt.table_id
          where pt.party_id = r.party_id),
        (select group_concat(n.value, ' ') from json_each(r.party_table_names) n))) end`;
}

export async function readOrderListPlaces(
  tx: Transaction,
  orders: readonly { id: string; live: boolean }[],
): Promise<Map<string, { names: string[]; partyName: string | null }>> {
  if (orders.length === 0) return new Map();
  const { rows } = await tx.execute<{
    id: string;
    place: string | null;
    historical: string | null;
  }>(sql`
    select wo.id,
      case when j.value ->> 'live' then ${orderPlaceFactsSql(sql`wo.party_id`, sql`wo.delivery_table_id`)} end as place,
      case when not (j.value ->> 'live') then ${recordedTableNamesSql(sql`wo.party_id`)} end as historical
    from json_each(${JSON.stringify(orders)}) j join working_orders wo on wo.id = j.value ->> 'id'
  `);
  return new Map(
    rows.map(({ id, place, historical }) => {
      if (place === null)
        return [id, { names: JSON.parse(historical!) as string[], partyName: null }];
      const { names, sittingWith } = JSON.parse(place) as OrderPlaceFacts;
      return [id, { names, partyName: sittingWith }];
    }),
  );
}
