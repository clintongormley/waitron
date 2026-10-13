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
