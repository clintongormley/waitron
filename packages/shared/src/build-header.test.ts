import { expect, it } from "vitest";
import { BUILD_HEADER } from "./build-header.js";

it("names the build header in lower case, as fetch's Headers report it", () => {
  expect(BUILD_HEADER).toBe("x-waitron-build");
});
