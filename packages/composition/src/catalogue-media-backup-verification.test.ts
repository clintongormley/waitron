import { describe, expect, it } from "vitest";
import { CATALOGUE_BACKUP_VERIFICATION } from "@waitron/catalogue";
import { MEDIA_BACKUP_VERIFICATION, MEDIA_CLASSIFICATION } from "@waitron/media";
import { validateBackupVerificationContribution } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";

describe("catalogue and media verification registration", () => {
  it.each([
    ["catalogue", CATALOGUE_BACKUP_VERIFICATION],
    ["media", MEDIA_BACKUP_VERIFICATION],
  ] as const)("registers %s independently of the enabled-module list", (name, expected) => {
    const descriptor = ALL_MODULES.find((module) => module.name === name)!;
    expect(descriptor.backup?.verification).toBe(expected);
    const owner = validateBackupVerificationContribution(descriptor.backup?.verification);
    expect(owner.data.kind).toBe("custom");
    expect(owner.data.tables).toEqual(descriptor.classification!.map((row) => row.table));
    expect([owner.secrets, owner.entries, owner.effects]).toEqual([[], [], []]);
  });
  it("keeps both original media classification imports equivalent", () => {
    expect(ALL_MODULES.find((module) => module.name === "media")!.classification).toBe(
      MEDIA_CLASSIFICATION,
    );
  });
});
