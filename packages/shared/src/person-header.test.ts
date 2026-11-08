import { expect, it } from "vitest";
import { PERSON_HEADER } from "./person-header.js";

it("names the person header in lower case, as fetch's Headers report it", () => {
  expect(PERSON_HEADER).toBe("x-waitron-person");
});
