import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import { menuDetails, menuItems } from "./schema/menu.js";
import { menuItemExtraItems, menuItemExtraLists } from "./schema/extras.js";
import { sections } from "./schema/sections.js";
import { menuItemVariantOverrides } from "./schema/variant-overrides.js";
import { loadSectionGraph, reachableProducts, type SectionGraph } from "./section-graph.js";
import type { MemberRef } from "./section-types.js";
import "./errors.js";

/** One member of a menu's structure; `children` is present exactly when the member is a section. */
export interface MenuStructureNode {
  memberId: string;
  ref: MemberRef;
  children?: MenuStructureNode[];
}

const HOME_LAYOUT_NAME = "Home";

/** The root and default home layout every menu has from the moment it is created. */
export async function createMenuShell(
  tx: Transaction,
  menuId: string,
  menuName: string,
): Promise<{ rootSectionId: string; defaultHomeLayoutId: string }> {
  const [root] = await tx
    .insert(sections)
    .values({ internalName: menuName, role: "menu_root", ownerMenuId: menuId })
    .returning({ id: sections.id });
  const [layout] = await tx
    .insert(sections)
    .values({ internalName: HOME_LAYOUT_NAME, role: "home_layout", ownerMenuId: menuId })
    .returning({ id: sections.id });
  const shell = { rootSectionId: root!.id, defaultHomeLayoutId: layout!.id };
  await tx.insert(menuDetails).values({ menuId, ...shell });
  return shell;
}

/** Each named menu's root; a menu with no details row is left out. */
export async function menuRoots(
  tx: Transaction,
  menuIds: readonly string[],
): Promise<Map<string, string>> {
  const roots = new Map<string, string>();
  for (const batch of batches(menuIds)) {
    const rows = await tx
      .select({ menuId: menuDetails.menuId, rootSectionId: menuDetails.rootSectionId })
      .from(menuDetails)
      .where(inArray(menuDetails.menuId, batch));
    for (const row of rows) roots.set(row.menuId, row.rootSectionId);
  }
  return roots;
}

/** The menu's root; undefined for a menu with no details row. */
export async function menuRoot(tx: Transaction, menuId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ rootSectionId: menuDetails.rootSectionId })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  return row?.rootSectionId;
}

export async function requireMenuRoot(tx: Transaction, menuId: string): Promise<string> {
  const rootSectionId = await menuRoot(tx, menuId);
  if (rootSectionId === undefined)
    throw new AppError("catalogue.not_found", { catalogueId: menuId });
  return rootSectionId;
}

function nodesOf(graph: SectionGraph, sectionId: string): MenuStructureNode[] {
  return graph
    .children(sectionId)
    .map(({ id, ref }) =>
      ref.kind === "product"
        ? { memberId: id, ref }
        : { memberId: id, ref, children: nodesOf(graph, ref.sectionId) },
    );
}

export async function readMenuStructure(
  tx: Transaction,
  menuId: string,
): Promise<{ rootSectionId: string; nodes: MenuStructureNode[] }> {
  const rootSectionId = await requireMenuRoot(tx, menuId);
  const graph = await loadSectionGraph(tx);
  return { rootSectionId, nodes: nodesOf(graph, rootSectionId) };
}

/**
 * The menu item, when its menu's structure reaches its product; a row the structure no longer
 * reaches has been reset and takes no settings until the product is back.
 */
export async function reachableMenuItem(
  tx: Transaction,
  menuItemId: string,
  menuId?: string,
): Promise<{ menuId: string; productId: string } | undefined> {
  const [row] = await tx
    .select({ menuId: menuItems.menuId, productId: menuItems.productId })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.id, menuItemId),
        ...(menuId === undefined ? [] : [eq(menuItems.menuId, menuId)]),
      ),
    );
  if (row === undefined) return undefined;
  const rootSectionId = await menuRoot(tx, row.menuId);
  if (rootSectionId === undefined) return undefined;
  const graph = await loadSectionGraph(tx);
  return reachableProducts(graph, rootSectionId).includes(row.productId) ? row : undefined;
}

/**
 * Brings each menu's `menu_items` rows in line with what its structure reaches: a row for every
 * product reached, active or not, and every other row of the menu reset to "starts fresh" — no menu
 * price, switched on, and no variant or extras overrides. Rows are reset rather than deleted
 * because `working_line_contexts.menu_item_id` keeps keys into the table with no delete rule.
 *
 * With `before`, the graph a structure write read before writing, only the products that write put
 * on the menu get a row, and only the rows it took off are reset: a product `before` reached got its
 * row from the write that put it there, and a row the menu stopped reaching earlier was reset then,
 * with every settings write refusing it since (`reachableMenuItem`).
 */
export async function syncMenuOffers(
  tx: Transaction,
  menuIds: readonly string[],
  before?: SectionGraph,
): Promise<void> {
  if (menuIds.length === 0) return;
  const roots = await menuRoots(tx, menuIds);
  if (roots.size === 0) return;
  const graph = await loadSectionGraph(tx);
  for (const [menuId, rootSectionId] of roots) {
    const reached = reachableProducts(graph, rootSectionId);
    const held = new Set(reached);
    const heldBefore =
      before === undefined ? undefined : new Set(reachableProducts(before, rootSectionId));
    const adding =
      heldBefore === undefined
        ? reached
        : reached.filter((productId) => !heldBefore.has(productId));
    for (const batch of batches(adding))
      await tx
        .insert(menuItems)
        .values(batch.map((productId) => ({ menuId, productId })))
        .onConflictDoNothing({ target: [menuItems.menuId, menuItems.productId] });
    const stale =
      heldBefore === undefined
        ? await rowsNotHeld(tx, menuId, held)
        : await rowsOf(
            tx,
            menuId,
            [...heldBefore].filter((productId) => !held.has(productId)),
          );
    for (const batch of batches(stale)) {
      await tx
        .delete(menuItemVariantOverrides)
        .where(inArray(menuItemVariantOverrides.menuItemId, batch));
      await tx.delete(menuItemExtraItems).where(inArray(menuItemExtraItems.menuItemId, batch));
      await tx.delete(menuItemExtraLists).where(inArray(menuItemExtraLists.menuItemId, batch));
      await tx
        .update(menuItems)
        .set({ grossPrice: null, active: true })
        .where(
          and(
            inArray(menuItems.id, batch),
            or(isNotNull(menuItems.grossPrice), eq(menuItems.active, false)),
          ),
        );
    }
  }
}

async function rowsNotHeld(
  tx: Transaction,
  menuId: string,
  held: ReadonlySet<string>,
): Promise<string[]> {
  const rows = await tx
    .select({ id: menuItems.id, productId: menuItems.productId })
    .from(menuItems)
    .where(eq(menuItems.menuId, menuId));
  return rows.filter((row) => !held.has(row.productId)).map((row) => row.id);
}

async function rowsOf(
  tx: Transaction,
  menuId: string,
  productIds: readonly string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const batch of batches(productIds))
    for (const row of await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(and(eq(menuItems.menuId, menuId), inArray(menuItems.productId, batch))))
      ids.push(row.id);
  return ids;
}
