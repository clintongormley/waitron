import { createLabelComparator } from "@waitron/shared";
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
} from "../routing.js";
import type { PeriodLine } from "../routing-types.js";
import { format } from "./hours-view.js";

interface Hidden {
  categories: number;
  products: number;
}

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
 * are all expanded, every category or product holding a cell (at its own place, without its
 * hidden ancestors), then the No category row — while a product has no category or the row holds
 * a cell — and the products with no category under it. A shown category's children are shown
 * exactly when its id is in `expanded`, so a category shown only for its cell opens too. A
 * category whose children are not shown counts the rows of its subtree that are absent. Siblings
 * are sorted by name with the shared label comparison, equal names keeping the model's order. A
 * category that is its own parent is sorted with the roots. Categories on or below a longer parent
 * cycle follow the roots, and the cycle members placed at the top level are not sorted by name; a
 * category's subcategories come before its products.
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

  const entries: GridRow[] = [
    { row: { kind: "all" }, name: "", path: [], depth: 0, hiddenProducts: 0, hiddenCategories: 0 },
  ];
  const placed = new Set<string>();

  // Returns the absent rows of `category`'s subtree, itself included, for its ancestors' counts.
  function place(category: GridCategory, path: string[], shown: boolean): Hidden {
    placed.add(category.id);
    const depth = path.length + 1;
    const visible = shown || categoriesWithCells.has(category.id);
    const open = visible && expanded.has(category.id);
    const entry: GridRow = {
      row: { kind: "category", categoryId: category.id },
      name: category.name,
      path,
      depth,
      hiddenProducts: 0,
      hiddenCategories: 0,
    };
    if (visible) entries.push(entry);
    const below: Hidden = { categories: 0, products: 0 };
    const childPath = [...path, category.name];
    for (const child of childCategories.get(category.id) ?? []) {
      if (placed.has(child.id)) continue;
      const absent = place(child, childPath, open);
      below.categories += absent.categories;
      below.products += absent.products;
    }
    for (const product of productsIn.get(category.id) ?? []) {
      if (open || productsWithCells.has(product.id)) {
        entries.push({
          row: { kind: "product", productId: product.id },
          name: product.name,
          path: childPath,
          depth: depth + 1,
          hiddenProducts: 0,
          hiddenCategories: 0,
        });
      } else {
        below.products += 1;
      }
    }
    if (!open) {
      entry.hiddenCategories = below.categories;
      entry.hiddenProducts = below.products;
    }
    return { categories: below.categories + (visible ? 0 : 1), products: below.products };
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
      hiddenProducts: 0,
      hiddenCategories: 0,
    });
    for (const product of uncategorised) {
      entries.push({
        row: { kind: "product", productId: product.id },
        name: product.name,
        path: [],
        depth: 1,
        hiddenProducts: 0,
        hiddenCategories: 0,
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
function periodsText(
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

  const linesOf = (stored: readonly PeriodLine[], zoneId: string | null): PeriodLineText[] => {
    const byTarget = new Map<string, { target: RouteTarget; periods: RoutingPeriod[] }>();
    const departmentId = zoneId === null ? undefined : (zoneDepartment.get(zoneId) ?? null);
    const applies = (periodId: string) =>
      departmentId === undefined ||
      model.periods[order.get(periodId)!]!.departmentId === departmentId;
    const known = stored
      .filter(({ periodId }) => order.has(periodId) && applies(periodId))
      .sort((a, b) => order.get(a.periodId)! - order.get(b.periodId)!);
    for (const { periodId, target } of known) {
      const key = targetKey(target);
      const period = model.periods[order.get(periodId)!]!;
      const line = byTarget.get(key);
      if (line === undefined) byTarget.set(key, { target, periods: [period] });
      else line.periods.push(period);
    }
    const names = new Map<string, Set<string>>();
    for (const { periodId } of known) {
      const { id, name } = model.periods[order.get(periodId)!]!;
      names.set(name, (names.get(name) ?? new Set()).add(id));
    }
    const repeated = new Set([...names].filter(([, ids]) => ids.size > 1).map(([name]) => name));
    return [...byTarget.values()].map(({ target, periods }) => ({
      periodIds: periods.map(({ id }) => id),
      target,
      text: format("routing.period_line", {
        periods: periodsText(periods, model.periods, repeated),
        target: targetText(target),
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
    if (own !== undefined) return { inherited: false, lines: linesOf(own, zoneId) };
    const category = row.kind === "product" ? (categoryOf.get(row.productId) ?? null) : null;
    const { decidedBy } = selectRoutingCell(rules, row, zoneId, category, { skipOwn: true });
    const deciding = decidedBy?.kind === "cell" ? cells.get(cellKey(decidedBy.address)) : undefined;
    return { inherited: true, lines: linesOf(deciding?.periods ?? [], zoneId) };
  };
}
