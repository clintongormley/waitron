// The setup wizard has to name the fields the fiscal regime refuses, and it cannot import the regime
// to learn them: nothing under `apps/` may import a regime package (`scripts/module-seams.test.ts`).
// So the wizard keeps its own list — the paths, plus the venue form's key for each and the sentence
// the operator reads — and this root guard is the only place the two are compared. It reads the
// exported VALUES both sides use at runtime, not their source text: two of the four paths never
// appear as a string literal at a `refuse(...)` call (they arrive through the loop's tuple), so a
// text scrape would find two, pass, and claim to have checked four (CLAUDE.md §1).
//
// It lives in the root project because that project is the one gate never narrowed away, and because
// neither package's own suite can see the other (CLAUDE.md §4).
import { expect, it } from "vitest";
import { VENUE_FISCAL_FIELD_PATHS } from "../packages/fiscal-verifactu/src/venue-fields.js";
import { SERVER_FIELDS } from "../apps/setup/src/server-fields.js";

it("the setup wizard covers exactly the venue fields the fiscal regime refuses", () => {
  // Drift in EITHER direction is a defect, and one of them is silent: a path the wizard routes on
  // but has no entry for would send the operator back to the venue form with no mark, no sentence
  // and no banner — nothing telling them anything happened.
  expect(Object.keys(SERVER_FIELDS).sort()).toEqual([...VENUE_FISCAL_FIELD_PATHS].sort());
});

it("every covered field names a form field and says something to the operator", () => {
  // A blank message is the same silent dead end as a missing entry: the field would be marked red
  // with no explanation beside it.
  for (const [path, field] of Object.entries(SERVER_FIELDS)) {
    expect(field?.key, `${path} must name the venue form's own field key`).toMatch(/\S/);
    expect(field?.message, `${path} must explain itself to the operator`).toMatch(/\S/);
  }
});
