import type { GroupRelease, OrderGroup, TabLine, TillCourse } from "../api/client.js";

/** One round line as the grouping reads it: its course, and whether the waiter held it. */
export interface RoundEntry {
  courseId: string | null;
  held: boolean;
}

/** One group of a round: the positions of its lines in the round, and when it is released. */
export interface RoundGroup {
  release: GroupRelease;
  lineIndexes: number[];
}

/**
 * Splits a round into groups by course, in the venue's course order. The earliest course goes to
 * the kitchen now, less the lines the waiter held, which wait as a group of their own; every later
 * course waits as a group. A line with no course, or with one the till does not list (so cannot
 * order or offer a Fire for), goes with the earliest course.
 */
export function groupRound(
  entries: readonly RoundEntry[],
  courses: readonly TillCourse[],
): RoundGroup[] {
  const rank = new Map(
    [...courses]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((course, index) => [course.id, index]),
  );
  const ranked = entries.map((entry) =>
    entry.courseId === null ? undefined : rank.get(entry.courseId),
  );
  const present = [...new Set(ranked.filter((r): r is number => r !== undefined))].sort(
    (a, b) => a - b,
  );
  const first = present[0];
  const bucketOf = (index: number) => ranked[index] ?? first;
  const indexesOf = (bucket: number | undefined, keep: (index: number) => boolean) =>
    entries.flatMap((_, index) => (bucketOf(index) === bucket && keep(index) ? [index] : []));

  const groups: RoundGroup[] = [
    { release: "fire", lineIndexes: indexesOf(first, (index) => !entries[index]!.held) },
    { release: "hold", lineIndexes: indexesOf(first, (index) => entries[index]!.held) },
    ...present
      .slice(1)
      .map((bucket) => ({ release: "hold" as const, lineIndexes: indexesOf(bucket, () => true) })),
  ];
  return groups.filter((group) => group.lineIndexes.length > 0);
}

/** The ids of the party's HELD groups. */
export function heldGroupIds(groups: readonly Pick<OrderGroup, "id" | "state">[]): Set<string> {
  return new Set(groups.filter((group) => group.state === "held").map((group) => group.id));
}

/** Its group releases it: the server refuses a held-group line's own Send (`group.line_held`). */
export function inHeldGroup(line: Pick<TabLine, "groupId">, heldIds: ReadonlySet<string>): boolean {
  return line.groupId !== null && heldIds.has(line.groupId);
}

/** A held dish with a ticket item and no held group, such as a recalled line: sent on its own. */
export function sendsAlone(
  line: Pick<TabLine, "parentLineNo" | "firedAt" | "state" | "groupId">,
  heldIds: ReadonlySet<string>,
): boolean {
  return (
    (line.parentLineNo ?? null) === null &&
    line.firedAt === null &&
    line.state !== null &&
    !inHeldGroup(line, heldIds)
  );
}
