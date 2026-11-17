import type { DashboardSettingSearchDestination } from "@waitron/dashboard-kit";
import { encodePathSegment } from "@waitron/ui";
import type { DashboardApi } from "./api/client.js";
import { printerSettingFields } from "./screens/printers-screen.js";
export function printerSettingSearchDestinations(
  api: DashboardApi,
): readonly DashboardSettingSearchDestination[] {
  return printerSettingFields.map((field) => ({
    kind: "setting",
    id: `dashboard:printer:${field.id}`,
    screen: "printers",
    labelKey: field.labelKey,
    locationKey: field.editor === "edit" ? "action.edit" : "printers.calibrate",
    requiresPermission: "hardware.manage",
    async resolve() {
      const printers = await api.background.listPrinters();
      const pages = field.rows === "all" ? await api.background.listPagePrinters() : [];
      return [
        ...printers.filter((row) => field.rows !== "network" || row.transport === "network_tcp"),
        ...pages,
      ].map((row) => ({
        id: row.id,
        label: row.name,
        path: `/printers/view/printers/printer/${encodePathSegment(row.id)}/editor/${field.editor}${"step" in field ? `/step/${field.step}` : ""}`,
      }));
    },
  }));
}
