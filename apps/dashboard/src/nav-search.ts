import { foldForSearch, searchFor, textSearch } from "@waitron/shared";

/** A group's pages for a nav search: those whose own label matches, closest first, then those that
 * match only with the group's heading, closest first and in nav order where equally close. A blank
 * search keeps every page. */
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
    // Not by length, as compareSearchRanks would: a shorter label is no closer a match.
    .sort(
      (left, right) =>
        left.rank.kind - right.rank.kind ||
        left.rank.part - right.rank.part ||
        left.rank.position - right.rank.position,
    );
  return [...own, ...withHeading.map(({ page }) => page)];
}
