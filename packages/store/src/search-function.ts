import type { DatabaseSync } from "node:sqlite";
import { foldForSearch, searchRankKey, textSearch, type TextSearch } from "@waitron/shared";

/**
 * `waitron_search_rank(query, part1, part2, …)`: NULL when the parts do not match the query or the
 * query is NULL or not text, `searchRankKey(rank)` when they match, 0 for a blank query. A part that
 * is NULL or not text counts as an empty part, so the parts after it keep their indexes. The query
 * is compiled once per run of calls with the same query, not once per row.
 */
export function registerSearchFunction(connection: DatabaseSync): void {
  let lastQuery: string | undefined;
  let lastSearch: TextSearch | undefined;
  connection.function(
    "waitron_search_rank",
    { deterministic: true, varargs: true },
    (query, ...parts) => {
      if (typeof query !== "string") return null;
      if (query !== lastQuery) {
        lastQuery = query;
        lastSearch = textSearch(query);
      }
      if (lastSearch === undefined) return 0;
      const rank = lastSearch.rank(
        parts.map((part) => (typeof part === "string" ? foldForSearch(part) : "")),
      );
      return rank === undefined ? null : searchRankKey(rank);
    },
  );
}
