import { createLabelComparator, type DeleteImpactItem, type DeleteTarget } from "@waitron/shared";

/** One item naming each distinct target once; its count is how many distinct rows it affects. */
export function named(key: string, targets: DeleteTarget[]): DeleteImpactItem {
  const unique = [...new Map(targets.map((target) => [target.id, target])).values()];
  const compare = createLabelComparator();
  unique.sort((a, b) => compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { key, count: unique.length, targets: unique };
}
