import { afterEach, expect, test } from "vitest";
import { mountTokenRoot, token } from "./token-test-helpers.js";

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

test("two theme roots render different themes simultaneously", () => {
  const a = mountTokenRoot("light");
  mounted.push(a);

  const b = mountTokenRoot("dark");
  mounted.push(b);

  // Both `a` and `b` stay mounted at once here — unlike tokens/colors.test.ts,
  // which removes the first host before mounting the second and so never
  // exercises two simultaneously live theme roots.
  expect(token(a, "--wt-color-bg")).toBe("#f7f7f8");
  expect(token(b, "--wt-color-bg")).toBe("#101216");
});
