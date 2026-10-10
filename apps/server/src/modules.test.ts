import { describe, expect, it } from "vitest";
import { BOOKINGS_TABLE_REMOVAL } from "@waitron/bookings";
import type { AlertSource, WaitronModule } from "@waitron/module";
import {
  ALL_ALERT_CLAIMS,
  ALL_CLASSIFICATIONS,
  ALL_MODULES,
  VENUE_SERVICE,
  enabledAlertSources,
  enabledTableRemovals,
} from "./modules.js";

describe("venue-service assembly", () => {
  it("injects the composed contribution through the generic module seat", () => {
    expect(VENUE_SERVICE).toBe(ALL_MODULES.find((module) => module.venueService)?.venueService);
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
