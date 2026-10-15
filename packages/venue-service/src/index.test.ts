import { describe, expect, it } from "vitest";
import * as barrel from "./index.js";
import { resolveDepartmentsDays } from "./day-resolver.js";

describe("@waitron/venue-service", () => {
  it("exports resolveDepartmentsDays for the staffing special-day guides", () => {
    expect(barrel.resolveDepartmentsDays).toBe(resolveDepartmentsDays);
  });
});
