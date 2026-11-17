import type { DashboardSettingSearchDestination } from "@waitron/dashboard-kit";
import { encodePathSegment } from "@waitron/ui";
import type { DashboardApi } from "./api/client.js";
import { deviceSettingFields, deviceSettingIsOffered } from "./screens/devices-screen.js";
export function deviceSettingSearchDestinations(
  api: DashboardApi,
): readonly DashboardSettingSearchDestination[] {
  return deviceSettingFields.map((field) => ({
    kind: "setting",
    id: `dashboard:device:${field.name}`,
    screen: "devices",
    labelKey: field.labelKey,
    locationKey: "action.edit",
    requiresPermission: "hardware.manage",
    async resolve() {
      const [devices, deviceProfiles] = await Promise.all([
        api.background.listDevices(),
        api.background.listDeviceProfiles(),
      ]);
      return devices
        .filter((row) =>
          deviceSettingIsOffered(field.name, row, {
            deviceProfiles,
          }),
        )
        .map((row) => ({
          id: row.id,
          label: row.label,
          path: `/devices/device/${encodePathSegment(row.id)}`,
        }));
    },
  }));
}
