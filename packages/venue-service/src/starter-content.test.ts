import { describe, expect, it } from "vitest";
import { OPEN_PERIOD_NAME } from "./menu-timetable.js";
import { COUNTER_ZONE_NAME } from "./provisioning.js";
import { DEFAULT_SEASONS } from "./season-rules.js";
import { STARTER_STEPS } from "./service-steps.js";
import {
  STARTER_PERIOD_NAMES,
  STARTER_SEASON_NAMES,
  STARTER_STEP_NAMES,
  STARTER_ZONE_NAMES,
} from "./starter-content.js";

describe("starter-content", () => {
  it("has an entry for every starter service step, and none for anything else", () => {
    expect(Object.keys(STARTER_STEP_NAMES)).toEqual(STARTER_STEPS.map((step) => step.name));
  });

  it("has an entry for every default season, and none for anything else", () => {
    expect(Object.keys(STARTER_SEASON_NAMES)).toEqual(DEFAULT_SEASONS.map((season) => season.name));
  });

  it("has an entry for the starter counter zone, and none for anything else", () => {
    expect(Object.keys(STARTER_ZONE_NAMES)).toEqual([COUNTER_ZONE_NAME]);
  });

  it("has an entry for the starter period, and none for anything else", () => {
    expect(Object.keys(STARTER_PERIOD_NAMES)).toEqual([OPEN_PERIOD_NAME]);
  });
});
