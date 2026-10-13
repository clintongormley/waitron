import { NEW_TABLE_SIZE } from "@waitron/shared";
import type { Placement } from "./floor-reset-plan.js";

export interface LaidPart {
  tableId: string;
  width: number;
  height: number;
}

const held = (value: number): number => Math.min(Math.max(Math.round(value), 0), 999);

/** Every placed table's width check allows 1–99 (`placementChecks`, `packages/db/src/schema/floor-plans.ts`). */
const MAX_WIDTH = 99;

const slotStart = (parts: readonly LaidPart[], index: number): number =>
  parts.slice(0, index).reduce((sum, part) => sum + part.width, 0);

interface Frame {
  originX: number;
  originY: number;
  cos: number;
  sin: number;
}

/** The point the slots are measured from: the row's left end, less the slots of the parts already split off. */
function frameOf(row: Placement, parts: readonly LaidPart[], covered: number): Frame {
  const turn = (row.rotation * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const leftX = row.x + row.width / 2 - (row.width / 2) * cos;
  const leftY = row.y + row.height / 2 - (row.width / 2) * sin;
  const back = slotStart(parts, covered);
  return { originX: leftX - back * cos, originY: leftY - back * sin, cos, sin };
}

function slotPlace(
  frame: Frame,
  row: Placement,
  start: number,
  width: number,
  height: number,
): Placement {
  const along = start + width / 2;
  const centreX = frame.originX + along * frame.cos;
  const centreY = frame.originY + along * frame.sin;
  return {
    x: held(centreX - width / 2),
    y: held(centreY - height / 2),
    width,
    height,
    shape: row.shape,
    rotation: row.rotation,
  };
}

/** Each part's place over the whole joined table; `covered` is the index of the part whose slot starts at `row`'s left edge. */
export function partPlaces(
  row: Placement,
  parts: readonly LaidPart[],
  covered: number,
): Placement[] {
  const frame = frameOf(row, parts, covered);
  return parts.map((part, index) =>
    slotPlace(frame, row, slotStart(parts, index), part.width, part.height),
  );
}

/** Where the joined table that remains stands: over the slots of parts[from..to], at the row's own depth. */
export function remainingPlace(
  row: Placement,
  parts: readonly LaidPart[],
  covered: number,
  from: number,
  to: number,
): Placement {
  const frame = frameOf(row, parts, covered);
  const start = slotStart(parts, from);
  const last = parts[to]!;
  const width = Math.min(slotStart(parts, to) + last.width - start, MAX_WIDTH);
  return slotPlace(frame, row, start, width, row.height);
}

/** The joined table whole again: its left end kept, at `size`, with the row's shape and turn. */
export function wholePlace(
  row: Placement,
  parts: readonly LaidPart[],
  covered: number,
  size: { width: number; height: number },
): Placement {
  return slotPlace(frameOf(row, parts, covered), row, 0, size.width, size.height);
}

/** The joined table over the tables `staying` (indexes into `parts`), from where the first of them stands now; whole: at `size`. */
export function joinedPlaceOver(
  anchor: Placement,
  parts: readonly LaidPart[],
  staying: readonly number[],
  whole: boolean,
  size: { width: number; height: number },
): Placement {
  const first = staying[0]!;
  return whole
    ? wholePlace(anchor, parts, first, size)
    : remainingPlace(anchor, parts, first, first, staying.at(-1)!);
}

/** Where a joined table stands after Join again. */
export function joinedPlaceAfter(args: {
  row: Placement | null;
  standing: boolean;
  saved: Placement | null;
  parts: readonly LaidPart[];
  covered: number;
  staying: readonly number[];
  whole: boolean;
}): Placement | null {
  const { row, standing, saved, parts, covered, staying, whole } = args;
  const from = standing && row !== null && covered >= 0 ? row : null;
  if (whole) {
    if (from === null) return saved;
    const size = saved ?? { width: NEW_TABLE_SIZE, height: NEW_TABLE_SIZE };
    return wholePlace(from, parts, covered, { width: size.width, height: size.height });
  }
  const origin =
    from !== null
      ? { at: from, covered }
      : saved !== null
        ? { at: saved, covered: 0 }
        : row !== null
          ? { at: row, covered: 0 }
          : null;
  if (origin === null) return null;
  return remainingPlace(origin.at, parts, origin.covered, staying[0]!, staying.at(-1)!);
}

type Point = [number, number];

/** The box's corners, turned about its centre. */
function cornersOf(place: Placement): { corners: Point[]; axes: Point[] } {
  const turn = (place.rotation * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const centreX = place.x + place.width / 2;
  const centreY = place.y + place.height / 2;
  const corners = (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([sx, sy]): Point => {
    const dx = (sx * place.width) / 2;
    const dy = (sy * place.height) / 2;
    return [centreX + dx * cos - dy * sin, centreY + dx * sin + dy * cos];
  });
  return {
    corners,
    axes: [
      [cos, sin],
      [-sin, cos],
    ],
  };
}

/** Rounding slack, so a corner that reaches exactly one square in counts. */
const SLACK = 1e-9;

/** Whether the two turned boxes overlap by at least one square along each of their four sides' directions. */
export function standsIn(place: Placement, other: Placement): boolean {
  const a = cornersOf(place);
  const b = cornersOf(other);
  return [...a.axes, ...b.axes].every(([ax, ay]) => {
    const along = (corners: Point[]) => corners.map(([x, y]) => x * ax + y * ay);
    const onA = along(a.corners);
    const onB = along(b.corners);
    const overlap =
      Math.min(Math.max(...onA), Math.max(...onB)) - Math.max(Math.min(...onA), Math.min(...onB));
    return overlap >= 1 - SLACK;
  });
}
