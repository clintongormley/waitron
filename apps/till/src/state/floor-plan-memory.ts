import { rotatedRect, type PlanRect } from "@waitron/ui";
import type { TableState } from "../api/floor-api.js";
import { onTodaysPlan } from "./floor-today.js";
import type { FloorViewIdentity } from "./floor-view-memory.js";

type ZoneName = { id: string; name: string };

function key(kind: "floor-plan" | "floor-zone", { origin, deviceId }: FloorViewIdentity): string {
  return `waitron.${kind}.${JSON.stringify([origin, deviceId])}`;
}

export function rememberFloorZone(identity: FloorViewIdentity, { id, name }: ZoneName): void {
  save(key("floor-zone", identity), { id, name });
}

export function rememberedFloorZone(identity: FloorViewIdentity): ZoneName[] {
  try {
    const zone = JSON.parse(localStorage.getItem(key("floor-zone", identity)) ?? "null");
    return typeof zone?.id === "string" && typeof zone?.name === "string" ? [zone] : [];
  } catch {
    return [];
  }
}

function save(name: string, value: unknown): void {
  try {
    const json = JSON.stringify(value);
    if (localStorage.getItem(name) !== json) localStorage.setItem(name, json);
  } catch {
    // A device that cannot store its layout can still read the live floor.
  }
}

export function rememberFloorPlan(
  identity: FloorViewIdentity,
  tables: readonly TableState[],
): void {
  const shapes = tables.filter(onTodaysPlan).map(({ zoneId, today }) => {
    const { x, y, width, height } = rotatedRect(today!.placement!);
    return [zoneId, x, y, width, height];
  });
  save(key("floor-plan", identity), shapes);
}

export function rememberedFloorPlan(identity: FloorViewIdentity): ReadonlyMap<string, PlanRect[]> {
  const zones = new Map<string, PlanRect[]>();
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(key("floor-plan", identity)) ?? "null");
    if (!Array.isArray(rows)) return zones;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 5) continue;
      const [zone, x, y, width, height] = row;
      if (
        typeof zone !== "string" ||
        ![x, y, width, height].every(Number.isFinite) ||
        width <= 0 ||
        height <= 0
      )
        continue;
      const shapes = zones.get(zone) ?? [];
      if (!zones.has(zone)) zones.set(zone, shapes);
      shapes.push({ x, y, width, height });
    }
  } catch {
    // Draw the neutral placeholder if the device cannot read its last layout.
  }
  return zones;
}
