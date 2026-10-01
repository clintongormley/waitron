import { formatMoney, type Decimal } from "@waitron/shared";
import type { Setting, ValueSource, Place } from "../api/client.js";
import { currentLocale } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
type Translate = (key: StringKey) => string;
export interface SourceNames {
  product: string;
}
const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
export function placeName(place: Place, t: Translate): string {
  return place.kind === "menu" ? place.menuName : t("menu_prices.own_sections");
}
function sourceText(source: ValueSource, names: SourceNames, t: Translate, nested = false): string {
  switch (source.kind) {
    case "product":
      return t(nested ? "menu_prices.source_uses_product" : "menu_prices.source_product");
    case "parent":
      return fill(t(nested ? "menu_prices.source_uses_parent" : "menu_prices.source_parent"), {
        name: names.product,
      });
    case "own":
      return t(nested ? "menu_prices.source_sets_own" : "menu_prices.source_own");
    case "menu":
      return fill(t(nested ? "menu_prices.source_takes_menu" : "menu_prices.source_menu"), {
        menu: source.menuName,
        from: sourceText(source.from, names, t, true),
      });
  }
}
export function describeSetting(
  setting: Setting<Decimal>,
  names: SourceNames,
  t: Translate,
): string {
  const money = (value: Decimal) => formatMoney(value, currentLocale());
  const candidates = (clash: Extract<Setting<Decimal>, { state: "clash" }>) =>
    clash.candidates
      .map((candidate) =>
        fill(t("menu_prices.source_candidate"), {
          price: "value" in candidate ? money(candidate.value) : t("menu_prices.clash"),
          place: placeName(candidate.place, t),
        }),
      )
      .join(", ");
  if (setting.state === "clash")
    return fill(t("menu_prices.source_clash"), { candidates: candidates(setting) });
  if (setting.source.kind !== "own") return `${sourceText(setting.source, names, t)}.`;
  const own = fill(t("menu_prices.source_set"), { price: money(setting.value) });
  const otherwise = setting.otherwise;
  if (otherwise === null) return own;
  if (otherwise.state === "clash")
    return `${own} ${fill(t("menu_prices.source_without_clash"), { candidates: candidates(otherwise) })}`;
  return `${own} ${fill(t("menu_prices.source_without"), { price: money(otherwise.value), source: sourceText(otherwise.source, names, t).replace(/^./, (letter) => letter.toLocaleLowerCase(currentLocale())) })}`;
}
