import { expect, it } from "vitest";
import { tf } from "./strings.js";

it("fills each placeholder, and leaves one with no value as written", () => {
  expect(tf("adjustments.limit_amount", { amount: "€30.00" }, "en")).toBe(
    "Up to €30.00 off a bill",
  );
  expect(tf("adjustments.limit_amount", {}, "en")).toBe("Up to {amount} off a bill");
});
