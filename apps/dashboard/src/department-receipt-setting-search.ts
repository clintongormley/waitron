import type { DashboardSettingSearchDestination } from "@waitron/dashboard-kit";
import { encodePathSegment } from "@waitron/ui";
import type { DashboardApi } from "./api/client.js";
import { departmentReceiptSettingFields } from "./screens/department-receipt-editor.js";

export function departmentReceiptSearchDestinations(
  api: DashboardApi,
): readonly DashboardSettingSearchDestination[] {
  return departmentReceiptSettingFields.map((field) => ({
    kind: "setting",
    id: `dashboard:department-receipt:${field.name}`,
    screen: "venue-operations",
    labelKey: field.labelKey,
    locationKey: `venue.department_tab.${field.tab}`,
    requiresPermission: "venue.configure",
    async resolve(ctx) {
      const departments = await api.background.getVenueDepartments();
      return departments
        .filter((row) => row.active && ctx.renderPanel?.("department-receipt", row) != null)
        .map((row) => ({
          id: row.id,
          label: row.name,
          path: `/venue-operations/department/${encodePathSegment(row.id)}/view/receipt`,
        }));
    },
  }));
}
