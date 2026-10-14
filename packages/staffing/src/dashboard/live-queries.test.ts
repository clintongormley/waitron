import { describe, expect, it } from "vitest";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

describe("QUERY_DEPENDENCIES", () => {
  it("declares no dashboard query until the staffing page has one", () => {
    expect(QUERY_DEPENDENCIES).toEqual({});
  });
});
