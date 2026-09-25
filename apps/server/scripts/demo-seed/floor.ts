// Demo floor-plan content for the Casa Delgado seed: plausibility rather than accuracy is the bar.
// Placements must satisfy `setTablePlacement`'s ranges (`apps/server/src/tables.ts`).

import type { SeedLocale } from "./menu.js";
import type { FloorTableShape } from "../../src/tables.js";

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
  shape: FloorTableShape;
  rotation: number;
}

/** `color` is not validated here, because the raw insert bypasses `createStatus`; keep it to what
 *  `validateStatusColor` in `tables.ts` accepts. */
export interface SeedStatus {
  label: Record<SeedLocale, string>;
  color: string;
}

export const DEMO_ZONES: SeedZone[] = [
  { key: "dining", name: { en: "Dining room", es: "Comedor" }, displayOrder: 0 },
  { key: "terrace", name: { en: "Terrace", es: "Terraza" }, displayOrder: 1 },
  { key: "bar", name: { en: "Downstairs bar", es: "Bar de abajo" }, displayOrder: 2 },
];

export const DEMO_TABLES: SeedTable[] = [
  {
    label: "1",
    zoneKey: "dining",
    capacity: 2,
    posX: 120,
    posY: 100,
    shape: "round",
    rotation: 0,
  },
  {
    label: "2",
    zoneKey: "dining",
    capacity: 2,
    posX: 280,
    posY: 100,
    shape: "round",
    rotation: 0,
  },
  {
    label: "3",
    zoneKey: "dining",
    capacity: 4,
    posX: 120,
    posY: 220,
    shape: "square",
    rotation: 0,
  },
  {
    label: "4",
    zoneKey: "dining",
    capacity: 4,
    posX: 280,
    posY: 220,
    shape: "square",
    rotation: 0,
  },
  {
    label: "5",
    zoneKey: "dining",
    capacity: 4,
    posX: 120,
    posY: 340,
    shape: "square",
    rotation: 45,
  },
  {
    label: "6",
    zoneKey: "dining",
    capacity: 4,
    posX: 280,
    posY: 340,
    shape: "square",
    rotation: 0,
  },
  {
    label: "7",
    zoneKey: "dining",
    capacity: 6,
    posX: 120,
    posY: 460,
    shape: "rect",
    rotation: 90,
  },
  {
    label: "8",
    zoneKey: "dining",
    capacity: 8,
    posX: 280,
    posY: 460,
    shape: "rect",
    rotation: 90,
  },
  {
    label: "T1",
    zoneKey: "terrace",
    capacity: 2,
    posX: 650,
    posY: 120,
    shape: "round",
    rotation: 0,
  },
  {
    label: "T2",
    zoneKey: "terrace",
    capacity: 2,
    posX: 800,
    posY: 120,
    shape: "round",
    rotation: 0,
  },
  {
    label: "T3",
    zoneKey: "terrace",
    capacity: 4,
    posX: 650,
    posY: 280,
    shape: "square",
    rotation: 0,
  },
  {
    label: "T4",
    zoneKey: "terrace",
    capacity: 4,
    posX: 800,
    posY: 280,
    shape: "square",
    rotation: 0,
  },
  {
    label: "T5",
    zoneKey: "terrace",
    capacity: 6,
    posX: 725,
    posY: 440,
    shape: "rect",
    rotation: 90,
  },
  { label: "B1", zoneKey: "bar", capacity: 2, posX: 150, posY: 750, shape: "rect", rotation: 0 },
  { label: "B2", zoneKey: "bar", capacity: 2, posX: 450, posY: 750, shape: "rect", rotation: 0 },
  { label: "B3", zoneKey: "bar", capacity: 2, posX: 750, posY: 750, shape: "rect", rotation: 0 },
];

export const DEMO_STATUSES: SeedStatus[] = [
  { label: { en: "Free", es: "Libre" }, color: "#22c55e" },
  { label: { en: "Occupied", es: "Ocupada" }, color: "#ef4444" },
  { label: { en: "Reserved", es: "Reservada" }, color: "#f59e0b" },
  { label: { en: "Bill requested", es: "Cuenta pedida" }, color: "#3b82f6" },
];
