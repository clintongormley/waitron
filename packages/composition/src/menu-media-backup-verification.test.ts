import { describe, expect, it } from "vitest";
import { CATALOGUE_BACKUP_VERIFICATION, CATALOGUE_TABLES } from "@waitron/menu";
import { MEDIA_BACKUP_VERIFICATION, MEDIA_TABLES } from "@waitron/media";
import { validateBackupVerificationContribution } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";

describe("catalogue and media verification registration", () => {
  it.each([
    ["catalogue", CATALOGUE_BACKUP_VERIFICATION, CATALOGUE_TABLES],
    ["media", MEDIA_BACKUP_VERIFICATION, MEDIA_TABLES],
  ] as const)("registers %s independently of the enabled-module list", (name, expected, tables) => {
    const descriptor = ALL_MODULES.find((module) => module.name === name)!;
    expect(descriptor.backup?.verification).toBe(expected);
    const owner = validateBackupVerificationContribution(descriptor.backup?.verification);
    expect(owner.data.kind).toBe("custom");
    expect(owner.data.tables).toEqual([...tables]);
    expect([owner.secrets, owner.entries, owner.effects]).toEqual([[], [], []]);
  });
  it("keeps media's tables in core's set, which classifies them", () => {
    const media = ALL_MODULES.find((module) => module.name === "media")!;
    expect(media.tablesIn).toBe("core");
    expect(media.classification).toBeUndefined();
    const core = ALL_MODULES.find((module) => module.name === "core")!;
    expect(
      core.classification!.map((row) => row.table).filter((t) => MEDIA_TABLES.includes(t as never)),
    ).toEqual([...MEDIA_TABLES]);
  });
});
