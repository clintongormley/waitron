import type { OrderGroup, TabLine } from "../api/client.js";

/** The ids of the party's HELD groups. */
export function heldGroupIds(groups: readonly Pick<OrderGroup, "id" | "state">[]): Set<string> {
  return new Set(groups.filter((group) => group.state === "held").map((group) => group.id));
}

/** Whether the line belongs to a held group, regardless of any individual lunch-course release. */
export function inHeldGroup(line: Pick<TabLine, "groupId">, heldIds: ReadonlySet<string>): boolean {
  return line.groupId !== null && heldIds.has(line.groupId);
}
