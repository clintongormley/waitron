/**
 * Pure floor-plan geometry + the shared table-token data model, used by `<wt-floor-canvas>` and (from
 * FP-2 Task 6) the till's live-floor card. No Lit, no DOM — just the constants and the placement maths,
 * so it stays fast to test and impossible to drift from the visual layer.
 */

/**
 * The one canvas aspect ratio (width : height = 3 : 2). A SINGLE shared constant: the map's fixed shape
 * lives here, never scattered as a `1.5` (or `3/2`) magic number across the CSS and the tests.
 */
export const FLOOR_ASPECT = 3 / 2;

/** The floor grid resolution in permille: edit-mode drags snap a coordinate to the nearest 50‰. */
export const GRID_STEP = 50;

/** The rotate handle's increment in degrees: a placed table rotates in 15° detents. */
export const ROTATION_STEP = 15;

/**
 * The rendered shape of a placed table. Defined LOCALLY rather than imported from `@waitron/db`'s
 * `floorTableShape` enum on purpose: `@waitron/ui` ships to the browser, and importing `@waitron/db`
 * would drag its Drizzle/Node surface into the bundle (the same decoupling `apps/till`'s api client
 * keeps against `@waitron/catalogue`). These three members MUST stay in step with
 * `floorTableShape = pgEnum("floor_table_shape", ["round", "square", "rect"])`
 * (`packages/db/src/schema/dining-tables.ts`); a server round-trip re-validates against the real enum.
 */
export type TableShape = "round" | "square" | "rect";

/**
 * A placed table's live occupancy state (FP-1 read-model, `GET /api/tables/state`): `free`, an
 * `open-tab` carrying a running total, or `delivery-pending`. Drives the token's state accent colour.
 */
export type TableOccupancyState = "free" | "open-tab" | "delivery-pending";

/** A table's manual service status badge (FP-1): a label plus an arbitrary DATA colour, or absent. */
export interface TableServiceStatus {
  id: string;
  label: string;
  color: string;
}

/**
 * One table as the floor canvas needs it: its spatial placement (`posX`/`posY` in 0..1000 permille,
 * `shape`, `rotation` degrees, `zoneId`) plus the FP-1 occupancy read-model fields the shared token
 * renders (`state`, `tabTotal`, `pendingToServe`, `status`). Placement fields are nullable because a
 * table need not be placed yet; the canvas falls back to sensible defaults.
 */
export interface FloorTable {
  id: string;
  label: string;
  capacity?: number | null;
  posX: number;
  posY: number;
  shape?: TableShape | null;
  rotation?: number | null;
  zoneId?: string | null;
  state: TableOccupancyState;
  tabTotal?: string | null;
  pendingToServe: number;
  status?: TableServiceStatus | null;
}

/** A table's spatial placement — the mutable subset an edit-mode gesture produces. */
export interface Placement {
  posX: number;
  posY: number;
  shape: TableShape;
  rotation: number;
  zoneId: string | null;
}

/** The `placement-change` event detail: a {@link Placement} tagged with the table it belongs to. */
export interface PlacementChange extends Placement {
  tableId: string;
}

/** The `placement-clear` event detail: the table whose placement is being removed. */
export interface PlacementClear {
  tableId: string;
}

/**
 * The token's t-shirt size bucket from a table's cover count: `≤2 → S`, `3–4 → M`, `5–6 → L`,
 * `≥7 → XL`. A missing capacity (`null`/`undefined`) is treated as a medium table — the safe middle,
 * never the largest or smallest.
 */
export function sizeForCapacity(capacity?: number | null): "S" | "M" | "L" | "XL" {
  if (capacity == null) return "M";
  if (capacity <= 2) return "S";
  if (capacity <= 4) return "M";
  if (capacity <= 6) return "L";
  return "XL";
}

/** Rounds a permille coordinate to the nearest grid `step` (default {@link GRID_STEP}). */
export function snapToGrid(value: number, step: number = GRID_STEP): number {
  return Math.round(value / step) * step;
}

/** Snaps a rotation to the nearest {@link ROTATION_STEP} detent, wrapped into `[0, 360)`. */
export function snapRotation(deg: number): number {
  return (Math.round(deg / ROTATION_STEP) * ROTATION_STEP) % 360;
}

/** Pins a permille coordinate into the canvas's `0..1000` range. */
export function clampPermille(value: number): number {
  return Math.min(1000, Math.max(0, value));
}
