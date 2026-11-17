import { deleteTargetName } from "@waitron/shared";
import type { DeleteImpactItem, DeleteTarget } from "@waitron/shared";
import type { StringKey } from "../i18n/strings.js";
import { fill, t } from "../i18n/t.js";

/** The targets' names, each deleted one marked, joined for a delete dialog line. */
export function deleteTargetNames(targets: readonly DeleteTarget[]): string {
  return targets.map((target) => deleteTargetName(target, t("delete.deleted"))).join(", ");
}

/** The item's line under `key`, or under `${key}_one` when it counts exactly one. */
export function countedDeleteLine(
  key: StringKey,
  item: DeleteImpactItem,
  extra: Readonly<Record<string, string>> = {},
): string {
  return fill(item.count === 1 ? (`${key}_one` as StringKey) : key, {
    ...extra,
    count: String(item.count),
    names: deleteTargetNames(item.targets),
  });
}
