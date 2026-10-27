// Demo floor-plan content for the Casa Delgado seed: plausibility rather than accuracy is the bar.

import type { SeedLocale } from "./locale.js";
import type { Placement } from "../../src/floor-reset-plan.js";

/** `key` joins a {@link SeedTable} to its zone; it has no DB counterpart (the real
 *  `floor_zones.id` is minted at seed time). */
export interface SeedZone {
  key: "dining" | "terrace" | "bar";
  name: Record<SeedLocale, string>;
  displayOrder: number;
}

export interface SeedTable {
  label: string;
  zoneKey: SeedZone["key"];
  capacity: number;
  posX: number;
  posY: number;
  shape: "round" | "square" | "rect";
  rotation: number;
  /** The place in the default set's layout, on a 120 × 80 grid. */
  placement: Placement;
  fixed: boolean;
}

export type SeedRawTable = Omit<SeedTable, "placement" | "fixed">;

const GRID_WIDTH = 120;
const GRID_HEIGHT = 80;

function sizeFor(capacity: number): { width: number; height: number } {
  if (capacity <= 2) return { width: 6, height: 6 };
  if (capacity <= 4) return { width: 8, height: 8 };
  if (capacity <= 6) return { width: 10, height: 8 };
  return { width: 14, height: 8 };
}

/** `posX`/`posY` is the table's centre in thousandths of the canvas; a placement's `x`/`y` is its
 *  top-left corner. The bar seats are stools fixed to the floor. */
export function onGrid(table: SeedRawTable): SeedTable {
  const fixed = table.zoneKey === "bar";
  const { width, height } = fixed ? { width: 2, height: 2 } : sizeFor(table.capacity);
  const corner = (permille: number, span: number, size: number): number =>
    Math.max(0, Math.round((permille / 1000) * span - size / 2));
  return {
    ...table,
    fixed,
    placement: {
      x: corner(table.posX, GRID_WIDTH, width),
      y: corner(table.posY, GRID_HEIGHT, height),
      width,
      height,
      shape: fixed || table.shape === "round" ? "round" : "rect",
      rotation: fixed ? 0 : table.rotation,
    },
  };
}
