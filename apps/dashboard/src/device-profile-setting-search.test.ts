import { expect, it, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { DashboardApi } from "./api/client.js";
import { deviceProfileSettingSearchDestinations } from "./device-profile-setting-search.js";
import { deviceProfile, deviceResponses } from "./testing/device-settings-fixture.js";
it("resolves offered profile settings passively", async () => {
  const profiles = [
    { ...deviceProfile, id: "p/+", name: "Counter", capabilities: ["show-expo"] },
    { ...deviceProfile, id: "kds", name: "Kitchen", formFactor: "kds" as const },
    { ...deviceProfile, id: "monitor", name: "Monitor", formFactor: "kds" as const },
  ];
  const answers = deviceResponses({
    profiles,
    kitchen: [
      { profileId: "p/+", screens: { pass: { stationIds: null, zoneIds: null } } },
      { profileId: "kds", screens: { station: { stationIds: null, zoneIds: null } } },
      { profileId: "monitor", screens: { pass_monitor: { stationIds: null, zoneIds: null } } },
    ],
  });
  answers["/management-api/page-printers"] = [{ id: "a4", name: "Office", active: true }];
  answers["/management-api/payments/device-profiles/p/+/readers"] = {
    readerIds: ["missing"],
    defaultReaderId: null,
  };
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async (path) => new Response(JSON.stringify(answers[path] ?? [])),
  );
  const api = new DashboardApi("", fetchImpl);
  for (const method of [
    "listDeviceProfiles",
    "listProfileKitchenScreens",
    "listPrinters",
    "listPagePrinters",
    "listReaders",
    "getProfileReaders",
  ] as const)
    vi.spyOn(api, method).mockRejectedValue(new Error("foreground read"));
  const entries = deviceProfileSettingSearchDestinations(api);
  expect(entries).toHaveLength(new Set(entries.map((e) => `${e.locationKey}:${e.labelKey}`)).size);
  const entry = (key: string, tab: string) =>
    entries.find((e) => e.id === `dashboard:device-profile:${key}:${tab}`)!;
  const resolve = (key: string, tab: string) =>
    entry(key, tab).resolve({ request: createRequest({ fetchImpl }) });
  expect(entry("inactivityTimeout", "general")).toMatchObject({
    labelKey: "device_profiles.inactivity_timeout_label",
    locationKey: "device_profiles.tab.general",
    screen: "device-profiles",
  });
  expect(await resolve("inactivityTimeout", "general")).toEqual([
    { id: "p/+", label: "Counter", path: "/device-profiles/profile/p%2F%2B/view/general" },
    { id: "kds", label: "Kitchen", path: "/device-profiles/profile/kds/view/general" },
    { id: "monitor", label: "Monitor", path: "/device-profiles/profile/monitor/view/general" },
  ]);
  expect((await resolve("stationScreenStations", "kitchen")).map((r) => r.id)).toEqual([
    "kds",
    "monitor",
  ]);
  expect((await resolve("passScreenZones", "capabilities")).map((r) => r.id)).toEqual(["p/+"]);
  expect((await resolve("passScreenZones", "kitchen")).map((r) => r.id)).toEqual(["monitor"]);
  expect((await resolve("invoicePrinterIds", "equipment")).map((r) => r.id)).toEqual(["p/+"]);
  answers["/management-api/page-printers"] = [];
  expect(await resolve("invoicePrinterIds", "equipment")).toEqual([]);
  expect(
    fetchImpl.mock.calls.filter(([path]) => path === "/management-api/payments/readers"),
  ).toHaveLength(0);
  expect((await resolve("defaultReaderId", "equipment")).map((r) => r.id)).toEqual(["p/+"]);
  const fallback = fetchImpl.mock.calls.filter(
    ([path]) => path.includes("/readers") && path.includes("device-profiles"),
  );
  expect(fallback.map(([path]) => path)).toEqual([
    "/management-api/payments/device-profiles/p/+/readers",
  ]);
  answers["/management-api/payments/readers"] = [{ id: "r1", active: true }];
  await resolve("defaultReaderId", "equipment");
  expect(
    fetchImpl.mock.calls.filter(
      ([path]) => path.includes("device-profiles/") && path.endsWith("/readers"),
    ),
  ).toHaveLength(1);
  expect(
    fetchImpl.mock.calls.every(
      ([, init]) => new Headers(init.headers).get("x-waitron-live") === "1",
    ),
  ).toBe(true);
  vi.restoreAllMocks();
});
