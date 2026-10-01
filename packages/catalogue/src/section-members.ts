import { asc, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import { allTopLevelProducts } from "./categories.js";
import { sectionMembers } from "./schema/sections.js";
import { toSectionMember, type SectionGraph } from "./section-graph.js";
import type { MemberRef, SectionMember, TileRef } from "./section-types.js";
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
): Promise<SectionMember<TileRef>[]> {
  const rows = await tx
    .select()
    .from(sectionMembers)
    .where(eq(sectionMembers.sectionId, sectionId))
    .orderBy(...memberOrder);
  const members = rows.map(toSectionMember);
  return role === "home_layout"
    ? members
    : members.filter((member) => member.ref.kind !== "missing");
}

export function nameOf(value: unknown, field: string): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") throw new AppError("menu_section.invalid", { field });
  return name;
}

export function sameRef(a: TileRef, b: MemberRef): boolean {
  return a.kind === "product"
    ? b.kind === "product" && a.productId === b.productId
    : a.kind === "section" && b.kind === "section" && a.sectionId === b.sectionId;
}

export function refColumns(ref: MemberRef) {
  return ref.kind === "product"
    ? { productId: ref.productId, childSectionId: null, missingName: null }
    : { productId: null, childSectionId: ref.sectionId, missingName: null };
}

export function heldMember<Ref extends TileRef>(
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

/** Home tiles may target owned sections or menu roots; reach is checked by the layout writer. */
export async function checkRef(
  tx: Transaction,
  graph: SectionGraph,
  sectionId: string,
  ref: MemberRef,
  replacing?: SectionMember<TileRef>,
): Promise<void> {
  if (ref?.kind === "section" && typeof ref.sectionId === "string") {
    const role = graph.role(ref.sectionId);
    if (role === undefined)
      throw new AppError("menu_section.not_found", { sectionId: ref.sectionId });
    if (role === "home_layout")
      throw new AppError("menu_section.wrong_role", { sectionId: ref.sectionId, role });
  } else if (ref?.kind !== "product" || !(await allTopLevelProducts(tx, [ref.productId]))) {
    throw new AppError("menu_section.membership_invalid", {});
  }
  if (graph.tiles(sectionId).some((member) => member !== replacing && sameRef(member.ref, ref)))
    throw new AppError("menu_section.member_duplicate", { sectionId });
}

export async function renumber(
  tx: Transaction,
  ordered: readonly SectionMember<TileRef>[],
): Promise<void> {
  for (const [position, member] of ordered.entries())
    if (member.position !== position)
      await tx.update(sectionMembers).set({ position }).where(eq(sectionMembers.id, member.id));
}

export function nextPosition(members: readonly SectionMember<TileRef>[]): number {
  return Math.max(-1, ...members.map((member) => member.position)) + 1;
}

export async function insertMember(
  tx: Transaction,
  sectionId: string,
  members: readonly SectionMember<TileRef>[],
  ref: MemberRef,
  position?: number,
): Promise<SectionMember> {
  const at = position === undefined ? nextPosition(members) : Math.min(position, members.length);
  const [row] = await tx
    .insert(sectionMembers)
    .values({ sectionId, position: at, ...refColumns(ref) })
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
  refs: readonly MemberRef[],
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
  members: readonly SectionMember<TileRef>[],
  memberId: string,
): Promise<void> {
  heldMember(members, sectionId, memberId);
  await tx.delete(sectionMembers).where(eq(sectionMembers.id, memberId));
  await renumber(
    tx,
    members.filter((member) => member.id !== memberId),
  );
}

export async function moveMemberTo<Ref extends TileRef>(
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
