import { describe, expect, it } from "vitest";
import * as api from "./index.js";

// This barrel is temporary (Task 5 completes it) — the test exists now because loading it is what
// exercises errors.ts's registry side-effect (`import "./errors.js"`); index.ts itself is
// coverage-excluded, same as payments-stripe's.
describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(["fromMajorUnits", "toMajorUnits", "toMinorUnits"]);
  });
});
