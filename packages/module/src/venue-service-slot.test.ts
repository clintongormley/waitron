import { describe, expect, it } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import type { VenueServiceContribution, WaitronModule } from "./module.js";
import { selectVenueService } from "./venue-service-slot.js";

const migrations = (name: string) => ({
  name,
  table: `__drizzle_migrations_${name}`,
  from: `../${name}/drizzle`,
});
const contribution = {} as VenueServiceContribution;
const moduleWith = (name: string, venueService?: VenueServiceContribution): WaitronModule => ({
  name,
  version: "0.0.0",
  tier: "mandatory",
  migrations: migrations(name),
  ...(venueService === undefined ? {} : { venueService }),
});

describe("selectVenueService", () => {
  it("returns the single contribution", () => {
    expect(selectVenueService([moduleWith("core"), moduleWith("service", contribution)])).toBe(
      contribution,
    );
  });

  it.each([
    [[], "module.venue_service_empty"],
    [
      [moduleWith("one", contribution), moduleWith("two", contribution)],
      "module.venue_service_ambiguous",
    ],
  ] as const)("rejects an invalid contribution set", (modules, code) => {
    let thrown: unknown;
    try {
      selectVenueService(modules);
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown) && thrown.code).toBe(code);
    expect(thrown).toBeInstanceOf(AppError);
  });
});
