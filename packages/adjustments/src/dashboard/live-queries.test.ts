import { describe, expect, it } from "vitest";
import { QUERY_DEPENDENCIES } from "./live-queries.js";

describe("the entries list's live data", () => {
  it("refreshes the entries when a refund or its link changes", () => {
    expect(QUERY_DEPENDENCIES.entries).toContain("adjustment_refunds");
    expect(QUERY_DEPENDENCIES.entries).toContain("tender_refunds");
  });
});
