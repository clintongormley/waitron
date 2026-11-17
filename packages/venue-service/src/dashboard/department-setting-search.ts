import type { DashboardSettingSearchDestination } from "@waitron/dashboard-kit";
import { encodePathSegment } from "@waitron/ui";
import { VenueServiceApi } from "./client.js";
import {
  departmentSettingFields,
  offeredDepartmentTabs,
  offersReceiptEditor,
} from "./department-settings.js";

export const departmentSettingSearchDestinations: readonly DashboardSettingSearchDestination[] =
  departmentSettingFields.map((field) => ({
    kind: "setting",
    id: `venue-service:department:${field.name}`,
    screen: "venue-operations",
    labelKey: field.labelKey,
    locationKey: `venue.department_tab.${field.tab}`,
    async resolve(ctx) {
      const model = await new VenueServiceApi(ctx.request, ctx.liveData).background.load();
      const departments = model.departments.filter((row) => row.active);
      const first = departments[0];
      if (!first || !offeredDepartmentTabs(model).includes(field.tab)) return [];
      if (field.requiresDescription) {
        if (!offersReceiptEditor(ctx.renderPanel?.("department-receipt", first))) return [];
        const receipt = await ctx.request<{ operationDescriptionRequired: boolean }>(
          `/management-api/venue-service/departments/${encodeURIComponent(first.id)}/receipt`,
          "GET",
          undefined,
          { passive: true },
        );
        if (!receipt.operationDescriptionRequired) return [];
      }
      if (field.requiresTakeawayVat && !model.takeawayVat) return [];
      const shown =
        field.name === "diningStartsAs"
          ? departments.filter(
              (row) =>
                model.salePolicies.departments.find((policy) => policy.departmentId === row.id)
                  ?.dining === "till_choice",
            )
          : departments;
      return shown.map((row) => ({
        id: row.id,
        label: row.name,
        path: `/venue-operations/department/${encodePathSegment(row.id)}${field.tab === "details" ? "" : `/view/${field.tab}`}`,
      }));
    },
  }));
