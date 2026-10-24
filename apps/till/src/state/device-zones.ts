import type { DeviceZoneSelection } from "@waitron/venue-service";
import type { FormFactor } from "../layout.js";

export function deviceZoneNavigation(
  formFactor: FormFactor,
  selection: DeviceZoneSelection,
): {
  counterZoneIds: readonly string[];
  floorZoneIds: readonly string[];
  startingZoneId: string | null;
  home: "counter" | "floor" | null;
} {
  const selected = selection.zones.filter((zone) => selection.selectedZoneIds.includes(zone.id));
  if (formFactor === "phone-portrait" || formFactor === "tablet-landscape") {
    const floorZoneIds = selected.map((zone) => zone.id);
    const start = selection.saved
      ? floorZoneIds.find((id) => id === selection.startingZoneId)
      : undefined;
    return {
      counterZoneIds: [],
      floorZoneIds,
      startingZoneId: start ?? null,
      home: floorZoneIds.length === 0 ? null : "floor",
    };
  }
  const visible = formFactor === "kds" ? [] : selected;
  const counterZoneIds = visible
    .filter((zone) => zone.serviceMode !== "table_tab")
    .map((zone) => zone.id);
  const floorZoneIds = visible
    .filter((zone) => zone.serviceMode === "table_tab")
    .map((zone) => zone.id);
  const startingZoneId =
    visible.find((zone) => zone.id === selection.startingZoneId)?.id ?? visible[0]?.id ?? null;
  return {
    counterZoneIds,
    floorZoneIds,
    startingZoneId,
    home:
      startingZoneId === null ? null : floorZoneIds.includes(startingZoneId) ? "floor" : "counter",
  };
}
