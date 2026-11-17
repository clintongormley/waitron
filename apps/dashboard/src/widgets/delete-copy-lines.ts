import { deleteTargetName } from "@waitron/shared";
import type { DeleteImpactItem, DeleteTarget } from "@waitron/shared";
import type { StringKey } from "../i18n/strings.js";
import { fill, t } from "../i18n/t.js";

type CountedKey = { [K in StringKey]: `${K}_one` extends StringKey ? K : never }[StringKey];

export function deleteTargetNames(targets: readonly DeleteTarget[]): string {
  return targets.map((target) => deleteTargetName(target, t("delete.deleted"))).join(", ");
}

export function countedDeleteLine(
  key: CountedKey,
  item: DeleteImpactItem,
  extra: Readonly<Record<string, string>> = {},
): string {
  return fill(item.count === 1 ? `${key}_one` : key, {
    ...extra,
    count: String(item.count),
    names: deleteTargetNames(item.targets),
  });
}
