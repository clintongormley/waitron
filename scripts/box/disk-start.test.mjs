import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diskStartupAction, inspectEncryptedHostState } from "./disk-start.mjs";

describe("the installed disk's startup decision", () => {
  it.each([
    [{ keySlots: 1, tpmSlots: 0, emptyPassword: true, openedBy: "bootstrap" }, "enroll"],
    [{ keySlots: 3, tpmSlots: 1, emptyPassword: true, openedBy: "chip" }, "remove-empty"],
    [{ keySlots: 2, tpmSlots: 1, emptyPassword: false, openedBy: "chip" }, "ready"],
  ])("continues an accepted disk state %j", (state, action) => {
    expect(diskStartupAction(state)).toBe(action);
  });

  it.each([
    { keySlots: 2, tpmSlots: 0, emptyPassword: true, openedBy: "bootstrap" },
    { keySlots: 3, tpmSlots: 1, emptyPassword: true, openedBy: "bootstrap" },
    { keySlots: 2, tpmSlots: 1, emptyPassword: false, openedBy: null },
  ])("refuses an interrupted enrollment or a missing chip opening %j", (state) => {
    expect(() => diskStartupAction(state)).toThrowError(
      expect.objectContaining({ code: "disk_start.refused" }),
    );
  });
});

const hostRoot = realpathSync(mkdtempSync(join(tmpdir(), "b3-host-mount-")));
afterAll(() => rmSync(hostRoot, { recursive: true, force: true }));
const DISK_UUID = "11111111-1111-4111-8111-111111111111";
const ROOT_UUID = "22222222-2222-4222-8222-222222222222";

it.each(["bound", "other-mount", "other-disk", "host-not-mounted", "other-root"])(
  "checks the encrypted host-state binding: %s",
  async (caseName) => {
    const mounts = {
      "/": {
        target: "/",
        source: "/dev/mapper/waitron-data[/@rootfs]",
        fstype: "btrfs",
        fsroot: "/@rootfs",
        uuid: caseName === "other-root" ? DISK_UUID : ROOT_UUID,
      },
      [hostRoot]: {
        target: caseName === "host-not-mounted" ? "/" : hostRoot,
        source:
          caseName === "other-mount"
            ? "/dev/mapper/foreign[/@host-state]"
            : "/dev/mapper/waitron-data[/@host-state]",
        fstype: "btrfs",
        fsroot: "/@host-state",
        uuid: ROOT_UUID,
      },
    };
    const run = async (command, args) => {
      if (command === "findmnt") return JSON.stringify({ filesystems: [mounts[args.at(-1)]] });
      if (
        command === "cryptsetup" &&
        args[0] === "status" &&
        args[1] === "/dev/mapper/waitron-data"
      )
        return "  device: /dev/vda3\n";
      if (command === "cryptsetup" && args[0] === "luksUUID" && args[1] === "/dev/vda3")
        return caseName === "other-disk" ? ROOT_UUID : DISK_UUID;
      throw new Error("unexpected command");
    };
    const inspect = () =>
      inspectEncryptedHostState({
        hostRoot,
        run,
        readFile: async (path) => (path.endsWith("-luks") ? DISK_UUID : ROOT_UUID),
      });
    if (caseName !== "bound") {
      await expect(inspect()).rejects.toMatchObject({ code: "disk_start.refused" });
    } else {
      const stat = lstatSync(hostRoot, { bigint: true });
      await expect(inspect()).resolves.toEqual({
        hostRoot,
        diskUuid: DISK_UUID,
        rootId: `${stat.dev}:${stat.ino}`,
      });
    }
  },
);
