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
  path: "/manage/prep-stations/view/routing",
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
      href: "/manage/prep-stations/view/routing",
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
        href: "/manage/venue-settings/view/tables",
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
        href: "/manage/opening-hours/view/rota",
      },
      {
        id: "calendar:rota:by-person",
        screen: "opening-hours",
        label: "By person",
        pageLabel: "Calendar",
        heading: "Operations",
        href: "/manage/opening-hours/view/rota/mode/person",
      },
    ]);
    value.calendarViews = [];
    expect(collectSearchDestinations(value).filter((x) => x.screen === "opening-hours")).toEqual(
      [],
    );
  });
  it("rejects duplicate ids, unknown parent screens and paths outside the declared screen", () => {
    for (const invalid of [
      [{ ...declaration, id: "x", screen: "absent", path: "/manage/absent" }],
      [declaration, declaration],
      [{ ...declaration, path: "https://outside.example/manage/prep-stations" }],
      [{ ...declaration, path: "/manage/printers" }],
    ])
      expect(() => collectSearchDestinations({ ...input(), declarations: invalid })).toThrow();
  });
});
