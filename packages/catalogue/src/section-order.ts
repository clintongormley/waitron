import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { sectionMembers } from "./schema/sections.js";
import type { SectionGraph } from "./section-graph.js";
import type { SectionMember } from "./section-types.js";

/** Write positions 0..n-1 in the order given, touching only the rows whose position moves. */
export async function renumber(tx: Transaction, ordered: readonly SectionMember[]): Promise<void> {
  for (const [position, member] of ordered.entries())
    if (member.position !== position)
      await tx.update(sectionMembers).set({ position }).where(eq(sectionMembers.id, member.id));
}

export function nextPosition(graph: SectionGraph, sectionId: string): number {
  return Math.max(-1, ...graph.children(sectionId).map((member) => member.position)) + 1;
}
