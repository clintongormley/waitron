import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, lstatSync, realpathSync, readdirSync, rmSync } from "node:fs";
import * as fs from "node:fs/promises";
import { createDiskRecoveryStore } from "./disk-key.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  diskStartupAction,
  inspectEncryptedHostState,
  runDiskCommand,
  readDiskOpening,
  startDisk,
} from "./disk-start.mjs";

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

it("passes secret bytes only through the inherited descriptor and erases them afterwards", async () => {
  const secret = Uint8Array.from([1, 2, 3, 4]);
  const result = await runDiskCommand(
    process.execPath,
    [
      "-e",
      'const fs=require("node:fs");process.stdout.write(require("node:crypto").createHash("sha256").update(fs.readFileSync(3)).digest("hex"));process.exit((fs.fstatSync(3).mode & 0o777) === 0o600 && fs.fstatSync(4).isFile() && fs.fstatSync(4).size === 0 ? 0 : 2)',
    ],
    secret,
    { runRoot: hostRoot, statfs: async () => ({ type: 0x01021994 }) },
  );
  expect(result).toEqual({
    status: 0,
    stdout: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
  });
  expect([...secret]).toEqual([0, 0, 0, 0]);
  expect(readdirSync(hostRoot).filter((name) => name.startsWith("waitron-disk-key-"))).toEqual([]);
});

it("refuses secret staging outside tmpfs", async () => {
  await expect(
    runDiskCommand(process.execPath, ["-e", "process.exit(0)"], Uint8Array.of(1), {
      runRoot: hostRoot,
      statfs: async () => ({ type: 0 }),
    }),
  ).rejects.toMatchObject({ code: "disk_start.refused" });
});

async function startupFixture({ chip = false, empty = true, record = chip } = {}) {
  const root = mkdtempSync(join(hostRoot, "startup-"));
  const stat = lstatSync(root, { bigint: true });
  const inspect = async () => ({
    hostRoot: root,
    diskUuid: DISK_UUID,
    rootId: `${stat.dev}:${stat.ino}`,
  });
  const store = createDiskRecoveryStore({
    hostRoot: root,
    ownerUid: process.getuid(),
    inspectHostState: inspect,
  });
  if (record)
    await store.store({ diskUuid: DISK_UUID, key: Uint8Array.from({ length: 32 }, () => 1) });
  const metadata = { keyslots: empty ? { 0: {} } : {}, tokens: {} };
  if (chip) {
    metadata.keyslots[1] = {};
    metadata.keyslots[2] = {};
    metadata.tokens[0] = { type: "systemd-tpm2", keyslots: ["2"], "tpm2-pcrs": [5, 7, 8, 9, 15] };
  }
  const writes = [];
  let recordBeforeAdd = false,
    enrollmentArgs,
    restartArgs;
  const command = async (name, args, secret) => {
    if (args[0] === "luksDump") return { status: 0, stdout: JSON.stringify(metadata) };
    if (args.includes("--test-passphrase"))
      return { status: secret.length === 0 && !empty ? 2 : 0, stdout: "" };
    if (args[0] === "luksAddKey") {
      recordBeforeAdd = await fs.access(join(root, "disk-recovery", `${DISK_UUID}.json`)).then(
        () => true,
        () => false,
      );
      writes.push("add-key");
      metadata.keyslots[1] = {};
    } else if (name === "systemd-cryptenroll" && args.includes("--wipe-slot=empty")) {
      writes.push("remove-empty");
      empty = false;
      delete metadata.keyslots[0];
    } else if (name === "systemd-cryptenroll") {
      writes.push("enroll");
      enrollmentArgs = args;
      metadata.keyslots[2] = {};
      metadata.tokens[0] = { type: "systemd-tpm2", keyslots: ["2"], "tpm2-pcrs": [5, 7, 8, 9, 15] };
    } else if (name === "systemctl") {
      restartArgs = args;
      writes.push("restart");
    } else throw new Error("unexpected command");
    return { status: 0, stdout: "" };
  };
  return {
    writes,
    store,
    facts: () => ({ recordBeforeAdd, enrollmentArgs, restartArgs }),
    deps: {
      hostRoot: root,
      ownerUid: process.getuid(),
      inspect,
      command,
      openedBy: async () => (chip ? "chip" : "bootstrap"),
    },
  };
}

it("retains the key before enrollment and asks the box to restart without removing the empty slot", async () => {
  const f = await startupFixture();
  expect(await startDisk(f.deps)).toMatchObject({ action: "restart" });
  expect(f.writes).toEqual(["add-key", "enroll", "restart"]);
  expect(f.facts().restartArgs).toEqual([
    "start",
    "reboot.target",
    "--job-mode=replace-irreversibly",
    "--no-block",
  ]);
  expect(f.facts().recordBeforeAdd).toBe(true);
  expect(f.facts().enrollmentArgs).toContain(
    "--tpm2-pcrs=5+7+8+9+15:sha256=0000000000000000000000000000000000000000000000000000000000000000",
  );
});
it("removes the empty slot after chip opening, while the later gate only reads", async () => {
  const f = await startupFixture({ chip: true });
  expect(await startDisk(f.deps)).toMatchObject({ action: "ready", emptyPassword: false });
  expect(f.writes).toEqual(["remove-empty"]);
  expect(await startDisk({ ...f.deps, checkOnly: true })).toMatchObject({
    action: "ready",
    emptyPassword: false,
  });
  expect(f.writes).toEqual(["remove-empty"]);
});
it("the read-only gate refuses bootstrap without enrolling or removing slots", async () => {
  const f = await startupFixture();
  await expect(startDisk({ ...f.deps, checkOnly: true })).rejects.toMatchObject({
    code: "disk_start.refused",
  });
  expect(f.writes).toEqual([]);
});
it("keeps the empty slot when the retained-key record cannot be read", async () => {
  const f = await startupFixture({ chip: true, record: false });
  await expect(startDisk(f.deps)).rejects.toMatchObject({ code: "disk_recovery.refused" });
  expect(f.writes).toEqual([]);
});

it.each(["chip", "bootstrap"])("reads the protected %s opening marker", async (openedBy) => {
  const path = join(hostRoot, `opening-${openedBy}`);
  await fs.writeFile(path, `${openedBy}\n`, { mode: 0o600 });
  expect(await readDiskOpening({ path, ownerUid: process.getuid() })).toBe(openedBy);
});
it.each(["public", "other-owner"])("refuses a %s opening marker", async (kind) => {
  const path = join(hostRoot, `opening-${kind}`);
  await fs.writeFile(path, "chip\n", { mode: kind === "public" ? 0o644 : 0o600 });
  await expect(
    readDiskOpening({ path, ownerUid: process.getuid() + (kind === "other-owner" ? 1 : 0) }),
  ).rejects.toMatchObject({ code: "disk_start.refused" });
});
