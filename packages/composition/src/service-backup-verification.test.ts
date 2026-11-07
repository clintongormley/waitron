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
    // A module without a set of its own is covered by the entry of the set holding its tables.
    const entry = inventory.find(
      (item) => item.module.name === name || item.hosted.some((m) => m.name === name),
    )!;
    const covered =
      entry.module.name === name ? entry.module : entry.hosted.find((m) => m.name === name);
    expect(covered?.backup?.verification).toBe(contribution);
    for (const table of contribution.data.tables)
      expect(entry.verification.data.tables).toContain(table);
    for (const table of contribution.data.immutableTables)
      expect(entry.verification.data.immutableTables).toContain(table);
    for (const check of contribution.data.checks)
      expect(entry.verification.data.checks).toContain(check);
  });
});
