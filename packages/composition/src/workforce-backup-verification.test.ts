import { expect, it } from "vitest";
import { WORKFORCE_BACKUP_VERIFICATION } from "@waitron/workforce";
import { ALL_MODULES } from "./modules.js";
it("registers full workforce verification regardless of enabled modules", () => {
  expect(ALL_MODULES.find((m) => m.name === "workforce")?.backup?.verification).toBe(
    WORKFORCE_BACKUP_VERIFICATION,
  );
});
