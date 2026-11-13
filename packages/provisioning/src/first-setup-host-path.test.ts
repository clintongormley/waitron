import { expect, it } from "vitest";
import { isFirstSetupHostPath } from "./first-setup-state.js";

it("excludes setup authority and its children without excluding similarly named venue files", () => {
  for (const name of ["flows", "first-setup-deleting.json", "records"]) {
    expect(isFirstSetupHostPath(name), name).toBe(true);
    expect(isFirstSetupHostPath(`${name}/retained/entry.json`), name).toBe(true);
    expect(isFirstSetupHostPath(`${name}-venue-copy`), name).toBe(false);
    expect(isFirstSetupHostPath(`saved/${name}`), name).toBe(false);
  }
  expect(isFirstSetupHostPath("venue.db")).toBe(false);
  expect(isFirstSetupHostPath("")).toBe(false);
});

it("an archive entry under flows/ is a host path", () => {
  expect(isFirstSetupHostPath("flows/setup/record.json")).toBe(true);
  expect(isFirstSetupHostPath("flows/restore/record.json")).toBe(true);
  expect(isFirstSetupHostPath("flows-venue-copy")).toBe(false);
});
