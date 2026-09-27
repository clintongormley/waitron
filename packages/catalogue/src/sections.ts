import { asc, eq, inArray } from "drizzle-orm";
import { catalogues, newId, type Transaction } from "@waitron/db";
import { AppError, FALLBACK_LOCALE } from "@waitron/shared";
import { batches } from "./batches.js";
import { allTopLevelProducts, isHexColor, mediaImageExists } from "./categories.js";
import { findContentTranslationGap } from "./content-languages.js";
import { sectionMembers, sections } from "./schema/sections.js";
import {
  loadSectionGraph,
  menusContaining,
  toSectionMember,
  wouldCreateCycle,
  type SectionGraph,
} from "./section-graph.js";
import {
  checkRef,
  deleteMember,
  heldMember,
  insertMember,
  memberOrder,
  membersOf,
  moveMemberTo,
  nameOf,
  nextPosition,
  refColumns,
  renumber,
  requireLibrary,
  requirePosition,
  writeMembers,
} from "./section-members.js";
import { onStructureChanged } from "./section-structure.js";
import type {
  LibrarySection,
  MemberRef,
  SectionInput,
  SectionMember,
  SectionUsages,
} from "./section-types.js";
import "./errors.js";

/*
 * Each member write reads the whole graph once and checks it in JavaScript before writing. No other
 * writer can change the graph between a read and the write that depends on it: `withTransaction`
 * (`packages/db/src/tenancy.ts`) runs its body inside the venue file's write queue, which admits
 * one write transaction at a time. Receipt: the opposing-containment case in
 * `sections.db.test.ts`, run through `racePair`.
 */

export type SectionPatch = Partial<SectionInput>;

const details = {
  id: sections.id,
  internalName: sections.internalName,
  names: sections.names,
  image: sections.image,
  color: sections.color,
};

const internalNameOf = (value: unknown): string => nameOf(value, "internalName");

/** Customer names are optional, so `{}` is accepted; a map that is supplied needs text in the
 * venue's default content language. */
async function namesOf(
  tx: Transaction,
  value: unknown,
  fallbackLanguage: string,
): Promise<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new AppError("menu_section.invalid", { field: "names" });
  const names = value as Record<string, string>;
  if (Object.keys(names).length === 0) return names;
  const gap = await findContentTranslationGap(tx, [names], fallbackLanguage);
  if (gap !== null)
    throw new AppError("menu_section.translation_required", {
      field: "names",
      language: gap.language,
    });
  return names;
}

function colorOf(value: unknown): string | null {
  if (value === null) return null;
  if (!isHexColor(value)) throw new AppError("menu_section.invalid", { field: "color" });
  return value;
}

async function imageOf(tx: Transaction, value: unknown): Promise<string | null> {
  if (value === null) return null;
  if (typeof value !== "string" || !(await mediaImageExists(tx, value)))
    throw new AppError("menu_section.invalid", { field: "image" });
  return value;
}

/** Any list but a home layout: a layout may only hold what its menu reaches, which no check here
 * establishes. */
function requireWritableList(graph: SectionGraph, sectionId: string): void {
  const role = graph.role(sectionId);
  if (role === undefined) throw new AppError("menu_section.not_found", { sectionId });
  if (role === "home_layout") throw new AppError("menu_section.not_library", { sectionId });
}

function writableMember(graph: SectionGraph, sectionId: string, memberId: string): SectionMember {
  requireWritableList(graph, sectionId);
  return heldMember(graph.children(sectionId), sectionId, memberId);
}

async function checkListRef(
  tx: Transaction,
  graph: SectionGraph,
  sectionId: string,
  ref: MemberRef,
  replacing?: SectionMember,
): Promise<void> {
  await checkRef(tx, graph, sectionId, ref, replacing);
  if (ref.kind === "section" && wouldCreateCycle(graph, sectionId, ref.sectionId))
    throw new AppError("menu_section.member_cycle", {
      sectionId,
      childSectionId: ref.sectionId,
    });
}

/** Library sections only, by internal name; a menu's own lists are not in the library. */
export async function listSections(tx: Transaction): Promise<LibrarySection[]> {
  const rows = await tx
    .select(details)
    .from(sections)
    .where(eq(sections.role, "library"))
    .orderBy(asc(sections.internalName), asc(sections.id));
  const members = await tx
    .select({ member: sectionMembers })
    .from(sectionMembers)
    .innerJoin(sections, eq(sections.id, sectionMembers.sectionId))
    .where(eq(sections.role, "library"))
    .orderBy(...memberOrder);
  const bySection = new Map<string, SectionMember[]>();
  for (const { member } of members) {
    const list = bySection.get(member.sectionId) ?? [];
    list.push(toSectionMember(member));
    bySection.set(member.sectionId, list);
  }
  return rows.map((row) => ({ ...row, members: bySection.get(row.id) ?? [] }));
}

/** Any section by id, a menu's own lists included. */
export async function readSection(tx: Transaction, id: string): Promise<LibrarySection> {
  const [row] = await tx.select(details).from(sections).where(eq(sections.id, id));
  if (!row) throw new AppError("menu_section.not_found", { sectionId: id });
  return { ...row, members: await membersOf(tx, id) };
}

/** Any section's members, a menu's own lists included. */
export async function listMembers(tx: Transaction, sectionId: string): Promise<SectionMember[]> {
  const [row] = await tx
    .select({ id: sections.id })
    .from(sections)
    .where(eq(sections.id, sectionId));
  if (!row) throw new AppError("menu_section.not_found", { sectionId });
  return membersOf(tx, sectionId);
}

export async function createSection(
  tx: Transaction,
  input: SectionInput,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<LibrarySection> {
  const internalName = internalNameOf(input.internalName);
  const names = input.names === undefined ? {} : await namesOf(tx, input.names, fallbackLanguage);
  const color = input.color === undefined ? null : colorOf(input.color);
  const image = input.image === undefined ? null : await imageOf(tx, input.image);
  const [created] = await tx
    .insert(sections)
    .values({ internalName, names, image, color })
    .returning({ id: sections.id });
  return readSection(tx, created!.id);
}

/** Changes a library section's details. Details are not structure, so the hook is not told. */
export async function updateSection(
  tx: Transaction,
  id: string,
  patch: SectionPatch,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<LibrarySection> {
  const [row] = await tx.select({ role: sections.role }).from(sections).where(eq(sections.id, id));
  if (!row) throw new AppError("menu_section.not_found", { sectionId: id });
  if (row.role !== "library") throw new AppError("menu_section.not_library", { sectionId: id });
  const values: SectionPatch = {};
  if (patch.internalName !== undefined) values.internalName = internalNameOf(patch.internalName);
  if (patch.names !== undefined) values.names = await namesOf(tx, patch.names, fallbackLanguage);
  if (patch.color !== undefined) values.color = colorOf(patch.color);
  if (patch.image !== undefined) values.image = await imageOf(tx, patch.image);
  if (Object.keys(values).length > 0)
    await tx.update(sections).set(values).where(eq(sections.id, id));
  return readSection(tx, id);
}

/**
 * Deletes a library section. Every list holding it loses it (`section_members_child_fk`
 * cascades); its own child sections stay. The menus are worked out before the delete, because the
 * cascade removes the links they are found through.
 */
export async function deleteSection(tx: Transaction, id: string): Promise<void> {
  const graph = await loadSectionGraph(tx);
  requireLibrary(graph, id);
  const menus = menusContaining(graph, id);
  await tx.delete(sections).where(eq(sections.id, id));
  for (const parent of graph.parents(id))
    await renumber(
      tx,
      graph
        .children(parent)
        .filter((member) => !(member.ref.kind === "section" && member.ref.sectionId === id)),
    );
  await onStructureChanged(tx, menus, graph);
}

/** Appends the member, or puts it at `position` and renumbers the list. */
export async function addMember(
  tx: Transaction,
  sectionId: string,
  ref: MemberRef,
  position?: number,
): Promise<SectionMember> {
  const graph = await loadSectionGraph(tx);
  requireWritableList(graph, sectionId);
  requirePosition(position);
  await checkListRef(tx, graph, sectionId, ref);
  const added = await insertMember(tx, sectionId, graph.children(sectionId), ref, position);
  await onStructureChanged(tx, menusContaining(graph, sectionId), graph);
  return added;
}

/** Appends each product the list does not already hold, in the order given. */
export async function addProducts(
  tx: Transaction,
  sectionId: string,
  productIds: string[],
): Promise<{ added: number }> {
  const graph = await loadSectionGraph(tx);
  requireWritableList(graph, sectionId);
  if (!Array.isArray(productIds) || !(await allTopLevelProducts(tx, productIds)))
    throw new AppError("menu_section.membership_invalid", {});
  const held = new Set(
    graph
      .children(sectionId)
      .flatMap((member) => (member.ref.kind === "product" ? [member.ref.productId] : [])),
  );
  const adding = productIds.filter((productId) => !held.has(productId));
  let position = nextPosition(graph.children(sectionId));
  for (const batch of batches(adding))
    await tx
      .insert(sectionMembers)
      .values(batch.map((productId) => ({ sectionId, position: position++, productId })));
  await onStructureChanged(tx, menusContaining(graph, sectionId), graph);
  return { added: adding.length };
}

export async function removeMember(
  tx: Transaction,
  sectionId: string,
  memberId: string,
): Promise<void> {
  const graph = await loadSectionGraph(tx);
  requireWritableList(graph, sectionId);
  await deleteMember(tx, sectionId, graph.children(sectionId), memberId);
  await onStructureChanged(tx, menusContaining(graph, sectionId), graph);
}

/** Moves the member to index `to` (past the end means last) and renumbers the whole list. */
export async function moveMember(
  tx: Transaction,
  sectionId: string,
  memberId: string,
  to: number,
): Promise<SectionMember[]> {
  const graph = await loadSectionGraph(tx);
  requireWritableList(graph, sectionId);
  const moved = await moveMemberTo(tx, sectionId, graph.children(sectionId), memberId, to);
  await onStructureChanged(tx, menusContaining(graph, sectionId), graph);
  return moved;
}

/**
 * Swaps what a member holds, keeping its place, so a menu never passes through a state holding
 * neither the old ref nor the new one. The hook is told once, after the swap.
 */
export async function replaceMember(
  tx: Transaction,
  sectionId: string,
  memberId: string,
  ref: MemberRef,
): Promise<SectionMember> {
  const graph = await loadSectionGraph(tx);
  const current = writableMember(graph, sectionId, memberId);
  await checkListRef(tx, graph, sectionId, ref, current);
  await tx.update(sectionMembers).set(refColumns(ref)).where(eq(sectionMembers.id, memberId));
  // A replace changes what the list holds, never which menus reach the list.
  await onStructureChanged(tx, menusContaining(graph, sectionId), graph);
  return { ...current, ref };
}

/**
 * Copies a library section's details and the chosen immediate members, in the source's order,
 * under a new internal name. A nested section is shared, not copied, and no product is made. With
 * `replaceIn` the copy also takes that member's place, in the caller's one transaction.
 */
export async function duplicateSection(
  tx: Transaction,
  sourceId: string,
  input: {
    internalName: string;
    memberIds: string[];
    replaceIn?: { sectionId: string; memberId: string };
  },
): Promise<LibrarySection> {
  const graph = await loadSectionGraph(tx);
  requireLibrary(graph, sourceId);
  const internalName = internalNameOf(input.internalName);
  const chosen = input.memberIds;
  const source = graph.children(sourceId);
  const sourceIds = new Set(source.map((member) => member.id));
  const chosenIds = new Set(Array.isArray(chosen) ? chosen : []);
  if (
    !Array.isArray(chosen) ||
    chosenIds.size !== chosen.length ||
    chosen.some((memberId) => !sourceIds.has(memberId))
  )
    throw new AppError("menu_section.membership_invalid", {});
  const kept = source.filter((member) => chosenIds.has(member.id));
  const copyId = newId();
  const { replaceIn } = input;
  if (replaceIn) {
    writableMember(graph, replaceIn.sectionId, replaceIn.memberId);
    // No list holds the new copy, so only the sections it keeps can lead back to the list.
    if (
      kept.some(
        ({ ref }) =>
          ref.kind === "section" && wouldCreateCycle(graph, replaceIn.sectionId, ref.sectionId),
      )
    )
      throw new AppError("menu_section.member_cycle", {
        sectionId: replaceIn.sectionId,
        childSectionId: copyId,
      });
  }
  const [row] = await tx.select(details).from(sections).where(eq(sections.id, sourceId));
  await tx
    .insert(sections)
    .values({ id: copyId, internalName, names: row!.names, image: row!.image, color: row!.color });
  await writeMembers(
    tx,
    copyId,
    kept.map((member) => member.ref),
  );
  let menus: string[] = [];
  if (replaceIn) {
    await tx
      .update(sectionMembers)
      .set(refColumns({ kind: "section", sectionId: copyId }))
      .where(eq(sectionMembers.id, replaceIn.memberId));
    menus = menusContaining(graph, replaceIn.sectionId);
  }
  await onStructureChanged(tx, menus, graph);
  return readSection(tx, copyId);
}

/** The ids behind `sectionUsages`: menus reaching the section or holding it directly in a list
 * they own, and the library sections holding it directly. */
function usageIds(graph: SectionGraph, sectionId: string) {
  const parents = graph.parents(sectionId);
  const menuIds = new Set(menusContaining(graph, sectionId));
  for (const parent of parents)
    if (graph.role(parent) !== "library") menuIds.add(graph.ownerMenu(parent)!);
  const libraryParents = parents.filter((parent) => graph.role(parent) === "library");
  return { menuIds, libraryParents };
}

/**
 * What deleting the section would touch: the menus whose root reaches it or whose home layout holds
 * it, and the library sections holding it directly.
 */
export async function sectionUsages(tx: Transaction, sectionId: string): Promise<SectionUsages> {
  const graph = await loadSectionGraph(tx);
  if (graph.role(sectionId) === undefined)
    throw new AppError("menu_section.not_found", { sectionId });
  const { menuIds, libraryParents } = usageIds(graph, sectionId);
  const menus =
    menuIds.size === 0
      ? []
      : await tx
          .select({ id: catalogues.id, name: catalogues.name })
          .from(catalogues)
          .where(inArray(catalogues.id, [...menuIds]))
          .orderBy(asc(catalogues.name), asc(catalogues.id));
  const holders =
    libraryParents.length === 0
      ? []
      : await tx
          .select({ id: sections.id, internalName: sections.internalName })
          .from(sections)
          .where(inArray(sections.id, libraryParents))
          .orderBy(asc(sections.internalName), asc(sections.id));
  return { menus, sections: holders };
}

/**
 * `sectionUsages` for every library section, keyed by section id, from one graph read and one
 * read each of the menu and section names, whatever the number of sections.
 */
export async function librarySectionUsages(
  tx: Transaction,
): Promise<Record<string, SectionUsages>> {
  const graph = await loadSectionGraph(tx);
  const library = await tx
    .select({ id: sections.id, internalName: sections.internalName })
    .from(sections)
    .where(eq(sections.role, "library"))
    .orderBy(asc(sections.internalName), asc(sections.id));
  if (library.length === 0) return {};
  const menus = await tx
    .select({ id: catalogues.id, name: catalogues.name })
    .from(catalogues)
    .orderBy(asc(catalogues.name), asc(catalogues.id));
  // Every id asked for is a row read here: a menu-owned list's menu is a foreign key into
  // `catalogues`, and a library parent is a library section.
  const inOrder = <T extends { id: string }>(rows: T[]) => {
    const rank = new Map(rows.map((row, index) => [row.id, index]));
    return (ids: Iterable<string>): T[] =>
      [...ids]
        .map((id) => rank.get(id)!)
        .sort((a, b) => a - b)
        .map((index) => rows[index]!);
  };
  const menusIn = inOrder(menus);
  const sectionsIn = inOrder(library);
  const result: Record<string, SectionUsages> = {};
  for (const { id } of library) {
    const { menuIds, libraryParents } = usageIds(graph, id);
    result[id] = { menus: menusIn(menuIds), sections: sectionsIn(libraryParents) };
  }
  return result;
}
