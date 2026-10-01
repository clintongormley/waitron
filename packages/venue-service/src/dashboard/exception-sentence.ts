import { currentLocale } from "@waitron/dashboard-kit";
import type { RouteException } from "../routing.js";

export interface ExceptionNames {
  categories: readonly { id: string; name: string }[];
  products: readonly { id: string; name: string }[];
  zones: readonly { id: string; name: string }[];
  stations: readonly { id: string; name: string; active: boolean }[];
}

export function exceptionSentence(exception: RouteException, names: ExceptionNames): string {
  const spanish = currentLocale().startsWith("es");
  const find = (rows: readonly { id: string; name: string }[], id: string) =>
    rows.find((row) => row.id === id)?.name ?? id;
  const what = exception.categoryId
    ? find(names.categories, exception.categoryId).split(" › ").at(-1)!
    : exception.productId
      ? find(names.products, exception.productId)
      : spanish
        ? "Todo"
        : "Everything";
  const zone = exception.zoneId
    ? ` ${spanish ? "desde" : "from"} ${find(names.zones, exception.zoneId)}`
    : "";
  const target =
    exception.target.kind === "no_preparation"
      ? spanish
        ? "Sin preparación"
        : "No preparation"
      : find(names.stations, exception.target.stationId);
  return `${what}${zone} → ${target}`;
}
