import { expect, it, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { DashboardApi } from "./api/client.js";
import { deviceSettingSearchDestinations } from "./device-setting-search.js";
import {
  device,
  deviceProfile,
  deviceResponses,
  savedScreen,
} from "./testing/device-settings-fixture.js";
it("resolves offered rows through passive lists and encodes device addresses", async () => {
  const rows = [
    { ...device, id: "d/+", label: "Pass", active: false, kitchenScreens: [savedScreen("pass")] },
    { ...device, id: "kds", deviceProfileId: "kds", kitchenScreens: [savedScreen("station")] },
    { ...device, id: "gone", deviceProfileId: null },
    {
      ...device,
      id: "empty",
      kitchenScreens: [{ ...savedScreen("pass"), everyStation: false, stations: [] }],
    },
  ];
  const answers = deviceResponses({
    devices: rows,
    profiles: [
      { ...deviceProfile, capabilities: ["show-expo", "show-station"] },
      { ...deviceProfile, id: "kds", formFactor: "kds" },
    ],
    kitchen: [{ profileId: "kds", screens: { station: { stationIds: null, zoneIds: null } } }],
  });
  const fetchImpl = vi.fn(async (path: string) => new Response(JSON.stringify(answers[path])));
  const api = new DashboardApi("", fetchImpl);
  const methods = ["listDevices", "listDeviceProfiles"] as const;
  const reads = methods.map((method) => vi.spyOn(api.background, method));
  for (const method of methods)
    vi.spyOn(api, method).mockRejectedValue(new Error("foreground read"));
  const entries = deviceSettingSearchDestinations(api);
  const resolve = (name: string) =>
    entries
      .find((e) => e.id === `dashboard:device:${name}`)!
      .resolve({ request: createRequest({ fetchImpl }) });
  expect(entries.map((entry) => entry.id)).not.toContain("dashboard:device:kitchenScreen");
  expect(await resolve("name")).toContainEqual({
    id: "d/+",
    label: "Pass",
    path: "/devices/device/d%2F%2B",
  });
  expect((await resolve("madeHereStationIds")).map((row) => row.id)).toEqual(["d/+", "empty"]);
  expect((await resolve("name")).map((row) => row.id)).toEqual(["d/+", "kds", "gone", "empty"]);
  expect(await resolve("approvedProfileIds")).toEqual([]);
  for (const read of reads) expect(read).toHaveBeenCalledTimes(4);
  for (const name of [
    "receiptPrinterId",
    "paymentSlipPrinterId",
    "cashDrawerPrinterId",
    "invoicePrinterId",
  ]) {
    expect((await resolve(name)).map((row) => row.id)).toEqual(["d/+", "gone", "empty"]);
  }
  vi.restoreAllMocks();
});
