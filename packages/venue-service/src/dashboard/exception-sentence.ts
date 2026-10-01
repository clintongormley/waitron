import { t } from "./strings.js";
import type { RouteException } from "../routing.js";

export interface ExceptionNames {
  categories: readonly { id: string; name: string }[];
  products: readonly { id: string; name: string }[];
  zones: readonly { id: string; name: string }[];
  stations: readonly { id: string; name: string; active: boolean }[];
}

export function exceptionSentence(exception: RouteException, names: ExceptionNames): string {
  const find = (rows: readonly { id: string; name: string }[], id: string) =>
    rows.find((row) => row.id === id)?.name ?? id;
  const what = exception.categoryId
    ? find(names.categories, exception.categoryId).split(" › ").at(-1)!
    : exception.productId
      ? find(names.products, exception.productId)
      : t("prep.everything");
  const zone = exception.zoneId
    ? t("prep.exception_from_zone").replace("{zone}", find(names.zones, exception.zoneId))
    : "";
  const target =
    exception.target.kind === "no_preparation"
      ? t("prep.no_preparation")
      : find(names.stations, exception.target.stationId);
  return t("prep.exception_sentence")
    .replace("{what}", what)
    .replace("{zone}", zone)
    .replace("{target}", target);
}
