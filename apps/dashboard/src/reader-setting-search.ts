import type { DashboardSettingSearchDestination } from "@waitron/dashboard-kit";
import { encodePathSegment } from "@waitron/ui";
import type { DashboardApi } from "./api/client.js";
import { readerSettingFields } from "./screens/payments-screen.js";
export function readerSettingSearchDestinations(
  api: DashboardApi,
): readonly DashboardSettingSearchDestination[] {
  return readerSettingFields.map((field) => ({
    kind: "setting",
    id: `dashboard:reader:${field.name}`,
    screen: "payments",
    labelKey: field.labelKey,
    locationKey: "action.edit",
    requiresPermission: "hardware.manage",
    async resolve() {
      return (await api.background.listReaders()).map((row) => ({
        id: row.id,
        label: row.name,
        path: `/payments/reader/${encodePathSegment(row.id)}`,
      }));
    },
  }));
}
