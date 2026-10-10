export const GRID_SQUARE_PX = 12;
export const NEW_TABLE_SIZE = 8;
export const NAME_MIN_PX = 28;

const GRID_MAX = 999;
const ROTATION_STEP = 15;
const CROP_MARGIN = 2;
const EXTENT_MARGIN = 8;
const FREE_SPOT_COLUMNS = 40;
const OVERLAP_EPSILON = 1e-9;

export type PlanShape = "rect" | "round";

/** A table's place on a floor plan, in whole grid squares. */
export interface PlanPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: PlanShape;
  rotation: number;
}

/** An axis-aligned box in grid squares; may be fractional and, for a crop, negative. */
export interface PlanRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function snapToSquare(px: number, squarePx: number = GRID_SQUARE_PX): number {
  return Math.round(px / squarePx);
}

export function clampToGrid(value: number): number {
  return Math.min(GRID_MAX, Math.max(0, Math.round(value)));
}

export function rotationFromAngle(degrees: number): number {
  const stepped = Math.round(degrees / ROTATION_STEP) * ROTATION_STEP;
  return ((stepped % 360) + 360) % 360;
}

export function rotatedRect(p: PlanPlacement): PlanRect {
  const turn = ((p.rotation % 360) + 360) % 360;
  let width: number;
  let height: number;
  if (turn === 0 || turn === 180) {
    ({ width, height } = p);
  } else if (turn === 90 || turn === 270) {
    width = p.height;
    height = p.width;
  } else {
    // Right angles are handled above because Math.cos(Math.PI / 2) is not exactly 0.
    const radians = (turn * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    width = p.width * cos + p.height * sin;
    height = p.width * sin + p.height * cos;
  }
  const centreX = p.x + p.width / 2;
  const centreY = p.y + p.height / 2;
  return { x: centreX - width / 2, y: centreY - height / 2, width, height };
}

export function bounds(placements: readonly PlanPlacement[]): PlanRect | null {
  if (placements.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const placement of placements) {
    const box = rotatedRect(placement);
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function cropToTables(
  placements: readonly PlanPlacement[],
  margin: number = CROP_MARGIN,
): PlanRect | null {
  const box = bounds(placements);
  if (box === null) return null;
  return {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + 2 * margin,
    height: box.height + 2 * margin,
  };
}

/** Pixels per grid square that fit the whole crop into the viewport. */
export function fitScale(crop: PlanRect, viewport: { width: number; height: number }): number {
  return Math.min(viewport.width / crop.width, viewport.height / crop.height);
}

export function gridExtent(
  placements: readonly PlanPlacement[],
  visible: { columns: number; rows: number },
  margin: number = EXTENT_MARGIN,
): { columns: number; rows: number } {
  const box = bounds(placements);
  if (box === null) return { columns: visible.columns, rows: visible.rows };
  return {
    columns: Math.max(visible.columns, Math.ceil(box.x + box.width) + margin),
    rows: Math.max(visible.rows, Math.ceil(box.y + box.height) + margin),
  };
}

function overlaps(a: PlanRect, b: PlanRect): boolean {
  return (
    a.x < b.x + b.width - OVERLAP_EPSILON &&
    b.x < a.x + a.width - OVERLAP_EPSILON &&
    a.y < b.y + b.height - OVERLAP_EPSILON &&
    b.y < a.y + a.height - OVERLAP_EPSILON
  );
}

export function firstFreeSpot(
  placed: readonly PlanPlacement[],
  size: { width: number; height: number } = { width: NEW_TABLE_SIZE, height: NEW_TABLE_SIZE },
  columns: number = FREE_SPOT_COLUMNS,
): { x: number; y: number } {
  const boxes = placed.map(rotatedRect);
  const box = bounds(placed);
  const lastX = Math.max(0, Math.max(columns, Math.ceil(box ? box.x + box.width : 0)) - size.width);
  // Terminates: a row below every table's box is free at x = 0.
  for (let y = 0; ; y++) {
    for (let x = 0; x <= lastX; x++) {
      const grown = { x: x - 1, y: y - 1, width: size.width + 2, height: size.height + 2 };
      if (!boxes.some((b) => overlaps(grown, b))) return { x, y };
    }
  }
}

export function showsName(p: Pick<PlanPlacement, "width" | "height">, squarePx: number): boolean {
  return Math.min(p.width, p.height) * squarePx >= NAME_MIN_PX;
}

/**
 * `count` labels numbered on from the highest existing "<prefix> <digits>". Labels compare by exact
 * characters, as the server compares table names.
 */
export function automaticNames(
  prefix: string,
  existing: Iterable<string>,
  count: number,
): string[] {
  const trimmed = prefix.trim();
  const lead = trimmed === "" ? "" : `${trimmed} `;
  let highest = 0;
  for (const label of existing) {
    if (!label.startsWith(lead)) continue;
    const rest = label.slice(lead.length);
    if (/^\d+$/.test(rest)) highest = Math.max(highest, Number(rest));
  }
  return Array.from({ length: count }, (_, i) => `${lead}${highest + i + 1}`);
}
