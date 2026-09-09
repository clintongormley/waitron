import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OPTIONAL_BACKUP_STATE, collectOptionalStateFiles } from "./backup-optional-state.js";

describe("collectOptionalStateFiles", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "opt-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("collects present optional files and skips absent ones", async () => {
    await writeFile(join(dir, "backup.env"), "WAITRON_BACKUP_DIR=/mnt/usb\n");
    const out = await collectOptionalStateFiles(dir, ["backup.env", "modules.json"]);
    expect(out).toEqual({ "backup.env": "WAITRON_BACKUP_DIR=/mnt/usb\n" }); // modules.json absent → skipped
  });

  it("collects both when both are present", async () => {
    await writeFile(join(dir, "backup.env"), "WAITRON_BACKUP_DIR=/mnt/usb\n");
    await writeFile(join(dir, "modules.json"), '{"modules":{"fiscal-none":false}}\n');
    const out = await collectOptionalStateFiles(dir, OPTIONAL_BACKUP_STATE);
    expect(out).toEqual({
      "backup.env": "WAITRON_BACKUP_DIR=/mnt/usb\n",
      "modules.json": '{"modules":{"fiscal-none":false}}\n',
    });
  });

  it("returns an empty map when every optional file is absent (backups off, all-modules-default)", async () => {
    const out = await collectOptionalStateFiles(dir, OPTIONAL_BACKUP_STATE);
    expect(out).toEqual({});
  });

  it("rethrows a non-ENOENT read error (a directory in the file's place → EISDIR)", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "backup.env")); // a dir where a file is expected → EISDIR, not ENOENT
    await expect(collectOptionalStateFiles(dir, ["backup.env"])).rejects.toMatchObject({
      code: "EISDIR",
    });
  });
});
