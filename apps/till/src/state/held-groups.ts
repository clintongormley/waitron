import type { OrderGroup, TabLine } from "../api/client.js";

/** The ids of the party's HELD groups. */
export function heldGroupIds(groups: readonly Pick<OrderGroup, "id" | "state">[]): Set<string> {
  return new Set(groups.filter((group) => group.state === "held").map((group) => group.id));
}

/** Its group releases it: the server refuses a held-group line's own Send (`group.line_held`). */
export function inHeldGroup(line: Pick<TabLine, "groupId">, heldIds: ReadonlySet<string>): boolean {
  return line.groupId !== null && heldIds.has(line.groupId);
}
