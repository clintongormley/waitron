import { expect, it } from "vitest";
import { reportBuild, setReportBuild } from "./diagnostics.js";

it("keeps the build it is given for later reports", () => {
  expect(reportBuild).toBeNull();
  setReportBuild("2026.11.22-abc");
  expect(reportBuild).toBe("2026.11.22-abc");
});
