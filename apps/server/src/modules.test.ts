import { describe, expect, it } from "vitest";
import { BOOKINGS_TABLE_REMOVAL } from "@waitron/bookings";
import { PERMISSIONS } from "@waitron/identity";
import type { AlertSource, StaffNoticeSource, WaitronModule } from "@waitron/module";
import {
  ALL_ALERT_CLAIMS,
  ALL_CLASSIFICATIONS,
  ALL_MODULE_PERMISSIONS,
  ALL_MODULES,
  VENUE_SERVICE,
  enabledAlertSources,
  enabledStaffNoticeSources,
  enabledTableRemovals,
} from "./modules.js";

describe("venue-service assembly", () => {
  it("injects the composed contribution through the generic module seat", () => {
    expect(VENUE_SERVICE).toBe(ALL_MODULES.find((module) => module.venueService)?.venueService);
  });
});

describe("permission assembly", () => {
  it("registers no core permission as a module's, so no module floor widens one", () => {
    const core: readonly string[] = PERMISSIONS;
    expect(ALL_MODULE_PERMISSIONS.filter((p) => core.includes(p.permission))).toEqual([]);
  });
});

describe("classification assembly", () => {
  it("classifies each table exactly once", () => {
    const names = ALL_CLASSIFICATIONS.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("table-removal assembly", () => {
  it("collects the bookings module's seat, and nothing from a module without one", () => {
    const bookings = ALL_MODULES.find((m) => m.name === "bookings")!;
    expect(enabledTableRemovals([bookings])).toEqual([BOOKINGS_TABLE_REMOVAL]);
    expect(enabledTableRemovals([{ ...bookings, tableRemoval: undefined }])).toEqual([]);
  });
});

describe("alert assembly", () => {
  it("collects every module's event-code claims", () => {
    expect(ALL_ALERT_CLAIMS.map((c) => c.prefix)).toEqual(
      expect.arrayContaining(["chain.", "clock.", "payment.", "fiscal.", "route."]),
    );
  });

  it("collects sources from the modules it is given only", () => {
    const source: AlertSource = {
      area: "test",
      permission: "diagnostics.view",
      read: () => Promise.resolve([]),
    };
    const withSource = { ...ALL_MODULES[0]!, alerts: { sources: [source] } } as WaitronModule;
    expect(enabledAlertSources([withSource])).toEqual([source]);
    expect(enabledAlertSources([ALL_MODULES[0]!])).toEqual([]);
  });
});

describe("staff-notice assembly", () => {
  it("collects the sources of the modules it is given only, named by their module", () => {
    const a: StaffNoticeSource = { read: () => Promise.resolve([]) };
    const b: StaffNoticeSource = { read: () => Promise.resolve([]) };
    const probe = { ...ALL_MODULES[0]!, name: "probe", staffNotices: [a, b] } as WaitronModule;
    const sources = enabledStaffNoticeSources([probe]);
    expect(sources).toEqual([
      { owner: "probe", source: a },
      { owner: "probe", source: b },
    ]);
    expect(sources[0]!.source).toBe(a);
    expect(sources[1]!.source).toBe(b);
    expect(enabledStaffNoticeSources([ALL_MODULES[0]!])).toEqual([]);
  });
});
