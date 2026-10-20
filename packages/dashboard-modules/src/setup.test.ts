import { expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { SETUP_MODULES } from "./setup.js";
it("provides a browser screen for each installed server setup offering", () => {
  expect(SETUP_MODULES.map((entry) => entry.module).sort()).toEqual(
    ALL_MODULES.filter((entry) => entry.provisioning?.initialSetup !== undefined)
      .map((entry) => entry.name)
      .sort(),
  );
  expect(new Set(SETUP_MODULES.map((entry) => entry.module)).size).toBe(SETUP_MODULES.length);
});
