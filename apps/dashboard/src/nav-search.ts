import { foldForSearch, searchFor } from "@waitron/shared";

/** A group's pages for a nav search: those whose own label matches, closest first, then those that
 * match only with the group's heading, closest first. A blank search keeps every page. */
export function navMatches<Page extends { label: string }>(
  query: string,
  pages: readonly Page[],
  heading: string,
): Page[] {
  const search = searchFor(query);
  const folded = pages.map((page) => [page, foldForSearch(page.label)] as const);
  const own = search(folded);
  const found = new Set(own);
  const foldedHeading = foldForSearch(heading);
  const withHeading = search(
    folded.flatMap(([page, label]) =>
      found.has(page) ? [] : [[page, [label, foldedHeading]] as const],
    ),
  );
  return [...own, ...withHeading];
}
