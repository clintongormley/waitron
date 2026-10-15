import { foldForSearch, searchFor, textSearch } from "@waitron/shared";

/** A group's pages for a nav search: those whose own label matches, closest first, then those that
 * match only with the group's heading, by match kind, part and position (not length), then in nav
 * order. A blank search keeps every page. */
export function navMatches<Page extends { label: string }>(
  query: string,
  pages: readonly Page[],
  heading: string,
): Page[] {
  const folded = pages.map((page) => [page, foldForSearch(page.label)] as const);
  const own = searchFor(query)(folded);
  const search = textSearch(query);
  if (search === undefined) return own;
  const found = new Set(own);
  const foldedHeading = foldForSearch(heading);
  const withHeading = folded
    .flatMap(([page, label]) => {
      const rank = found.has(page) ? undefined : search.rank([label, foldedHeading]);
      return rank === undefined ? [] : [{ page, rank }];
    })
    // Length is left out so pages tied on the heading alone keep nav order.
    .sort(
      (left, right) =>
        left.rank.kind - right.rank.kind ||
        left.rank.part - right.rank.part ||
        left.rank.position - right.rank.position,
    );
  return [...own, ...withHeading.map(({ page }) => page)];
}

export interface NavSearchDestination {
  id: string;
  screen: string;
  label: string;
  pageLabel: string;
  heading: string;
  href: string;
}

export function destinationMatches(
  query: string,
  items: readonly NavSearchDestination[],
): NavSearchDestination[] {
  if (query.trim() === "") return [];
  const own = navMatches(query, items, "");
  const found = new Set(own.map((item) => item.id));
  const combined = items.map((item) => ({
    ...item,
    label: `${item.label} ${item.pageLabel} ${item.heading}`,
  }));
  const remaining = navMatches(query, combined, "").filter((item) => !found.has(item.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  return [...own, ...remaining.map((item) => byId.get(item.id)!)];
}
