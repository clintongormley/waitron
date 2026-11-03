import { describe, expect, it } from "vitest";
import { WAITRON_LAYOUTS } from "./disk-state.mjs";
import { freezeUnlockTarget } from "./preboot.mjs";

const EFI_TYPE = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
const XBOOTLDR_TYPE = "bc13c2ff-59e6-4262-a352-b275fd6f7172";
const BASIC_DATA_TYPE = "ebd0a0a2-b9e5-4433-87c0-68b6b72699c7";
const FOREIGN_LUKS_TYPE = "0fc63daf-8483-4772-8e79-3d69d8477de4";
const LUKS_UUID = "2f0e8c1a-5b7d-4e3f-9a6c-1d2b3c4d5e6f";
const OTHER_UUID = "7a1b2c3d-4e5f-4061-8172-93a4b5c6d7e8";
const LAYOUT = WAITRON_LAYOUTS[0];
const INTERNAL_ID = "nvme-Samsung_SSD_980_500GB_S64DNF0R123456A";
const SECOND_ID = "ata-WDC_WD10EZEX-08WN4A0_WD-WCC6Y1234567";
const EXTERNAL_ID = "usb-Samsung_PSSD_T7_S5TANS0R654321-0:0";
const STICK_ID = "usb-SanDisk_Ultra_4C531001234567-0:0";

const valid = (uuid = LUKS_UUID, subsystem = LAYOUT.subsystem) => ({
  state: "valid",
  subsystem,
  uuid,
});
const damaged = () => ({ state: "damaged", subsystem: null, uuid: null });
const absent = () => ({ state: "absent", subsystem: null, uuid: null });
const plain = (content) => ({ content, luks: null });
const luks = (primary = valid(), secondary = valid()) => ({
  content: "luks2",
  luks: [primary, secondary],
});
const partition = (signature, typeGuid, name = "") => ({ ...signature, typeGuid, name });
const efi = () => partition(plain("vfat"), EFI_TYPE, "EFI System Partition");
const boot = () => partition(plain("other"), XBOOTLDR_TYPE, "boot");
const waitronPartition = (signature) => partition(signature, LAYOUT.typeGuid, LAYOUT.partitionName);

const waitronDisk = ({
  diskId = INTERNAL_ID,
  uuid = LUKS_UUID,
  attachment = "internal",
  signature = luks(valid(uuid), valid(uuid)),
  extra = [],
} = {}) => ({
  diskId,
  attachment,
  table: "gpt",
  partitions: [efi(), boot(), waitronPartition(signature), ...extra],
  whole: plain("none"),
  nameTag: null,
});
const windowsDisk = () => ({
  diskId: INTERNAL_ID,
  attachment: "internal",
  table: "gpt",
  partitions: [efi(), partition(plain("ntfs"), BASIC_DATA_TYPE, "Basic data partition")],
  whole: plain("none"),
  nameTag: null,
});
const machine = (disks, { tpm = "enabled", secureBoot = "user-mode" } = {}) => ({
  tpm,
  secureBoot,
  disks,
});
const observation = (overrides = {}) => ({
  expectedDiskUuid: LUKS_UUID,
  firstStart: "complete",
  machine: machine([waitronDisk()]),
  ...overrides,
});

const ready = {
  kind: "ready",
  handle: { diskId: INTERNAL_ID, diskUuid: LUKS_UUID, layoutVersion: 1 },
};
const refused = (reason) => ({ kind: "refused", reason });

describe("freezeUnlockTarget", () => {
  it("answers ready with a frozen handle for one internal Waitron disk with the expected UUID", () => {
    const result = freezeUnlockTarget(observation());
    expect(result).toEqual(ready);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.handle)).toBe(true);
  });

  it("answers ready when the primary header is damaged and the secondary valid", () => {
    const disk = waitronDisk({ signature: luks(damaged(), valid()) });
    expect(freezeUnlockTarget(observation({ machine: machine([disk]) }))).toEqual(ready);
  });

  it("answers ready when the primary header is valid and the secondary absent", () => {
    const disk = waitronDisk({ signature: luks(valid(), absent()) });
    expect(freezeUnlockTarget(observation({ machine: machine([disk]) }))).toEqual(ready);
  });

  it("answers ready with the TPM disabled and Secure Boot off", () => {
    const m = machine([waitronDisk()], { tpm: "disabled", secureBoot: "off" });
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(ready);
  });

  it("keeps the handle unchanged when the observation changes after freezing", () => {
    const input = observation();
    const result = freezeUnlockTarget(input);
    input.machine.disks[0].diskId = SECOND_ID;
    input.machine.disks[0].partitions[2].luks[0].uuid = OTHER_UUID;
    input.expectedDiskUuid = OTHER_UUID;
    expect(result).toEqual(ready);
  });
});

describe("freezeUnlockTarget refusals", () => {
  it("answers disk-mismatch when the Waitron disk's UUID differs from the expected one", () => {
    const m = machine([waitronDisk({ uuid: OTHER_UUID })]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-mismatch"));
  });

  it("answers disk-duplicate when an external disk carries the expected UUID too", () => {
    const m = machine([
      waitronDisk(),
      waitronDisk({ diskId: EXTERNAL_ID, attachment: "external" }),
    ]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-duplicate"));
  });

  it("answers disk-duplicate when the installer stick carries the expected UUID", () => {
    const stick = {
      diskId: STICK_ID,
      attachment: "installer",
      table: "none",
      partitions: [],
      whole: luks(damaged(), valid()),
      nameTag: null,
    };
    const m = machine([waitronDisk(), stick]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-duplicate"));
  });

  it("answers disk-duplicate when a foreign LUKS2 partition on the same disk carries the expected UUID", () => {
    const foreign = partition(
      luks(valid(LUKS_UUID, "other"), valid(LUKS_UUID, "other")),
      FOREIGN_LUKS_TYPE,
      "data",
    );
    const m = machine([waitronDisk({ extra: [foreign] })]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-duplicate"));
  });

  it("answers disk-not-waitron when only an external disk carries the UUID and the internal one is Windows", () => {
    const m = machine([
      windowsDisk(),
      waitronDisk({ diskId: EXTERNAL_ID, attachment: "external" }),
    ]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-not-waitron"));
  });

  it("answers disk-not-waitron when both headers are damaged", () => {
    const m = machine([waitronDisk({ signature: luks(damaged(), damaged()) })]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-not-waitron"));
  });

  it("answers disk-multiple for two internal Waitron disks", () => {
    const m = machine([waitronDisk(), waitronDisk({ diskId: SECOND_ID, uuid: OTHER_UUID })]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-multiple"));
  });

  it("answers disk-missing with no internal disk", () => {
    const m = machine([waitronDisk({ diskId: EXTERNAL_ID, attachment: "external" })]);
    expect(freezeUnlockTarget(observation({ machine: m }))).toEqual(refused("disk-missing"));
  });

  it.each(["pending", "unknown"])(
    "answers first-start-pending when firstStart is %s",
    (firstStart) => {
      expect(freezeUnlockTarget(observation({ firstStart }))).toEqual(
        refused("first-start-pending"),
      );
    },
  );
});

describe("freezeUnlockTarget bad shapes", () => {
  const withoutFirstStart = observation();
  delete withoutFirstStart.firstStart;
  const throwing = observation();
  Object.defineProperty(throwing, "firstStart", {
    enumerable: true,
    get() {
      throw new Error("boom");
    },
  });
  const badDisk = { ...waitronDisk(), diskId: "../sda" };
  it.each([
    ["null", null],
    ["an extra key", { ...observation(), extra: 1 }],
    ["a missing firstStart", withoutFirstStart],
    ["firstStart done", observation({ firstStart: "done" })],
    ["an upper-case expectedDiskUuid", observation({ expectedDiskUuid: LUKS_UUID.toUpperCase() })],
    ["a machine classifyDisk refuses", observation({ machine: machine([badDisk]) })],
    ["a function", observation({ machine: () => {} })],
    ["a getter that throws", throwing],
  ])("answers observation-invalid for %s", (_name, input) => {
    expect(freezeUnlockTarget(input)).toEqual(refused("observation-invalid"));
  });

  it("follows one read of a getter that changes its answer", () => {
    let reads = 0;
    const input = observation();
    Object.defineProperty(input, "firstStart", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? "complete" : "pending";
      },
    });
    expect(freezeUnlockTarget(input)).toEqual(ready);
    expect(reads).toBe(1);
  });
});
