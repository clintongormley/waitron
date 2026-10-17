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
  };
}

export function deviceZonesFor(catalogue: {
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
  const zones = catalogue.zones ?? [
    {
      id: catalogue.context.zoneId,
      name: catalogue.context.zoneId,
      departmentId: catalogue.context.departmentId,
      departmentName: catalogue.context.departmentName,
      serviceMode: catalogue.context.serviceMode,
    },
  ];
  return {
    profileId: "profile",
    snapshot: "scope",
    zones,
    selectedZoneIds: zones.map((zone) => zone.id),
    startingZoneId: catalogue.context.zoneId,
    adjusted: false,
  };
}
