import { describe, expect, it } from "vitest";
import { shortNameColumns } from "./table-short-names.js";

describe("shortNameColumns", () => {
  it("writes the folded key beside the short name, and nulls for none", () => {
    expect(shortNameColumns("TÉ1")).toEqual({ shortName: "TÉ1", shortNameKey: "té1" });
    expect(shortNameColumns(null)).toEqual({ shortName: null, shortNameKey: null });
  });
});
