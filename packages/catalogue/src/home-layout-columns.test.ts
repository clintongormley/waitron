import { describe, expect, it } from "vitest";
import { HANDHELD_COLUMNS, TILL_COLUMNS } from "./home-layout-columns.js";

describe("home layout columns", () => {
  it("lays a handheld's home page three tiles wide and a till's six", () => {
    expect(HANDHELD_COLUMNS).toBe(3);
    expect(TILL_COLUMNS).toBe(6);
  });
});
