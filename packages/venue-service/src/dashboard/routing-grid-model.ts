import { createLabelComparator, foldForSearch, textSearch } from "@waitron/shared";
import {
  cellKey,
  selectionRulesFromModel,
  selectRoutingCell,
  targetKey,
  type GridCategory,
  type GridProduct,
  type GridRow,
  type RouteTarget,
  type RoutingModel,
  type RoutingPeriod,
  type RoutingRow,
  type SelectedCell,
} from "../routing.js";
import type { PeriodLine, RoutingModelCell } from "../routing-types.js";
import { format } from "./hours-view.js";

function append<T>(lists: Map<string, T[]>, key: string, value: T): void {
  const list = lists.get(key);
  if (list === undefined) lists.set(key, [value]);
  else list.push(value);
}

function hasNoCategoryCell(model: RoutingModel): boolean {
  return model.cells.some((cell) => cell.row.kind === "no_category");
}

/**
 * The grid's rows in tree order: All categories, the root categories, every row whose ancestors
 * are all expanded, every category or product holding a cell together with every ancestor of it,
 * then the No category row — while a product has no category or the row holds a cell — and the
 * products with no category under it. A shown category that is not in `expanded` lists only the
 * children that hold a cell or have a descendant that does; one in `expanded` lists all of them.
 * Siblings are sorted by name with the shared label comparison, equal names keeping the model's
 * order. A category that is its own parent is sorted with the roots. Categories on or below a
 * longer parent cycle follow the roots, and the cycle members placed at the top level are not
 * sorted by name; a category's subcategories come before its products.
 */
export function visibleRoutingRows(model: RoutingModel, expanded: ReadonlySet<string>): GridRow[] {
  const known = new Map(model.categories.map((category) => [category.id, category]));
  const childCategories = new Map<string, GridCategory[]>();
  const productsIn = new Map<string, GridProduct[]>();
  const uncategorised: GridProduct[] = [];
  const roots: GridCategory[] = [];
  for (const category of model.categories) {
    const parent = category.parentId;
    if (parent === null || parent === category.id || !known.has(parent)) {
      roots.push(category);
    } else {
      append(childCategories, parent, category);
    }
  }
  for (const product of model.products) {
    if (product.categoryId === null || !known.has(product.categoryId)) {
      uncategorised.push(product);
    } else {
      append(productsIn, product.categoryId, product);
    }
  }
  const compare = createLabelComparator();
  const byName = (a: { name: string }, b: { name: string }): number => compare(a.name, b.name);
  roots.sort(byName);
  uncategorised.sort(byName);
  for (const list of childCategories.values()) list.sort(byName);
  for (const list of productsIn.values()) list.sort(byName);
  const categoriesWithCells = new Set<string>();
  const productsWithCells = new Set<string>();
  for (const { row } of model.cells) {
    if (row.kind === "category") categoriesWithCells.add(row.categoryId);
    if (row.kind === "product") productsWithCells.add(row.productId);
  }

  const entries: GridRow[] = [{ row: { kind: "all" }, name: "", path: [], depth: 0 }];
  const placed = new Set<string>();

  // Returns whether the subtree holds a cell, which shows the category even under a closed
  // parent. A category that turns out hidden takes back the rows its subtree wrote.
  function place(category: GridCategory, path: string[], parentOpen: boolean): boolean {
    placed.add(category.id);
    const mark = entries.length;
    const depth = path.length + 1;
    const open = expanded.has(category.id);
    const childPath = [...path, category.name];
    entries.push({
      row: { kind: "category", categoryId: category.id },
      name: category.name,
      path,
      depth,
    });
    let forced = categoriesWithCells.has(category.id);
    for (const child of childCategories.get(category.id) ?? []) {
      if (placed.has(child.id)) continue;
      if (place(child, childPath, open)) forced = true;
    }
    for (const product of productsIn.get(category.id) ?? []) {
      const own = productsWithCells.has(product.id);
      if (own) forced = true;
      if (open || own) {
        entries.push({
          row: { kind: "product", productId: product.id },
          name: product.name,
          path: childPath,
          depth: depth + 1,
        });
      }
    }
    if (!parentOpen && !forced) entries.length = mark;
    return forced;
  }

  for (const root of roots) place(root, [], true);
  // What is left sits on or below a parent cycle, every ancestor unplaced and listed. Walking up
  // reaches a cycle member, placed as a root so the rest of its cycle and subtree fall under it.
  for (const category of model.categories) {
    if (placed.has(category.id)) continue;
    const seen = new Set<string>();
    let member = category;
    while (!seen.has(member.id)) {
      seen.add(member.id);
      member = known.get(member.parentId!)!;
    }
    place(member, [], true);
  }

  if (uncategorised.length > 0 || hasNoCategoryCell(model)) {
    entries.push({
      row: { kind: "no_category" },
      name: "",
      path: [],
      depth: 0,
    });
    for (const product of uncategorised) {
      entries.push({
        row: { kind: "product", productId: product.id },
        name: product.name,
        path: [],
        depth: 1,
      });
    }
  }
  return entries;
}

export function expandCategory(expanded: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return new Set([...expanded, id]);
}

export function collapseCategory(expanded: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(expanded);
  next.delete(id);
  return next;
}

export function expandAll(model: RoutingModel): ReadonlySet<string> {
  return new Set(model.categories.map((category) => category.id));
}

export function collapseAll(): ReadonlySet<string> {
  return new Set();
}

/** Keeps the expanded categories the refreshed model still has; a new one starts collapsed. */
export function pruneExpanded(
  model: RoutingModel,
  expanded: ReadonlySet<string>,
): ReadonlySet<string> {
  const known = new Set(model.categories.map((category) => category.id));
  return new Set([...expanded].filter((id) => known.has(id)));
}

/** Whether `visibleRoutingRows` lists the row once every category is expanded. */
export function rowInModel(model: RoutingModel, row: RoutingRow): boolean {
  switch (row.kind) {
    case "all":
      return true;
    case "category":
      return model.categories.some((category) => category.id === row.categoryId);
    case "product":
      return model.products.some((product) => product.id === row.productId);
    case "no_category": {
      const known = new Set(model.categories.map((category) => category.id));
      return (
        hasNoCategoryCell(model) ||
        model.products.some(
          (product) => product.categoryId === null || !known.has(product.categoryId),
        )
      );
    }
  }
}

export interface PeriodLineText {
  readonly periodIds: readonly string[];
  readonly target: RouteTarget;
  /** "Lunch, Afternoon: Downstairs bar". */
  readonly text: string;
  /** "Not on Lunch menus": the line's periods whose menus reach none of the row's active products;
   * only on a line its cell stores. */
  readonly flagText?: string;
}

export interface CellPeriodLines {
  /** The coordinate has no cell of its own, so its lines are those of the cell deciding it. */
  readonly inherited: boolean;
  readonly lines: readonly PeriodLineText[];
}

/**
 * Three or more periods read "first–last" only when they run on in their one department's order.
 * A name repeated anywhere among the cell's lines carries its department.
 */
export function periodsText(
  periods: readonly RoutingPeriod[],
  all: readonly RoutingPeriod[],
  repeated: ReadonlySet<string>,
): string {
  const named = (period: RoutingPeriod) =>
    repeated.has(period.name)
      ? format("routing.period_in_department", {
          period: period.name,
          department: period.departmentName,
        })
      : period.name;
  const first = periods[0]!;
  const last = periods[periods.length - 1]!;
  if (periods.length <= 2) return periods.map(named).join(", ");
  const department = all.filter(({ departmentId }) => departmentId === first.departmentId);
  const from = department.indexOf(first);
  const runsOn = periods.every((period, i) => department[from + i] === period);
  return runsOn
    ? format("routing.period_span", { first: named(first), last: named(last) })
    : format("routing.period_more", { first: named(first), count: String(periods.length - 1) });
}

type StoredLine = NonNullable<RoutingModelCell["periods"]>[number];

/** A choice not yet saved: its target, and its lines when it has any; a null target clears. */
export interface WaitingChoice {
  readonly target: RouteTarget | null;
  readonly periods?: readonly PeriodLine[];
}

/**
 * A coordinate's period lines, one per target, each ordered and ordered among themselves by the
 * model's period order. A coordinate with no cell of its own shows the lines of the cell that
 * decides it. A line's period the model does not list is left out, and so, in a zone column, is a
 * line of another department's period, which the server never applies there. A waiting choice
 * stands in for the coordinate's own cell.
 */
export function cellPeriodLines(
  model: RoutingModel,
  targetText: (target: RouteTarget) => string,
): (row: RoutingRow, zoneId: string | null, waiting?: WaitingChoice) => CellPeriodLines {
  const rules = selectionRulesFromModel(model);
  const cells = new Map(model.cells.map((cell) => [cellKey(cell), cell]));
  const order = new Map(model.periods.map((period, i) => [period.id, i]));
  const categoryOf = new Map(model.products.map(({ id, categoryId }) => [id, categoryId]));
  const zoneDepartment = new Map(model.zones.map(({ id, departmentId }) => [id, departmentId]));

  const linesOf = (
    stored: readonly StoredLine[],
    zoneId: string | null,
    own: boolean,
  ): PeriodLineText[] => {
    const byTarget = new Map<
      string,
      { target: RouteTarget; periods: RoutingPeriod[]; flagged: RoutingPeriod[] }
    >();
    const departmentId = zoneId === null ? undefined : (zoneDepartment.get(zoneId) ?? null);
    const applies = (periodId: string) =>
      departmentId === undefined ||
      model.periods[order.get(periodId)!]!.departmentId === departmentId;
    const known = stored
      .filter(({ periodId }) => order.has(periodId) && applies(periodId))
      .sort((a, b) => order.get(a.periodId)! - order.get(b.periodId)!);
    for (const { periodId, target, notOffered } of known) {
      const key = targetKey(target);
      const period = model.periods[order.get(periodId)!]!;
      const line = byTarget.get(key) ?? { target, periods: [], flagged: [] };
      byTarget.set(key, line);
      line.periods.push(period);
      if (own && notOffered === true) line.flagged.push(period);
    }
    const names = new Map<string, Set<string>>();
    for (const { periodId } of known) {
      const { id, name } = model.periods[order.get(periodId)!]!;
      names.set(name, (names.get(name) ?? new Set()).add(id));
    }
    const repeated = new Set([...names].filter(([, ids]) => ids.size > 1).map(([name]) => name));
    return [...byTarget.values()].map(({ target, periods, flagged }) => ({
      periodIds: periods.map(({ id }) => id),
      target,
      text: format("routing.period_line", {
        periods: periodsText(periods, model.periods, repeated),
        target: targetText(target),
      }),
      ...(flagged.length === 0
        ? {}
        : {
            flagText: format("routing.period_not_on_menus", {
              periods: periodsText(flagged, model.periods, repeated),
            }),
          }),
    }));
  };

  return (row, zoneId, waiting) => {
    const stored = cells.get(cellKey({ row, zoneId }));
    const own =
      waiting === undefined
        ? stored && (stored.periods ?? [])
        : waiting.target === null
          ? undefined
          : (waiting.periods ?? []);
    if (own !== undefined) return { inherited: false, lines: linesOf(own, zoneId, true) };
    const category = row.kind === "product" ? (categoryOf.get(row.productId) ?? null) : null;
    const { decidedBy } = selectRoutingCell(rules, row, zoneId, category, { skipOwn: true });
    const deciding = decidedBy?.kind === "cell" ? cells.get(cellKey(decidedBy.address)) : undefined;
    return { inherited: true, lines: linesOf(deciding?.periods ?? [], zoneId, false) };
  };
}

/**
 * Whether a zone cell, judged without any setting of its own, draws blank: it inherits the same
 * target as the row's own Every zone, and the same (period, target) lines that apply in the zone —
 * each side's lines being those its deciding cell stores, for periods the model lists and of the
 * zone's department. The grid draws a cell set here, or a waiting choice, before asking.
 */
export function blankZoneCell(model: RoutingModel): (row: RoutingRow, zoneId: string) => boolean {
  const rules = selectionRulesFromModel(model);
  const cells = new Map(model.cells.map((cell) => [cellKey(cell), cell]));
  const periodDepartment = new Map(model.periods.map(({ id, departmentId }) => [id, departmentId]));
  const categoryOf = new Map(model.products.map(({ id, categoryId }) => [id, categoryId]));
  const zoneDepartment = new Map(model.zones.map(({ id, departmentId }) => [id, departmentId]));
  return (row, zoneId) => {
    const category = row.kind === "product" ? categoryOf.get(row.productId) : null;
    const zone = selectRoutingCell(rules, row, zoneId, category, { skipOwn: true });
    const every = selectRoutingCell(rules, row, null, category);
    if (targetKey(zone.target) !== targetKey(every.target)) return false;
    const departmentId = zoneDepartment.get(zoneId) ?? null;
    const linesOf = ({ decidedBy }: SelectedCell): Set<string> => {
      const deciding =
        decidedBy?.kind === "cell" ? cells.get(cellKey(decidedBy.address)) : undefined;
      return new Set(
        (deciding?.periods ?? [])
          .filter(({ periodId }) => periodDepartment.get(periodId) === departmentId)
          .map(({ periodId, target }) => `${periodId} ${targetKey(target)}`),
      );
    };
    const zoneLines = linesOf(zone);
    const everyLines = linesOf(every);
    return (
      zoneLines.size === everyLines.size && [...zoneLines].every((line) => everyLines.has(line))
    );
  };
}

/** UTF-16 offsets into the name as given: `start` inclusive, `end` exclusive. */
export interface MatchRange {
  readonly start: number;
  readonly end: number;
}

// textSearch's word rules (packages/shared/src/text-search.ts), copied rather than exported from
// there: a word is letters and digits, and a query still being typed ends in one.
const WORD = "[\\p{L}\\p{N}]";

/**
 * Where in `name` each query word sits, by `textSearch`'s rules: the word still being typed
 * anywhere, every other word only where it is whole. Sorted, with ranges that overlap or touch
 * merged. Empty exactly when `textSearch(query)` does not match the folded name.
 */
export function matchRanges(name: string, query: string): readonly MatchRange[] {
  const folded = foldForSearch(name);
  if (textSearch(query)?.rank(folded) === undefined) return [];
  const foldedQuery = foldForSearch(query);
  // A match means the query has at least one word.
  const words = foldedQuery.match(new RegExp(`${WORD}+`, "gu"))!;
  const typing = new RegExp(`${WORD}$`, "u").test(foldedQuery);
  // Folding one code point at a time gives the same length as folding the whole name: only the
  // final sigma depends on its neighbours, and both sigmas are one unit long.
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const character of name) {
    const piece = foldForSearch(character);
    for (let i = 0; i < piece.length; i++) {
      starts.push(offset);
      ends.push(offset + character.length);
    }
    // A combining mark folds to nothing; it belongs with the letter before it.
    if (piece.length === 0 && ends.length > 0) ends[ends.length - 1] = offset + character.length;
    offset += character.length;
  }
  const found: [number, number][] = [];
  words.forEach((word, i) => {
    if (typing && i === words.length - 1) {
      for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1))
        found.push([at, at + word.length]);
    } else {
      for (const { index } of folded.matchAll(new RegExp(`(?<!${WORD})${word}(?!${WORD})`, "gu")))
        found.push([index, index + word.length]);
    }
  });
  found.sort((a, b) => a[0] - b[0]);
  const ranges: { start: number; end: number }[] = [];
  for (const [from, to] of found) {
    const start = starts[from]!;
    const end = ends[to - 1]!;
    const last = ranges.at(-1);
    if (last !== undefined && start <= last.end) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  return ranges;
}

export interface SearchRow {
  readonly entry: GridRow;
  /** The category's or product's own name matches the query. */
  readonly match: boolean;
  /** Not a match, but leads to one: All categories always, an ancestor, No category over its matches. */
  readonly parent: boolean;
  /** Empty unless `match`. */
  readonly ranges: readonly MatchRange[];
}

export interface RoutingSearch {
  /** Tree order, as `visibleRoutingRows` sorts it. */
  readonly rows: readonly SearchRow[];
  /** Every match, shown or under a closed category. */
  readonly count: number;
  /** The open categories the rows were drawn with. */
  readonly open: ReadonlySet<string>;
}

/**
 * The rows a search shows: All categories, then each category or product whose own name matches
 * and each of its ancestors (No category over an uncategorised match). `open` defaults to every
 * category that is an ancestor of a match, so matched categories start closed. An open ancestor
 * lists only its children that match or lead to a match; any other open category lists all its
 * children. A cell of a row's own adds no row. Undefined for a blank query: no search.
 */
export function searchRows(
  model: RoutingModel,
  query: string,
  open?: ReadonlySet<string>,
): RoutingSearch | undefined {
  const search = textSearch(query);
  if (search === undefined) return undefined;
  const tree = visibleRoutingRows(model, expandAll(model));
  // With every category expanded, a row's parent is the nearest row above it one level up.
  const parentOf: number[] = [];
  const stack: number[] = [];
  tree.forEach((entry, i) => {
    while (stack.length > 0 && tree[stack.at(-1)!]!.depth >= entry.depth) stack.pop();
    parentOf.push(stack.at(-1) ?? -1);
    stack.push(i);
  });
  const match = tree.map(
    ({ row, name }) =>
      (row.kind === "category" || row.kind === "product") &&
      search.rank(foldForSearch(name)) !== undefined,
  );
  const leads = new Set<number>([0]);
  match.forEach((matched, i) => {
    if (!matched) return;
    for (let up = parentOf[i]!; up !== -1 && !leads.has(up); up = parentOf[up]!) leads.add(up);
  });
  const opened =
    open ??
    new Set(
      [...leads].flatMap((i) => {
        const { row } = tree[i]!;
        return row.kind === "category" ? [row.categoryId] : [];
      }),
    );
  const isOpen = ({ row }: GridRow) => row.kind !== "category" || opened.has(row.categoryId);
  const shown: boolean[] = [];
  const rows: SearchRow[] = [];
  tree.forEach((entry, i) => {
    const up = parentOf[i]!;
    const relevant = match[i]! || leads.has(i);
    const visible =
      up === -1 ? relevant : shown[up]! && isOpen(tree[up]!) && (relevant || !leads.has(up));
    shown.push(visible);
    if (!visible) return;
    rows.push({
      entry,
      match: match[i]!,
      parent: !match[i]! && leads.has(i),
      ranges: match[i]! ? matchRanges(entry.name, query) : [],
    });
  });
  return { rows, count: match.filter(Boolean).length, open: opened };
}
