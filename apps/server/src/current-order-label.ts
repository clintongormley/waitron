import { readOrderPlaces, workingOrders, type OrderPlaces, type Transaction } from "@waitron/db";
import { partyTablesName } from "@waitron/shared";

type DisplayPlace = Pick<OrderPlaces, "names" | "partyName" | "billName" | "counter">;

function recordedOrderLabel(savedLabel: string | null, billName: string | null): string | null {
  return [...new Set([savedLabel, billName])].filter(Boolean).join(" · ") || null;
}

export function currentOrderLabel(
  place: DisplayPlace | undefined,
  savedLabel?: string | null,
): string | null {
  if (place === undefined) return null;
  if (savedLabel !== undefined && !place.counter && place.names.length === 0)
    return recordedOrderLabel(savedLabel, place.billName);
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
  collectedAt: workingOrders.collectedAt,
  deliveryTableId: workingOrders.deliveryTableId,
  deliveryTableLabel: workingOrders.deliveryTableLabel,
};

export async function withPaymentOrderLabels<
  T extends {
    workingOrderId: string;
    label: string | null;
    collectedAt: string | null;
    deliveryTableId: string | null;
    deliveryTableLabel: string | null;
  },
>(tx: Transaction, rows: T[]) {
  const places = await readOrderPlaces(
    tx,
    rows.map((row) => row.workingOrderId),
  );
  return rows.map(({ collectedAt, deliveryTableId, deliveryTableLabel, ...row }) => {
    const place = places.get(row.workingOrderId);
    const collectedDelivery =
      collectedAt !== null && (deliveryTableId !== null || deliveryTableLabel !== null);
    return {
      ...row,
      label: collectedDelivery
        ? recordedOrderLabel(row.label ?? deliveryTableLabel, place?.billName ?? null)
        : currentOrderLabel(place, row.label),
    };
  });
}
