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
