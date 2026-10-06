import { eq, inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import { homeDisplayProblem } from "./device-home.js";
import type { HomeDevice, HomeDisplay } from "./menu-document-types.js";
import { menuDetails } from "./schema/menu.js";
import { sectionMembers, sections } from "./schema/sections.js";
import {
  loadSectionGraph,
  reachableFrom,
  sectionPathName,
  type SectionGraph,
} from "./section-graph.js";
import {
  checkRef,
  deleteMember,
  heldMember,
  insertMember,
  membersOf,
  moveMemberTo,
  refColumns,
  requirePosition,
} from "./section-members.js";
import type { MemberRef, MenuHome, SectionMember, TileRef } from "./section-types.js";
import "./errors.js";

// A shortcut writes no `menu_items` row: no menu's root reaches a Device Home Page section.

interface HomeRow {
  rootSectionId: string;
  homeSectionId: string;
  handheld: HomeDisplay;
  till: HomeDisplay;
}

/** The menu's root, its Device Home Page section and both display settings. */
async function requireMenuHome(tx: Transaction, menuId: string): Promise<HomeRow> {
  const [row] = await tx.select().from(menuDetails).where(eq(menuDetails.menuId, menuId));
  if (row === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  return {
    rootSectionId: row.rootSectionId,
    homeSectionId: row.homeSectionId,
    handheld: { columns: row.handheldColumns, tiles: row.handheldTiles, order: row.handheldOrder },
    till: { columns: row.tillColumns, tiles: row.tillTiles, order: row.tillOrder },
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
 * reaches included and marked, and how each device presents it. */
export async function readMenuHome(tx: Transaction, menuId: string): Promise<MenuHome> {
  const home = await requireMenuHome(tx, menuId);
  const graph = await loadSectionGraph(tx);
  const reaches = structuralReach(graph, home.rootSectionId);
  const tiles = graph.tiles(home.homeSectionId);
  const names = new Map<string, string>();
  const sectionIds = tiles.flatMap(({ ref }) => (ref.kind === "section" ? [ref.sectionId] : []));
  const productIds = tiles.flatMap(({ ref }) => (ref.kind === "product" ? [ref.productId] : []));
  for (const batch of batches(sectionIds))
    for (const row of await tx
      .select({ id: sections.id, name: sections.internalName })
      .from(sections)
      .where(inArray(sections.id, batch)))
      names.set(row.id, row.name);
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
          : names.get(ref.kind === "product" ? ref.productId : ref.sectionId)!;
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
    handheld: home.handheld,
    till: home.till,
  };
}

export async function setHomeDisplay(
  tx: Transaction,
  menuId: string,
  device: HomeDevice,
  patch: { columns?: unknown; tiles?: unknown; order?: unknown },
): Promise<void> {
  await requireMenuHome(tx, menuId);
  const field = homeDisplayProblem(device, patch);
  if (field !== null) throw new AppError("menu.home_display_invalid", { device, field });
  // homeDisplayProblem answering null proves each present value is one the device takes.
  const { columns, tiles, order } = patch as Partial<HomeDisplay>;
  // Drizzle leaves an undefined key out of the update, and refuses an update with nothing to set.
  const set =
    device === "handheld"
      ? { handheldColumns: columns, handheldTiles: tiles, handheldOrder: order }
      : { tillColumns: columns, tillTiles: tiles, tillOrder: order };
  if (Object.values(set).some((value) => value !== undefined))
    await tx.update(menuDetails).set(set).where(eq(menuDetails.menuId, menuId));
}

/** Appends a shortcut to a target the menu reaches structurally, or inserts at `position`. */
export async function addShortcut(
  tx: Transaction,
  menuId: string,
  ref: MemberRef,
  position?: number,
): Promise<SectionMember> {
  const { rootSectionId, homeSectionId } = await requireMenuHome(tx, menuId);
  const graph = await loadSectionGraph(tx);
  requirePosition(position);
  await checkRef(tx, graph, homeSectionId, ref);
  if (!structuralReach(graph, rootSectionId)(ref))
    throw new AppError("menu.shortcut_unreachable", { ref });
  return insertMember(tx, homeSectionId, graph.tiles(homeSectionId), ref, position);
}

export async function replaceShortcut(
  tx: Transaction,
  menuId: string,
  memberId: string,
  ref: MemberRef,
): Promise<SectionMember> {
  const { rootSectionId, homeSectionId } = await requireMenuHome(tx, menuId);
  const graph = await loadSectionGraph(tx);
  const current = heldMember(graph.tiles(homeSectionId), homeSectionId, memberId);
  await checkRef(tx, graph, homeSectionId, ref, current);
  if (!structuralReach(graph, rootSectionId)(ref))
    throw new AppError("menu.shortcut_unreachable", { ref });
  await tx.update(sectionMembers).set(refColumns(ref)).where(eq(sectionMembers.id, memberId));
  return { ...current, ref };
}

export async function removeShortcut(
  tx: Transaction,
  menuId: string,
  memberId: string,
): Promise<void> {
  const { homeSectionId } = await requireMenuHome(tx, menuId);
  await deleteMember(
    tx,
    homeSectionId,
    await membersOf(tx, homeSectionId, "home_layout"),
    memberId,
  );
}

/** Moves the shortcut to index `to` (past the end means last) and renumbers the others. */
export async function moveShortcut(
  tx: Transaction,
  menuId: string,
  memberId: string,
  to: number,
): Promise<SectionMember<TileRef>[]> {
  const { homeSectionId } = await requireMenuHome(tx, menuId);
  return moveMemberTo(
    tx,
    homeSectionId,
    await membersOf(tx, homeSectionId, "home_layout"),
    memberId,
    to,
  );
}
