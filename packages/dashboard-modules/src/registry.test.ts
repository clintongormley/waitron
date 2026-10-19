import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { CARD_PROVIDERS } from "@waitron/composition";
import { CARD_PROVIDER_PANELS, DASHBOARD_MODULES } from "./index.js";

// Every registry entry names a REAL server module and is unique. The reverse — a UI-bearing module
// silently MISSING from the registry — is NOT mechanically checkable: the server descriptor carries
// no dashboard seat, so "UI-bearing" is not a queryable property of ALL_MODULES.
describe("DASHBOARD_MODULES honesty", () => {
  it("every contribution names a real module in ALL_MODULES, and is unique", () => {
    const names = new Set(ALL_MODULES.map((m) => m.name));
    const ids = DASHBOARD_MODULES.map((c) => c.module);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(names.has(id)).toBe(true);
  });

  it("registers the bookings contribution (not vacuous)", () => {
    expect(DASHBOARD_MODULES.map((c) => c.module)).toContain("bookings");
  });

  it("puts the adjustment reasons on Venue settings for managers of adjustments", () => {
    const adjustments = DASHBOARD_MODULES.find((c) => c.module === "adjustments");
    expect(
      adjustments?.settingsPanels?.map((panel) => [panel.tab, panel.requiresPermission]),
    ).toEqual([["adjustment-reasons", "adjustment.manage"]]);
  });

  it("puts the AEAT certificate on Venue details for system.manage, readable with fiscal.view", () => {
    const verifactu = DASHBOARD_MODULES.find((c) => c.module === "fiscal-verifactu");
    expect(
      verifactu?.settingsPanels?.map((panel) => [
        panel.tab,
        panel.requiresPermission,
        panel.readPermission,
        panel.order,
      ]),
    ).toEqual([["venue-details", "system.manage", "fiscal.view", 1]]);
  });

  it("registers the adjustment report in the reports group for anyone who may view reports", () => {
    const adjustments = DASHBOARD_MODULES.find((c) => c.module === "adjustments");
    expect(adjustments?.screen).toEqual({
      id: "adjustment-report",
      navLabelKey: "nav.adjustment_report",
      group: "reports",
      requiresPermission: "report.view",
    });
  });

  it("registers the Staff roles page in the Team group for managers of staffing", () => {
    const staffing = DASHBOARD_MODULES.find((c) => c.module === "staffing");
    expect(staffing?.screen).toEqual({
      id: "staff-roles",
      navLabelKey: "nav.staff_roles",
      group: "team",
      requiresPermission: "staffing.manage",
      readPermission: "venue.view",
    });
  });
});

describe("CARD_PROVIDER_PANELS honesty", () => {
  it("names the same providers as the server's CARD_PROVIDERS list, uniquely", () => {
    const panelIds = CARD_PROVIDER_PANELS.map((p) => p.providerId);
    expect(new Set(panelIds).size).toBe(panelIds.length);
    expect([...panelIds].sort()).toEqual([...CARD_PROVIDERS.map((p) => p.providerId)].sort());
  });

  it("registers the sumup and stripe panels (not vacuous)", () => {
    expect(CARD_PROVIDER_PANELS.map((p) => p.providerId).sort()).toEqual(["stripe", "sumup"]);
  });
});

it("registers Time corrections in Team for workforce correction authority", () => {
  const workforce = DASHBOARD_MODULES.find((contribution) => contribution.module === "workforce");
  expect(workforce?.screen).toEqual({
    id: "time-corrections",
    navLabelKey: "nav.time_corrections",
    group: "team",
    requiresPermission: "workforce.correct",
  });
});

it("registers workforce Hours beside Time corrections with current correction authority", () => {
  const workforce = DASHBOARD_MODULES.find((contribution) => contribution.module === "workforce");
  expect(workforce?.moreScreens?.find((entry) => entry.screen.id === "hours")?.screen).toEqual({
    id: "hours",
    navLabelKey: "nav.hours",
    group: "team",
    requiresPermission: "workforce.correct",
  });
});
