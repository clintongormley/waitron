import { expect, it } from "vitest";
import { isFirstSetupHostPath } from "./first-setup-state.js";

it("excludes setup authority and its children without excluding similarly named venue files", () => {
  for (const name of [
    "first-setup.json",
    "first-setup-claim.json",
    "module-operation-public.json",
    "first-setup-node-key.json",
    "first-fiscal-documents",
    "first-setup-resolutions",
    "first-setup-workspaces",
    "first-setup-selection.json",
    "first-setup-retirement.json",
    "first-setup-workspace.json",
  ]) {
    expect(isFirstSetupHostPath(name), name).toBe(true);
    expect(isFirstSetupHostPath(`${name}/retained/entry.json`), name).toBe(true);
    expect(isFirstSetupHostPath(`${name}-venue-copy`), name).toBe(false);
    expect(isFirstSetupHostPath(`saved/${name}`), name).toBe(false);
  }
  expect(isFirstSetupHostPath("venue.db")).toBe(false);
  expect(isFirstSetupHostPath("")).toBe(false);
});
