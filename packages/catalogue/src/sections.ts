import { and, asc, eq, inArray } from "drizzle-orm";
import { catalogues, products, type Transaction } from "@waitron/db";
import { AppError, contentLanguageCode } from "@waitron/shared";
import { mediaImageExists } from "./categories.js";
import { sectionMembers, sections } from "./schema/sections.js";
import {
  loadSectionGraph,
  menusContaining,
  toSectionMember,
  wouldCreateCycle,
  type SectionGraph,
} from "./section-graph.js";
import { onStructureChanged } from "./section-structure.js";
import type { LibrarySection, MemberRef, SectionMember, SectionUsages } from "./section-types.js";
import { isTopLevelProduct } from "./variant-fallback.js";
import "./errors.js";

/*
 * Each member write reads the whole graph and checks it in JavaScript before writing; a duplicate
 * that also replaces reads it again after the copy. No other writer can change the graph between
 * a read and the write that depends on it: `withTransaction`
 * (`packages/db/src/tenancy.ts`) runs its body inside the venue file's write queue, which admits
 * one write transaction at a time. Receipt: the opposing-containment case in
 * `sections.db.test.ts`, run through `racePair`.
 */

export interface SectionInput {
  internalName: string;
  names?: Record<string, string>;
  image?: string | null;
  color?: string | null;
}
export type SectionPatch = Partial<{
  internalName: string;
  names: Record<string, string>;
  image: string | null;
  color: string | null;
}>;

const details = {
  id: sections.id,
  internalName: sections.internalName,
  names: sections.names,
  image: sections.image,
  color: sections.color,
};

const memberOrder = [asc(sectionMembers.position), asc(sectionMembers.id)];

async function membersOf(tx: Transaction, sectionId: string): Promise<SectionMember[]> {
  const rows = await tx
    .select()
    .from(sectionMembers)
    .where(eq(sectionMembers.sectionId, sectionId))
    .orderBy(...memberOrder);
  return rows.map(toSectionMember);
}

function internalNameOf(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") throw new AppError("menu_section.invalid", { field: "internalName" });
  return name;
}

function namesOf(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new AppError("menu_section.invalid", { field: "names" });
  for (const [language, text] of Object.entries(value)) {
    contentLanguageCode(language);
    if (typeof text !== "string") throw new AppError("content.translation_invalid", {});
  }
  return value as Record<string, string>;
}

function colorOf(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/.test(value))
    throw new AppError("menu_section.invalid", { field: "color" });
  return value;
}

async function imageOf(tx: Transaction, value: unknown): Promise<string | null> {
  if (value === null) return null;
  if (typeof value !== "string" || !(await mediaImageExists(tx, value)))
    throw new AppError("menu_section.invalid", { field: "image" });
  return value;
}

/** The list a generic member write may change: any but a home layout. A layout's tiles are to be
 * written only by the menus plan's Task 8 routes, which check the menu reaches each target. */
function requireWritableList(graph: SectionGraph, sectionId: string): void {
  const role = graph.role(sectionId);
  if (role === undefined) throw new AppError("menu_section.not_found", { sectionId });
  if (role === "home_layout") throw new AppError("menu_section.not_library", { sectionId });
}

function requireLibrary(graph: SectionGraph, sectionId: string): void {
  const role = graph.role(sectionId);
  if (role === undefined) throw new AppError("menu_section.not_found", { sectionId });
  if (role !== "library") throw new AppError("menu_section.not_library", { sectionId });
}

function heldMember(graph: SectionGraph, sectionId: string, memberId: string): SectionMember {
  const member = graph.children(sectionId).find((candidate) => candidate.id === memberId);
  if (!member) throw new AppError("menu_section.not_found", { sectionId, memberId });
  return member;
}

/** Are these all distinct top-level products? A repeat leaves the count short, as an absent id does. */
async function allTopLevelProducts(tx: Transaction, ids: readonly unknown[]): Promise<boolean> {
  if (ids.some((id) => typeof id !== "string")) return false;
  if (ids.length === 0) return true;
  const found = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(inArray(products.id, ids as string[]), isTopLevelProduct));
  return found.length === ids.length;
}

function sameRef(a: MemberRef, b: MemberRef): boolean {
  return a.kind === "product"
    ? b.kind === "product" && a.productId === b.productId
    : b.kind === "section" && a.sectionId === b.sectionId;
}

/** Refuse a ref the list cannot hold. `replacing` is the member whose place it takes, if any. */
async function checkRef(
  tx: Transaction,
  graph: SectionGraph,
  sectionId: string,
  ref: MemberRef,
  replacing?: SectionMember,
): Promise<void> {
  if (ref?.kind === "section" && typeof ref.sectionId === "string") {
    const role = graph.role(ref.sectionId);
    if (role === undefined)
      throw new AppError("menu_section.not_found", { sectionId: ref.sectionId });
    if (role !== "library")
      throw new AppError("menu_section.not_library", { sectionId: ref.sectionId });
  } else if (ref?.kind !== "product" || !(await allTopLevelProducts(tx, [ref.productId]))) {
    throw new AppError("menu_section.membership_invalid", {});
  }
  if (graph.children(sectionId).some((member) => member !== replacing && sameRef(member.ref, ref)))
    throw new AppError("menu_section.member_duplicate", { sectionId });
  if (ref.kind === "section" && wouldCreateCycle(graph, sectionId, ref.sectionId))
    throw new AppError("menu_section.member_cycle", {
      sectionId,
      childSectionId: ref.sectionId,
    });
}

function refColumns(ref: MemberRef) {
  return ref.kind === "product"
    ? { productId: ref.productId, childSectionId: null }
    : { productId: null, childSectionId: ref.sectionId };
}

/** Write positions 0..n-1 in the order given, touching only the rows whose position moves. */
async function renumber(tx: Transaction, ordered: readonly SectionMember[]): Promise<void> {
  for (const [position, member] of ordered.entries())
    if (member.position !== position)
      await tx.update(sectionMembers).set({ position }).where(eq(sectionMembers.id, member.id));
}

function nextPosition(graph: SectionGraph, sectionId: string): number {
  return Math.max(-1, ...graph.children(sectionId).map((member) => member.position)) + 1;
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

export async function createSection(tx: Transaction, input: SectionInput): Promise<LibrarySection> {
  const internalName = internalNameOf(input.internalName);
  const names = input.names === undefined ? {} : namesOf(input.names);
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
): Promise<LibrarySection> {
  const [row] = await tx.select({ role: sections.role }).from(sections).where(eq(sections.id, id));
  if (!row) throw new AppError("menu_section.not_found", { sectionId: id });
  if (row.role !== "library") throw new AppError("menu_section.not_library", { sectionId: id });
  const values: SectionPatch = {};
  if (patch.internalName !== undefined) values.internalName = internalNameOf(patch.internalName);
  if (patch.names !== undefined) values.names = namesOf(patch.names);
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
  await onStructureChanged(tx, menus);
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
  if (position !== undefined && (!Number.isInteger(position) || position < 0))
    throw new AppError("menu_section.invalid", { field: "position" });
  await checkRef(tx, graph, sectionId, ref);
  const [row] = await tx
    .insert(sectionMembers)
    .values({ sectionId, position: nextPosition(graph, sectionId), ...refColumns(ref) })
    .returning();
  let added = toSectionMember(row!);
  if (position !== undefined) {
    const ordered = [...graph.children(sectionId)];
    ordered.splice(position, 0, added);
    await renumber(tx, ordered);
    added = { ...added, position: ordered.indexOf(added) };
  }
  await onStructureChanged(tx, menusContaining(graph, sectionId));
  return added;
}

/** Appends each product the list does not hold yet, in the order given (spec §10.2). */
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
  let position = nextPosition(graph, sectionId);
  for (const productId of adding)
    await tx.insert(sectionMembers).values({ sectionId, position: position++, productId });
  await onStructureChanged(tx, menusContaining(graph, sectionId));
  return { added: adding.length };
}

export async function removeMember(
  tx: Transaction,
  sectionId: string,
  memberId: string,
): Promise<void> {
  const graph = await loadSectionGraph(tx);
  requireWritableList(graph, sectionId);
  heldMember(graph, sectionId, memberId);
  const menus = menusContaining(graph, sectionId);
  await tx.delete(sectionMembers).where(eq(sectionMembers.id, memberId));
  await renumber(
    tx,
    graph.children(sectionId).filter((member) => member.id !== memberId),
  );
  await onStructureChanged(tx, menus);
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
  const member = heldMember(graph, sectionId, memberId);
  if (!Number.isInteger(to) || to < 0) throw new AppError("menu_section.invalid", { field: "to" });
  const ordered = graph.children(sectionId).filter((candidate) => candidate !== member);
  ordered.splice(to, 0, member);
  await renumber(tx, ordered);
  await onStructureChanged(tx, menusContaining(graph, sectionId));
  return membersOf(tx, sectionId);
}

/** The replace itself, without telling the hook; answers the menus the list reaches. */
async function swapMember(
  tx: Transaction,
  graph: SectionGraph,
  sectionId: string,
  memberId: string,
  ref: MemberRef,
): Promise<{ member: SectionMember; menus: string[] }> {
  requireWritableList(graph, sectionId);
  const current = heldMember(graph, sectionId, memberId);
  await checkRef(tx, graph, sectionId, ref, current);
  await tx.update(sectionMembers).set(refColumns(ref)).where(eq(sectionMembers.id, memberId));
  return {
    member: { ...current, ref },
    // A replace changes what the list holds, never which menus reach the list.
    menus: menusContaining(graph, sectionId),
  };
}

/**
 * Swaps what a member holds, keeping its place, so a menu never passes through a state holding
 * neither the old ref nor the new one (D23). The hook is told once, after the swap.
 */
export async function replaceMember(
  tx: Transaction,
  sectionId: string,
  memberId: string,
  ref: MemberRef,
): Promise<SectionMember> {
  const { member, menus } = await swapMember(
    tx,
    await loadSectionGraph(tx),
    sectionId,
    memberId,
    ref,
  );
  await onStructureChanged(tx, menus);
  return member;
}

/**
 * Copies a library section's details and the chosen immediate members, in the source's order,
 * under a new internal name. A nested section is shared, not copied, and no product is made. With
 * `replaceIn` the copy also takes that member's place, in the caller's one transaction (D23).
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
  if (
    !Array.isArray(chosen) ||
    new Set(chosen).size !== chosen.length ||
    chosen.some((memberId) => !source.some((member) => member.id === memberId))
  )
    throw new AppError("menu_section.membership_invalid", {});
  const [row] = await tx.select(details).from(sections).where(eq(sections.id, sourceId));
  const [copy] = await tx
    .insert(sections)
    .values({ internalName, names: row!.names, image: row!.image, color: row!.color })
    .returning({ id: sections.id });
  const kept = source.filter((member) => chosen.includes(member.id));
  for (const [position, member] of kept.entries())
    await tx
      .insert(sectionMembers)
      .values({ sectionId: copy!.id, position, ...refColumns(member.ref) });
  const menus = input.replaceIn
    ? (
        await swapMember(
          tx,
          await loadSectionGraph(tx),
          input.replaceIn.sectionId,
          input.replaceIn.memberId,
          { kind: "section", sectionId: copy!.id },
        )
      ).menus
    : [];
  await onStructureChanged(tx, menus);
  return readSection(tx, copy!.id);
}

/**
 * What deleting the section would touch: the menus whose root reaches it or whose home layout holds
 * it, and the library sections holding it directly.
 */
export async function sectionUsages(tx: Transaction, sectionId: string): Promise<SectionUsages> {
  const graph = await loadSectionGraph(tx);
  if (graph.role(sectionId) === undefined)
    throw new AppError("menu_section.not_found", { sectionId });
  const parents = graph.parents(sectionId);
  const menuIds = new Set(menusContaining(graph, sectionId));
  for (const parent of parents)
    if (graph.role(parent) !== "library") menuIds.add(graph.ownerMenu(parent)!);
  const libraryParents = parents.filter((parent) => graph.role(parent) === "library");
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
