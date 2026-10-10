import { foldForSearch, searchFor, textSearch } from "@waitron/shared";

/** A group's pages for a nav search: those whose own label matches, closest first, then those that
 * match only with the group's heading, in the group's order. A blank search keeps every page. */
export function navMatches<Page extends { label: string }>(
  query: string,
  pages: readonly Page[],
  heading: string,
): Page[] {
  const own = searchFor(query)(pages.map((page) => [page, foldForSearch(page.label)] as const));
  const search = textSearch(query);
  if (search === undefined) return own;
  const found = new Set(own);
  const folded = foldForSearch(heading);
  return [
    ...own,
    ...pages.filter(
      (page) => !found.has(page) && search.rank([foldForSearch(page.label), folded]) !== undefined,
    ),
  ];
}
