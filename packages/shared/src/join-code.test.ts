import { expect, it } from "vitest";
import { groupedJoinCode } from "./join-code.js";

it("writes a join code as two groups of three joined by a no-break space", () => {
  expect(groupedJoinCode("482913")).toBe("482\u00a0913");
  expect(groupedJoinCode("004217")).toBe("004\u00a0217");
});
