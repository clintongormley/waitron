// Demo floor-plan content for the Casa Delgado seed (Phase 2, Task 7) — spec §4.3. This is DEV/DEMO
// data, plausibility rather than accuracy is the bar, the same posture `menu.ts` states for the
// catalogue content it authors.
//
// Three zones (Comedor/Terraza/Barra) and ~16 tables, spatially placed on a shared 0..1000 canvas so
// the live floor and the FP-2 spatial editor both look real: Comedor (the indoor dining room) fills
// the top-left, Terraza (the outdoor terrace) the top-right, and Barra (the bar) a strip along the
// bottom — the three zones occupy visually distinct regions rather than overlapping. Zone names are
// kept identical in both locales (proper venue-area names, the same choice `menu.ts` makes for the
// catalogue names themselves, e.g. `CASA_DELGADO.name`); table labels are plain, locale-independent
// strings (`dining_tables.label` is a single `text` column, not a per-locale one). Coordinates/shape/
// rotation satisfy `setTablePlacement`'s ranges (`apps/server/src/tables.ts`): `posX`/`posY` 0..1000,
// `shape` one of the `floor_table_shape` enum members, `rotation` 0..359.
//
// The four `table_service_statuses` (Libre/Ocupada/Reservada/Cuenta pedida) are genuinely translated
// per locale — the same per-locale-distinct choice `menu.ts` makes for category/product names —
// matching the English wording `table-service-statuses.ts`'s own doc comment already uses ("Bill
// requested") for its worked example.

import type { SeedLocale } from "./menu.js";
import type { FloorTableShape } from "../../src/tables.js";

/** A floor-plan zone: both-locale name and its editor `displayOrder`. `key` is this module's own
 *  internal handle joining a {@link SeedTable} to the zone it sits in — it has no DB counterpart
 *  (the real `floor_zones.id` is minted at seed time). */
export interface SeedZone {
  key: "dining" | "terrace" | "bar";
  name: Record<SeedLocale, string>;
  displayOrder: number;
}

/** A demo table: a plain label, the zone it sits in (by {@link SeedZone.key}), a capacity, and its
 *  FP-2 spatial placement — everything `createTable` + `setTablePlacement` need. */
export interface SeedTable {
  label: string;
  zoneKey: SeedZone["key"];
  capacity: number;
  posX: number;
  posY: number;
  shape: FloorTableShape;
  rotation: number;
}

/** A demo service status: both-locale label and its floor-plan swatch (a hex or short token, the
 *  same shape `validateStatusColor` in `tables.ts` accepts — unvalidated here since the raw insert
 *  bypasses `createStatus`, but chosen to satisfy that pattern anyway). */
export interface SeedStatus {
  label: Record<SeedLocale, string>;
  color: string;
}

export const DEMO_ZONES: SeedZone[] = [
  { key: "dining", name: { "en-GB": "Comedor", "es-ES": "Comedor" }, displayOrder: 0 },
  { key: "terrace", name: { "en-GB": "Terraza", "es-ES": "Terraza" }, displayOrder: 1 },
  { key: "bar", name: { "en-GB": "Barra", "es-ES": "Barra" }, displayOrder: 2 },
];

export const DEMO_TABLES: SeedTable[] = [
  // ── Comedor (indoor dining room) — 8 tables, top-left of the canvas ─────────────────────────────
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
  // ── Terraza (outdoor terrace) — 5 tables, top-right of the canvas ───────────────────────────────
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
  // ── Barra (bar) — 3 high tables, a strip along the bottom of the canvas ─────────────────────────
  { label: "B1", zoneKey: "bar", capacity: 2, posX: 150, posY: 750, shape: "rect", rotation: 0 },
  { label: "B2", zoneKey: "bar", capacity: 2, posX: 450, posY: 750, shape: "rect", rotation: 0 },
  { label: "B3", zoneKey: "bar", capacity: 2, posX: 750, posY: 750, shape: "rect", rotation: 0 },
];

export const DEMO_STATUSES: SeedStatus[] = [
  { label: { "en-GB": "Free", "es-ES": "Libre" }, color: "#22c55e" },
  { label: { "en-GB": "Occupied", "es-ES": "Ocupada" }, color: "#ef4444" },
  { label: { "en-GB": "Reserved", "es-ES": "Reservada" }, color: "#f59e0b" },
  { label: { "en-GB": "Bill requested", "es-ES": "Cuenta pedida" }, color: "#3b82f6" },
];
