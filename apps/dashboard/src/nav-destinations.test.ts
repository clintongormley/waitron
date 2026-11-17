import { describe, expect, it } from "vitest";
import type { CalendarViewEntry, DashboardSearchDestination } from "@waitron/dashboard-kit";
import { collectSearchDestinations } from "./nav-destinations.js";

const pages = [
  { screen: "opening-hours", label: "Calendar", heading: "Operations" },
  { screen: "prep-stations", label: "Prep stations", heading: "Operations" },
  { screen: "venue-settings", label: "Venue settings", heading: "Operations" },
  { screen: "printers", label: "Printers", heading: "Settings" },
];
const declaration: DashboardSearchDestination = {
  id: "routes",
  screen: "prep-stations",
  labelKey: "routes",
  path: "/prep-stations/view/routing",
};
const input = () => ({
  pages,
  declarations: [declaration],
  calendarViews: [] as CalendarViewEntry[],
  settingsTabs: [] as { id: string; label: string }[],
  permissions: [] as string[],
  label: (key: string) =>
    ({ routes: "Routes", staffing: "Staffing", rota: "Rota", person: "By person" })[key] ?? key,
  knownScreens: pages.map((x) => x.screen),
});
const ids = (value: ReturnType<typeof collectSearchDestinations>) => value.map((x) => x.id);

describe("collectSearchDestinations", () => {
  it("collects a full declared address and the localized containing page", () => {
    expect(collectSearchDestinations(input()).find((x) => x.id === "routes")).toEqual({
      id: "routes",
      screen: "prep-stations",
      label: "Routes",
      pageLabel: "Prep stations",
      heading: "Operations",
      href: "/prep-stations/view/routing",
    });
  });
  it("requires a readable parent and an explicitly gated child's write or read permission", () => {
    const value = input();
    value.declarations = [
      { ...declaration, requiresPermission: "routing.manage", readPermission: "routing.view" },
    ];
    expect(ids(collectSearchDestinations(value))).not.toContain("routes");
    value.permissions = ["routing.view"];
    expect(ids(collectSearchDestinations(value))).toContain("routes");
    value.permissions = ["routing.manage"];
    expect(ids(collectSearchDestinations(value))).toContain("routes");
    value.pages = pages.filter((x) => x.screen !== "prep-stations");
    expect(ids(collectSearchDestinations(value))).not.toContain("routes");
  });
  it("honours a read-only child gate without a write permission", () => {
    const value = input();
    value.declarations = [{ ...declaration, readPermission: "routing.view" }];
    expect(ids(collectSearchDestinations(value))).not.toContain("routes");
    value.permissions = ["routing.view"];
    expect(ids(collectSearchDestinations(value))).toContain("routes");
  });
  it("uses only supplied visible settings tabs, without duplicate panel results", () => {
    const value = input();
    value.settingsTabs = [{ id: "tables", label: "Tables" }];
    expect(collectSearchDestinations(value).filter((x) => x.screen === "venue-settings")).toEqual([
      {
        id: "settings:tables",
        screen: "venue-settings",
        label: "Tables",
        pageLabel: "Venue settings",
        heading: "Operations",
        href: "/venue-settings/view/tables",
      },
    ]);
  });
  it("inherits calendar-view access for main results and modes and preserves every parameter", () => {
    const value = input();
    value.calendarViews = [
      {
        view: {
          id: "rota",
          labelKey: "rota",
          order: 20,
          requiresPermission: "schedule.manage",
          searchDestinations: [{ id: "by-person", labelKey: "person", params: { mode: "person" } }],
          create: () => ({ render: () => undefined as never }),
        },
        canWrite: true,
      },
    ];
    expect(collectSearchDestinations(value).filter((x) => x.screen === "opening-hours")).toEqual([
      {
        id: "calendar:rota",
        screen: "opening-hours",
        label: "Rota",
        pageLabel: "Calendar",
        heading: "Operations",
        href: "/opening-hours/view/rota",
      },
      {
        id: "calendar:rota:by-person",
        screen: "opening-hours",
        label: "By person",
        pageLabel: "Calendar",
        heading: "Operations",
        href: "/opening-hours/view/rota/mode/person",
      },
    ]);
    value.calendarViews = [];
    expect(collectSearchDestinations(value).filter((x) => x.screen === "opening-hours")).toEqual(
      [],
    );
  });
  it("rejects duplicate ids, unknown parent screens and paths outside the declared screen", () => {
    for (const invalid of [
      [{ ...declaration, id: "x", screen: "absent", path: "/absent" }],
      [declaration, declaration],
      [{ ...declaration, path: "https://outside.example/prep-stations" }],
      [{ ...declaration, path: "/printers" }],
    ])
      expect(() => collectSearchDestinations({ ...input(), declarations: invalid })).toThrow();
  });
});

it("searches card providers under Modules without offering the removed Card payments tabs", () => {
  const value = input();
  value.pages = [
    { screen: "payments", label: "Card payments", heading: "Settings" },
    { screen: "modules", label: "Modules", heading: "Settings" },
  ];
  expect(collectSearchDestinations(value)).toEqual([
    {
      id: "modules:card-providers",
      screen: "modules",
      label: "modules.providers",
      pageLabel: "Modules",
      heading: "Settings",
      href: "/modules/view/card-providers/state/all",
    },
    {
      id: "payments:readers",
      screen: "payments",
      label: "payments.readers_heading",
      pageLabel: "Card payments",
      heading: "Settings",
      href: "/payments",
    },
  ]);
});

it("collects localized setting locations without resolving rows and retains parent/child gates and duplicate validation", () => {
  const setting = {
    kind: "setting" as const,
    id: "reminder",
    screen: "prep-stations",
    labelKey: "reminder",
    locationKey: "service",
    requiresPermission: "routing.manage",
    resolve: async () => [],
  };
  const value = {
    ...input(),
    declarations: [setting],
    label: (key: string) => ({ reminder: "Reminder", service: "Service" })[key] ?? key,
  };
  expect(collectSearchDestinations(value).find((x) => x.id === "reminder")).toBeUndefined();
  value.permissions = ["routing.manage"];
  expect(collectSearchDestinations(value).find((x) => x.id === "reminder")).toEqual({
    id: "reminder",
    screen: "prep-stations",
    label: "Reminder",
    location: "Service",
    pageLabel: "Prep stations",
    heading: "Operations",
    setting,
  });
  expect(() => collectSearchDestinations({ ...value, declarations: [setting, setting] })).toThrow(
    "repeats search destination",
  );
  expect(() =>
    collectSearchDestinations({ ...value, declarations: [{ ...setting, screen: "absent" }] }),
  ).toThrow("invalid screen");
  expect(collectSearchDestinations({ ...value, pages: [] })).toEqual([]);
});
