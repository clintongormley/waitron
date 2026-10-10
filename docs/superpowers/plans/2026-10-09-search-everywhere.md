# Every search follows one rule — implementation plan

> 2026-10-10: [A461's plan](../plans/2026-10-10-a461-product-search.md) supersedes
> Products and Menus Structure tree-search presentation and selection lifetime, and adds matching
> sections to the till's results. Search closeness and table-sort ties remain unchanged.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every typed search in Waitron matches every word typed in any order, ignoring accents,
capitals and punctuation, shows nothing for a search of only punctuation, and lists the closest
matches first.

**Architecture:** One matcher in `@waitron/shared` (`text-search.ts`) replaces the copy in
`@waitron/catalogue`. The shared table (`wt-data-table`) and dropdown (`wt-combobox`) use it, which
brings most screens into line; the screens with their own filter code move to it one by one; the
image library replaces its query grammar with it; the venue store registers it as a SQL function,
`waitron_search_rank`, so the Orders list, Find a bill and Find an invoice filter and order in SQL.

**Tech Stack:** TypeScript, Lit web components, Vitest (browser mode for `packages/ui` and
`apps/dashboard`, `apps/till`), `node:sqlite` through drizzle-orm, Hono.

**Spec:** `docs/superpowers/specs/2026-10-09-search-everywhere-design.md` — read it first; this plan
argues from it.

**Worktree and branch:** `~/workspace/worktrees/waitron-search-everywhere`, branch
`search-everywhere` (already created; the spec is its first commit).

## Global Constraints

- Owner decisions (2026-10-09), verbatim from the spec: every typed search uses #1478's rule; a
  search of only punctuation shows nothing; a search of only spaces is no search; closest matches
  first, everywhere, ahead of a table's own sort; in a tree, closest matches first among the rows
  under each parent; image search becomes exactly the product rule (quoted phrases, `-word` and `or`
  removed); the Orders list, Find a bill and Find an invoice follow the same rule, and `A/12` or a
  bare number still finds that number exactly.
- Owner decision 7 (2026-10-09): **a search looks at names only; other fields are reached through
  the filters.** Products: the product's name and its variants' names. Staff: names, email and
  telephone (kept). Modifier lists: name plus their items' or labels' names. Units: name and
  abbreviation. Devices: name. Orders and bills: party name, delivery label, table labels. A table
  column with no `searchValue` is not searched.
- **Never trim the query before handing it to the matcher.** A trailing space finishes the last
  word ("gin " must not find "Ginger Ale"). Trim only to decide whether the query is blank —
  `textSearch` already does that.
- Every commit is `git commit -s`. Commit messages and the PR are plain English (see
  `~/.claude/CLAUDE.md` → "Talk to me in plain English").
- Coverage stays at `98/98/98/95` in every package touched. `@waitron/shared` and `@waitron/ui` are
  mutation-tested with a break floor of 90 — the matcher's tests must kill mutants, not just run
  lines.
- Comments: only an invariant or a non-obvious why (CLAUDE.md §1). No history in comments.
- Identifiers and comments in English only.
- Focused tests while implementing (CLAUDE.md §2). Before each commit run, for each package you
  changed: `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint`, and
  `pnpm exec prettier --check <changed files>`. Do not run a whole-workspace suite.
- Under an AI agent Vitest hides passing tests' console output; read the `Tests` count line, never
  the exit status alone.
- Every commit step stages the task's files by explicit path (`git add <paths>`, never
  `git add -A` outside the paths listed), and a task that changes a `package.json` also stages
  `pnpm-lock.yaml` — the push hook runs a locked install.
- Each implementer stops at about 150 tool calls with the task unfinished: commit at a passing (or
  cleanly red) point and return a handover — done, left, files, each check's state.

## Review Focus

1. **A query trimmed before it reaches the matcher** — "gin " (with a trailing space) in a table, a
   dropdown, a screen or a database lookup must not find "Ginger Ale". Pinned in Tasks 2, 3, 4, 5
   and 7b.
2. **An accent or capital on either side** — "GARCÍA" and "garcia" both find "José García" and
   "Jose Garcia", in the browser and in SQL. Pinned in Tasks 1, 6 and 7a.
3. **A database column that is NULL** — a bill with no party name or delivery label is still found
   by its table label, and is never matched by the word "null". Pinned in Tasks 6 and 7a.
4. **The Orders list's second page while searching** — paging continues the ranked order with no row
   repeated or skipped, including rows tied on rank. Pinned in Task 7a.
5. **The dropdown's "add" row with accents** — typing "cafe" where "Café" exists offers no add row.
   Pinned in Task 3.

---

### Task 1: The shared matcher

**Files:**
- Create: `packages/shared/src/text-search.ts`
- Create: `packages/shared/src/text-search.test.ts`
- Modify: `packages/shared/src/index.ts` (export), `packages/shared/src/index.test.ts` (if it lists
  exports — read it; follow its pattern)
- Modify: `packages/catalogue/src/device-home.ts` (delete `foldForSearch`, `WORD`, `wordPattern`,
  `NameSearch`, `searchFor`), `packages/catalogue/src/device-home.test.ts` (delete the
  `foldForSearch` case and the `describe("searchFor")` block — they move)
- Modify: `apps/till/src/widgets/menu-browser.ts` (import `foldForSearch`, `searchFor`,
  `NameSearch` from `@waitron/shared` instead of `@waitron/catalogue/src/device-home.js`)
- Modify: `apps/dashboard/src/widgets/device-home-preview.ts` (same import change)
- Check: `apps/till/package.json` and `apps/dashboard/package.json` already depend on
  `@waitron/shared` (they do as of 2026-10-09; confirm).

**Interfaces — Produces** (every later task uses these exact names):

```ts
export function foldForSearch(text: string): string;
export interface SearchRank {
  readonly kind: 0 | 1 | 2; // 0 whole word, 1 start of a word, 2 inside a word
  readonly part: number; // index of the part the last word was best found in
  readonly position: number; // its position inside that part
  readonly length: number; // total length of all parts
}
export interface TextSearch {
  /** `parts` are already folded. Undefined when they do not match. */
  rank(parts: string | readonly string[]): SearchRank | undefined;
}
/** Undefined for a blank query (empty or only whitespace): no search at all. */
export function textSearch(query: string): TextSearch | undefined;
export function compareSearchRanks(left: SearchRank, right: SearchRank): number;
/** One non-negative safe integer that sorts as `compareSearchRanks` does. */
export function searchRankKey(rank: SearchRank): number;
export type NameSearch = <T>(named: readonly (readonly [T, string | readonly string[]])[]) => T[];
/** Blank query: every value, in the order given. Otherwise the matches in rank order, ties in the
 * order given. */
export function searchFor(query: string): NameSearch;
```

- [ ] **Step 1: Write the failing tests.** Create `packages/shared/src/text-search.test.ts`. Move
  every case of the old `describe("searchFor")` block from `packages/catalogue/src/device-home.test.ts`
  (lines ~88–148 on 2026-10-09) into it unchanged except the import, then add the cases below. The
  moved case "finds every name, in the order given, when nothing is typed" stays as it is (a blank
  query is no search).

```ts
import { describe, expect, it } from "vitest";
import {
  compareSearchRanks,
  foldForSearch,
  searchFor,
  searchRankKey,
  textSearch,
  type SearchRank,
} from "./text-search.js";

const find = (query: string, ...names: string[]) =>
  searchFor(query)(names.map((name) => [name, foldForSearch(name)] as const));
const findParts = (query: string, ...rows: string[][]) =>
  searchFor(query)(rows.map((parts) => [parts.join("|"), parts.map(foldForSearch)] as const));

it("folds case and accents, so jamon finds Jamón", () => {
  expect(foldForSearch("Jamón Ibérico")).toBe("jamon iberico");
});

describe("a query with no words", () => {
  it("finds nothing when it is only punctuation", () => {
    expect(find("&", "Gin & Tonic", "Fish-and-chips")).toEqual([]);
    expect(find(" - ", "Fish-and-chips")).toEqual([]);
  });
  it("is no search at all when it is blank", () => {
    expect(textSearch("")).toBeUndefined();
    expect(textSearch("   ")).toBeUndefined();
    expect(textSearch("&")).toBeDefined();
    expect(textSearch("&")!.rank("gin & tonic")).toBeUndefined();
  });
});

describe("text in several parts", () => {
  it("finds each word in any part", () => {
    expect(findParts("tonic drinks", ["Gin & Tonic", "Drinks"], ["Tonic", "Mixers"])).toEqual([
      "Gin & Tonic|Drinks",
    ]);
  });
  it("never lets a word span two parts", () => {
    expect(findParts("gintonic", ["Gin", "Tonic"])).toEqual([]);
  });
  it("finds the word being typed inside any part", () => {
    expect(findParts("drinks onic", ["Gin & Tonic", "Drinks"])).toEqual(["Gin & Tonic|Drinks"]);
  });
  it("orders an earlier part's match before a later part's of the same kind", () => {
    expect(findParts("gin", ["Mixers", "Gin"], ["Gin", "Mixers"])).toEqual([
      "Gin|Mixers",
      "Mixers|Gin",
    ]);
  });
  it("orders by kind before part", () => {
    expect(findParts("gin", ["Ginger", "Spirits"], ["Spirits", "Gin"])).toEqual([
      "Spirits|Gin",
      "Ginger|Spirits",
    ]);
  });
  it("keeps the best part when the last word matches in more than one", () => {
    expect(findParts("gin", ["Mixers", "Gin"], ["Gin", "Ginger"])).toEqual([
      "Gin|Ginger",
      "Mixers|Gin",
    ]);
  });
  it("treats one string as one part", () => {
    const search = textSearch("gin")!;
    expect(search.rank("gin & tonic")).toEqual(search.rank(["gin & tonic"]));
  });
});

describe("rank", () => {
  const rankOf = (query: string, ...parts: string[]) => textSearch(query)!.rank(parts.map(foldForSearch));
  it("reports kind, part, position and total length", () => {
    expect(rankOf("ton", "Gin & Tonic", "Mixers")).toEqual({ kind: 1, part: 0, position: 6, length: 17 });
    expect(rankOf("onic", "Gin & Tonic")).toEqual({ kind: 2, part: 0, position: 7, length: 11 });
    expect(rankOf("tonic", "Mixers", "Gin & Tonic")).toEqual({ kind: 0, part: 1, position: 6, length: 17 });
  });
  it("ranks a completed last word by where it is whole", () => {
    expect(rankOf("gin ", "Ginger Gin")).toEqual({ kind: 0, part: 0, position: 7, length: 10 });
  });
});

describe("compareSearchRanks and searchRankKey agree", () => {
  const ranks: SearchRank[] = [
    { kind: 0, part: 0, position: 0, length: 3 },
    { kind: 0, part: 0, position: 0, length: 11 },
    { kind: 0, part: 0, position: 6, length: 9 },
    { kind: 0, part: 1, position: 0, length: 9 },
    { kind: 1, part: 0, position: 0, length: 10 },
    { kind: 2, part: 0, position: 3, length: 11 },
  ];
  it("orders kind, then part, then position, then length", () => {
    for (let i = 0; i < ranks.length - 1; i += 1) {
      expect(compareSearchRanks(ranks[i]!, ranks[i + 1]!)).toBeLessThan(0);
      expect(compareSearchRanks(ranks[i + 1]!, ranks[i]!)).toBeGreaterThan(0);
      expect(searchRankKey(ranks[i]!)).toBeLessThan(searchRankKey(ranks[i + 1]!));
    }
    expect(compareSearchRanks(ranks[0]!, { ...ranks[0]! })).toBe(0);
  });
  it("stays a safe integer and keeps order for very large values", () => {
    const big = { kind: 2, part: 5000, position: 5_000_000, length: 5_000_000 } as const;
    expect(Number.isSafeInteger(searchRankKey(big))).toBe(true);
    expect(searchRankKey({ ...big, kind: 1 })).toBeLessThan(searchRankKey(big));
    expect(searchRankKey({ kind: 0, part: 5000, position: 0, length: 0 })).toBeLessThan(
      searchRankKey({ kind: 1, part: 0, position: 0, length: 0 }),
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**
  Run: `pnpm --filter @waitron/shared exec vitest run src/text-search.test.ts`
  Expected: FAIL — `Failed to resolve import "./text-search.js"`.

- [ ] **Step 3: Write `packages/shared/src/text-search.ts`.**

```ts
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

const WORD = "[\\p{L}\\p{N}]";

/** A word holds only letters and digits, so it needs no escaping inside a pattern. */
function wordPattern(word: string, whole: boolean): RegExp {
  return new RegExp(`(?<!${WORD})${word}${whole ? `(?!${WORD})` : ""}`, "u");
}

export interface SearchRank {
  readonly kind: 0 | 1 | 2;
  readonly part: number;
  readonly position: number;
  readonly length: number;
}

export interface TextSearch {
  rank(parts: string | readonly string[]): SearchRank | undefined;
}

export function compareSearchRanks(left: SearchRank, right: SearchRank): number {
  return (
    left.kind - right.kind ||
    left.part - right.part ||
    left.position - right.position ||
    left.length - right.length
  );
}

const cap = (value: number, limit: number) => Math.min(value, limit - 1);

/** Kind, part (under 1000), position and length (each under 1,000,000) packed below 2^53. */
export function searchRankKey(rank: SearchRank): number {
  return (
    rank.kind * 1e15 +
    cap(rank.part, 1000) * 1e12 +
    cap(rank.position, 1_000_000) * 1e6 +
    cap(rank.length, 1_000_000)
  );
}

/** A text matches when it holds every word of the query, in any order. A word followed by anything
 * but a letter or digit must be a whole word; the word still being typed may be any part of one.
 * The last word orders the matches. A query with words matches nothing when it has none. */
export function textSearch(query: string): TextSearch | undefined {
  if (query.trim() === "") return undefined;
  const folded = foldForSearch(query);
  const words = folded.match(new RegExp(`${WORD}+`, "gu")) ?? [];
  const typing = new RegExp(`${WORD}$`, "u").test(folded) ? words.pop() : undefined;
  const last = typing ?? words.at(-1);
  if (last === undefined) return { rank: () => undefined };
  const whole = words.map((word) => wordPattern(word, true));
  const wholeLast = wordPattern(last, true);
  const startLast = wordPattern(last, false);
  const partRank = (text: string, part: number, length: number): SearchRank | undefined => {
    const atWhole = wholeLast.exec(text);
    if (atWhole !== null) return { kind: 0, part, position: atWhole.index, length };
    const atStart = startLast.exec(text);
    if (atStart !== null) return { kind: 1, part, position: atStart.index, length };
    const inside = text.indexOf(last);
    return inside === -1 ? undefined : { kind: 2, part, position: inside, length };
  };
  return {
    rank(given) {
      const parts = typeof given === "string" ? [given] : given;
      if (!whole.every((pattern) => parts.some((text) => pattern.test(text)))) return undefined;
      const length = parts.reduce((sum, text) => sum + text.length, 0);
      let best: SearchRank | undefined;
      parts.forEach((text, part) => {
        const found = partRank(text, part, length);
        if (found !== undefined && (best === undefined || compareSearchRanks(found, best) < 0))
          best = found;
      });
      return best;
    },
  };
}

export type NameSearch = <T>(named: readonly (readonly [T, string | readonly string[]])[]) => T[];

export function searchFor(query: string): NameSearch {
  const search = textSearch(query);
  if (search === undefined) return (named) => named.map(([value]) => value);
  return (named) =>
    named
      .flatMap(([value, text]) => {
        const rank = search.rank(text);
        return rank === undefined ? [] : [{ value, rank }];
      })
      .sort((left, right) => compareSearchRanks(left.rank, right.rank))
      .map(({ value }) => value);
}
```

  Note the `rank` test for "gin " on "Ginger Gin": the last word is completed, so `whole` already
  demands it as a whole word somewhere, and a whole match (kind 0) always beats the weaker kinds
  `partRank` may also report for other parts. `Array.prototype.sort`
  is stable, which keeps ties in the order given.

- [ ] **Step 4: Run the tests.** Same command. Expected: PASS, every case. Then run
  `pnpm --filter @waitron/shared exec vitest run --coverage src/text-search.test.ts` is NOT how
  coverage is measured here; instead check that `text-search.ts` shows 100% lines in
  `pnpm --filter @waitron/shared test:coverage` (the shared suite is small and fast).

- [ ] **Step 5: Export it.** In `packages/shared/src/index.ts`, beside the `compareLabels` export:

```ts
export {
  compareSearchRanks,
  foldForSearch,
  searchFor,
  searchRankKey,
  textSearch,
  type NameSearch,
  type SearchRank,
  type TextSearch,
} from "./text-search.js";
```

  If `packages/shared/src/index.test.ts` asserts the list of exports, add these the way it adds
  the others.

- [ ] **Step 6: Delete the old copy and repoint the two callers.** Remove `foldForSearch`, `WORD`,
  `wordPattern`, `NameSearch` and `searchFor` from `packages/catalogue/src/device-home.ts`, and the
  moved tests from `device-home.test.ts`. In `apps/till/src/widgets/menu-browser.ts` and
  `apps/dashboard/src/widgets/device-home-preview.ts`, import `foldForSearch`, `searchFor` (and
  `NameSearch` where used) from `@waitron/shared`. Then:
  `grep -rn "foldForSearch\|searchFor" apps packages --include='*.ts' | grep -v node_modules` —
  the only definitions left are in `packages/shared/src/text-search.ts` and the dashboard's
  private copy in `apps/dashboard/src/dashboard-app.ts` (Task 5 removes that one).

- [ ] **Step 7: Add the till's punctuation case.** In `apps/till/src/widgets/menu-browser.test.ts`
  add a test beside the existing search tests: type "&" into the search and expect the "no results"
  state (read the file's existing "no results" test for the selector and string). Run:
  `pnpm --filter @waitron/till exec vitest run src/widgets/menu-browser.test.ts` — expect the new
  case and every existing case to pass (before this task it would have listed every product).

- [ ] **Step 8: Run the affected suites.**
  `pnpm --filter @waitron/catalogue exec vitest run src/device-home.test.ts`,
  `pnpm --filter @waitron/till exec vitest run src/widgets/menu-browser.test.ts src/widgets/card-grid.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/device-home-preview.test.ts`.
  Expected: all pass. Then typecheck and lint `@waitron/shared`, `@waitron/catalogue`,
  `@waitron/till`, `@waitron/dashboard`; prettier on the changed files.

- [ ] **Step 9: Mutation check of the new file.** `pnpm --filter @waitron/shared mutation` (it is
  incremental). Every surviving mutant in `text-search.ts` gets a test that kills it, or a line in
  the handover saying why it is equivalent. The floor is 90.

- [ ] **Step 10: Commit.**
  `git add -A packages/shared packages/catalogue/src/device-home.ts packages/catalogue/src/device-home.test.ts apps/till/src/widgets apps/dashboard/src/widgets/device-home-preview.ts`
  then `git commit -s -m "One search matcher in the shared package; a search of only punctuation finds nothing"`.

---

### Task 2: The shared table ranks its search

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts` — `#searchHaystack`, `#term`,
  `#passesSearch`, `#visibleRows`, `#shownRows`, `#sortByColumn`
- Modify: `packages/ui/package.json` only if `@waitron/shared` is missing (it is a dependency as of
  2026-10-09; confirm)
- Test: `packages/ui/src/components/wt-data-table.test.ts`

**Interfaces:** Consumes `textSearch`, `foldForSearch`, `compareSearchRanks`, `SearchRank` from
`@waitron/shared` (Task 1). Produces no new public API: `searchTerm`, `searchable`, `searchValue`
keep their names; only the matching and the order change.

**Behaviour to build (spec → "Shared components"):**
- The search text is `this.searchable ? this.searchText : this.searchTerm`, handed **untrimmed** to
  `textSearch`. `undefined` back means no search: everything passes and the order is exactly
  today's.
- Each row's parts are the search values of the columns that declare `searchValue`, in
  `this.columns` order, each folded with `foldForSearch`. **A column with no `searchValue` is not
  searched** — the old fallback to `String(sortValue ?? "")` is removed (owner decision 7). A table
  none of whose columns declares `searchValue` therefore finds nothing while a search is typed;
  Task 2b gives the devices screen, the one such searchable table, a name search value.
  Cache the folded parts per row in a `WeakMap<Row, readonly string[]>` that is replaced whenever
  `columns` changes (in `willUpdate`, when `changed.has("columns")`), so typing does not re-fold
  every row on every keystroke.
- A row passes the search when `rank` is defined. Compute the ranks once per pass, in
  `#visibleRows`, into a `Map<Row, SearchRank>` kept on the instance for the sort to read.
- **Flat table, search typed:** order by `rowGroup` (unchanged, it stays first), then rank, then the
  column sort, then the incoming index. Clicking a heading still updates `sortKey`/`sortDirection`
  and the indicator; that sort decides only ties until the search is cleared.
- **Tree:** Task 2t orders a tree's rows by match. This task leaves `#treeRows` ordering as it is
  (tree rows still filter by the new rule).
- The `searching` check in `#treeVisible` becomes "a search is active" (`textSearch(...) !==
  undefined`), so a punctuation-only search (active, matching nothing) leaves the tree empty.

- [ ] **Step 1: Write the failing tests** (in `wt-data-table.test.ts`, near the existing search
  tests at ~line 1858; reuse the file's `mount` helper and its `table()` / `treeTable()` helpers):

```ts
type Drink = { id: string; name: string; category: string };
const drinks: Drink[] = [
  { id: "virgin", name: "Virgin Mary", category: "Mocktails" },
  { id: "ginger", name: "Ginger Ale", category: "Mixers" },
  { id: "tonic-gin", name: "Tonic Gin", category: "Cocktails" },
  { id: "gt", name: "Gin & Tónic", category: "Cocktails" },
  { id: "gin", name: "Gin", category: "Spirits" },
];
async function drinksTable(props: Partial<WtDataTable<Drink>> = {}) {
  const el = (await mount('<wt-data-table aria-label="Drinks"></wt-data-table>')) as WtDataTable<Drink>;
  Object.assign(el, {
    rows: drinks,
    rowKey: (r: Drink) => r.id,
    columns: [
      { key: "name", label: "Name", cell: (r: Drink) => r.name, sortValue: (r: Drink) => r.name, searchValue: (r: Drink) => r.name },
      { key: "category", label: "Category", cell: (r: Drink) => r.category, searchValue: (r: Drink) => r.category },
    ],
    sortKey: "name",
    sortDirection: "ascending",
    ...props,
  });
  await el.updateComplete;
  return el;
}
const keys = (el: WtDataTable<Drink>) =>
  [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-row-key"));

test("a search lists the closest matches first, ahead of the column sort", async () => {
  const el = await drinksTable({ searchTerm: "gin" });
  expect(keys(el)).toEqual(["gin", "gt", "tonic-gin", "ginger", "virgin"]);
  el.searchTerm = "";
  await el.updateComplete;
  expect(keys(el)).toEqual(["gin", "gt", "ginger", "tonic-gin", "virgin"]);
});

test("a search finds every word in any order, across columns, ignoring accents", async () => {
  // Both are Cocktails; "cocktails" is whole in each one's second part, so the shorter row wins.
  const el = await drinksTable({ searchTerm: "tonic cocktails" });
  expect(keys(el)).toEqual(["tonic-gin", "gt"]);
  el.searchTerm = "tonic mixers";
  await el.updateComplete;
  expect(keys(el)).toEqual([]);
  el.searchTerm = "COCKTAILS tonic gin";
  await el.updateComplete;
  expect(keys(el)).toEqual(["gt", "tonic-gin"]);
});

test("a word followed by a space must be a whole word", async () => {
  const el = await drinksTable({ searchTerm: "gin " });
  expect(keys(el)).toEqual(["gin", "gt", "tonic-gin"]);
});

test("a column with only a sort value is not searched", async () => {
  // "Spirits" is only in the category column; give that column a sortValue and no searchValue.
  const el = await drinksTable({
    searchTerm: "spirits",
    columns: [
      { key: "name", label: "Name", cell: (r: Drink) => r.name, sortValue: (r: Drink) => r.name, searchValue: (r: Drink) => r.name },
      { key: "category", label: "Category", cell: (r: Drink) => r.category, sortValue: (r: Drink) => r.category },
    ],
  });
  expect(keys(el)).toEqual([]);
});

test("a search of only punctuation shows no rows", async () => {
  const el = await drinksTable({ searchTerm: "&" });
  expect(keys(el)).toEqual([]);
});

test("the search box ranks too, and keeps a trailing space", async () => {
  const el = await drinksTable({ searchable: true });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  input.value = "gin ";
  input.dispatchEvent(new Event("input"));
  await el.updateComplete;
  expect(keys(el)).toEqual(["gin", "gt", "tonic-gin"]);
});

test("a heading clicked during a search applies once the search is cleared", async () => {
  const el = await drinksTable({ searchTerm: "gin" });
  el.shadowRoot!.querySelector<HTMLButtonElement>('button.sort[data-sort="name"]')!.click();
  await el.updateComplete;
  expect(el.sortDirection).toBe("descending");
  expect(keys(el)).toEqual(["gin", "gt", "tonic-gin", "ginger", "virgin"]);
  el.searchTerm = "";
  await el.updateComplete;
  expect(keys(el)).toEqual(["virgin", "tonic-gin", "ginger", "gt", "gin"]);
});

```

  The heading selector `button.sort[data-sort="name"]` is the one the file's sort tests use; the
  cleared-search orders were checked with `compareLabels` (Gin, Gin & Tónic, Ginger Ale, Tonic Gin,
  Virgin Mary ascending).

- [ ] **Step 2: Run them; they fail** (old substring rule, column order):
  `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts -t "search|closest|whole word|punctuation|heading clicked"`.

- [ ] **Step 3: Implement** as described under "Behaviour to build". Shape of the core change:

```ts
import { compareSearchRanks, foldForSearch, textSearch, type SearchRank } from "@waitron/shared";

#folded = new WeakMap<Row, readonly string[]>();
#ranks: ReadonlyMap<Row, SearchRank> | undefined;

#searchParts(row: Row): readonly string[] {
  let parts = this.#folded.get(row);
  if (parts === undefined) {
    parts = this.columns.flatMap((column) =>
      column.searchValue ? [foldForSearch(column.searchValue(row))] : [],
    );
    this.#folded.set(row, parts);
  }
  return parts;
}

#search() {
  return textSearch(this.searchable ? this.searchText : this.searchTerm);
}
```

  `#visibleRows` builds `#ranks` (undefined when `#search()` is undefined) and keeps rows whose rank
  is defined. `#sortByColumn` gains the rank comparison between the group comparison and the column
  comparison. **It returns early today when there is no sort column and no group** (`if
  (column?.sortValue === undefined && group === undefined) return [...rows];`) — the rank ordering
  must happen before that return, or a table with no `sortKey` keeps its incoming order while
  searching. Give `#sortByColumn` the rank map as a parameter so Task 2t can pass its own.

- [ ] **Step 4: Run the whole file** — `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts`.
  Every existing case still passes except ones asserting the old substring rule or the old order
  during a search; for each of those, change only the fixture or expectation so it checks the same
  thing under the new rule, and list each changed test in the handover with one line on why.
  The existing `searchTerm: " EGGS "` case (~line 5533) must keep passing: a leading space is
  harmless and a trailing space finishes "eggs" as a whole word. Existing cases whose columns give
  only a `sortValue` and expect the search to find through it get a `searchValue` on the column the
  case means to search (list each in the handover). The ui demo (`packages/ui/demo/main.ts`)
  already declares one.

- [ ] **Step 5: Run the package's suites that render tables** —
  `pnpm --filter @waitron/ui test:coverage` (it measures coverage; check `wt-data-table.ts` stays
  at the bar), then typecheck, lint, prettier.

- [ ] **Step 6: Commit.** `git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts`
  then `git commit -s -m "Tables find every word typed and list the closest matches first"`.
  (No local mutation run: `@waitron/ui`'s mutation floor is enforced by the weekly run; the tests
  above are written to kill mutants of the new comparisons.)

---

### Task 2t: A tree lists the closest matches first under each parent

**Files:**
- Modify: `packages/ui/src/components/wt-data-table.ts` — `#treeRows` (and the rank map it passes
  to `#sortByColumn`), `#treeVisible`'s `searching` check
- Test: `packages/ui/src/components/wt-data-table.test.ts`

**Interfaces:** Consumes Task 2's `#ranks` map and the rank-aware `#sortByColumn`.

**Behaviour (owner decision 4):** in `#treeRows`, siblings are ordered by group, then by their
**effective rank**, then by the column sort, then index. A row's effective rank is its own rank if
it matches, otherwise the best rank among its matching descendants (walk each matched row's
ancestors, keeping each ancestor's best rank); a row with neither (one kept under a match by
`searchOpensPath`) sorts after every ranked sibling, in column order. A parent for which
`rowKeepsChildOrder` answers true keeps its children in `rows` order, as today. The `searching`
check in `#treeVisible` becomes "a search is active" (`#search() !== undefined`).

- [ ] **Step 1: Failing test:**

```ts
type MenuNode = { id: string; parent: string | null; name: string };
const nodes: MenuNode[] = [
  { id: "drinks", parent: null, name: "Drinks" },
  { id: "virgin", parent: "drinks", name: "Virgin Mary" },
  { id: "gin", parent: "drinks", name: "Gin" },
  { id: "food", parent: null, name: "Food" },
  { id: "ginger-cake", parent: "food", name: "Ginger Cake" },
  { id: "spirits", parent: null, name: "Spirits" },
  { id: "gin-and-tonic", parent: "spirits", name: "Gin & Tonic" },
];
test("in a tree, the closest matches come first under each parent", async () => {
  const el = (await mount('<wt-data-table aria-label="Menu"></wt-data-table>')) as WtDataTable<MenuNode>;
  Object.assign(el, {
    rows: nodes,
    rowKey: (r: MenuNode) => r.id,
    rowParent: (r: MenuNode) => r.parent,
    columns: [{ key: "name", label: "Name", cell: (r: MenuNode) => r.name, searchValue: (r: MenuNode) => r.name, sortValue: (r: MenuNode) => r.name }],
    sortKey: "name",
    sortDirection: "ascending",
    searchTerm: "gin",
  });
  await el.updateComplete;
  const shown = [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-row-key"));
  // Drinks holds a whole-word Gin; Spirits a whole-word Gin at position 0 of a longer name; Food
  // only a word that starts with gin. Under Drinks, Gin comes before Virgin Mary.
  expect(shown).toEqual(["drinks", "gin", "virgin", "spirits", "gin-and-tonic", "food", "ginger-cake"]);
});
```

  Also: a test that a parent for which `rowKeepsChildOrder` answers true keeps its children in
  `rows` order during a search, and one that a row kept only by `searchOpensPath` (a non-matching
  child of a matching parent) comes after its ranked siblings.

- [ ] **Step 2: Run; it fails.** `pnpm --filter @waitron/ui exec vitest run src/components/wt-data-table.test.ts -t "tree"`.
- [ ] **Step 3: Implement** per "Behaviour".
- [ ] **Step 4: Run the whole file**, then `pnpm --filter @waitron/ui test:coverage`, typecheck,
  lint, prettier. Existing tree-search cases that pinned tree order during a search change only
  their expectation; list each in the handover.
- [ ] **Step 5: Commit.** `git add packages/ui/src/components/wt-data-table.ts packages/ui/src/components/wt-data-table.test.ts`
  then `git commit -s -m "A tree lists the closest matches first under each parent"`.

---

### Task 2b: Each table searches names only

**Files:**
- Modify: `apps/dashboard/src/widgets/product-list.ts` — the name column's `searchValue`
  (~line 1011: drop `this.#categorySearchText(...)`), and delete the `searchValue` of the price
  (~line 1091), modifiers (~line 1102) and ordering (~line 1119) columns. In the tree wrapper
  (~line 1390–1401) a folder (category) row must be searched on **its own name only**
  (`row.folder.name`), not the parent path it uses today. Then delete `#categorySearchTexts` /
  `#categorySearchText` here and in `menu-prices-table.ts` once nothing calls them (grep).
- Modify: `apps/dashboard/src/widgets/menu-prices-table.ts` — keep the name column's (~line 1060);
  delete the override price's (~line 1081), the category's (~line 1132) and the `available`
  column's `searchValue: () => ""` with its comment (~line 1151; no longer needed — a column with
  no search value is not searched)
- Modify: `apps/dashboard/src/screens/modifiers-screen.ts` — delete the "used by" column's
  `searchValue` (~line 441); keep name and items/labels
- Modify: `apps/dashboard/src/screens/devices-screen.ts` — add `searchValue` to the device-name
  column of the searchable table (~line 1640; read its `#columns` to find the name column); no other
  column gets one
- Check, no change expected: `units-screen.ts` (name and abbreviation), `menu-structure-table.ts`
  (name), `menus-screen.ts:2087` (its table is not searchable)
- Modify: `apps/dashboard/src/widgets/form-fields.ts` — delete `priceSearchText` (~line 36) if
  nothing else uses it after the deletions above (grep), with its tests
- Tests: `product-list.test.ts`, `catalogue-browser.test.ts`, `menu-prices-table.test.ts`,
  `modifiers-screen.test.ts`, `devices-screen.test.ts`

**Interfaces:** Consumes Task 2's rule (only `searchValue` columns are searched).

- [ ] **Step 1: Failing tests**, one per screen, each asserting a non-name field no longer matches
  and a name still does:
  - products: a product "Cerveza" with variants "Caña" and "Jarra" in category "Bebidas", price
    2.50, ordering "not sold separately", filed in a folder "Mixers" whose parent folder is
    "Bebidas" — "jarra" finds it, "cerveza caña" finds it, "2,50" and "2.50" find nothing, the
    ordering label's words find nothing, and "bebidas mixers" finds NO row (no single name holds
    both words; today the folder row's parent-path search value does). "bebidas" alone finds the
    "Bebidas" folder by its own name; the product list sets `searchOpensPath`, so what sits under a
    matching folder is shown too — that is expected, not a match on the product;
  - menu prices: an item's variant name finds it; its price and its category find nothing;
  - modifiers: a list's extra's name finds the list; the "used by" text (read `#usageText` for what
    it returns) finds nothing;
  - devices: a device's name finds it; another column's value (its profile or status — read the
    columns) finds nothing.
  Read each file's existing search tests first and extend them; several assert the old cross-field
  matches (price, category) and must be changed to the new expectation — list each in the handover.
- [ ] **Step 2: Run; they fail.**
  `pnpm --filter @waitron/dashboard exec vitest run src/widgets/product-list.test.ts src/widgets/catalogue-browser.test.ts src/widgets/menu-prices-table.test.ts src/screens/modifiers-screen.test.ts src/screens/devices-screen.test.ts`
- [ ] **Step 3: Make the changes** listed under Files.
- [ ] **Step 4: Run the same files**, then typecheck, lint, prettier for `@waitron/dashboard`.
- [ ] **Step 5: Commit.** Stage the changed files under `apps/dashboard/src/widgets` and
  `apps/dashboard/src/screens` by path, then
  `git commit -s -m "Tables search names only; other fields are reached through the filters"`.

---

### Task 3: The shared dropdown ranks its search

**Files:**
- Modify: `packages/ui/src/components/wt-combobox.ts` — `filter` (~line 436), `showAddRow`
  (~line 447)
- Test: `packages/ui/src/components/wt-combobox.test.ts`

**Interfaces:** Consumes `searchFor`, `foldForSearch` from `@waitron/shared`.

**Grouped options.** `renderRows` draws a heading over each run of consecutive options sharing a
group (read the option type's group field and `renderRows`). Ranking across groups would split a
group and repeat its heading. So matches are ranked **within each group**, and groups keep their
order — the same rule as a tree under each parent (decision 4). Two dropdowns use groups today:
the VAT return's period choice (quarters and months) and adding a content language (official and
other).

- [ ] **Step 1: Failing tests** (beside "filters the option list as the search box is typed into",
  ~line 176; reuse `mountWithOptions` or mount with your own options the way the file does):

```ts
test("the search finds every word in any order and lists the closest first", async () => {
  // options labelled: "Virgin Mary", "Ginger Ale", "Tonic Gin", "Gin & Tónic", "Gin"
  ...
  await userEvent.type(search, "gin");
  expect(optionLabels()).toEqual(["Gin", "Gin & Tónic", "Tonic Gin", "Ginger Ale", "Virgin Mary"]);
  await userEvent.clear(search);
  await userEvent.type(search, "tonic gin");
  expect(optionLabels()).toEqual(["Gin & Tónic", "Tonic Gin"]);
});

test("a trailing space finishes the word", async () => {
  ...
  await userEvent.type(search, "gin ");
  expect(optionLabels()).toEqual(["Gin", "Gin & Tónic", "Tonic Gin"]);
});

test("a search of only punctuation lists nothing", async () => {
  ...
  await userEvent.type(search, "&");
  expect(optionLabels()).toEqual([]);
});

test("the add row is not offered for a label that differs only in accents or capitals", async () => {
  // allowAdd on, options include "Café"
  ...
  await userEvent.type(search, "CAFE");
  expect(el.shadowRoot!.querySelector(".add-row")).toBeNull(); // use the file's add-row selector
  await userEvent.type(search, "s");
  expect(el.shadowRoot!.querySelector(".add-row")).not.toBeNull();
});
```

  Fill the `...` with the file's own mounting pattern, and `optionLabels` with
  `[...el.shadowRoot!.querySelectorAll('[role="option"]')].map((row) => row.textContent?.trim())`
  — the existing test at line ~180 does exactly this. Use the add-row selector the existing allowAdd
  tests use.

  Plus a grouped case: options in two groups, A ("Gin Fizz", "Pink Gin") then B ("Gin",
  "Ginger"); typing "gin" lists A's matches ranked (Gin Fizz, Pink Gin) under A's heading, then B's
  ranked (Gin, Ginger) under B's heading, each heading drawn once.

- [ ] **Step 2: Run; they fail.** `pnpm --filter @waitron/ui exec vitest run src/components/wt-combobox.test.ts`.

- [ ] **Step 3: Implement.**

```ts
private filter(options: ComboboxOption[]): ComboboxOption[] {
  const search = searchFor(this.searchText);
  // Rank inside each run of one group, keeping the runs in their order.
  const runs: ComboboxOption[][] = [];
  for (const option of options) {
    const run = runs.at(-1);
    if (run !== undefined && groupOf(run[0]!) === groupOf(option)) run.push(option);
    else runs.push([option]);
  }
  return runs.flatMap((run) => search(run.map((option) => [option, foldForSearch(closedText(option))] as const)));
}

private get showAddRow(): boolean {
  if (!this.allowAdd || !this.trimmedSearch) return false;
  const query = foldForSearch(this.trimmedSearch);
  return !this.options.some((option) => foldForSearch(closedText(option)) === query);
}
```

  `groupOf` stands for however `renderRows` reads an option's group — use that same expression.
  Leave the type-ahead (~line 650, `startsWith` on keys pressed while the list is closed) as it is:
  it is keyboard navigation, not a search (spec).

- [ ] **Step 4: Run the file**, adjust any existing case that pinned the old substring rule (list
  them in the handover), then `pnpm --filter @waitron/ui test:coverage`, typecheck, lint, prettier.

- [ ] **Step 5: Run every screen that searches through the shared table or dropdown** (Tasks 2,
  2t and 3 changed the rule under them). List them with
  `grep -rln "searchable\|searchTerm\|wt-combobox" apps/dashboard/src apps/till/src packages/*/src/dashboard --include='*.ts' | grep -v test`,
  and run each one's sibling test files (`<name>.test.ts`, `<name>.*.test.ts`) in groups of about
  ten — check free memory first (`memory_pressure | grep free`); these are real-Chromium suites.
  Fix each failure that is the new rule showing (an expectation of the old substring or old
  order): change the expectation, keeping what the case checks, and list it in the handover. A
  failure that is not the new rule is a bug in Tasks 2–3: fix it there.

- [ ] **Step 6: Commit.** Stage `packages/ui/src/components/wt-combobox.ts`, its test, and any
  test files Step 5 changed, by path; then
  `git commit -s -m "Dropdowns find every word typed and list the closest matches first"`.

---

### Task 4: Dashboard pickers and the menu structure's boxes

**Files:**
- Modify: `apps/dashboard/src/widgets/section-add-products.ts` (`#visible`, ~line 194)
- Modify: `apps/dashboard/src/widgets/menu-structure-table.ts` (`#rowSelectable`, ~line 648)
- Modify: `apps/dashboard/src/screens/units-screen.ts` (`inUseRows`, ~line 511)
- Modify: `apps/dashboard/src/widgets/allergen-picker.ts` (`choices`, ~line 167)
- Tests: the sibling `*.test.ts` of each

**Interfaces:** Consumes `searchFor`, `textSearch`, `foldForSearch` from `@waitron/shared`.

For each site: first a failing test with "tonic gin" finding "Gin & Tónic" (or a fixture name the
file already uses, reordered words and an accent), "&" finding nothing, and an order that differs
from the list's own (put the whole-word match after a start-of-word match in the fixture). Then the
change. Then the file's whole suite.

- [ ] **Step 1: `section-add-products.ts`.** Test, then:

```ts
#visible(): AddableProduct[] {
  const within = this.#within;
  const offered = this.#offered.filter(
    (product) => within === null || (product.categoryId !== null && within.has(product.categoryId)),
  );
  return searchFor(this.search)(offered.map((product) => [product, foldForSearch(product.name)] as const));
}
```

  Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/section-add-products.test.ts`.

- [ ] **Step 2: `menu-structure-table.ts` `#rowSelectable`.** It must agree with the table's own
  rule: the table searches each row on `searchValue: row.name` alone (~line 955). Test: with
  `search` "drinks " (trailing space), a section named "Drinks" takes a box and one named
  "Drinkstuff" does not; with "&", no section takes a box. Then:

```ts
const search = textSearch(this.search);
return search === undefined || search.rank(foldForSearch(row.name)) !== undefined;
```

  Also add a test that, with `search` "gin", the table's sections and products under a parent come
  in ranked order (this table is a `wt-data-table` tree, so Task 2t already orders it; the test pins
  that the menu structure's own wiring passes `search` through unchanged). Run
  `src/widgets/menu-structure-table.test.ts`.

- [ ] **Step 3: `units-screen.ts` `inUseRows`.** The in-use products are drawn by a
  `wt-data-table`, and a heading click there would re-sort a list the screen had filtered itself,
  undoing the ranked order. So: delete the `productNeedle` pre-filter, hand `this.inUseSearch` to
  that table as `.searchTerm`, and give its product-name column `searchValue: (p) => p.name` (read
  the in-use table's columns; no other column gets one). Test in `units-screen.test.ts` beside the
  existing in-use search test: "tonic gin" finds "Gin & Tónic", "&" finds nothing, the order is
  ranked, and stays ranked after a heading click.

- [ ] **Step 4: `allergen-picker.ts`.** Test in `allergen-picker.test.ts` with Spanish and English
  names (e.g. "frutos cascara" finds "Frutos de cáscara", if that is the Spanish name the file
  uses; read `allergenName`). Then:

```ts
const unchosen = ALLERGEN_DISPLAY_ORDER.filter((code) => !this.entries[code]);
const choices = searchFor(this.search)(unchosen.map((code) => [code, foldForSearch(allergenName(code))] as const));
```

- [ ] **Step 5:** Run the four test files together, then typecheck, lint and prettier for
  `@waitron/dashboard`.

- [ ] **Step 6: Commit.** Stage the four source files and their tests by path, then
  `git commit -s -m "Adding products to a section, the menu structure, units in use and allergens search every word"`.

---

### Task 5: Staff, translations and the navigation search

**Files:**
- Modify: `apps/dashboard/src/screens/staff-screen.ts` (`#filteredPeople`, ~line 152),
  `apps/dashboard/src/widgets/staff-list.ts` (its table's columns and `searchTerm`)
- Modify: `apps/dashboard/src/widgets/content-translations-dialog.ts` (`#visible`, ~line 384)
- Modify: `apps/dashboard/src/dashboard-app.ts` (delete the private `foldForSearch` at ~line 171;
  the nav search at ~lines 1766–1797)
- Tests: `staff-screen.test.ts`, `content-translations-dialog.test.ts`, `dashboard-app.test.ts`
  (nav search cases around `nav-search`, ~line 5858)

- [ ] **Step 1: Staff.** Failing test: a person "José García", email `jose@example.com`, found by
  "garcia jose" and by "jose example" (words across name and email); "&" finds nobody; "gar" lists
  a person whose last name is "García" before one whose email merely contains "gar" inside a word.
  Staff are drawn by a `wt-data-table` in `staff-list.ts` with a `viewKey`, so a remembered heading
  sort would re-order a list the screen filtered itself. So: keep the role and status filters in
  `#filteredPeople`, delete its text check, and hand `this.search` to the staff table as
  `.searchTerm`; give the table's name column `searchValue` returning display name, first names and
  last names joined with spaces, and its email and telephone columns their values (read
  `staff-list.ts`; if there is no telephone column, put the telephone in the email column's search
  value). No other column gets a search value. Add to the test: after a heading click the matches
  stay in ranked order.

- [ ] **Step 2: Content translations.** Failing test: a row labelled with an accented name is
  found by its unaccented words in reverse order; "&" finds nothing. Replace the `includes(query)`
  in `#visible` with `searchFor(this.search)` over the rows that pass the other filters, folding
  `label(row)`. The `editedOnly` branch ignores the search today; keep that.

- [ ] **Step 3: Navigation search.** Failing tests in `dashboard-app.test.ts`, following its
  existing `nav-search` cases: two words of a page label in reverse order find it; "&" finds no
  page and no group; a page is found by words split between its label and its group's heading
  (e.g. "menu prices" finds the Prices page under a Menu heading, if the nav has such a pair — read
  `NAV_GROUPS` and the English strings, and pick a real pair); within a group, a page whose label
  has the word whole comes before one where it starts a word; a matching group heading still shows
  the whole group, with the pages whose own labels match first. Then, in the nav code: each page
  is searched as two parts, `[foldForSearch(page.label), foldForSearch(heading)]`, where `heading`
  is `t(group.headerKey)` or `""` for a group with none:
  `pages = searchFor(this.navSearch)(permitted.map((page) => [page, [foldForSearch(page.label), heading]] as const))`.
  That alone shows a whole group when its heading matches (every page matches through part 1) and
  ranks own-label matches first, so the separate `headerMatches` branch goes. A blank search
  returns the groups as today. Delete the private `foldForSearch` and import from
  `@waitron/shared`. Groups keep their place.

- [ ] **Step 4:** Run the three test files, then typecheck, lint, prettier.

- [ ] **Step 5: Commit.** Stage the changed files by path, then
  `git commit -s -m "Staff, translations and the navigation search every word"`.

---

### Task 6: The venue store's search function

**Files:**
- Create: `packages/store/src/search-function.ts`
- Create: `packages/store/src/search-function.test.ts`
- Modify: `packages/store/src/index.ts` — call `registerSearchFunction(connection)` in
  `openConnection` (~line 148) and `openReadConnection` (~line 179)
- Modify: `packages/store/package.json` — add `"@waitron/shared": "workspace:*"` to
  `dependencies`; run `pnpm install` in the worktree afterwards
- Check: `scripts/workspace-cycles.test.ts` and the `import-x/no-restricted-paths` zones in
  `eslint.config.js` allow `store` → `shared` (shared imports no package, so no loop is possible;
  run `pnpm exec vitest run scripts/workspace-cycles.test.ts` from the worktree root to confirm;
  the reviewer measured 15 passed with the dependency in place).

**Interfaces:** Produces the SQL scalar function
`waitron_search_rank(query, part1, part2, …) → number | null`: `null` when the parts do not match;
otherwise `searchRankKey(rank)`; `0` for a blank query. SQLite receives the JavaScript number as a
`real` (measured by the plan reviewer on Node v26.7.0); every key is a whole number below 2^53, so
it orders and compares exactly, and a cursor writes it with `String(Math.trunc(value))`. A NULL or non-text part counts as an empty
part (it keeps its position, so part indexes stay stable). Consumes `textSearch`, `foldForSearch`,
`searchRankKey`.

- [ ] **Step 1: Failing test** — open a real venue store the way `packages/store/src/index.test.ts`
  does (read its setup: temporary directory, `openVenueStore`), and run SQL through BOTH the write
  path (inside `withTransaction` or the file's equivalent) and the read path:

```ts
const rank = (sql: string) => /* run `select ${sql} as r` and return r */;
expect(rank("waitron_search_rank('garcia jose', 'José García')")).not.toBeNull();
expect(rank("waitron_search_rank('GARCÍA', 'Jose Garcia')")).not.toBeNull();
expect(rank("waitron_search_rank('&', 'Gin & Tonic')")).toBeNull();
expect(rank("waitron_search_rank('null', null)")).toBeNull();
expect(rank("waitron_search_rank('terraza', null, null, 'Terraza 4')")).not.toBeNull();
expect(rank("waitron_search_rank('  ', 'anything')")).toBe(0);
expect(rank("waitron_search_rank('gin', 'Gin')")).toBeLessThan(rank("waitron_search_rank('gin', 'Ginger')"));
```

  Expected first run: FAIL with `no such function: waitron_search_rank`.

- [ ] **Step 2: Implement `search-function.ts`.**

```ts
import type { DatabaseSync } from "node:sqlite";
import { foldForSearch, searchRankKey, textSearch, type TextSearch } from "@waitron/shared";

/** One query is compiled once per run of consecutive calls, not once per row. */
export function registerSearchFunction(connection: DatabaseSync): void {
  let lastQuery: string | undefined;
  let lastSearch: TextSearch | undefined;
  connection.function(
    "waitron_search_rank",
    { deterministic: true, varargs: true },
    (query: unknown, ...parts: unknown[]) => {
      const text = typeof query === "string" ? query : "";
      if (text !== lastQuery) {
        lastQuery = text;
        lastSearch = textSearch(text);
      }
      if (lastSearch === undefined) return 0;
      const rank = lastSearch.rank(parts.map((part) => (typeof part === "string" ? foldForSearch(part) : "")));
      return rank === undefined ? null : searchRankKey(rank);
    },
  );
}
```

  Check the `connection.function` signature against Node v26's `node:sqlite` types
  (`node_modules/@types/node/sqlite.d.ts`); adjust the parameter typing to what it declares.

- [ ] **Step 3: Register it** in `openConnection` and `openReadConnection`, right after the pragmas.
  Run the test file; expected PASS. Then `pnpm --filter @waitron/store test:coverage`, typecheck,
  lint, prettier.

- [ ] **Step 4: Commit.** `git add packages/store/src/search-function.ts packages/store/src/search-function.test.ts packages/store/src/index.ts packages/store/package.json pnpm-lock.yaml`
  then `git commit -s -m "The venue store can rank a search in SQL"`.

---

### Task 7a: The Orders list searches every word, with a ranked page bookmark

**Files:**
- Modify: `apps/server/src/orders-list.ts` — `searchClause` (~line 214), `ordersPageSql`
  (~line 300), `filterClauses` (the `after` clause, ~line 287), `listOrders` (the `next` cursor,
  ~line 315), `OrderCursor` (~line 49); export `isNumberSearch(search: string): boolean`
- Modify: `apps/server/src/orders-api.ts` — `CURSOR` (~line 46), `requireCursor` (~line 59), the
  `next` encoding (~line 152), and `parseOrdersQuery` (refuse a cursor that does not fit the
  search, using `isNumberSearch` rather than a copy of its pattern)
- Tests: `apps/server/src/orders-list.test.ts`, `apps/server/src/orders-api.test.ts`; keep
  `apps/server/src/orders-list.reads.test.ts` passing unchanged

**Interfaces:** Consumes `waitron_search_rank` (Task 6). Produces `isNumberSearch` (used by Task
7b). The dashboard's cursor stays an opaque string it hands back
(`apps/dashboard/src/api/client.ts` ~line 3468 passes `page.next` as `after`).

**Behaviour:**
- `isNumberSearch(search)` is true for the `A/12` form and a bare number (today's two regexes in
  `searchClause`, applied to the trimmed text). A number search keeps today's exact clause and
  newest-first order, unchanged. Everything else is a word search.
- **No search, or a number search: the SQL is exactly today's**, so the query-plan expectations in
  `orders-list.reads.test.ts` still hold.
- Word search: wrap the rows in a second CTE and read from it under the same alias, so every
  existing `r.` clause and the `credited` column keep working:

```sql
with base as (<rowsSql(filter)>),
r as (
  select base.*, waitron_search_rank(<search>, base.party_name, base.delivery_label,
    (select group_concat(dt.label, ' ') from party_tables pt join dining_tables dt on dt.id = pt.table_id
     where pt.party_id = base.party_id)) as search_rank
  from base
)
select r.*, exists (select 1 from sales c where c.corrects_sale_id = r.sale_id) as credited
from r where r.search_rank is not null and <the other clauses>
order by r.search_rank, r.at desc, r.id desc
limit <limit + 1>
```

  `<search>` is the search text **untrimmed** (a trailing space finishes the last word). The plan
  reviewer built this shape in SQLite with the matcher registered and walked tied-rank pages
  correctly; `credited` still worked.
- Cursor while word-searching: `${Math.trunc(rank)}_${at}_${id}`; the after clause becomes
  `(r.search_rank > R or (r.search_rank = R and (r.at < A or (r.at = A and r.id < I))))`. Without a
  word search the cursor and clause are exactly today's. `CURSOR` accepts an optional leading
  `(\d{1,16})_`. A word search with a cursor lacking a rank, or a ranked cursor with no word
  search, is refused as `invalid("after")`.
- `delete likePattern` if nothing else uses it.

- [ ] **Step 1: Failing tests — orders** (`orders-list.test.ts`, using its existing fixtures for
  bills with party names and tables; read them first):
  - party "José García" found by "garcia jose" and by "GARCÍA" (Review Focus 2);
  - a bill with no party name and no delivery label, at table "Terraza 4", found by "terraza" and
    NOT found by "null" (Review Focus 3);
  - "&" finds nothing, where a party named "Smith & Co" exists;
  - order: a party "Gin" listed before "Ginger Club" for "gin" whichever is newer;
  - "gin " (trailing space) finds "Gin" and not "Ginger Club";
  - paging: with `limit: 2` and five matching bills whose ranks tie in pairs, walk every page with
    the returned `next` cursor and assert the concatenated ids equal the one-page answer with a
    large limit — no repeats, no gaps (Review Focus 4);
  - a number search still finds by invoice number exactly, newest first (existing cases must keep
    passing untouched).
- [ ] **Step 2: Failing tests — API** (`orders-api.test.ts`): a ranked cursor round-trips; a word
  search with a plain `at_id` cursor answers 400 with field `after`; a ranked cursor with no search
  answers 400 with field `after`; a plain cursor without a search still works.
- [ ] **Step 3: Run them; they fail.**
  `pnpm --filter @waitron/server exec vitest run src/orders-list.test.ts src/orders-api.test.ts src/orders-list.reads.test.ts`.
- [ ] **Step 4: Implement** per "Behaviour". Read the emitted SQL once (log `ordersPageSql(filter)`
  in a scratch test, or `.toSQL()`), because a correlated subquery against the wrong table breaks
  silently (CLAUDE.md §3).
- [ ] **Step 5: Run the three files**, then `pnpm --filter @waitron/server typecheck`, lint,
  prettier.
- [ ] **Step 6: Commit.** Stage the two source files and their tests by path, then
  `git commit -s -m "The Orders list searches every word, ignoring accents, closest matches first"`.

---

### Task 7b: Find a bill, Find an invoice, and keeping the trailing space

**Files:**
- Modify: `apps/server/src/invoice-lookup-api.ts` — `lookUpInvoices` (~line 27) and the route's
  `q` handling (~line 76)
- Modify: `apps/server/src/bill-lookup-api.ts` — the route's `q` handling (~line 67); `lookUpBills`
  itself needs no change (it calls `listOrders` with `search: q`)
- Modify: `apps/server/src/orders-api.ts` — `optionalText` for `q`: keep the raw text (decide
  blank and the length limit on the trimmed text; pass the untrimmed text on)
- Modify: `apps/dashboard/src/screens/orders-screen.ts` (~line 177) and
  `apps/till/src/widgets/find-bill-dialog.ts` (~line 190): stop trimming the typed text before it
  is sent (still treat a blank box as no search)
- Tests: `apps/server/src/bill-lookup-api.test.ts`; the invoice lookup's existing cases live in
  `apps/server/src/bill-payments.test.ts` and `apps/server/src/till-api.profile-zones.test.ts` —
  add the new invoice cases to `bill-payments.test.ts` beside them; `orders-api.test.ts`;
  `apps/dashboard/src/screens/orders-screen.test.ts`; `apps/till/src/widgets/find-bill-dialog.test.ts`

**Interfaces:** Consumes `isNumberSearch` (Task 7a) and `waitron_search_rank` (Task 6).

**Behaviour:**
- Every place that receives a search keeps its trailing space: the box, the request, the route and
  the SQL. A route still refuses a blank `q` and one over 100 characters, measured on the trimmed
  text. `isNumberSearch` runs on the trimmed text.
- Invoices: a word search filters `waitron_search_rank(${q}, ${sales.counterpartyLegalName}) is not null`
  and orders by that rank, then `issuedAt desc`, then `"sales".rowid desc`; the `A/12` form is
  unchanged.

- [ ] **Step 1: Failing tests.**
  - bills (`bill-lookup-api.test.ts`): "garcia jose" finds the bill; ranked order holds; "&"
    answers an empty list; "gin " finds "Gin" and not "Ginger Club". The existing case "finds a
    debt by its order number and orders results newest first" uses party names of different
    lengths ("Number search first" / "Number search second"), which the new length tie-break would
    reorder for a word search: if it searches by words, change the names to equal lengths ("Number
    search one" / "Number search two") so it still checks newest-first among equal matches.
  - invoices (`bill-payments.test.ts`): a customer "Distribuciones Núñez SL" found by "nunez
    distribuciones"; "&" finds nothing; `A/12` exact still works; two customers come in rank order.
  - API (`orders-api.test.ts`): `q=gin%20` finds "Gin" and not "Ginger Club"; `q=%20%20` is still
    refused as blank.
  - screens: the Orders screen and the till's Find a bill send "gin " with its space (assert the
    request's `q`; read how each test file captures requests).
- [ ] **Step 2: Run; they fail.**
  `pnpm --filter @waitron/server exec vitest run src/bill-lookup-api.test.ts src/bill-payments.test.ts src/orders-api.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/orders-screen.test.ts`,
  `pnpm --filter @waitron/till exec vitest run src/widgets/find-bill-dialog.test.ts`.
- [ ] **Step 3: Implement** per "Behaviour".
- [ ] **Step 4: Run the same files plus** `apps/server/src/till-api.profile-zones.test.ts`, then
  typecheck, lint and prettier for `@waitron/server`, `@waitron/dashboard`, `@waitron/till`.
- [ ] **Step 5: Commit.** Stage the changed files by path, then
  `git commit -s -m "Find a bill and Find an invoice search every word, and a trailing space is kept"`.

---

### Task 8: Image search follows the same rule

**Files:**
- Modify: `packages/media/src/images.ts` — `listImages` (~line 506); delete `QueryItem`,
  `searchTokens`, `parseSearch`, `fieldHolds`, `scoreSearch` (~lines 386–500) once nothing uses
  them (grep first: `searchTokens` may have another caller)
- Delete: `packages/media/src/search-grammar.test.ts`
- Modify: `packages/media/src/images.test.ts`, `packages/media/src/routes.test.ts` — cases pinning
  phrases, `-word`, `or` or prefix-only matching are deleted or rewritten to the new rule

- [ ] **Step 1: Failing tests** in `images.test.ts` (read its seeding helper first): an image named
  "Café con leche" found by "leche cafe" and by "ech"; "&" finds nothing; an image whose English
  name is "Toast" and Spanish name "Tostada" is found by "tostada", but not by "toast tostada" (no
  one language holds both words); with `sort` relevance, "gin" lists "Gin" before "Ginger" before
  "Virgin"; with `sort: "name"` the matches come in name order.
- [ ] **Step 2: Run; fail.** `pnpm --filter @waitron/media exec vitest run src/images.test.ts`.
- [ ] **Step 3: Implement.** In `listImages`: `const search = textSearch(typed);` (untrimmed);
  keep the length check; `query` (trimmed) still decides the date fast path. For each row, the
  rank is the best of `search.rank(foldForSearch(name))` over `Object.values(row.names)`; keep rows
  with a rank; the relevance comparison is `compareSearchRanks(left.rank, right.rank)`; name and
  date sorting are unchanged; the id tie-break stays.
- [ ] **Step 4: Delete the grammar** and its tests; run `images.test.ts`, `routes.test.ts`,
  `src/dashboard/image-library.test.ts`; then `pnpm --filter @waitron/media test:coverage`,
  typecheck, lint, prettier. In the handover, list every test deleted with the grammar (by name),
  so the PR can list them (spec → Testing).
- [ ] **Step 5: Commit.** Stage the changed and deleted files by path (`git rm` for the deleted
  test), then `git commit -s -m "Image search follows the same rule as every other search"`.

---

### Task 9: Docs and backlog

**Files:**
- Modify: `docs/backlog.md` and `docs/backlog/catalogue.md` — delete the entry "Product search and
  image search follow different rules, and a search of only punctuation lists every product" and
  its detail section (added by commit 27bd5f36c), and the entry "`wt-data-table` searches a
  column's sort value when it has no search value" (Task 2 removed that fallback) with its detail
  (grep `docs/backlog/` for it)
- Sweep: `grep -rn -i "search" docs/developers/*.md docs/*.md` for prose describing the old rules
  (substring tables, image search grammar, "unbroken", a table searching its sort values), and fix
  what this branch made false — `docs/developers/design-system.md` describes `wt-data-table` and
  `wt-combobox`; read their search sections. Add the rule there in one short paragraph: a search
  matches every word in any order on the row's names (its `searchValue` columns), ignoring accents,
  capitals and punctuation, and lists the closest first (in a tree, under each parent; in a grouped
  dropdown, within each group).

- [ ] **Step 1: Make the edits.** `docs/` is ignored by prettier; check with
  `pnpm exec prettier --file-info docs/backlog.md` (prints `"ignored": true`).
- [ ] **Step 2: Run** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` from the worktree
  root (it checks links in docs this task may touch).
- [ ] **Step 3: Commit.** Stage the doc files by path, then
  `git commit -s -m "Docs and backlog: one search rule everywhere"`.

---

## After the last task

Run `/finish-branch ~/workspace/worktrees/waitron-search-everywhere` with a note naming this plan.
This branch takes the full review path: it changes the shared table and dropdown other packages
depend on (a cross-package contract) and the Orders cursor.
