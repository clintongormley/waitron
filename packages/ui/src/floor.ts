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

/** The `wt-placement-change` event detail: a {@link Placement} tagged with the table it belongs to. */
export interface PlacementChange extends Placement {
  tableId: string;
}

/** The `wt-placement-clear` event detail: the table whose placement is being removed. */
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

/** Snaps a rotation to the nearest {@link ROTATION_STEP} detent, wrapped into `[0, 360)`. The double
 *  modulo normalizes a NEGATIVE input too — a bare `% 360` leaves `-8` at `-15`, breaking the contract —
 *  so any degree, positive or negative, resolves into `[0, 360)`. */
export function snapRotation(deg: number): number {
  return (((Math.round(deg / ROTATION_STEP) * ROTATION_STEP) % 360) + 360) % 360;
}

/** Pins a permille coordinate into the canvas's `0..1000` range. */
export function clampPermille(value: number): number {
  return Math.min(1000, Math.max(0, value));
}

/**
 * The tap-to-place slot for an unplaced tray table: the canvas centre (`500,500`) nudged right by one
 * {@link GRID_STEP} per already-placed table so successive placements don't stack exactly, clamped into
 * range. Shared by the till's and dashboard's `#placeFromTray`, which supply the count of tables already
 * placed in the active zone.
 */
export function defaultTraySlot(placedCount: number): { posX: number; posY: number } {
  return { posX: clampPermille(500 + placedCount * GRID_STEP), posY: 500 };
}

/**
 * Whether a table belongs under the "no zone" tab: it has NO zone (`zoneId === null`), OR its zone is
 * not among the currently-active ones. The second case matters because a soft `deactivateZone` never
 * nulls a table's `zoneId`, so a table can point at a zone missing from the active set; without catching
 * it here that table would match no tab and vanish. Duck-typed on `{ zoneId }` so no app type is needed.
 */
export function isTableZoneless(
  table: { zoneId: string | null },
  knownZoneIds: ReadonlySet<string>,
): boolean {
  return table.zoneId === null || !knownZoneIds.has(table.zoneId);
}

/** One zone tab: a zone id (or `null` for the trailing "no zone" tab) and the label to show for it. */
export interface ZoneTab {
  key: string | null;
  name: string;
}

/**
 * The zone tabs for a floor view: the active zones sorted by `displayOrder` (mapped to `{ key, name }`),
 * plus a trailing "no zone" tab — key `null`, carrying `noZoneLabel` — iff some table is zoneless or
 * points at a deactivated zone (see {@link isTableZoneless}). Duck-typed on the minimal zone/table
 * shapes, so no app API type is needed. The screen owns the (localised, Spanish) `noZoneLabel`.
 */
export function buildZoneTabs(
  zones: readonly { id: string; name: string; displayOrder: number }[],
  tables: readonly { zoneId: string | null }[],
  noZoneLabel: string,
): ZoneTab[] {
  const knownZoneIds = new Set(zones.map((z) => z.id));
  const zoneTabs: ZoneTab[] = [...zones]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((z) => ({ key: z.id as string | null, name: z.name }));
  const hasZoneless = tables.some((table) => isTableZoneless(table, knownZoneIds));
  return hasZoneless ? [...zoneTabs, { key: null, name: noZoneLabel }] : zoneTabs;
}

/**
 * The active tab's key: an explicit `requested` pick wins WHEN it still names a tab in `tabs` (a zone
 * id, or `null` for the no-zone tab); `undefined` (nothing picked yet) — and a stale `requested` naming
 * a tab no longer present (its zone was deactivated/removed, or the no-zone tab is gone) — both fall
 * back to the FIRST tab's key, or `undefined` when there are no tabs at all. Without the staleness
 * check a dropped selection would filter every table against a dead key, blanking the floor. Kept
 * distinct from a zone id so the default tracks the current tab order.
 */
export function resolveActiveTabKey(
  requested: string | null | undefined,
  tabs: readonly ZoneTab[],
): string | null | undefined {
  if (requested !== undefined && tabs.some((tab) => tab.key === requested)) return requested;
  return tabs[0]?.key;
}

/** A table's spatial placement as either screen holds it — the input half of {@link toFloorTable}. */
export interface FloorPlacementInput {
  id: string;
  label: string;
  capacity?: number | null;
  posX: number | null;
  posY: number | null;
  shape?: TableShape | null;
  rotation?: number | null;
  zoneId?: string | null;
}

/** A table's occupancy read-model fields — the other input half of {@link toFloorTable}. */
export interface FloorOccupancyInput {
  state: TableOccupancyState;
  tabTotal?: string | null;
  pendingToServe: number;
  status?: TableServiceStatus | null;
}

/**
 * Map a table's placement + occupancy to the shared canvas/token {@link FloorTable} shape. The placement
 * half is identical on both screens (null coordinates default to 0, which the token ignores for an
 * unplaced tray table); the occupancy half is supplied separately — the till passes its live read-model,
 * the dashboard the neutral `free`/`null`/`0`/`null` (it has no occupancy). Shared by both `#toFloorTable`.
 */
export function toFloorTable(
  placement: FloorPlacementInput,
  occupancy: FloorOccupancyInput,
): FloorTable {
  return {
    id: placement.id,
    label: placement.label,
    capacity: placement.capacity,
    posX: placement.posX ?? 0,
    posY: placement.posY ?? 0,
    shape: placement.shape,
    rotation: placement.rotation,
    zoneId: placement.zoneId,
    state: occupancy.state,
    tabTotal: occupancy.tabTotal ?? null,
    pendingToServe: occupancy.pendingToServe,
    status: occupancy.status,
  };
}
