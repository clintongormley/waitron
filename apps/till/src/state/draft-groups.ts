import type { GroupRelease, TillCourse } from "../api/client.js";

/** One draft line as the grouping reads it. */
export interface DraftEntry {
  /** The waiter's course override, else the product's default; null for none. */
  courseId: string | null;
  quantity: string;
  /** Sold by the whole unit. A weighed or fractional line is one item, whatever it weighs. */
  wholeUnits: boolean;
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

/** The groups an action submits, in the party's sequence order, and the draft lines it leaves. */
export interface DraftSubmission {
  groups: DraftGroup[];
  joinGroupId?: string;
  remaining: number[];
}

/** What an action's confirmation names before it is sent. */
export interface DraftPreview {
  fireItems: number;
  holdGroups: number;
  holdItems: number;
  joinGroupId?: string;
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

/** The groups `action` submits. A group's lines follow the order the screen shows them in. */
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
  const one = (release: GroupRelease, lineIndexes: number[]): DraftGroup[] =>
    lineIndexes.length === 0 ? [] : [{ release, lineIndexes }];
  const groups = ((): DraftGroup[] => {
    switch (action.kind) {
      case "send-all":
        return sections.map((section) => ({ release: "hold", lineIndexes: section.lineIndexes }));
      case "fire-all":
        return one("fire", shown);
      case "send-selected":
        return one("hold", chosen);
      case "fire-selected":
        return one("fire", chosen);
      case "fire-now":
        return one("fire", scope);
      case "add-to-held":
      case "add-as-new":
        return one("hold", scope);
    }
  })();
  const joinGroupId =
    action.kind === "add-to-held" && groups.length > 0 ? action.groupId : undefined;
  const sent = new Set(groups.flatMap((group) => group.lineIndexes));
  const remaining = entries.flatMap((_, index) => (sent.has(index) ? [] : [index]));
  return joinGroupId === undefined ? { groups, remaining } : { groups, joinGroupId, remaining };
}

/** What the confirmation of `action` names: counted from the very groups it submits. */
export function draftPreview(
  action: DraftAction,
  entries: readonly DraftEntry[],
  courses: readonly TillCourse[],
  selected: ReadonlySet<number>,
): DraftPreview {
  const { groups, joinGroupId } = draftSubmission(action, entries, courses, selected);
  const items = (release: GroupRelease) =>
    groups
      .filter((group) => group.release === release)
      .reduce(
        (sum, group) =>
          sum + group.lineIndexes.reduce((count, index) => count + itemCount(entries[index]!), 0),
        0,
      );
  const preview: DraftPreview = {
    fireItems: items("fire"),
    holdGroups: groups.filter((group) => group.release === "hold").length,
    holdItems: items("hold"),
  };
  return joinGroupId === undefined ? preview : { ...preview, joinGroupId };
}
