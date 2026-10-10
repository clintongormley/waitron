import { createLabelComparator, type DeleteImpactItem, type DeleteTarget } from "@waitron/shared";

/** Each distinct target once, by id, sorted by name then id. */
export function distinctTargets(targets: DeleteTarget[]): DeleteTarget[] {
  const unique = [...new Map(targets.map((target) => [target.id, target])).values()];
  const compare = createLabelComparator();
  return unique.sort((a, b) => compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One item naming each distinct target once; its count is how many distinct rows it affects. */
export function named(key: string, targets: DeleteTarget[]): DeleteImpactItem {
  const unique = distinctTargets(targets);
  return { key, count: unique.length, targets: unique };
}
