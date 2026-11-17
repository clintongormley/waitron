import type { DashboardSettingSearchDestination } from "@waitron/dashboard-kit";
import { encodePathSegment } from "@waitron/ui";
import { VenueServiceApi } from "./client.js";
import { zoneIsEditable, zoneSettingFields } from "./zone-edit-dialog.js";

export const zoneSettingSearchDestinations: readonly DashboardSettingSearchDestination[] =
  zoneSettingFields.map((field) => ({
    kind: "setting",
    id: `venue-service:zone:${field.name}`,
    screen: "venue-operations",
    labelKey: field.labelKey,
    locationKey: "venue.edit_zone",
    async resolve(ctx) {
      const model = await new VenueServiceApi(ctx.request, ctx.liveData).background.load();
      return model.zones
        .filter((zone) => zoneIsEditable(model, zone))
        .map((zone) => ({
          id: zone.id,
          label: `${model.departments.find((department) => department.id === zone.departmentId)!.name} / ${zone.name}`,
          path: `/venue-operations/department/${encodePathSegment(zone.departmentId)}/view/zones/zone/${encodePathSegment(zone.id)}`,
        }));
    },
  }));
