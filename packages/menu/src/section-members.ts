import { and, asc, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import { allTopLevelProducts } from "./categories.js";
import { menus, sectionMembers, sections } from "@waitron/db";
import { isTile, toSectionMember, type SectionGraph } from "./section-graph.js";
import type { MemberRef, SectionMember, ShortcutRef, TileRef } from "@waitron/shared";
import "./errors.js";

export const memberOrder = [asc(sectionMembers.position), asc(sectionMembers.id)];

export function membersOf(tx: Transaction, sectionId: string): Promise<SectionMember[]>;
export function membersOf(
  tx: Transaction,
  sectionId: string,
  role: "home_layout",
): Promise<SectionMember<TileRef>[]>;
export async function membersOf(
  tx: Transaction,
  sectionId: string,
  role?: "home_layout",
): Promise<SectionMember<MemberRef | TileRef>[]> {
  const rows = await tx
    .select()
    .from(sectionMembers)
    .where(eq(sectionMembers.sectionId, sectionId))
    .orderBy(...memberOrder);
  const setMenuRoots = await tx
    .select({ sectionId: sections.id, menuId: menus.id })
    .from(sections)
    .innerJoin(menus, eq(menus.id, sections.ownerMenuId))
    .where(and(eq(sections.role, "menu_root"), eq(menus.kind, "set_menu")));
  const roots = new Map(setMenuRoots.map(({ sectionId, menuId }) => [sectionId, menuId]));
  const members = rows.map((row) => toSectionMember(row, roots));
  return role === "home_layout"
    ? members.filter(isTile)
    : members.filter((member) => member.ref.kind !== "missing");
}

export function nameOf(value: unknown, field: string): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") throw new AppError("menu_section.invalid", { field });
  return name;
}

export function refKey(ref: MemberRef): string {
  switch (ref.kind) {
    case "product":
      return `product:${ref.productId}`;
    case "section":
      return `section:${ref.sectionId}`;
    case "set_menu":
      return `set_menu:${ref.menuId}`;
  }
}

export function refColumns(ref: ShortcutRef) {
  return ref.kind === "product"
    ? { productId: ref.productId, childSectionId: null, missingName: null }
    : { productId: null, childSectionId: ref.sectionId, missingName: null };
}

export function heldMember<Ref extends MemberRef | TileRef>(
  members: readonly SectionMember<Ref>[],
  sectionId: string,
  memberId: string,
): SectionMember<Ref> {
  const member = members.find((candidate) => candidate.id === memberId);
  if (!member) throw new AppError("menu_section.not_found", { sectionId, memberId });
  return member;
}

function requireIndex(value: number, field: "position" | "to"): void {
  if (!Number.isInteger(value) || value < 0) throw new AppError("menu_section.invalid", { field });
}

export function requirePosition(position: number | undefined): void {
  if (position !== undefined) requireIndex(position, "position");
}

/** Home tiles may target owned sections or menu roots; reach is checked by the shortcut writer. A
 * product must be Active too when `active`. */
export async function checkRef(
  tx: Transaction,
  graph: SectionGraph,
  sectionId: string,
  ref: MemberRef,
  replacing?: SectionMember<MemberRef | TileRef>,
  { active = false }: { active?: boolean } = {},
): Promise<ShortcutRef> {
  const home = graph.role(sectionId) === "home_layout";
  let stored: ShortcutRef;
  if (ref?.kind === "set_menu") {
    if (home) throw new AppError("set_menu.wrong_place", { menuId: ref.menuId });
    const menu = graph.menu(ref.menuId);
    const root = graph.roots().find(({ menuId }) => menuId === ref.menuId);
    if (menu?.kind !== "set_menu" || !menu.active || root === undefined)
      throw new AppError("set_menu.not_found", { menuId: ref.menuId });
    stored = { kind: "section", sectionId: root.sectionId };
  } else if (ref?.kind === "section" && typeof ref.sectionId === "string") {
    const role = graph.role(ref.sectionId);
    if (role === undefined)
      throw new AppError("menu_section.not_found", { sectionId: ref.sectionId });
    if (role === "home_layout")
      throw new AppError("menu_section.wrong_role", { sectionId: ref.sectionId, role });
    const menuId = graph.ownerMenu(ref.sectionId)!;
    if (role === "menu_root" && graph.menu(menuId)?.kind === "set_menu")
      throw new AppError("set_menu.wrong_place", { menuId });
    stored = ref;
  } else if (
    ref?.kind === "product" &&
    (await allTopLevelProducts(tx, [ref.productId], { active }))
  ) {
    stored = ref;
  } else {
    throw new AppError("menu_section.membership_invalid", {});
  }
  const members = home ? graph.tiles(sectionId) : graph.children(sectionId);
  const key = refKey(ref);
  if (
    members.some(
      ({ ref: held, id }) =>
        id !== replacing?.id && held.kind !== "missing" && refKey(held) === key,
    )
  )
    throw new AppError("menu_section.member_duplicate", { sectionId });
  return stored;
}

export async function renumber(
  tx: Transaction,
  ordered: readonly SectionMember<MemberRef | TileRef>[],
): Promise<void> {
  for (const [position, member] of ordered.entries())
    if (member.position !== position)
      await tx.update(sectionMembers).set({ position }).where(eq(sectionMembers.id, member.id));
}

export function nextPosition(members: readonly SectionMember<MemberRef | TileRef>[]): number {
  return Math.max(-1, ...members.map((member) => member.position)) + 1;
}

export async function appendProductMembers(
  tx: Transaction,
  sectionId: string,
  members: readonly SectionMember[],
  productIds: readonly string[],
): Promise<string[]> {
  const held = new Set(
    members.flatMap(({ ref }) => (ref.kind === "product" ? [ref.productId] : [])),
  );
  const adding = productIds.filter((productId) => !held.has(productId));
  let position = nextPosition(members);
  for (const batch of batches(adding))
    await tx
      .insert(sectionMembers)
      .values(batch.map((productId) => ({ sectionId, position: position++, productId })));
  return adding;
}

export async function insertMember(
  tx: Transaction,
  sectionId: string,
  members: readonly SectionMember<MemberRef | TileRef>[],
  ref: MemberRef,
  stored: ShortcutRef,
  position?: number,
): Promise<SectionMember> {
  const at = position === undefined ? nextPosition(members) : Math.min(position, members.length);
  const [row] = await tx
    .insert(sectionMembers)
    .values({ sectionId, position: at, ...refColumns(stored) })
    .returning();
  const added: SectionMember = { id: row!.id, position: row!.position, ref };
  if (position !== undefined) {
    const ordered = [...members];
    ordered.splice(at, 0, added);
    await renumber(tx, ordered);
  }
  return added;
}

/** Fills a new, empty list with the refs given, at positions 0..n-1. */
export async function writeMembers(
  tx: Transaction,
  sectionId: string,
  refs: readonly ShortcutRef[],
): Promise<void> {
  let position = 0;
  for (const batch of batches(refs))
    await tx
      .insert(sectionMembers)
      .values(batch.map((ref) => ({ sectionId, position: position++, ...refColumns(ref) })));
}

export async function deleteMember(
  tx: Transaction,
  sectionId: string,
  members: readonly SectionMember<MemberRef | TileRef>[],
  memberId: string,
): Promise<void> {
  heldMember(members, sectionId, memberId);
  await tx.delete(sectionMembers).where(eq(sectionMembers.id, memberId));
  await renumber(
    tx,
    members.filter((member) => member.id !== memberId),
  );
}

export async function moveMemberTo<Ref extends MemberRef | TileRef>(
  tx: Transaction,
  sectionId: string,
  members: readonly SectionMember<Ref>[],
  memberId: string,
  to: number,
): Promise<SectionMember<Ref>[]> {
  const member = heldMember(members, sectionId, memberId);
  requireIndex(to, "to");
  const ordered = members.filter((candidate) => candidate !== member);
  ordered.splice(to, 0, member);
  await renumber(tx, ordered);
  return ordered.map((held, position) => ({ ...held, position }));
}
