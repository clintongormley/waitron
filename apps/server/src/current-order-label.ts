import { sql } from "drizzle-orm";
import { readOrderPlaces, workingOrders, type OrderPlaces, type Transaction } from "@waitron/db";
import { partyTablesName } from "@waitron/shared";

type DisplayPlace = Pick<OrderPlaces, "names" | "partyName" | "billName" | "counter">;

function recordedOrderLabel(savedLabel: string | null, place?: DisplayPlace): string | null {
  const billName = place?.billName;
  if (billName === place?.partyName && savedLabel?.startsWith(`${billName} · `)) return savedLabel;
  return [...new Set([savedLabel, billName])].filter(Boolean).join(" · ") || null;
}

export function currentOrderLabel(
  place: DisplayPlace | undefined,
  savedLabel?: string | null,
): string | null {
  if (place === undefined) return null;
  if (savedLabel !== undefined && !place.counter && place.names.length === 0)
    return recordedOrderLabel(savedLabel, place);
  const tables = new Set(place.names.filter(Boolean));
  const typedNames = new Set(
    [place.partyName, place.billName].filter((name) => name && !tables.has(name)),
  );
  return [partyTablesName([...tables]), ...typedNames].filter(Boolean).join(" · ") || null;
}

export function refusalOrderName(orderNumber: number, place: DisplayPlace | undefined): string {
  return [`#${orderNumber}`, currentOrderLabel(place)].filter(Boolean).join(" · ");
}

export const paymentOrderLabelFields = {
  label: workingOrders.label,
  recordedDeliveryLabel: sql<string | null>`case when ${workingOrders.partyId} is null and (
    (${workingOrders.deliveryTableId} is null and ${workingOrders.deliveryTableLabel} is not null)
    or (${workingOrders.deliveryTableId} is not null and ${workingOrders.status} = 'settled' and ${workingOrders.collectedAt} is not null)
  ) then coalesce(${workingOrders.label}, ${workingOrders.deliveryTableLabel}) end`,
};

export async function withPaymentOrderLabels<
  T extends { workingOrderId: string; label: string | null; recordedDeliveryLabel: string | null },
>(tx: Transaction, rows: T[]) {
  const places = await readOrderPlaces(
    tx,
    rows.map((row) => row.workingOrderId),
  );
  return rows.map(({ recordedDeliveryLabel, ...row }) => {
    const place = places.get(row.workingOrderId);
    return {
      ...row,
      label:
        recordedDeliveryLabel === null
          ? currentOrderLabel(place, row.label)
          : recordedOrderLabel(recordedDeliveryLabel, place),
    };
  });
}
