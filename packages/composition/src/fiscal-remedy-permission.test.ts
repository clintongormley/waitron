import { expect, it } from "vitest";
import { registerModulePermissions, roleHasPermission } from "@waitron/identity";
import { ALL_MODULES } from "./modules.js";

it("grants fiscal remedy decisions only to administrators through the fiscal module", () => {
  const fiscal = ALL_MODULES.find((module) => module.name === "fiscal-verifactu")!;
  registerModulePermissions(fiscal.permissions ?? []);
  expect(
    ["staff", "supervisor", "manager", "admin"].map((role) =>
      roleHasPermission(role as "staff" | "supervisor" | "manager" | "admin", "fiscal.remedy"),
    ),
  ).toEqual([false, false, false, true]);
});
