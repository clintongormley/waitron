import type { TimingBand } from "@waitron/shared";

/** The rotate handle's increment in degrees: a placed table rotates in 15° detents. */
export const ROTATION_STEP = 15;

export type TableOccupancyState = "free" | "open-tab" | "delivery-pending";

export interface TableServiceStatus {
  id: string;
  label: string;
  color: string;
}

/** Which token a chip's colour reads: a border in that colour, or `primary-filled` for a chip painted
 * in the primary colour itself. */
export type FloorChipTone = "success" | "primary" | "warning" | "danger" | "primary-filled";

/** A chip the consumer has already worded; `key` names it for the consumer's own tests. */
export interface FloorChip {
  key: string;
  text: string;
  tone: FloorChipTone;
}

export interface FloorTable {
  id: string;
  label: string;
  seats?: number | null;
  state: TableOccupancyState;
  tabTotal?: string | null;
  pendingToServe: number;
  status?: TableServiceStatus | null;
  /** The wall-clock "HH:MM" of the table's next reservation. */
  reservedTime?: string | null;
  timingBand?: TimingBand;
  /** Who has an order on this table not yet sent, one name per order; "" for an unknown person. */
  unsentDrafts?: readonly string[];
  /** The name of the party seated there, shown under the table's label. */
  partyName?: string;
  /** The seated party's release reminder has fallen due. */
  fireDue?: boolean;
  /** What wants attention at the table, several at once. */
  chips?: readonly FloorChip[];
}

/** The double modulo wraps a negative angle into `[0, 360)` too. */
export function snapRotation(deg: number): number {
  return (((Math.round(deg / ROTATION_STEP) * ROTATION_STEP) % 360) + 360) % 360;
}

export interface ZoneTab {
  key: string;
  name: string;
}

export function buildZoneTabs(
  zones: readonly { id: string; name: string; displayOrder: number }[],
): ZoneTab[] {
  return [...zones]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((zone) => ({ key: zone.id, name: zone.name }));
}

/** A pick naming a tab that no longer exists falls back to the first tab, or the floor would go blank. */
export function resolveActiveTabKey(
  requested: string | undefined,
  tabs: readonly ZoneTab[],
): string | undefined {
  if (tabs.some((tab) => tab.key === requested)) return requested;
  return tabs[0]?.key;
}

export interface FloorPlacementInput {
  id: string;
  label: string;
  seats?: number | null;
}

export interface FloorOccupancyInput {
  state: TableOccupancyState;
  tabTotal?: string | null;
  pendingToServe: number;
  status?: TableServiceStatus | null;
  reservedTime?: string | null;
  timingBand?: TimingBand;
  unsentDrafts?: readonly string[];
  partyName?: string;
  fireDue?: boolean;
  chips?: readonly FloorChip[];
}

export function toFloorTable(
  placement: FloorPlacementInput,
  occupancy: FloorOccupancyInput,
): FloorTable {
  return {
    id: placement.id,
    label: placement.label,
    seats: placement.seats,
    timingBand: occupancy.timingBand,
    state: occupancy.state,
    tabTotal: occupancy.tabTotal ?? null,
    pendingToServe: occupancy.pendingToServe,
    status: occupancy.status,
    reservedTime: occupancy.reservedTime ?? null,
    unsentDrafts: occupancy.unsentDrafts,
    partyName: occupancy.partyName,
    fireDue: occupancy.fireDue,
    chips: occupancy.chips,
  };
}
