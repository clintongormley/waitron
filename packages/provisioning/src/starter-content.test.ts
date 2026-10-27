import { describe, expect, it } from "vitest";
import { DEFAULT_DEVICE_PROFILES } from "@waitron/layouts";
import { STARTER_PROFILE_NAMES, STARTER_STATION_NAMES } from "./starter-content.js";
import { DEFAULT_STATION_NAME } from "./venue-plan.js";

describe("starter-content", () => {
  it("has an entry for every starter device profile, and none for anything else", () => {
    expect(Object.keys(STARTER_PROFILE_NAMES)).toEqual(
      DEFAULT_DEVICE_PROFILES.map((profile) => profile.name),
    );
  });

  it("has an entry for the starter kitchen station, and none for anything else", () => {
    expect(Object.keys(STARTER_STATION_NAMES)).toEqual([DEFAULT_STATION_NAME]);
  });
});
