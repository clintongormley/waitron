import type { DashboardSettingSearchDestination } from "@waitron/dashboard-kit";
import { encodePathSegment } from "@waitron/ui";
import type { DashboardApi } from "./api/client.js";
import { isSharedDisplay } from "./device-profile-types.js";
import { profileSettingFields, profileTabLabels } from "./screens/device-profiles-screen.js";
export function deviceProfileSettingSearchDestinations(
  api: DashboardApi,
): readonly DashboardSettingSearchDestination[] {
  return profileSettingFields.map((field) => ({
    kind: "setting",
    id: `dashboard:device-profile:${field.key}:${field.tab}`,
    screen: "device-profiles",
    labelKey: field.labelKey,
    locationKey: profileTabLabels[field.tab],
    ...(field.equipment ? { requiresPermission: "hardware.manage" } : {}),
    async resolve() {
      const [profiles, kitchen, printers, pages, readers] = await Promise.all([
        api.background.listDeviceProfiles(),
        api.background.listProfileKitchenScreens(),
        field.equipment ? api.background.listPrinters() : [],
        field.equipment ? api.background.listPagePrinters() : [],
        field.equipment ? api.background.listReaders() : [],
      ]);
      const savedReaders = field.name === "readerIds" || field.name === "defaultReaderId";
      const candidates = await Promise.all(
        profiles.map(async (profile) => {
          const hasReaders =
            savedReaders && !isSharedDisplay(profile.formFactor) && readers.length === 0
              ? (await api.background.getProfileReaders(profile.id)).readerIds.length > 0
              : readers.length > 0;
          return field.offered(
            profile,
            kitchen.find((k) => k.profileId === profile.id)?.screens ?? {},
            printers.some(
              (p) =>
                p.active ||
                profile.receiptPrinterIds.includes(p.id) ||
                profile.paymentSlipPrinterIds.includes(p.id) ||
                profile.cashDrawerPrinterIds.includes(p.id) ||
                profile.invoicePrinterIds.includes(p.id),
            ) || pages.some((p) => p.active || profile.invoicePrinterIds.includes(p.id)),
            hasReaders,
          )
            ? {
                id: profile.id,
                label: profile.name,
                path: `/manage/device-profiles/profile/${encodePathSegment(profile.id)}/view/${field.tab}`,
              }
            : null;
        }),
      );
      return candidates.filter((row) => row !== null);
    },
  }));
}
