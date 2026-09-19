import { describe, expect, it } from "vitest";
import type { AlertSource, WaitronModule } from "@waitron/module";
import {
  ALL_ALERT_CLAIMS,
  ALL_CLASSIFICATIONS,
  ALL_MODULES,
  VENUE_SERVICE,
  enabledAlertSources,
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

describe("alert assembly", () => {
  it("collects every module's event-code claims", () => {
    expect(ALL_ALERT_CLAIMS.map((c) => c.prefix)).toEqual(
      expect.arrayContaining(["chain.", "clock.", "payment.", "fiscal."]),
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
