import { describe, expect, it } from "vitest";
import { WORKFORCE_ES_BACKUP_VERIFICATION } from "@waitron/workforce-es";
import { STAFFING_BACKUP_VERIFICATION } from "@waitron/staffing";
import { ALL_MODULES } from "./modules.js";
import { backupVerificationInventory } from "./backup-verification.js";

describe("agreement and staffing backup registration", () => {
  it.each([
    ["workforce-es", WORKFORCE_ES_BACKUP_VERIFICATION],
    ["staffing", STAFFING_BACKUP_VERIFICATION],
  ] as const)("registers the complete %s owner", (name, contribution) => {
    expect(ALL_MODULES.find((m) => m.name === name)?.backup?.verification).toBe(contribution);
    const names = ["core", "catalogue", "venue-service", "identity", "workforce", name];
    const inventory = backupVerificationInventory(
      ALL_MODULES.filter((m) => names.includes(m.name)),
    );
    expect(inventory.find((entry) => entry.module.name === name)?.verification.data).toEqual(
      contribution.data,
    );
  });
});
