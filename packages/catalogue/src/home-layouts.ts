import { and, asc, eq, inArray, or } from "drizzle-orm";
import { catalogues, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import { requireMenuRoot } from "./menu-structure.js";
import { deviceProfileHomeLayouts } from "./schema/home-layouts.js";
import { menuDetails } from "./schema/menu.js";
import { sectionMembers, sections } from "./schema/sections.js";
import { loadSectionGraph, reachableFrom, type SectionGraph } from "./section-graph.js";
import {
  checkRef,
  deleteMember,
  insertMember,
  membersOf,
  moveMemberTo,
  nameOf,
  requirePosition,
  writeMembers,
} from "./section-members.js";
import type {
  DeviceMenuHomeLayouts,
  HomeLayout,
  MemberRef,
  SectionMember,
} from "./section-types.js";
import type { DeviceHomeLayout, MenuDocument } from "./menu-document-types.js";
import "./errors.js";

/*
 * A home layout is a `home_layout` section its menu owns, and its tiles are that section's members.
 * A tile is only a shortcut: no write here touches `menu_items`, because no menu's root reaches a
 * layout (`menusContaining`), so the offers `syncMenuOffers` keeps are not the layouts' business.
 */

const layoutNameOf = (value: unknown): string => nameOf(value, "name");

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

function defaultFirst<T extends { id: string }>(rows: readonly T[], defaultId: string): T[] {
  return [
    ...rows.filter((row) => row.id === defaultId),
    ...rows.filter((row) => row.id !== defaultId),
  ];
}

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
  const reached = reachableFrom(graph, rootSectionId);
  const reachedProducts = new Set(reached.products);
  return (ref) =>
    ref.kind === "product"
      ? reachedProducts.has(ref.productId)
      : reached.sections.has(ref.sectionId);
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
  const isLayout = and(eq(sections.role, "home_layout"), eq(sections.ownerMenuId, menuId));
  // The menu's layouts and the sections their tiles hold, named in one read.
  const named = await tx
    .select({
      id: sections.id,
      name: sections.internalName,
      role: sections.role,
      ownerMenuId: sections.ownerMenuId,
    })
    .from(sections)
    .where(
      or(
        isLayout,
        inArray(
          sections.id,
          tx
            .select({ id: sectionMembers.childSectionId })
            .from(sectionMembers)
            .where(
              inArray(
                sectionMembers.sectionId,
                tx.select({ id: sections.id }).from(sections).where(isLayout),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(sections.internalName), asc(sections.id));
  const ordered = defaultFirst(
    named.filter((row) => row.role === "home_layout" && row.ownerMenuId === menuId),
    details.defaultHomeLayoutId,
  );
  const names = new Map(named.map((row) => [row.id, row.name]));
  const productIds = new Set(
    ordered.flatMap(({ id }) =>
      graph.children(id).flatMap(({ ref }) => (ref.kind === "product" ? [ref.productId] : [])),
    ),
  );
  for (const batch of batches([...productIds]))
    for (const row of await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, batch)))
      names.set(row.id, row.name);
  return ordered.map(({ id, name }) => ({
    id,
    name,
    isDefault: id === details.defaultHomeLayoutId,
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
  const tiles = await membersOf(tx, layoutId);
  const id = await insertLayout(tx, menuId, internalName);
  await writeMembers(
    tx,
    id,
    tiles.map(({ ref }) => ref),
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
  requirePosition(position);
  await checkRef(tx, graph, layoutId, ref);
  const reaches = structuralReach(graph, await requireMenuRoot(tx, menuId));
  if (!reaches(ref)) throw new AppError("menu.shortcut_unreachable", { layoutId, ref });
  return insertMember(tx, layoutId, graph.children(layoutId), ref, position);
}

export async function removeShortcut(
  tx: Transaction,
  layoutId: string,
  memberId: string,
): Promise<void> {
  await readLayout(tx, layoutId);
  await deleteMember(tx, layoutId, await membersOf(tx, layoutId), memberId);
}

/** Moves the tile to index `to` (past the end means last) and renumbers the layout. */
export async function moveShortcut(
  tx: Transaction,
  layoutId: string,
  memberId: string,
  to: number,
): Promise<SectionMember[]> {
  await readLayout(tx, layoutId);
  return moveMemberTo(tx, layoutId, await membersOf(tx, layoutId), memberId, to);
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
      layouts: defaultFirst(own, defaultHomeLayoutId),
      selectedLayoutId,
      selectedRemoved:
        selectedLayoutId !== null && !own.some((layout) => layout.id === selectedLayoutId),
    };
  });
}

/**
 * The layout a device of the profile shows for each document's menu, keyed by menu id (D14). The
 * profile's choice when the live document holds it, so a layout deleted or renamed since the publish
 * still shows; otherwise the document's default, with why. A null profile shows every default.
 */
export async function resolveDeviceHomeLayouts(
  tx: Transaction,
  deviceProfileId: string | null,
  documents: readonly MenuDocument[],
): Promise<Map<string, DeviceHomeLayout>> {
  const chosen = new Map<string, string>();
  if (deviceProfileId !== null)
    for (const row of await tx
      .select({
        menuId: deviceProfileHomeLayouts.menuId,
        layoutId: deviceProfileHomeLayouts.layoutId,
      })
      .from(deviceProfileHomeLayouts)
      .where(eq(deviceProfileHomeLayouts.deviceProfileId, deviceProfileId)))
      chosen.set(row.menuId, row.layoutId);
  const unpublished = (document: MenuDocument): string | null => {
    const layoutId = chosen.get(document.menuId);
    return layoutId === undefined || document.homeLayouts.some((layout) => layout.id === layoutId)
      ? null
      : layoutId;
  };
  const missing = documents.flatMap((document) => unpublished(document) ?? []);
  // A chosen layout the live version lacks: its menu, if the working state still has it.
  const working = new Map<string, string>();
  if (missing.length > 0)
    for (const row of await tx
      .select({ id: sections.id, ownerMenuId: sections.ownerMenuId })
      .from(sections)
      .where(and(inArray(sections.id, missing), eq(sections.role, "home_layout"))))
      working.set(row.id, row.ownerMenuId!);
  return new Map(
    documents.map((document): [string, DeviceHomeLayout] => {
      const layoutId = unpublished(document);
      if (layoutId === null)
        return [
          document.menuId,
          {
            homeLayoutId: chosen.get(document.menuId) ?? document.defaultHomeLayoutId,
            layoutFallback: null,
          },
        ];
      return [
        document.menuId,
        {
          homeLayoutId: document.defaultHomeLayoutId,
          layoutFallback:
            working.get(layoutId) === document.menuId ? "layout_unpublished" : "layout_removed",
        },
      ];
    }),
  );
}
