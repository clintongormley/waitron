import { MONEY_SCALE, decimal, sumDecimals, toScale } from "@waitron/shared";
import { lineGross } from "./order-line.js";
import type { GroupRelease, TillCourse } from "../api/client.js";
import { lineProductName } from "../widgets/product-name.js";
import type { Place } from "./draft-place.js";
import type { OrderLine } from "./working-order.js";

interface LayoutHeldGroup {
  id: string;
  state: "held" | "fired";
  position: number;
  displayNumber: number;
}
export interface LayoutGroup {
  key: string;
  kind: "fire" | "new" | "join";
  slot: number | null;
  groupId: string | null;
  displayNumber: number | null;
  invalidTarget: boolean;
  courseNames: string[];
  sections: { course: TillCourse | null; heading: boolean; indexes: number[] }[];
}
interface LayoutInput {
  lines: readonly OrderLine[];
  courses: readonly TillCourse[];
  groups: readonly LayoutHeldGroup[];
  locale: string;
  nextDisplayNumber: number;
}
export interface SubmitGroup {
  release: GroupRelease;
  indexes: number[];
  joinGroupId?: string;
  afterGroupId?: string;
}

interface PlacedGroup {
  key: string;
  place: Place;
  indexes: number[];
}
function placedGroups(
  lines: readonly OrderLine[],
  held: readonly LayoutHeldGroup[],
): PlacedGroup[] {
  const parts = new Map<string, PlacedGroup>();
  lines.forEach((line, index) => {
    const place = line.place ?? { kind: "fire" };
    const key =
      place.kind === "fire"
        ? "fire"
        : place.kind === "new"
          ? `new:${place.slot}`
          : `join:${place.groupId}`;
    const group = parts.get(key) ?? { key, place, indexes: [] };
    group.indexes.push(index);
    parts.set(key, group);
  });
  const rank = { fire: 0, new: 1, join: 2 };
  return [...parts.values()].sort((a, b) => {
    const kind = rank[a.place.kind] - rank[b.place.kind];
    if (kind !== 0) return kind;
    if (a.place.kind === "new" && b.place.kind === "new") return a.place.slot - b.place.slot;
    if (a.place.kind === "join" && b.place.kind === "join") {
      const aId = a.place.groupId;
      const bId = b.place.groupId;
      return (
        (held.find((group) => group.id === aId)?.position ?? Number.POSITIVE_INFINITY) -
          (held.find((group) => group.id === bId)?.position ?? Number.POSITIVE_INFINITY) ||
        aId.localeCompare(bId)
      );
    }
    return 0;
  });
}

export function draftLayout({
  lines,
  courses,
  groups,
  locale,
  nextDisplayNumber,
}: LayoutInput): LayoutGroup[] {
  const ordered = placedGroups(lines, groups);
  const known = new Map(courses.map((course) => [course.id, course]));
  const courseIdOf = (line: OrderLine) => line.courseId ?? line.product.courseId ?? null;
  for (const line of lines) {
    if (line.course?.id === courseIdOf(line) && !known.has(line.course.id))
      known.set(line.course.id, line.course);
  }
  const collator = new Intl.Collator(locale);
  let nextNewNumber =
    nextDisplayNumber + (ordered.some((group) => group.place.kind === "fire") ? 1 : 0);
  return ordered.map(({ key, place, indexes }) => {
    const byCourse = new Map<string | null, number[]>();
    for (const index of indexes) {
      const id = courseIdOf(lines[index]!);
      const courseId = id !== null && known.has(id) ? id : null;
      const bucket = byCourse.get(courseId) ?? [];
      bucket.push(index);
      byCourse.set(courseId, bucket);
    }
    const sections = [...byCourse]
      .map(([id, indexes]) => ({
        course: id === null ? null : known.get(id)!,
        heading: byCourse.size > 1,
        indexes: [...indexes].sort(
          (a, b) =>
            collator.compare(
              lineProductName(lines[a]!.product),
              lineProductName(lines[b]!.product),
            ) || a - b,
        ),
      }))
      .sort((a, b) =>
        a.course === null
          ? b.course === null
            ? 0
            : -1
          : b.course === null
            ? 1
            : a.course.displayOrder - b.course.displayOrder ||
              a.course.id.localeCompare(b.course.id),
      );
    const targetId =
      place.kind === "join" ? place.groupId : place.kind === "new" ? place.afterGroupId : undefined;
    const target = groups.find((group) => group.id === targetId);
    return {
      key,
      kind: place.kind,
      slot: place.kind === "new" ? place.slot : null,
      groupId: place.kind === "join" ? place.groupId : null,
      displayNumber:
        place.kind === "new"
          ? nextNewNumber++
          : place.kind === "join"
            ? (target?.displayNumber ?? null)
            : null,
      invalidTarget: targetId !== undefined && target?.state !== "held",
      courseNames: sections.flatMap((section) =>
        section.course === null ? [] : [section.course.name],
      ),
      sections,
    };
  });
}

export function sendAllGroups(
  lines: readonly OrderLine[],
  held: readonly LayoutHeldGroup[],
  sendable: (index: number) => boolean,
): SubmitGroup[] {
  return placedGroups(lines, held).flatMap(({ place, indexes }) => {
    const accepted = indexes.filter(sendable);
    if (accepted.length === 0) return [];
    return [
      {
        release: place.kind === "fire" ? ("fire" as const) : ("hold" as const),
        indexes: accepted,
        ...(place.kind === "join" ? { joinGroupId: place.groupId } : {}),
        ...(place.kind === "new" && place.afterGroupId !== undefined
          ? { afterGroupId: place.afterGroupId }
          : {}),
      },
    ];
  });
}

export function fireGroups(
  lines: readonly OrderLine[],
  ticked: ReadonlySet<number>,
  sendable: (index: number) => boolean,
): SubmitGroup[] {
  const indexes = lines.flatMap((_, index) =>
    ticked.has(index) && sendable(index) ? [index] : [],
  );
  return indexes.length === 0 ? [] : [{ release: "fire", indexes }];
}

export function panelTotal(storedTotal: string, ownLines: readonly OrderLine[]): string {
  return toScale(
    sumDecimals([
      decimal(storedTotal),
      ...ownLines.filter((line) => line.source === undefined).map(lineGross),
    ]),
    MONEY_SCALE,
  );
}
