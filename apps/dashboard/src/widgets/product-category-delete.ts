import { css, html, nothing } from "lit";
import type {
  CategorySummary,
  FolderContents,
  FolderSummary,
  Product,
  ProductSelection,
} from "../api/client.js";
import { conjunctionList } from "../i18n/list.js";
import { fill, t } from "../i18n/t.js";
import { categoryAncestors, PATH_SEPARATOR, categoryWithDescendants } from "./category-form.js";
import { countOf } from "./count-text.js";

export const productCategoryDeleteStyles = css`
  .category-delete-paths,
  .category-delete-choices {
    overflow-wrap: anywhere;
  }
  .category-delete-choices {
    margin: var(--wt-space-4) 0;
    padding: var(--wt-space-3);
    min-inline-size: 0;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
  }
  .category-delete-choice {
    display: flex;
    align-items: center;
    gap: var(--wt-space-2);
    min-height: var(--wt-tap-min);
  }
  .category-delete-choice input {
    flex-shrink: 0;
    margin: 0;
    accent-color: var(--wt-color-primary);
  }
`;

export function categoryDeleteImpact(
  selection: ProductSelection,
  summaries: readonly FolderSummary[],
  categories: readonly CategorySummary[],
  products: readonly Product[],
) {
  const selectedCategories = new Set(selection.categoryIds);
  const selectedSummaries = summaries.filter(({ id }) => selectedCategories.has(id));
  const roots = selectedSummaries.filter(({ id }) => {
    const category = categories.find((item) => item.id === id);
    return (
      !category ||
      !categoryAncestors(category, categories)
        .slice(1)
        .some((parent) => selectedCategories.has(parent.id))
    );
  });
  const subtree = new Set(roots.flatMap(({ id }) => [...categoryWithDescendants(id, categories)]));
  const selectedProducts = new Set(selection.productIds);
  let selectedInside = 0;
  for (const { id, active, primaryCategoryId } of products) {
    if (!active || primaryCategoryId === null || !subtree.has(primaryCategoryId)) continue;
    if (selectedProducts.has(id)) selectedInside++;
  }
  return {
    folders: Math.max(
      0,
      roots.reduce((count, root) => count + root.folders, 0) -
        (selectedSummaries.length - roots.length),
    ),
    active: Math.max(
      0,
      roots.reduce((count, root) => count + root.activeProducts, 0) - selectedInside,
    ),
  };
}

export function deleteSelectionHeading(
  selection: ProductSelection,
  categories: readonly CategorySummary[],
  products: readonly Product[],
): string {
  const [categoryId] = selection.categoryIds;
  const [productId] = selection.productIds;
  const categoryCount = selection.categoryIds.length;
  const productCount = selection.productIds.length;
  if (categoryCount + productCount === 1) {
    const name =
      categoryId !== undefined
        ? (categories.find(({ id }) => id === categoryId)?.name ?? categoryId)
        : (products.find(({ id }) => id === productId)?.name ?? productId!);
    return fill("folders.delete_named_heading", { name });
  }
  const items = conjunctionList([
    ...(categoryCount ? [countOf("folders.count", categoryCount)] : []),
    ...(productCount ? [countOf("folders.product_count", productCount)] : []),
  ]);
  return fill("folders.delete_selection_heading", { items });
}

/** Number matching paths in the tree's depth-first order, using the list's order for ties. */
function numberedPaths(categories: readonly CategorySummary[]) {
  const known = new Set(categories.map(({ id }) => id));
  const children = new Map<string | null, CategorySummary[]>();
  for (const category of categories) {
    const parent =
      category.parentId !== null && known.has(category.parentId) ? category.parentId : null;
    (children.get(parent) ?? children.set(parent, []).get(parent)!).push(category);
  }
  const sharing = new Map<string, string[]>();
  const pathOf = new Map<string, string>();
  const walk = (parentId: string | null, prefix = ""): void => {
    for (const category of children.get(parentId) ?? []) {
      if (pathOf.has(category.id)) continue;
      const path = prefix + category.name;
      pathOf.set(category.id, path);
      (sharing.get(path) ?? sharing.set(path, []).get(path)!).push(category.id);
      walk(category.id, path + PATH_SEPARATOR);
    }
  };
  walk(null);
  return (id: string) => {
    const path = pathOf.get(id) ?? id;
    const same = sharing.get(path) ?? [];
    return same.length < 2
      ? path
      : fill("folders.path_ordinal", {
          path,
          position: String(same.indexOf(id) + 1),
          total: String(same.length),
        });
  };
}

export function categoryDeletePaths(
  selection: ProductSelection,
  categories: readonly CategorySummary[],
) {
  const path = numberedPaths(categories);
  const paths = selection.categoryIds.map(path);
  const [id] = selection.categoryIds;
  if (paths.length === 1 && paths[0] === categories.find((category) => category.id === id)?.name)
    return nothing;
  return html`<ul class="category-delete-paths" data-test="deleting">
    ${paths.map((name) => html`<li>${name}</li>`)}
  </ul>`;
}

export function categoryDeleteChoices(
  selection: ProductSelection,
  categories: readonly CategorySummary[],
  impact: ReturnType<typeof categoryDeleteImpact>,
  choice: FolderContents,
  busy: boolean,
  change: (event: Event) => void,
) {
  const { folders, active } = impact;
  if (!folders && !active) return nothing;
  const selected = new Set(selection.categoryIds);
  const parentOf = (category: CategorySummary) =>
    categoryAncestors(category, categories)
      .slice(1)
      .find(({ id }) => !selected.has(id))?.id ?? null;
  const removed = categories.filter(({ id }) => selected.has(id));
  const parents = new Set(removed.map(parentOf));
  const after = numberedPaths(
    categories
      .filter(({ id }) => !selected.has(id))
      .map((category) => ({ ...category, parentId: parentOf(category) })),
  );
  const [parent] = parents;
  const differingParents = parents.size > 1;
  const before = differingParents ? numberedPaths(categories) : null;
  const placement = differingParents
    ? t("folders.keep_each_parent")
    : parent
      ? fill("folders.keep_move_to", { parent: after(parent) })
      : t(folders ? "folders.keep_top" : "folders.keep_no_category");
  const items = conjunctionList([
    ...(folders ? [countOf("folders.contents_category_count", folders)] : []),
    ...(active ? [countOf("folders.contents_product_count", active)] : []),
  ]);
  const ownership = selection.categoryIds.length === 1 ? "one" : "many";
  return html`<fieldset class="category-delete-choices" .disabled=${busy}>
    <legend>${t(`folders.contents_question_${ownership}`)} *</legend>
    ${(
      [
        ["move_up", fill(`folders.keep_contents_${ownership}`, { items, placement })],
        ["delete", fill(`folders.delete_contents_${ownership}`, { items })],
      ] as const
    ).map(
      ([value, label]) => html`
        <label class="category-delete-choice">
          <input
            type="radio"
            name="contents"
            required
            value=${value}
            .checked=${choice === value}
            @change=${change}
          />
          <span>${label}</span>
        </label>
        ${
          value === "move_up" && before
            ? html`
                <ul data-test="category-delete-destinations">
                  ${removed.map((category) => {
                    const destination = parentOf(category);
                    return html`<li>
                      ${before(category.id)} →
                      ${destination ? after(destination) : t("categories.none")}
                    </li>`;
                  })}
                </ul>
              `
            : nothing
        }
      `,
    )}
  </fieldset>`;
}
