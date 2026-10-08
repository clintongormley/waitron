import { and, eq, inArray, sql } from "drizzle-orm";
import { tableExists, type Transaction } from "@waitron/db";
import { AppError, FALLBACK_LOCALE } from "@waitron/shared";
import { batches } from "./batches.js";
import { allTopLevelProducts } from "./categories.js";
import { colorOrNull } from "./color-inheritance.js";
import { findContentTranslationGap } from "./content-languages.js";
import { sectionMembers, sections } from "./schema/sections.js";
import {
  loadSectionGraph,
  sectionPathName,
  menusContaining,
  wouldCreateCycle,
  type SectionGraph,
} from "./section-graph.js";
import {
  checkRef,
  deleteMember,
  heldMember,
  insertMember,
  membersOf,
  moveMemberTo,
  nameOf,
  nextPosition,
  refColumns,
  renumber,
  requirePosition,
} from "./section-members.js";
import { onStructureChanged } from "./section-structure.js";
import type { SectionDetails, MemberRef, SectionInput, SectionMember } from "./section-types.js";
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
  await requireDefaultLanguageName(tx, names, fallbackLanguage);
  return names;
}

/** Refuses a names map that has entries but no text in the venue's default content language. */
export async function requireDefaultLanguageName(
  tx: Transaction,
  names: Record<string, string>,
  fallbackLanguage: string,
): Promise<void> {
  if (Object.keys(names).length === 0) return;
  const gap = await findContentTranslationGap(tx, [names], fallbackLanguage);
  if (gap !== null)
    throw new AppError("menu_section.translation_required", {
      field: "names",
      language: gap.language,
    });
}

/** Does the media library hold this file? Never, where the media module is not installed. */
async function mediaImageExists(tx: Transaction, filename: string): Promise<boolean> {
  if (!(await tableExists(tx, "media_images"))) return false;
  // The media module owns the reference. The row cannot be deleted between this read and the
  // write that depends on it: one write transaction runs on the venue file at a time, so there is
  // no concurrent deleter to hold the reference against.
  const image = await tx.execute(sql`select 1 from media_images where filename = ${filename}`);
  return image.rows.length > 0;
}

export function sectionColorOf(value: unknown): string | null {
  return colorOrNull(value, () => {
    throw new AppError("menu_section.invalid", { field: "color" });
  });
}

export async function sectionImageOf(tx: Transaction, value: unknown): Promise<string | null> {
  if (value === null) return null;
  if (typeof value !== "string" || !(await mediaImageExists(tx, value)))
    throw new AppError("menu_section.invalid", { field: "image" });
  return value;
}

/** Any list but a Device Home Page: that may only hold what its menu reaches, which no check here
 * establishes. */
function requireWritableList(graph: SectionGraph, sectionId: string): void {
  const role = graph.role(sectionId);
  if (role === undefined) throw new AppError("menu_section.not_found", { sectionId });
  if (role === "home_layout") throw new AppError("menu_section.wrong_role", { sectionId, role });
}

export function writableMember(
  graph: SectionGraph,
  sectionId: string,
  memberId: string,
): SectionMember {
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
  if (ref?.kind === "section") {
    const role = graph.role(ref.sectionId);
    if (role === undefined)
      throw new AppError("menu_section.not_found", { sectionId: ref.sectionId });
    if (role !== "menu_root")
      throw new AppError("menu_section.wrong_role", { sectionId: ref.sectionId, role });
  }
  // An Inactive product is on no menu, so no list may take one.
  await checkRef(tx, graph, sectionId, ref, replacing, { active: true });
  if (ref.kind === "section" && wouldCreateCycle(graph, sectionId, ref.sectionId))
    throw new AppError("menu_section.member_cycle", {
      sectionId,
      childSectionId: ref.sectionId,
    });
}

/** Any list by id; Home omits missing members. Use readMenuHome for its complete shortcuts. */
export async function readSection(tx: Transaction, id: string): Promise<SectionDetails> {
  const [row] = await tx.select(details).from(sections).where(eq(sections.id, id));
  if (!row) throw new AppError("menu_section.not_found", { sectionId: id });
  return { ...row, members: await membersOf(tx, id) };
}

/** A list's members; Home omits missing members. Use readMenuHome for its complete shortcuts. */
export async function listMembers(tx: Transaction, sectionId: string): Promise<SectionMember[]> {
  const [row] = await tx
    .select({ id: sections.id })
    .from(sections)
    .where(eq(sections.id, sectionId));
  if (!row) throw new AppError("menu_section.not_found", { sectionId });
  return membersOf(tx, sectionId);
}

export async function createSectionIn(
  tx: Transaction,
  listId: string,
  input: SectionInput,
  position?: number,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<SectionDetails> {
  const graph = await loadSectionGraph(tx);
  requireWritableList(graph, listId);
  requirePosition(position);
  const internalName = internalNameOf(input.internalName);
  const names = input.names === undefined ? {} : await namesOf(tx, input.names, fallbackLanguage);
  const color = input.color === undefined ? null : sectionColorOf(input.color);
  const image = input.image === undefined ? null : await sectionImageOf(tx, input.image);
  const [created] = await tx
    .insert(sections)
    .values({
      internalName,
      names,
      image,
      color,
      role: "section",
      ownerMenuId: graph.ownerMenu(listId)!,
    })
    .returning({ id: sections.id });
  await insertMember(
    tx,
    listId,
    graph.children(listId),
    { kind: "section", sectionId: created!.id },
    position,
  );
  await onStructureChanged(tx, menusContaining(graph, listId), graph);
  return readSection(tx, created!.id);
}

export async function updateSection(
  tx: Transaction,
  id: string,
  patch: SectionPatch,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<SectionDetails> {
  const [row] = await tx.select({ role: sections.role }).from(sections).where(eq(sections.id, id));
  if (!row) throw new AppError("menu_section.not_found", { sectionId: id });
  if (row.role !== "section")
    throw new AppError("menu_section.wrong_role", { sectionId: id, role: row.role });
  const values = await sectionPatchValues(tx, patch, fallbackLanguage);
  if (Object.keys(values).length > 0)
    await tx.update(sections).set(values).where(eq(sections.id, id));
  return readSection(tx, id);
}

export async function deleteSection(tx: Transaction, id: string): Promise<void> {
  const graph = await loadSectionGraph(tx);
  const role = graph.role(id);
  if (role === undefined) throw new AppError("menu_section.not_found", { sectionId: id });
  if (role !== "section") throw new AppError("menu_section.wrong_role", { sectionId: id, role });
  const menus = menusContaining(graph, id);
  const descendants = new Set<string>();
  const collect = (current: string): void => {
    descendants.add(current);
    for (const { ref } of graph.children(current))
      if (ref.kind === "section" && graph.role(ref.sectionId) === "section") collect(ref.sectionId);
  };
  collect(id);
  for (const target of descendants)
    for (const parent of graph.parents(target))
      if (graph.role(parent) === "home_layout")
        await tx
          .update(sectionMembers)
          .set({
            productId: null,
            childSectionId: null,
            missingName: sectionPathName(graph, target),
          })
          .where(
            and(eq(sectionMembers.sectionId, parent), eq(sectionMembers.childSectionId, target)),
          );
  await tx.delete(sections).where(inArray(sections.id, [...descendants]));
  for (const parent of graph.parents(id))
    if (graph.role(parent) !== "home_layout")
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
  if (!Array.isArray(productIds) || !(await allTopLevelProducts(tx, productIds, { active: true })))
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
  const member = heldMember(graph.children(sectionId), sectionId, memberId);
  refuseOwnedMember(graph, member);
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

/** A member named by the list holding it. */
export interface MemberAt {
  listId: string;
  memberId: string;
}

/** Each named member as its list holds it, refusing an empty or repeated naming. */
function heldMembers(
  graph: SectionGraph,
  members: readonly MemberAt[],
): { listId: string; member: SectionMember }[] {
  if (!Array.isArray(members) || members.length === 0)
    throw new AppError("menu_section.invalid", { field: "members" });
  const named = new Set<string>();
  return members.map(({ listId, memberId }) => {
    if (named.has(memberId)) throw new AppError("menu_section.invalid", { field: "members" });
    named.add(memberId);
    requireWritableList(graph, listId);
    return { listId, member: heldMember(graph.children(listId), listId, memberId) };
  });
}

const refKey = (ref: MemberRef): string =>
  ref.kind === "product" ? `product:${ref.productId}` : `section:${ref.sectionId}`;

async function writeStructureChange(
  tx: Transaction,
  graph: SectionGraph,
  lists: Iterable<string>,
): Promise<void> {
  const menus = new Set<string>();
  for (const list of lists) for (const menu of menusContaining(graph, list)) menus.add(menu);
  await onStructureChanged(tx, [...menus].sort(), graph);
}

/**
 * Moves members of this menu's lists into one of its lists, keeping each member row (and so an
 * include's folder setting), placed in the order given at `position` of the destination counted
 * without them (past the end means last). Every source list is renumbered without them.
 */
export async function moveMembersInto(
  tx: Transaction,
  toListId: string,
  members: readonly MemberAt[],
  position?: number,
): Promise<SectionMember[]> {
  const graph = await loadSectionGraph(tx);
  requireWritableList(graph, toListId);
  requirePosition(position);
  const moving = heldMembers(graph, members);
  const menu = graph.ownerMenu(toListId);
  if (moving.some(({ listId }) => graph.ownerMenu(listId) !== menu))
    throw new AppError("menu_section.invalid", { field: "listId" });
  const movedIds = new Set(moving.map(({ member }) => member.id));
  const staying = graph.children(toListId).filter((member) => !movedIds.has(member.id));
  // Checked against the final list, so no update below passes through a duplicate either.
  const held = new Set(staying.map((member) => refKey(member.ref)));
  for (const { member } of moving) {
    if (member.ref.kind === "section" && wouldCreateCycle(graph, toListId, member.ref.sectionId))
      throw new AppError("menu_section.member_cycle", {
        sectionId: toListId,
        childSectionId: member.ref.sectionId,
      });
    const key = refKey(member.ref);
    if (held.has(key)) throw new AppError("menu_section.member_duplicate", { sectionId: toListId });
    held.add(key);
  }
  const ordered = [...staying];
  ordered.splice(
    Math.min(position ?? staying.length, staying.length),
    0,
    ...moving.map(({ member }) => member),
  );
  const arriving = moving.filter(({ listId }) => listId !== toListId);
  for (const batch of batches(arriving.map(({ member }) => member.id)))
    await tx
      .update(sectionMembers)
      .set({ sectionId: toListId })
      .where(inArray(sectionMembers.id, batch));
  await renumber(tx, ordered);
  const sources = new Set(arriving.map(({ listId }) => listId));
  for (const listId of sources)
    await renumber(
      tx,
      graph.children(listId).filter((member) => !movedIds.has(member.id)),
    );
  await writeStructureChange(tx, graph, [toListId, ...sources]);
  return ordered.map((member, at) => ({ ...member, position: at }));
}

/** Removes members from their lists; an owned section is deleted, never removed. */
export async function removeMembers(tx: Transaction, members: readonly MemberAt[]): Promise<void> {
  const graph = await loadSectionGraph(tx);
  const removing = heldMembers(graph, members);
  for (const { member } of removing) refuseOwnedMember(graph, member);
  const removedIds = new Set(removing.map(({ member }) => member.id));
  for (const batch of batches([...removedIds]))
    await tx.delete(sectionMembers).where(inArray(sectionMembers.id, batch));
  const lists = new Set(removing.map(({ listId }) => listId));
  for (const listId of lists)
    await renumber(
      tx,
      graph.children(listId).filter((member) => !removedIds.has(member.id)),
    );
  await writeStructureChange(tx, graph, lists);
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
  refuseOwnedMember(graph, current);
  await checkListRef(tx, graph, sectionId, ref, current);
  const sameInclude =
    ref.kind === "section" &&
    current.ref.kind === "section" &&
    ref.sectionId === current.ref.sectionId;
  await tx
    .update(sectionMembers)
    .set(
      sameInclude
        ? refColumns(ref)
        : { ...refColumns(ref), showAsFolder: true, folderOverrides: {} },
    )
    .where(eq(sectionMembers.id, memberId));
  // A replace changes what the list holds, never which menus reach the list.
  await onStructureChanged(tx, menusContaining(graph, sectionId), graph);
  return { ...current, ref };
}

function refuseOwnedMember(graph: SectionGraph, member: SectionMember): void {
  if (member.ref.kind === "section" && graph.role(member.ref.sectionId) === "section")
    throw new AppError("menu_section.wrong_role", {
      sectionId: member.ref.sectionId,
      role: "section",
    });
}

export async function sectionPatchValues(
  tx: Transaction,
  patch: SectionPatch,
  fallbackLanguage: string = FALLBACK_LOCALE,
): Promise<SectionPatch> {
  const values: SectionPatch = {};
  if (patch.internalName !== undefined) values.internalName = internalNameOf(patch.internalName);
  if (patch.names !== undefined) values.names = await namesOf(tx, patch.names, fallbackLanguage);
  if (patch.color !== undefined) values.color = sectionColorOf(patch.color);
  if (patch.image !== undefined) values.image = await sectionImageOf(tx, patch.image);
  return values;
}
