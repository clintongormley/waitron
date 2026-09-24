// The setup wizard keeps its own copy of the venue fields the fiscal regime refuses. This compares
// the exported runtime values, not source text: two of the four paths reach `refuse(...)` through a
// loop's tuple, never as a string literal.
import { expect, it } from "vitest";
import { VENUE_FISCAL_FIELD_PATHS } from "../packages/fiscal-verifactu/src/venue-fields.js";
import { SERVER_FIELDS } from "../apps/setup/src/server-fields.js";

it("the setup wizard covers exactly the venue fields the fiscal regime refuses", () => {
  // Drift in either direction is a defect: a path with no entry here sends the operator back to
  // the venue form with no mark and no sentence.
  expect(Object.keys(SERVER_FIELDS).sort()).toEqual([...VENUE_FISCAL_FIELD_PATHS].sort());
});

it("every covered field names a form field and says something to the operator", () => {
  for (const [path, field] of Object.entries(SERVER_FIELDS)) {
    expect(field?.key, `${path} must name the venue form's own field key`).toMatch(/\S/);
    expect(field?.message, `${path} must explain itself to the operator`).toMatch(/\S/);
  }
});
