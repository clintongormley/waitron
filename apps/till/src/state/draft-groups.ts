import type { GroupRelease, TillCourse } from "../api/client.js";

/** One draft line as the grouping reads it. */
export interface DraftEntry {
  /** The waiter's course override, else the product's default; null for none. */
  courseId: string | null;
  quantity: string;
  /** Sold by the whole unit. A weighed or fractional line is one item, whatever it weighs. */
  wholeUnits: boolean;
  /** Cannot be sold now: no action sends it, and it stays in the draft. */
  flagged?: boolean;
}

/** One section of the draft: its course (null when no line has a course the till lists) and the
 * positions of its lines in the draft, in draft order. */
export interface DraftSection {
  course: TillCourse | null;
  lineIndexes: number[];
}

/** One group a draft action submits: the positions of its lines in the draft, and its release. */
export interface DraftGroup {
  release: GroupRelease;
  lineIndexes: number[];
}

/** A draft action. `fire-now`, `add-to-held` and `add-as-new` act on the selection, or on everything
 * when nothing is selected. */
export type DraftAction =
  | { kind: "send-all" }
  | { kind: "fire-all" }
  | { kind: "send-selected" }
  | { kind: "fire-selected" }
  | { kind: "fire-now" }
  | { kind: "add-to-held"; groupId: string }
  | { kind: "add-as-new" };

/** The groups an action submits, in the party's sequence order, and the draft lines it leaves.
 * `leftOut`: the flagged lines the action would have sent, present only when there are some. */
export interface DraftSubmission {
  groups: DraftGroup[];
  joinGroupId?: string;
  remaining: number[];
  leftOut?: number[];
}

/** What an action's confirmation names before it is sent. */
export interface DraftPreview {
  fireItems: number;
  holdGroups: number;
  holdItems: number;
}

/**
 * Sorts the draft into one section per course present, in the venue's course order. A line with no
 * course, or one the till does not list, goes in the first section.
 */
export function draftSections(
  entries: readonly Pick<DraftEntry, "courseId">[],
  courses: readonly TillCourse[],
): DraftSection[] {
  if (entries.length === 0) return [];
  const ordered = [...courses].sort((a, b) => a.displayOrder - b.displayOrder);
  const rank = new Map(ordered.map((course, index) => [course.id, index]));
  const ranked = entries.map((entry) =>
    entry.courseId === null ? undefined : rank.get(entry.courseId),
  );
  const present = [...new Set(ranked.filter((r): r is number => r !== undefined))].sort(
    (a, b) => a - b,
  );
  if (present.length === 0) {
    return [{ course: null, lineIndexes: entries.map((_, index) => index) }];
  }
  const first = present[0];
  return present.map((bucket) => ({
    course: ordered[bucket]!,
    lineIndexes: entries.flatMap((_, index) =>
      (ranked[index] ?? first) === bucket ? [index] : [],
    ),
  }));
}

/** A line sold by the unit counts its quantity; a weighed line counts one. */
export function itemCount(entry: Pick<DraftEntry, "quantity" | "wholeUnits">): number {
  return entry.wholeUnits ? Number(entry.quantity) : 1;
}

/** The groups `action` submits. A flagged line is never among them. */
export function draftSubmission(
  action: DraftAction,
  entries: readonly DraftEntry[],
  courses: readonly TillCourse[],
  selected: ReadonlySet<number>,
): DraftSubmission {
  const sections = draftSections(entries, courses);
  const shown = sections.flatMap((section) => section.lineIndexes);
  const chosen = shown.filter((index) => selected.has(index));
  const scope = chosen.length > 0 ? chosen : shown;
  const sendable = (index: number) => entries[index]!.flagged !== true;
  const one = (release: GroupRelease, lineIndexes: number[]): DraftGroup[] => {
    const sent = lineIndexes.filter(sendable);
    return sent.length === 0 ? [] : [{ release, lineIndexes: sent }];
  };
  const [groups, reached] = ((): [DraftGroup[], number[]] => {
    switch (action.kind) {
      case "send-all":
        return [sections.flatMap((section) => one("hold", section.lineIndexes)), shown];
      case "fire-all":
        return [one("fire", shown), shown];
      case "send-selected":
        return [one("hold", chosen), chosen];
      case "fire-selected":
        return [one("fire", chosen), chosen];
      case "fire-now":
        return [one("fire", scope), scope];
      case "add-to-held":
      case "add-as-new":
        return [one("hold", scope), scope];
    }
  })();
  const joinGroupId =
    action.kind === "add-to-held" && groups.length > 0 ? action.groupId : undefined;
  const sent = new Set(groups.flatMap((group) => group.lineIndexes));
  const remaining = entries.flatMap((_, index) => (sent.has(index) ? [] : [index]));
  const leftOut = reached.filter((index) => !sendable(index)).sort((a, b) => a - b);
  return {
    groups,
    ...(joinGroupId === undefined ? {} : { joinGroupId }),
    remaining,
    ...(leftOut.length === 0 ? {} : { leftOut }),
  };
}

/** What the confirmation of `submission` names, counted from the groups it sends. */
export function draftPreview(
  submission: Pick<DraftSubmission, "groups">,
  entries: readonly DraftEntry[],
): DraftPreview {
  const { groups } = submission;
  const items = (release: GroupRelease) =>
    groups
      .filter((group) => group.release === release)
      .reduce(
        (sum, group) =>
          sum + group.lineIndexes.reduce((count, index) => count + itemCount(entries[index]!), 0),
        0,
      );
  return {
    fireItems: items("fire"),
    holdGroups: groups.filter((group) => group.release === "hold").length,
    holdItems: items("hold"),
  };
}
