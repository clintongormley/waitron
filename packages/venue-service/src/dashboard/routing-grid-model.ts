import { createLabelComparator } from "@waitron/shared";
import type { GridCategory, GridProduct, GridRow, RoutingModel, RoutingRow } from "../routing.js";

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
 * category whose children are not shown counts the rows of its subtree that are absent. Siblings are sorted by name with the shared label comparison, equal
 * names keeping the model's order. A category that is its own parent is sorted with the roots.
 * Categories on or below a longer parent cycle follow the roots, and the cycle members placed at
 * the top level are not sorted by name; a category's subcategories come before its products.
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
