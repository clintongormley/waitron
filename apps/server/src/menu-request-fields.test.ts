import { expect, it } from "vitest";
import { bodyId, object, refOf, rows, homeRefOf } from "./menu-request-fields.js";

it.each([
  ["body", () => object([], "body")],
  ["sections", () => rows(null, "sections", object)],
  ["sections.0", () => rows([null], "sections", object)],
  ["sections.0.id", () => bodyId(null, "sections.0.id")],
  ["shortcuts.0.ref.kind", () => refOf({ kind: [] }, "shortcuts.0.ref")],
  [
    "shortcuts.0.ref.productId",
    () => refOf({ kind: "product", productId: "no" }, "shortcuts.0.ref"),
  ],
] as const)("reports the malformed request field %s", (field, read) => {
  expect(read).toThrow(
    expect.objectContaining({
      code: "management.request_invalid",
      params: { field },
    }),
  );
});

it("reads a missing tile reference from its kind alone", () => {
  expect(homeRefOf({ kind: "missing" }, "shortcuts.0.ref")).toEqual({ kind: "missing" });
});
