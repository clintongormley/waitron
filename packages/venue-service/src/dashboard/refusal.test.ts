import { expect, it } from "vitest";
import { refusalOf } from "./refusal.js";

it("keeps a refusal's code and params", () => {
  expect(
    refusalOf({ code: "menu_period.invalid", params: { field: "name", reason: "taken" } }),
  ).toEqual({ code: "menu_period.invalid", params: { field: "name", reason: "taken" } });
});

it("a thrown value that is not an object reads as the internal error, with no params", () => {
  expect(refusalOf("network down")).toEqual({ code: "server.internal", params: undefined });
  expect(refusalOf(null)).toEqual({ code: "server.internal", params: undefined });
});
