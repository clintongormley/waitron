import type { DeviceProfile, DeviceRow, KitchenScreenKind, Station } from "../api/client.js";
import { deep, mountReceiptApp } from "./department-receipt-app-fixture.js";
export const deviceProfile: DeviceProfile = {
  id: "dp1",
  name: "Counter",
  formFactor: "till",
  capabilities: [],
  inactivityTimeoutSeconds: null,
  startingScreen: null,
  departmentId: null,
  allowedZoneIds: null,
  startingZoneId: null,
  admittedStaffRoleIds: [],
  receiptPrinterIds: [],
  paymentSlipPrinterIds: [],
  cashDrawerPrinterIds: [],
  invoicePrinterIds: [],
  receiptPrinterDefaultId: null,
  paymentSlipPrinterDefaultId: null,
  cashDrawerPrinterDefaultId: null,
  invoicePrinterDefaultId: null,
};
export const device: DeviceRow = {
  id: "d1",
  label: "Counter till",
  deviceProfileId: "dp1",
  kind: "kds_station",
  active: true,
  lastSeenAt: null,
  enrolledAt: "2026-11-14T12:00:00Z",
  profileRetired: false,
  madeHereStationIds: [],
  approvedProfileIds: ["dp1"],
  kitchenScreens: [],
  receiptPrinterId: null,
  paymentSlipPrinterId: null,
  cashDrawerPrinterId: null,
  equipment: [],
  batteryLevel: null,
  batteryCharging: null,
  batteryReportedAt: null,
};
export const station: Station = {
  id: "s1",
  name: "Hot line",
  isDefault: true,
  active: true,
  showsRestOfOrder: false,
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};
export const savedScreen = (kind: KitchenScreenKind): DeviceRow["kitchenScreens"][number] => ({
  kind,
  available: true,
  everyStation: true,
  everyZone: true,
  profileEveryStation: true,
  stations: [{ id: "s1", name: "Hot line", available: true, switchedOff: false }],
  zones: [],
  nonPassStationsOverride: null,
  showNonPassStations: true,
});
export function deviceResponses(
  options: {
    devices?: DeviceRow[];
    profiles?: DeviceProfile[];
    kitchen?: Awaited<
      ReturnType<import("../api/client.js").DashboardApi["listProfileKitchenScreens"]>
    >;
    stations?: Station[];
  } = {},
): Record<string, unknown> {
  return {
    "/management-api/devices": options.devices ?? [device],
    "/management-api/device-profiles": { deviceProfiles: options.profiles ?? [deviceProfile] },
    "/management-api/device-profile-kitchen-screens": { profiles: options.kitchen ?? [] },
    "/management-api/stations": options.stations ?? [station],
    "/management-api/zones": [{ id: "z1", name: "Bar", displayOrder: 0, active: true }],
    "/management-api/pairing-mode": {
      open: false,
      openUntil: null,
      deviceAddress: "https://waitron.local",
    },
    "/management-api/payments/devices/d1/reader": { readerId: null },
    "/management-api/payments/device-profiles/dp1/readers": {
      readerIds: [],
      defaultReaderId: null,
    },
  };
}
export function mountDeviceApp(
  options: Parameters<typeof mountReceiptApp>[0] & Parameters<typeof deviceResponses>[0] = {},
) {
  const answers = deviceResponses(options);
  return mountReceiptApp({
    path: "/manage/devices",
    permissions: ["venue.view", "hardware.manage"],
    modules: [],
    ...options,
    respond(path, init) {
      return (
        options.respond?.(path, init) ??
        (path in answers ? Promise.resolve(new Response(JSON.stringify(answers[path]))) : undefined)
      );
    },
  });
}
export const deviceScreen = (app: Awaited<ReturnType<typeof mountDeviceApp>>["app"]) =>
  deep(
    app.shadowRoot!,
    "dashboard-devices-screen",
  ) as HTMLElementTagNameMap["dashboard-devices-screen"];
