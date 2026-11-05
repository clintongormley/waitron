import { compareDecimal, decimal } from "@waitron/shared";
import type { OrderGroup, TabLine } from "../api/client.js";

/** The ids of the party's HELD groups. */
export function heldGroupIds(groups: readonly Pick<OrderGroup, "id" | "state">[]): Set<string> {
  return new Set(groups.filter((group) => group.state === "held").map((group) => group.id));
}

/** Its group releases it: the server refuses a held-group line's own Send (`group.line_held`). */
export function inHeldGroup(line: Pick<TabLine, "groupId">, heldIds: ReadonlySet<string>): boolean {
  return line.groupId !== null && heldIds.has(line.groupId);
}

/** The kitchen is not making it until its group is released. A dish made here has a fired time even
 * in a held group, and one wholly cancelled has nothing left to make. */
export function waitsInHeldGroup(
  line: Pick<TabLine, "groupId" | "firedAt" | "quantity" | "cancelledQuantity">,
  heldIds: ReadonlySet<string>,
): boolean {
  return (
    inHeldGroup(line, heldIds) &&
    line.firedAt === null &&
    compareDecimal(decimal(line.cancelledQuantity ?? "0"), decimal(line.quantity)) < 0
  );
}
