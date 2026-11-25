import {
  groupRoutingMoves,
  previewFrom,
  previewTargetName,
  previewTo,
  routingPreviewTable,
} from "@waitron/venue-service/dashboard/routing-preview";
import type { ProductItemsRoutingPreview, RoutingModel } from "@waitron/venue-service/routing";
import { css, html, nothing } from "lit";
import "@waitron/ui/src/components/wt-disclosure.js";
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
  .category-delete-choices,
  .category-delete-routing > p {
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
  .category-delete-choice small {
    display: block;
    color: var(--wt-color-text-muted);
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
  const kept = new Set<string>();
  let selectedInside = 0;
  for (const { id, active, primaryCategoryId } of products) {
    if (!active || primaryCategoryId === null || !subtree.has(primaryCategoryId)) continue;
    if (selectedProducts.has(id)) selectedInside++;
    else kept.add(id);
  }
  return {
    kept,
    folders: Math.max(
      0,
      roots.reduce((count, root) => count + root.folders, 0) -
        (selectedSummaries.length - roots.length),
    ),
    active: Math.max(
      0,
      roots.reduce((count, root) => count + root.activeProducts, 0) - selectedInside,
    ),
    keepRules: selectedSummaries.reduce((count, summary) => count + summary.ownRoutes, 0),
    deleteRules: roots.reduce((count, root) => count + root.routes, 0),
  };
}

export function categoryDeleteHeading(
  selection: ProductSelection,
  categories: readonly CategorySummary[],
  products: readonly Product[],
): string {
  if (!selection.productIds.length && selection.categoryIds.length > 1)
    return countOf("folders.delete_categories_heading", selection.categoryIds.length);
  const names = [
    ...selection.categoryIds.map(
      (id) => categories.find((category) => category.id === id)?.name ?? id,
    ),
    ...selection.productIds.map((id) => products.find((product) => product.id === id)?.name ?? id),
  ];
  return fill("folders.delete_named_heading", { names: conjunctionList(names) });
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

function routeRemoval(count: number) {
  return count
    ? fill("folders.remove_routes", { rules: countOf("folders.route_count", count) })
    : "";
}

export function categoryDeleteChoices(
  selection: ProductSelection,
  categories: readonly CategorySummary[],
  impact: ReturnType<typeof categoryDeleteImpact>,
  choice: FolderContents,
  busy: boolean,
  change: (event: Event) => void,
) {
  const { folders, active, keepRules, deleteRules } = impact;
  if (!folders && !active) return keepRules ? html`<p>${routeRemoval(keepRules)}</p>` : nothing;
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
      ? fill("folders.keep_in", { parent: after(parent) })
      : t(folders ? "folders.keep_top" : "folders.keep_no_category");
  const items = conjunctionList([
    ...(folders ? [countOf("folders.contents_category_count", folders)] : []),
    ...(active ? [countOf("folders.contents_product_count", active)] : []),
  ]);
  const ownership = selection.categoryIds.length === 1 ? "one" : "many";
  return html`<fieldset class="category-delete-choices" .disabled=${busy}>
    <legend>${t("folders.contents_question")} *</legend>
    ${(
      [
        ["move_up", fill(`folders.keep_contents_${ownership}`, { items, placement }), keepRules],
        ["delete", fill(`folders.delete_contents_${ownership}`, { items }), deleteRules],
      ] as const
    ).map(
      ([value, label, rules]) => html`
        <label class="category-delete-choice">
          <input
            type="radio"
            name="contents"
            required
            value=${value}
            .checked=${choice === value}
            @change=${change}
          />
          <span
            ><span>${label}</span>
            ${rules ? html`<small>${routeRemoval(rules)}</small>` : nothing}</span
          >
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

export function categoryDeleteRouting(
  preview: ProductItemsRoutingPreview,
  routing: RoutingModel | null,
  kept: ReadonlySet<string> | null,
) {
  if (!preview.moves.length) return routingPreviewTable(preview);
  const targetName = previewTargetName(preview.stations);
  const groups = groupRoutingMoves(preview.moves, () => []);
  const zones = routing?.zones.length ? routing.zones.map(({ id }) => id) : [null];
  return html`<div class="category-delete-routing">
    ${groups.map(({ move, moves, products }) => {
      const baselineAcrossZones =
        routing !== null &&
        moves.every(({ periodIds }) => periodIds === null) &&
        [...products].every((id) =>
          zones.every((zone) =>
            moves.some(
              (entry) =>
                (entry.variantOf?.productId ?? entry.productId) === id && entry.zoneId === zone,
            ),
          ),
        );
      const asExtra = moves.some(({ dish }) => dish !== undefined);
      const ordinary = baselineAcrossZones && !asExtra;
      const all =
        ordinary &&
        groups.length === 1 &&
        products.size > 1 &&
        products.size === kept?.size &&
        [...products].every((id) => kept.has(id));
      const from = previewFrom(move, targetName);
      const to = previewTo(move, targetName);
      const scope = asExtra
        ? t("folders.station_order")
        : ordinary
          ? ""
          : t("folders.station_scoped");
      const usually = ordinary ? t("folders.station_usually") : "";
      const count = String(products.size);
      const stationPair = !asExtra && move.from?.kind === "station" && move.to?.kind === "station";
      const key = stationPair
        ? all
          ? "folders.station_all"
          : products.size === 1
            ? "folders.station_one"
            : "folders.station_many"
        : ordinary
          ? "folders.station_other_usual"
          : "folders.station_other";
      return html`<p data-test="category-delete-station">
        ${fill(key, { count, from, to, scope, usually })}
      </p>`;
    })}
    <wt-disclosure heading=${t("folders.station_details")}
      >${routingPreviewTable(preview)}</wt-disclosure
    >
  </div>`;
}
