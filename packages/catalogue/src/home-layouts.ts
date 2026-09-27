import { and, asc, eq, inArray } from "drizzle-orm";
import { catalogues, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import { allTopLevelProducts } from "./categories.js";
import { requireMenuRoot } from "./menu-structure.js";
import { deviceProfileHomeLayouts } from "./schema/home-layouts.js";
import { menuDetails } from "./schema/menu.js";
import { sectionMembers, sections } from "./schema/sections.js";
import {
  loadSectionGraph,
  reachableProducts,
  reachableSections,
  toSectionMember,
  type SectionGraph,
} from "./section-graph.js";
import { nextPosition, renumber } from "./section-order.js";
import type {
  DeviceMenuHomeLayouts,
  HomeLayout,
  MemberRef,
  SectionMember,
} from "./section-types.js";
import "./errors.js";

/*
 * A home layout is a `home_layout` section its menu owns, and its tiles are that section's members.
 * A tile is only a shortcut: no write here touches `menu_items`, because no menu's root reaches a
 * layout (`menusContaining`), so the offers `syncMenuOffers` keeps are not the layouts' business.
 */

function layoutNameOf(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") throw new AppError("menu_section.invalid", { field: "name" });
  return name;
}

function notFound(layoutId: string, menuId?: string): AppError {
  return new AppError(
    "menu.layout_not_found",
    menuId === undefined ? { layoutId } : { layoutId, menuId },
  );
}

/** The layout's menu; with `menuId`, a layout of any other menu is refused too. */
async function readLayout(tx: Transaction, layoutId: string, menuId?: string): Promise<string> {
  const [row] = await tx
    .select({ role: sections.role, ownerMenuId: sections.ownerMenuId })
    .from(sections)
    .where(eq(sections.id, layoutId));
  if (row?.role !== "home_layout" || (menuId !== undefined && row.ownerMenuId !== menuId))
    throw notFound(layoutId, menuId);
  return row.ownerMenuId!;
}

function graphLayout(graph: SectionGraph, layoutId: string): string {
  if (graph.role(layoutId) !== "home_layout") throw notFound(layoutId);
  return graph.ownerMenu(layoutId)!;
}

function heldTile(graph: SectionGraph, layoutId: string, memberId: string): SectionMember {
  const member = graph.children(layoutId).find((candidate) => candidate.id === memberId);
  if (!member) throw new AppError("menu_section.not_found", { sectionId: layoutId, memberId });
  return member;
}

const refKey = (ref: MemberRef): string =>
  ref.kind === "product" ? `p:${ref.productId}` : `s:${ref.sectionId}`;

async function insertLayout(tx: Transaction, menuId: string, name: string): Promise<string> {
  const [row] = await tx
    .insert(sections)
    .values({ internalName: name, role: "home_layout", ownerMenuId: menuId })
    .returning({ id: sections.id });
  return row!.id;
}

/** Whether the menu's working structure reaches a tile's target, whatever the menu's, the
 * product's or the offer's switches (D13). Publishing applies its own, narrower test. */
function structuralReach(graph: SectionGraph, rootSectionId: string): (ref: MemberRef) => boolean {
  const reachedProducts = new Set(reachableProducts(graph, rootSectionId));
  const reachedSections = reachableSections(graph, rootSectionId);
  return (ref) =>
    ref.kind === "product"
      ? reachedProducts.has(ref.productId)
      : reachedSections.has(ref.sectionId);
}

/** The menu's working layouts, the default first and then by name, each with every tile in order,
 * the ones its structure no longer reaches included and marked. */
export async function listHomeLayouts(tx: Transaction, menuId: string): Promise<HomeLayout[]> {
  const [details] = await tx
    .select({
      rootSectionId: menuDetails.rootSectionId,
      defaultHomeLayoutId: menuDetails.defaultHomeLayoutId,
    })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  if (details === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  const graph = await loadSectionGraph(tx);
  const reaches = structuralReach(graph, details.rootSectionId);
  const layouts = await tx
    .select({ id: sections.id, name: sections.internalName })
    .from(sections)
    .where(and(eq(sections.role, "home_layout"), eq(sections.ownerMenuId, menuId)))
    .orderBy(asc(sections.internalName), asc(sections.id));
  const isDefault = (id: string) => id === details.defaultHomeLayoutId;
  const ordered = [
    ...layouts.filter((layout) => isDefault(layout.id)),
    ...layouts.filter((layout) => !isDefault(layout.id)),
  ];
  const refs = ordered.flatMap(({ id }) => graph.children(id).map(({ ref }) => ref));
  const productIds = new Set(
    refs.flatMap((ref) => (ref.kind === "product" ? [ref.productId] : [])),
  );
  const sectionIds = new Set(
    refs.flatMap((ref) => (ref.kind === "section" ? [ref.sectionId] : [])),
  );
  const names = new Map<string, string>();
  for (const batch of batches([...productIds]))
    for (const row of await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, batch)))
      names.set(row.id, row.name);
  for (const batch of batches([...sectionIds]))
    for (const row of await tx
      .select({ id: sections.id, name: sections.internalName })
      .from(sections)
      .where(inArray(sections.id, batch)))
      names.set(row.id, row.name);
  return ordered.map(({ id, name }) => ({
    id,
    name,
    isDefault: isDefault(id),
    tiles: graph.children(id).map(({ id: memberId, position, ref }) => ({
      memberId,
      position,
      ref,
      name: names.get(ref.kind === "product" ? ref.productId : ref.sectionId)!,
      reachable: reaches(ref),
    })),
  }));
}

export async function createHomeLayout(
  tx: Transaction,
  menuId: string,
  name: string,
): Promise<{ id: string }> {
  const internalName = layoutNameOf(name);
  await requireMenuRoot(tx, menuId);
  return { id: await insertLayout(tx, menuId, internalName) };
}

/** A new layout of the same menu holding the same tiles in the same order. */
export async function duplicateHomeLayout(
  tx: Transaction,
  layoutId: string,
  name: string,
): Promise<{ id: string }> {
  const menuId = await readLayout(tx, layoutId);
  const internalName = layoutNameOf(name);
  const tiles = (
    await tx
      .select()
      .from(sectionMembers)
      .where(eq(sectionMembers.sectionId, layoutId))
      .orderBy(asc(sectionMembers.position), asc(sectionMembers.id))
  ).map(toSectionMember);
  const id = await insertLayout(tx, menuId, internalName);
  let position = 0;
  for (const batch of batches(tiles))
    await tx.insert(sectionMembers).values(
      batch.map(({ ref }) => ({
        sectionId: id,
        position: position++,
        productId: ref.kind === "product" ? ref.productId : null,
        childSectionId: ref.kind === "section" ? ref.sectionId : null,
      })),
    );
  return { id };
}

export async function renameHomeLayout(
  tx: Transaction,
  layoutId: string,
  name: string,
): Promise<void> {
  await readLayout(tx, layoutId);
  const internalName = layoutNameOf(name);
  await tx.update(sections).set({ internalName }).where(eq(sections.id, layoutId));
}

/**
 * Deletes a layout that is not its menu's default, and its tiles. A device profile's choice of it
 * is left in place (D14), so the profile can be shown the choice as removed.
 */
export async function deleteHomeLayout(tx: Transaction, layoutId: string): Promise<void> {
  const menuId = await readLayout(tx, layoutId);
  const [details] = await tx
    .select({ defaultHomeLayoutId: menuDetails.defaultHomeLayoutId })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  if (details?.defaultHomeLayoutId === layoutId)
    throw new AppError("menu.default_layout_required", { layoutId });
  await tx.delete(sections).where(eq(sections.id, layoutId));
}

export async function setDefaultHomeLayout(
  tx: Transaction,
  menuId: string,
  layoutId: string,
): Promise<void> {
  await requireMenuRoot(tx, menuId);
  await readLayout(tx, layoutId, menuId);
  await tx
    .update(menuDetails)
    .set({ defaultHomeLayoutId: layoutId })
    .where(eq(menuDetails.menuId, menuId));
}

/**
 * Appends a tile, or puts it at `position` and renumbers the layout. The target must be a product
 * or library section the menu's working structure reaches (D13); a tile for a product the menu
 * does not offer when it is published is left out of that version.
 */
export async function addShortcut(
  tx: Transaction,
  layoutId: string,
  ref: MemberRef,
  position?: number,
): Promise<SectionMember> {
  const graph = await loadSectionGraph(tx);
  const menuId = graphLayout(graph, layoutId);
  if (position !== undefined && (!Number.isInteger(position) || position < 0))
    throw new AppError("menu_section.invalid", { field: "position" });
  if (ref?.kind === "section" && typeof ref.sectionId === "string") {
    const role = graph.role(ref.sectionId);
    if (role === undefined)
      throw new AppError("menu_section.not_found", { sectionId: ref.sectionId });
    if (role !== "library")
      throw new AppError("menu_section.not_library", { sectionId: ref.sectionId });
  } else if (ref?.kind !== "product" || !(await allTopLevelProducts(tx, [ref.productId]))) {
    throw new AppError("menu_section.membership_invalid", {});
  }
  const tiles = graph.children(layoutId);
  if (tiles.some((tile) => refKey(tile.ref) === refKey(ref)))
    throw new AppError("menu_section.member_duplicate", { sectionId: layoutId });
  const reaches = structuralReach(graph, await requireMenuRoot(tx, menuId));
  if (!reaches(ref)) throw new AppError("menu.shortcut_unreachable", { layoutId, ref });
  const at =
    position === undefined ? nextPosition(graph, layoutId) : Math.min(position, tiles.length);
  const [row] = await tx
    .insert(sectionMembers)
    .values({
      sectionId: layoutId,
      position: at,
      productId: ref.kind === "product" ? ref.productId : null,
      childSectionId: ref.kind === "section" ? ref.sectionId : null,
    })
    .returning();
  const added = toSectionMember(row!);
  if (position !== undefined) {
    const ordered = [...tiles];
    ordered.splice(at, 0, added);
    await renumber(tx, ordered);
  }
  return added;
}

export async function removeShortcut(
  tx: Transaction,
  layoutId: string,
  memberId: string,
): Promise<void> {
  const graph = await loadSectionGraph(tx);
  graphLayout(graph, layoutId);
  heldTile(graph, layoutId, memberId);
  await tx.delete(sectionMembers).where(eq(sectionMembers.id, memberId));
  await renumber(
    tx,
    graph.children(layoutId).filter((tile) => tile.id !== memberId),
  );
}

/** Moves the tile to index `to` (past the end means last) and renumbers the layout. */
export async function moveShortcut(
  tx: Transaction,
  layoutId: string,
  memberId: string,
  to: number,
): Promise<SectionMember[]> {
  const graph = await loadSectionGraph(tx);
  graphLayout(graph, layoutId);
  const tile = heldTile(graph, layoutId, memberId);
  if (!Number.isInteger(to) || to < 0) throw new AppError("menu_section.invalid", { field: "to" });
  const ordered = graph.children(layoutId).filter((candidate) => candidate !== tile);
  ordered.splice(to, 0, tile);
  await renumber(tx, ordered);
  return ordered.map((held, position) => ({ ...held, position }));
}

/**
 * Chooses the layout a device profile shows for the menu; null goes back to the menu's default.
 * The caller establishes that the profile exists: here only its foreign key refuses one that does
 * not.
 */
export async function setDeviceHomeLayout(
  tx: Transaction,
  deviceProfileId: string,
  menuId: string,
  layoutId: string | null,
): Promise<void> {
  await requireMenuRoot(tx, menuId);
  const row = and(
    eq(deviceProfileHomeLayouts.deviceProfileId, deviceProfileId),
    eq(deviceProfileHomeLayouts.menuId, menuId),
  );
  if (layoutId === null) {
    await tx.delete(deviceProfileHomeLayouts).where(row);
    return;
  }
  await readLayout(tx, layoutId, menuId);
  await tx
    .insert(deviceProfileHomeLayouts)
    .values({ deviceProfileId, menuId, layoutId })
    .onConflictDoUpdate({
      target: [deviceProfileHomeLayouts.deviceProfileId, deviceProfileHomeLayouts.menuId],
      set: { layoutId },
    });
}

/** Every menu, by name, with its working layouts and the profile's choice for it. */
export async function deviceHomeLayouts(
  tx: Transaction,
  deviceProfileId: string,
): Promise<DeviceMenuHomeLayouts[]> {
  const menus = await tx
    .select({
      menuId: menuDetails.menuId,
      menuName: catalogues.name,
      defaultHomeLayoutId: menuDetails.defaultHomeLayoutId,
    })
    .from(menuDetails)
    .innerJoin(catalogues, eq(catalogues.id, menuDetails.menuId))
    .orderBy(asc(catalogues.name), asc(catalogues.id));
  const layouts = await tx
    .select({ id: sections.id, name: sections.internalName, menuId: sections.ownerMenuId })
    .from(sections)
    .where(eq(sections.role, "home_layout"))
    .orderBy(asc(sections.internalName), asc(sections.id));
  const chosen = new Map(
    (
      await tx
        .select({
          menuId: deviceProfileHomeLayouts.menuId,
          layoutId: deviceProfileHomeLayouts.layoutId,
        })
        .from(deviceProfileHomeLayouts)
        .where(eq(deviceProfileHomeLayouts.deviceProfileId, deviceProfileId))
    ).map((row) => [row.menuId, row.layoutId]),
  );
  const byMenu = new Map<string, { id: string; name: string }[]>();
  for (const { id, name, menuId } of layouts) {
    const list = byMenu.get(menuId!) ?? [];
    list.push({ id, name });
    byMenu.set(menuId!, list);
  }
  return menus.map(({ menuId, menuName, defaultHomeLayoutId }) => {
    const own = (byMenu.get(menuId) ?? []).map(({ id, name }) => ({
      id,
      name,
      isDefault: id === defaultHomeLayoutId,
    }));
    const selectedLayoutId = chosen.get(menuId) ?? null;
    return {
      menuId,
      menuName,
      layouts: [...own.filter((layout) => layout.isDefault), ...own.filter((l) => !l.isDefault)],
      selectedLayoutId,
      selectedRemoved:
        selectedLayoutId !== null && !own.some((layout) => layout.id === selectedLayoutId),
    };
  });
}
