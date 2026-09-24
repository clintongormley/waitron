import type { TimingBand } from "@waitron/shared";

export const FLOOR_ASPECT = 3 / 2;

/** The floor grid resolution in permille: edit-mode drags snap a coordinate to the nearest 50‰. */
export const GRID_STEP = 50;

/** The rotate handle's increment in degrees: a placed table rotates in 15° detents. */
export const ROTATION_STEP = 15;

/**
 * Must match `floorTableShape` in `packages/db/src/schema/dining-tables.ts`. Declared here because
 * `@waitron/ui` ships to the browser and importing `@waitron/db` would pull its Node code in.
 */
export type TableShape = "round" | "square" | "rect";

export type TableOccupancyState = "free" | "open-tab" | "delivery-pending";

export interface TableServiceStatus {
  id: string;
  label: string;
  color: string;
}

/** `posX`/`posY` are permille (0..1000) and `rotation` is degrees. */
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
  /** The wall-clock "HH:MM" of the table's next reservation. */
  reservedTime?: string | null;
  timingBand?: TimingBand;
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

export function sizeForCapacity(capacity?: number | null): "S" | "M" | "L" | "XL" {
  if (capacity == null) return "M";
  if (capacity <= 2) return "S";
  if (capacity <= 4) return "M";
  if (capacity <= 6) return "L";
  return "XL";
}

export function snapToGrid(value: number, step: number = GRID_STEP): number {
  return Math.round(value / step) * step;
}

/** The double modulo wraps a negative angle into `[0, 360)` too. */
export function snapRotation(deg: number): number {
  return (((Math.round(deg / ROTATION_STEP) * ROTATION_STEP) % 360) + 360) % 360;
}

export function clampPermille(value: number): number {
  return Math.min(1000, Math.max(0, value));
}

/** Offset one grid step per table already placed, so successive tap-to-place tables don't stack
 *  until the offset reaches the right edge, where the clamp holds every further one at 1000. */
export function defaultTraySlot(placedCount: number): { posX: number; posY: number } {
  return { posX: clampPermille(500 + placedCount * GRID_STEP), posY: 500 };
}

/**
 * Deactivating a zone leaves its tables' `zoneId` set, so a table pointing at an inactive zone also
 * belongs under the "no zone" tab; otherwise it would match no tab and vanish.
 */
export function isTableZoneless(
  table: { zoneId: string | null },
  knownZoneIds: ReadonlySet<string>,
): boolean {
  return table.zoneId === null || !knownZoneIds.has(table.zoneId);
}

/** `key` is `null` for the trailing "no zone" tab. */
export interface ZoneTab {
  key: string | null;
  name: string;
}

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

/** A pick naming a tab that no longer exists falls back to the first tab, or the floor would go blank. */
export function resolveActiveTabKey(
  requested: string | null | undefined,
  tabs: readonly ZoneTab[],
): string | null | undefined {
  if (requested !== undefined && tabs.some((tab) => tab.key === requested)) return requested;
  return tabs[0]?.key;
}

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

export interface FloorOccupancyInput {
  state: TableOccupancyState;
  tabTotal?: string | null;
  pendingToServe: number;
  status?: TableServiceStatus | null;
  reservedTime?: string | null;
  timingBand?: TimingBand;
}

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
    timingBand: occupancy.timingBand,
    state: occupancy.state,
    tabTotal: occupancy.tabTotal ?? null,
    pendingToServe: occupancy.pendingToServe,
    status: occupancy.status,
    reservedTime: occupancy.reservedTime ?? null,
  };
}
