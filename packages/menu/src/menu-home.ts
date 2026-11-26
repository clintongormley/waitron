import { and, eq, inArray, ne } from "drizzle-orm";
import { menus, products, sectionMembers, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import type {
  HomeOrder,
  MenuHome,
  MenuHomeSaveInput,
  MenuHomeSaveResult,
  TileRef,
} from "@waitron/shared";
import {
  loadSectionGraph,
  reachableFrom,
  sectionPathName,
  type SectionGraph,
} from "./section-graph.js";
import { refColumns, refKey } from "./section-members.js";
import { menuHome, requireMenuRoot } from "./menu-structure.js";
import "./errors.js";

// A shortcut writes no `menu_items` row: no menu's root reaches a Device Home Page section.

interface HomeRow {
  rootSectionId: string;
  homeSectionId: string;
  order: HomeOrder;
}

/** The menu's root, its Device Home Page section and display order. */
async function requireMenuHome(tx: Transaction, menuId: string, writing = false): Promise<HomeRow> {
  const [row] = await tx.select().from(menus).where(eq(menus.id, menuId));
  if (row === undefined) throw new AppError("menu.not_found", { menuId: menuId });
  if (writing && !row.active) throw new AppError("menu.deleted", { menuId });
  return {
    rootSectionId: await requireMenuRoot(tx, menuId),
    homeSectionId: (await menuHome(tx, menuId))!,
    order: row.homeOrder,
  };
}

/** Whether the menu's working structure reaches a tile's target, whatever the menu's or the
 * product's switches. Publishing applies its own, narrower test. */
function structuralReach(graph: SectionGraph, rootSectionId: string): (ref: TileRef) => boolean {
  const reached = reachableFrom(graph, rootSectionId);
  const reachedProducts = new Set(reached.products);
  return (ref) =>
    ref.kind === "product"
      ? reachedProducts.has(ref.productId)
      : ref.kind === "section" && reached.sections.has(ref.sectionId);
}

/** The menu's working Device Home Page: every shortcut in order, the ones its structure no longer
 * reaches included and marked, and which block appears first. */
export async function readMenuHome(tx: Transaction, menuId: string): Promise<MenuHome> {
  const home = await requireMenuHome(tx, menuId);
  const graph = await loadSectionGraph(tx);
  const reaches = structuralReach(graph, home.rootSectionId);
  const tiles = graph.tiles(home.homeSectionId);
  const names = new Map<string, string>();
  const productIds = tiles.flatMap(({ ref }) => (ref.kind === "product" ? [ref.productId] : []));
  for (const batch of batches(productIds))
    for (const row of await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, batch)))
      names.set(row.id, row.name);
  return {
    homeSectionId: home.homeSectionId,
    shortcuts: tiles.map(({ id: memberId, position, ref }) => {
      const reachable = reaches(ref);
      const name =
        ref.kind === "missing"
          ? ref.name
          : ref.kind === "product"
            ? names.get(ref.productId)!
            : graph.section(ref.sectionId)!.internalName!;
      return {
        memberId,
        position,
        ref,
        name,
        reachable,
        missingName: reachable
          ? null
          : ref.kind === "section"
            ? sectionPathName(graph, ref.sectionId)
            : name,
      };
    }),
    order: home.order,
  };
}

export async function saveMenuHome(
  tx: Transaction,
  menuId: string,
  input: MenuHomeSaveInput,
): Promise<MenuHomeSaveResult> {
  const { homeSectionId, rootSectionId } = await requireMenuHome(tx, menuId, true);
  const graph = await loadSectionGraph(tx);
  if (graph.menu(menuId)?.kind === "set_menu")
    throw new AppError("set_menu.wrong_place", { menuId });
  const reaches = structuralReach(graph, rootSectionId);
  const held = new Map(graph.tiles(homeSectionId).map(({ id, ref }) => [id, ref]));
  const newIds = input.shortcuts
    .filter(({ memberId }) => !held.has(memberId))
    .map(({ memberId }) => memberId);
  const foreign = new Set<string>();
  for (const ids of batches(newIds))
    for (const row of await tx
      .select({ id: sectionMembers.id })
      .from(sectionMembers)
      .where(and(inArray(sectionMembers.id, ids), ne(sectionMembers.sectionId, homeSectionId))))
      foreign.add(row.id);
  const productIds = input.shortcuts.flatMap(({ memberId, ref }) =>
    !held.has(memberId) && ref.kind === "product" ? [ref.productId] : [],
  );
  const catalogue = new Map<string, { parentId: string | null; active: boolean }>();
  for (const ids of batches([...new Set(productIds)]))
    for (const row of await tx
      .select({ id: products.id, parentId: products.parentId, active: products.active })
      .from(products)
      .where(inArray(products.id, ids)))
      catalogue.set(row.id, row);

  const seenIds = new Set<string>();
  const seenTargets = new Set<string>();
  const values: (typeof sectionMembers.$inferInsert)[] = [];
  const dropped: MenuHomeSaveResult["dropped"] = [];
  for (const [index, { memberId, ref: requested }] of input.shortcuts.entries()) {
    const path = "shortcuts." + index;
    if (seenIds.has(memberId) || foreign.has(memberId))
      throw new AppError("menu_section.membership_invalid", { field: path + ".memberId" });
    seenIds.add(memberId);
    const stored = held.get(memberId);
    const ref = stored ?? (requested.kind === "missing" ? undefined : requested);
    if (ref === undefined)
      throw new AppError("menu_section.not_found", {
        sectionId: homeSectionId,
        memberId,
        field: path + ".ref",
      });
    if (ref.kind === "missing") {
      values.push({
        id: memberId,
        sectionId: homeSectionId,
        position: values.length,
        missingName: ref.name,
      });
      continue;
    }
    if (stored === undefined) {
      let deleted: boolean;
      if (ref.kind === "product") {
        const product = catalogue.get(ref.productId);
        if (product?.parentId !== null)
          throw new AppError("menu_section.membership_invalid", { field: path + ".ref" });
        deleted = !product.active;
      } else {
        const target = graph.section(ref.sectionId);
        if (target?.role === "home_layout")
          throw new AppError("menu_section.wrong_role", {
            sectionId: ref.sectionId,
            role: target.role,
            field: path + ".ref",
          });
        const owner = target && graph.menu(target.ownerMenuId);
        if (target?.role === "menu_root" && owner?.kind === "set_menu")
          throw new AppError("set_menu.wrong_place", {
            menuId: target.ownerMenuId,
            field: path + ".ref",
          });
        deleted = target === undefined || owner?.active === false;
      }
      if (deleted) {
        dropped.push({ memberId, reason: "deleted" });
        continue;
      }
      if (!reaches(ref))
        throw new AppError("menu.shortcut_unreachable", { ref, field: path + ".ref" });
    }
    const key = refKey(ref);
    if (seenTargets.has(key))
      throw new AppError("menu_section.member_duplicate", {
        sectionId: homeSectionId,
        field: path + ".ref",
      });
    seenTargets.add(key);
    values.push({
      id: memberId,
      sectionId: homeSectionId,
      position: values.length,
      ...refColumns(ref),
    });
  }

  await tx.delete(sectionMembers).where(eq(sectionMembers.sectionId, homeSectionId));
  for (const batch of batches(values)) await tx.insert(sectionMembers).values(batch);
  await tx.update(menus).set({ homeOrder: input.order }).where(eq(menus.id, menuId));
  return { ...(await readMenuHome(tx, menuId)), dropped };
}
