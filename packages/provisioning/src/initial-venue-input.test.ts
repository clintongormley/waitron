import { expect, it } from "vitest";
import * as inputs from "./index.js";
const value = {
  nodeId: "C0000000-0000-4000-8000-000000000001",
  administratorId: "C0000000-0000-4000-8000-000000000002",
  inputs: [
    {
      module: "test-regime",
      eventId: "setup-42",
      sourceId: "paper-42",
      input: { signed: "opaque" },
    },
  ],
};
it("normalises planned identities and snapshots opaque module input", () => {
  expect(inputs.parseInitialVenueInput).toBeTypeOf("function");
  const result = inputs.parseInitialVenueInput(value)!;
  value.inputs[0]!.input.signed = "caller-mutated";
  expect(result).toEqual({
    nodeId: "c0000000-0000-4000-8000-000000000001",
    administratorId: "c0000000-0000-4000-8000-000000000002",
    inputs: [
      {
        module: "test-regime",
        eventId: "setup-42",
        sourceId: "paper-42",
        input: { signed: "opaque" },
      },
    ],
  });
  value.inputs[0]!.input.signed = "opaque";
});
it.each([
  null,
  [],
  {},
  { ...value, nodeId: "bad" },
  { ...value, administratorId: "bad" },
  { ...value, nodeId: 42 },
  { ...value, administratorId: 42 },
  { ...value, extra: "host trust" },
  { ...value, inputs: [] },
  { ...value, inputs: null },
  { ...value, inputs: [null] },
  { ...value, inputs: [{ ...value.inputs[0], module: " wrong " }] },
  { ...value, inputs: [{ ...value.inputs[0], eventId: "" }] },
  { ...value, inputs: [{ ...value.inputs[0], sourceId: "" }] },
  { ...value, inputs: [{ ...value.inputs[0], eventId: "x".repeat(257) }] },
  { ...value, inputs: [{ ...value.inputs[0], sourceId: "x\n" }] },
  { ...value, inputs: [{ ...value.inputs[0], authority: { forged: true } }] },
  { ...value, inputs: [{ module: "test-regime", eventId: "setup-42", sourceId: "paper-42" }] },
  { ...value, inputs: [value.inputs[0], value.inputs[0]] },
])("refuses malformed or duplicate bootstrap input %#", (input) => {
  expect(inputs.parseInitialVenueInput).toBeTypeOf("function");
  expect(inputs.parseInitialVenueInput(input)).toBeNull();
});
it("refuses opaque values that cannot be snapshotted", () => {
  expect(inputs.parseInitialVenueInput).toBeTypeOf("function");
  expect(
    inputs.parseInitialVenueInput({ ...value, inputs: [{ ...value.inputs[0], input: () => {} }] }),
  ).toBeNull();
});
