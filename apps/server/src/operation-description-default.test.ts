import { expect, it } from "vitest";
import { offeredOperationDescriptionDefault } from "./operation-description-default.js";

it.each([undefined, "", "  \t"])("a missing or blank seat default (%j) offers none", (value) => {
  expect(offeredOperationDescriptionDefault(value)).toBeUndefined();
});

it("a seat default with text is offered as given", () => {
  expect(offeredOperationDescriptionDefault(" Seat default ")).toBe(" Seat default ");
});
