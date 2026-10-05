import { describe, expect, it } from "vitest";
import { isStatusColor } from "./status-color.js";

describe("isStatusColor", () => {
  it.each(["amber", "#ef4444", "#EF4444", "a_b-c", "x".repeat(32)])("accepts %j", (value) => {
    expect(isStatusColor(value)).toBe(true);
  });

  it.each(["", "x".repeat(33), "red;position:fixed", "red position", 7, null, undefined])(
    "refuses %j",
    (value) => {
      expect(isStatusColor(value)).toBe(false);
    },
  );
});
