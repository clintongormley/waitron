import type { DeviceZoneSelection } from "@waitron/venue-service";

export function deviceZonesFixture(
  counters: readonly string[] = ["zone-counter"],
  tables: readonly string[] = [],
): DeviceZoneSelection {
  const zones: DeviceZoneSelection["zones"] = [
    ...counters.map((id) => ({
      id,
      name: id,
      departmentId: "department-default",
      departmentName: "Restaurant",
      serviceMode: "prepay" as const,
    })),
    ...tables.map((id) => ({
      id,
      name: id,
      departmentId: "department-default",
      departmentName: "Restaurant",
      serviceMode: "table_tab" as const,
    })),
  ];
  return {
    profileId: "profile",
    snapshot: "scope",
    zones,
    selectedZoneIds: zones.map((zone) => zone.id),
    startingZoneId: zones[0]?.id ?? null,
    adjusted: false,
    saved: false,
  };
}

export function deviceZonesFor(menu: {
  context: {
    zoneId: string;
    departmentId: string;
    departmentName: string;
    serviceMode: "table_tab" | "prepay" | "ticket_then_pay";
  };
  zones?: readonly {
    id: string;
    name: string;
    departmentId: string;
    departmentName: string;
    serviceMode: "table_tab" | "prepay" | "ticket_then_pay";
  }[];
}): DeviceZoneSelection {
  const zones = menu.zones ?? [
    {
      id: menu.context.zoneId,
      name: menu.context.zoneId,
      departmentId: menu.context.departmentId,
      departmentName: menu.context.departmentName,
      serviceMode: menu.context.serviceMode,
    },
  ];
  return {
    profileId: "profile",
    snapshot: "scope",
    zones,
    selectedZoneIds: zones.map((zone) => zone.id),
    startingZoneId: menu.context.zoneId,
    adjusted: false,
    saved: false,
  };
}
