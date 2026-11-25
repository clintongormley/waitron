import { readOrderPlaces, type OrderPlaces, type Transaction } from "@waitron/db";
import { partyTablesName } from "@waitron/shared";

type DisplayPlace = Pick<OrderPlaces, "names" | "partyName" | "billName" | "counter">;

export function currentOrderLabel(
  place: DisplayPlace | undefined,
  savedLabel?: string | null,
): string | null {
  if (place === undefined) return null;
  if (savedLabel !== undefined && !place.counter && place.names.length === 0) return savedLabel;
  const tables = new Set(place.names.filter(Boolean));
  const typedNames = new Set(
    [place.partyName, place.billName].filter((name) => name && !tables.has(name)),
  );
  return [partyTablesName([...tables]), ...typedNames].filter(Boolean).join(" · ") || null;
}

export function refusalOrderName(orderNumber: number, place: DisplayPlace | undefined): string {
  return [`#${orderNumber}`, currentOrderLabel(place)].filter(Boolean).join(" · ");
}

export async function withPaymentOrderLabels<
  T extends { workingOrderId: string; label: string | null },
>(tx: Transaction, rows: T[]) {
  const places = await readOrderPlaces(
    tx,
    rows.map((row) => row.workingOrderId),
  );
  return rows.map((row) => ({
    ...row,
    label: currentOrderLabel(places.get(row.workingOrderId), row.label),
  }));
}
