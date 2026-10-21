import { describe, expect, it } from "vitest";
import { VENUE_SERVICE_BACKUP_VERIFICATION } from "@waitron/venue-service";
import { ADJUSTMENTS_BACKUP_VERIFICATION } from "@waitron/adjustments";
import { ALL_MODULES } from "./modules.js";
import { backupVerificationInventory } from "./backup-verification.js";

describe("service and adjustment backup registration", () => {
  it.each([
    ["venue-service", VENUE_SERVICE_BACKUP_VERIFICATION],
    ["adjustments", ADJUSTMENTS_BACKUP_VERIFICATION],
  ] as const)("registers the complete %s owner", (name, contribution) => {
    expect(ALL_MODULES.find((m) => m.name === name)?.backup?.verification).toBe(contribution);
    const inventory = backupVerificationInventory(
      ALL_MODULES.filter((m) => ["core", "catalogue", name].includes(m.name)),
    );
    expect(inventory.find((entry) => entry.module.name === name)?.verification.data).toEqual(
      contribution.data,
    );
  });
});
