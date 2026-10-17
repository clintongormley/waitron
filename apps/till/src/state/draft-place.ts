import type { CurrentOrders, OrderGroup, TillCourse } from "../api/client.js";

export type Place =
  | { kind: "fire" }
  | { kind: "new"; slot: number; afterGroupId?: string }
  | { kind: "join"; groupId: string };

type GroupPlace = Exclude<Place, { kind: "fire" }>;

export interface HeldGroupView {
  id: string;
  position: number;
  courseIds: ReadonlySet<string>;
}

export interface PlaceContext {
  courses: readonly TillCourse[];
  held: readonly HeldGroupView[];
  firstOrder: boolean;
  placed: readonly { courseId: string | null; place: Place }[];
}

export function placeFor(
  courseId: string | null,
  ctx: PlaceContext,
): { place: Place; shift?: { from: number } } {
  const course = ctx.courses.find((candidate) => candidate.id === courseId);
  if (courseId === null || course?.heldUntilFired === false) return { place: { kind: "fire" } };

  const slots = new Map<number, Extract<Place, { kind: "new" }>>();
  for (const { place } of ctx.placed) {
    if (place.kind === "new" && !slots.has(place.slot)) slots.set(place.slot, place);
  }
  const newPlaces = [...slots.values()].sort((a, b) => a.slot - b.slot);
  const held = [...ctx.held].sort((a, b) => a.position - b.position);
  const heldIds = new Set(held.map((group) => group.id));
  const firingOrder: GroupPlace[] = held.flatMap((group): GroupPlace[] => [
    { kind: "join", groupId: group.id },
    ...newPlaces.filter((place) => place.afterGroupId === group.id),
  ]);
  firingOrder.push(...newPlaces.filter((place) => !heldIds.has(place.afterGroupId ?? "")));

  for (const place of firingOrder) {
    const hasCourse =
      place.kind === "join"
        ? held.find((group) => group.id === place.groupId)!.courseIds.has(courseId) ||
          ctx.placed.some(
            (line) =>
              line.courseId === courseId &&
              line.place.kind === "join" &&
              line.place.groupId === place.groupId,
          )
        : ctx.placed.some(
            (line) =>
              line.courseId === courseId &&
              line.place.kind === "new" &&
              line.place.slot === place.slot,
          );
    if (hasCourse) return { place: { ...place } };
  }

  if (!ctx.firstOrder) {
    const laterThanHeld =
      course !== undefined &&
      held.length > 0 &&
      held.every((group) =>
        [...group.courseIds].every((id) => {
          const previous = ctx.courses.find((candidate) => candidate.id === id);
          return previous !== undefined && course.displayOrder > previous.displayOrder;
        }),
      );
    return laterThanHeld
      ? { place: { kind: "new", slot: (newPlaces.at(-1)?.slot ?? 0) + 1 } }
      : { place: { kind: "fire" } };
  }
  const rank = (id: string | null) =>
    ctx.courses.find((candidate) => candidate.id === id)?.displayOrder ?? Number.MAX_SAFE_INTEGER;
  const before = newPlaces.find((place) => {
    const first = ctx.placed.find(
      (line) => line.place.kind === "new" && line.place.slot === place.slot,
    )!;
    return rank(first.courseId) > rank(courseId);
  });
  return before === undefined
    ? { place: { kind: "new", slot: (newPlaces.at(-1)?.slot ?? 0) + 1 } }
    : { place: { kind: "new", slot: before.slot }, shift: { from: before.slot } };
}

export function heldViews(
  current: CurrentOrders | null,
  groups: readonly OrderGroup[],
): HeldGroupView[] {
  return groups
    .filter((group) => group.state === "held")
    .sort((a, b) => a.position - b.position)
    .map((group) => ({
      id: group.id,
      position: group.position,
      courseIds: new Set(
        (current?.groups.find((entry) => entry.id === group.id)?.rows ?? []).flatMap((row) =>
          row.courseId === null ? [] : [row.courseId],
        ),
      ),
    }));
}
