import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { MICROSOFT_RESERVED_TYPE, WAITRON_LAYOUTS, classifyDisk } from "./disk-state.mjs";

const EFI_TYPE = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
const XBOOTLDR_TYPE = "bc13c2ff-59e6-4262-a352-b275fd6f7172";
const BASIC_DATA_TYPE = "ebd0a0a2-b9e5-4433-87c0-68b6b72699c7";
const WINDOWS_RECOVERY_TYPE = "de94bba4-06d1-4d40-a16a-bfd50179d6ac";
const FOREIGN_LUKS_TYPE = "0fc63daf-8483-4772-8e79-3d69d8477de4";
const LUKS_UUID = "2f0e8c1a-5b7d-4e3f-9a6c-1d2b3c4d5e6f";
const OTHER_UUID = "7a1b2c3d-4e5f-4061-8172-93a4b5c6d7e8";
const LAYOUT = WAITRON_LAYOUTS[0];
const INTERNAL_ID = "nvme-Samsung_SSD_980_500GB_S64DNF0R123456A";
const SECOND_ID = "ata-WDC_WD10EZEX-08WN4A0_WD-WCC6Y1234567";
const EXTERNAL_ID = "usb-Samsung_PSSD_T7_S5TANS0R654321-0:0";
const STICK_ID = "usb-SanDisk_Ultra_4C531001234567-0:0";

const valid = (subsystem = LAYOUT.subsystem, uuid = LUKS_UUID) => ({
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
const waitronPartition = (signature = luks()) =>
  partition(signature, LAYOUT.typeGuid, LAYOUT.partitionName);

const disk = (overrides = {}) => ({
  diskId: INTERNAL_ID,
  attachment: "internal",
  table: "gpt",
  partitions: [],
  whole: plain("none"),
  nameTag: null,
  ...overrides,
});
const blankDisk = (overrides = {}) => disk({ table: "none", ...overrides });
const completeWaitronDisk = (overrides = {}) =>
  disk({ partitions: [efi(), boot(), waitronPartition()], ...overrides });
const waitronWith = (signature, overrides = {}) =>
  completeWaitronDisk({ partitions: [efi(), boot(), waitronPartition(signature)], ...overrides });
const windowsDisk = (overrides = {}) =>
  disk({
    partitions: [
      efi(),
      partition(plain("none"), MICROSOFT_RESERVED_TYPE, "Microsoft reserved partition"),
      partition(plain("ntfs"), BASIC_DATA_TYPE, "Basic data partition"),
      partition(plain("ntfs"), WINDOWS_RECOVERY_TYPE, ""),
    ],
    ...overrides,
  });
const machine = (disks, overrides = {}) => ({
  tpm: "enabled",
  secureBoot: "user-mode",
  disks,
  ...overrides,
});

const result = (overrides) => ({
  kind: "unknown",
  diskId: INTERNAL_ID,
  hardware: null,
  layoutVersion: null,
  recognised: null,
  ...overrides,
});
const unknown = result({});
const waitron = (layoutVersion = LAYOUT.version) => result({ kind: "waitron", layoutVersion });
const recognised = (recognised) => result({ kind: "recognised-other", recognised });
const multiple = result({ kind: "multiple", diskId: null });
const none = result({ kind: "none", diskId: null });

const classifyOne = (d) => classifyDisk(machine([d]));
const invalid = expect.objectContaining({
  code: "disk.observation_invalid",
  reason: "observation-invalid",
});

describe("classifyDisk: recognised disks", () => {
  it("classifies a blank internal disk as recognised blank", () => {
    expect(classifyOne(blankDisk())).toEqual({
      kind: "recognised-other",
      diskId: INTERNAL_ID,
      hardware: null,
      layoutVersion: null,
      recognised: "blank",
    });
  });

  it("classifies a Windows disk as recognised windows", () => {
    expect(classifyOne(windowsDisk())).toEqual(recognised("windows"));
  });

  it("classifies a Windows disk with one BitLocker partition as recognised bitlocker", () => {
    const d = windowsDisk();
    d.partitions[2] = partition(plain("bitlocker"), BASIC_DATA_TYPE, "Basic data partition");
    expect(classifyOne(d)).toEqual(recognised("bitlocker"));
  });

  it("classifies an MBR disk with ntfs as recognised windows", () => {
    const d = disk({ table: "mbr", partitions: [partition(plain("ntfs"), null)] });
    expect(classifyOne(d)).toEqual(recognised("windows"));
  });

  it("classifies a Windows disk plus one other partition as unknown", () => {
    const d = windowsDisk();
    d.partitions.push(partition(plain("other"), FOREIGN_LUKS_TYPE, "linux"));
    expect(classifyOne(d)).toEqual(unknown);
  });

  it("classifies a none partition whose type is not Microsoft reserved as unknown", () => {
    const d = windowsDisk();
    d.partitions[1] = partition(plain("none"), BASIC_DATA_TYPE, "Microsoft reserved partition");
    expect(classifyOne(d)).toEqual(unknown);
  });

  it("classifies a vfat-only disk as unknown", () => {
    expect(classifyOne(disk({ partitions: [efi()] }))).toEqual(unknown);
  });

  it("classifies a gpt table with zero partitions as unknown", () => {
    expect(classifyOne(disk({ table: "gpt", partitions: [] }))).toEqual(unknown);
  });

  it("classifies a disk with no table but a whole-disk filesystem as unknown", () => {
    expect(classifyOne(blankDisk({ whole: plain("other") }))).toEqual(unknown);
  });
});

describe("classifyDisk: Waitron disks", () => {
  it.each(WAITRON_LAYOUTS)(
    "classifies a complete layout $version disk as waitron (only version 1 exists; no earlier layout was ever written)",
    (layout) => {
      const d = disk({
        partitions: [
          efi(),
          boot(),
          partition(
            luks(valid(layout.subsystem), valid(layout.subsystem)),
            layout.typeGuid,
            layout.partitionName,
          ),
        ],
      });
      expect(classifyOne(d)).toEqual(waitron(layout.version));
    },
  );

  it("classifies primary damaged, secondary valid as waitron", () => {
    expect(classifyOne(waitronWith(luks(damaged(), valid())))).toEqual(waitron());
  });

  it("classifies primary valid, secondary damaged as waitron", () => {
    expect(classifyOne(waitronWith(luks(valid(), damaged())))).toEqual(waitron());
  });

  it("classifies primary valid, secondary absent as waitron", () => {
    expect(classifyOne(waitronWith(luks(valid(), absent())))).toEqual(waitron());
  });
});

describe("classifyDisk: a disk that is partly Waitron's", () => {
  it("classifies both headers damaged as unknown", () => {
    expect(classifyOne(waitronWith(luks(damaged(), damaged())))).toEqual(unknown);
  });

  it("classifies a Waitron typeGuid with a foreign subsystem as unknown", () => {
    expect(classifyOne(waitronWith(luks(valid("other"), valid("other"))))).toEqual(unknown);
  });

  it("classifies a Waitron subsystem on a non-Waitron typeGuid as unknown", () => {
    const d = disk({
      partitions: [efi(), boot(), partition(luks(), FOREIGN_LUKS_TYPE, "data")],
    });
    expect(classifyOne(d)).toEqual(unknown);
  });

  it("classifies a Waitron typeGuid with content none as unknown", () => {
    expect(classifyOne(waitronWith(plain("none")))).toEqual(unknown);
  });

  it("classifies a Waitron typeGuid and valid Waitron headers but partition name data as unknown", () => {
    const d = disk({ partitions: [efi(), boot(), partition(luks(), LAYOUT.typeGuid, "data")] });
    expect(classifyOne(d)).toEqual(unknown);
  });

  it("classifies a Windows disk with one ntfs partition renamed waitron-box as unknown", () => {
    const d = windowsDisk();
    d.partitions[2] = partition(plain("ntfs"), BASIC_DATA_TYPE, LAYOUT.partitionName);
    expect(classifyOne(d)).toEqual(unknown);
  });

  it("classifies both headers valid with the SAME uuid but different subsystems as unknown", () => {
    expect(classifyOne(waitronWith(luks(valid(), valid("other"))))).toEqual(unknown);
  });

  it("classifies both headers valid Waitron with different uuids as unknown", () => {
    expect(
      classifyOne(waitronWith(luks(valid(LAYOUT.subsystem), valid(LAYOUT.subsystem, OTHER_UUID)))),
    ).toEqual(unknown);
  });

  it("classifies a complete Waitron disk plus a second Waitron-typed partition as unknown", () => {
    const d = completeWaitronDisk();
    d.partitions.push(partition(plain("none"), LAYOUT.typeGuid, ""));
    expect(classifyOne(d)).toEqual(unknown);
  });

  it("classifies a complete Waitron disk plus one unreadable partition as unknown", () => {
    const d = completeWaitronDisk();
    d.partitions.push(partition(plain("unreadable"), BASIC_DATA_TYPE, ""));
    expect(classifyOne(d)).toEqual(unknown);
  });

  it("classifies a complete Waitron disk with a Waitron whole-disk header as unknown", () => {
    expect(classifyOne(completeWaitronDisk({ whole: luks() }))).toEqual(unknown);
  });

  it("classifies whole-disk LUKS2 with the Waitron subsystem and no table as unknown", () => {
    expect(classifyOne(blankDisk({ whole: luks() }))).toEqual(unknown);
  });
});

describe("classifyDisk: foreign and unreadable disks", () => {
  it("classifies a foreign LUKS2 partition as unknown", () => {
    const d = disk({
      partitions: [efi(), partition(luks(valid(""), valid("")), FOREIGN_LUKS_TYPE, "root")],
    });
    expect(classifyOne(d)).toEqual(unknown);
  });

  it("classifies whole-disk foreign LUKS2 as unknown", () => {
    expect(classifyOne(blankDisk({ whole: luks(valid(""), valid("")) }))).toEqual(unknown);
  });

  it("classifies an unreadable table as unknown", () => {
    expect(classifyOne(disk({ table: "unreadable" }))).toEqual(unknown);
  });

  it("classifies an unreadable whole-disk signature as unknown", () => {
    expect(classifyOne(blankDisk({ whole: plain("unreadable") }))).toEqual(unknown);
  });

  it("classifies ntfs plus one unreadable partition as unknown", () => {
    const d = disk({
      partitions: [
        partition(plain("ntfs"), BASIC_DATA_TYPE),
        partition(plain("unreadable"), BASIC_DATA_TYPE),
      ],
    });
    expect(classifyOne(d)).toEqual(unknown);
  });
});

describe("classifyDisk: which disks count", () => {
  it("classifies two internal Windows disks as multiple", () => {
    expect(classifyDisk(machine([windowsDisk(), windowsDisk({ diskId: SECOND_ID })]))).toEqual(
      multiple,
    );
  });

  it("classifies two internal complete Waitron disks as multiple", () => {
    expect(
      classifyDisk(machine([completeWaitronDisk(), completeWaitronDisk({ diskId: SECOND_ID })])),
    ).toEqual(multiple);
  });

  it("classifies one internal plus one unknown attachment as multiple", () => {
    expect(
      classifyDisk(
        machine([windowsDisk(), blankDisk({ diskId: SECOND_ID, attachment: "unknown" })]),
      ),
    ).toEqual(multiple);
  });

  it("ignores external disks and the installer stick (legitimate-case control)", () => {
    const observation = machine([
      completeWaitronDisk({ diskId: EXTERNAL_ID, attachment: "external" }),
      blankDisk({ diskId: STICK_ID, attachment: "installer" }),
      windowsDisk(),
    ]);
    expect(classifyDisk(observation)).toEqual(recognised("windows"));
  });

  it("classifies only external disks as none", () => {
    expect(classifyDisk(machine([windowsDisk({ attachment: "external" })]))).toEqual(none);
  });

  it("classifies a machine with no disks as none", () => {
    expect(classifyDisk(machine([]))).toEqual(none);
  });

  it("refuses two disks with the same diskId", () => {
    expect(() =>
      classifyDisk(machine([windowsDisk(), blankDisk({ attachment: "external" })])),
    ).toThrowError(invalid);
  });
});

describe("classifyDisk: hardware", () => {
  it.each(["disabled", "absent", "unknown"])("reports tpm %s as no-tpm", (tpm) => {
    expect(classifyDisk(machine([windowsDisk()], { tpm }))).toEqual({
      ...recognised("windows"),
      hardware: "no-tpm",
    });
  });

  it.each(["off", "setup-mode", "unknown"])("reports secureBoot %s as secure-boot-off", (sb) => {
    expect(classifyDisk(machine([windowsDisk()], { secureBoot: sb }))).toEqual({
      ...recognised("windows"),
      hardware: "secure-boot-off",
    });
  });

  it("reports no-tpm on a complete Waitron disk without changing the kind", () => {
    expect(classifyDisk(machine([completeWaitronDisk()], { tpm: "disabled" }))).toEqual({
      ...waitron(),
      hardware: "no-tpm",
    });
  });

  it("reports no-tpm when both checks fail", () => {
    expect(classifyDisk(machine([windowsDisk()], { tpm: "absent", secureBoot: "off" }))).toEqual({
      ...recognised("windows"),
      hardware: "no-tpm",
    });
  });

  it("reports hardware on multiple and none too", () => {
    expect(
      classifyDisk(machine([windowsDisk(), blankDisk({ diskId: SECOND_ID })], { tpm: "absent" })),
    ).toEqual({ ...multiple, hardware: "no-tpm" });
    expect(classifyDisk(machine([], { secureBoot: "off" }))).toEqual({
      ...none,
      hardware: "secure-boot-off",
    });
  });
});

describe("classifyDisk: the name tag never decides anything", () => {
  const longAccented = "Restaurant Àngels i Còpia de l'Església Vella del Carrer Major";
  const tags = [
    ["no tag", null],
    ["an accented name", Buffer.from("Bar Àngels")],
    ["an accented name over 48 bytes", Buffer.from(longAccented)],
    ["Waitron's subsystem text", Buffer.from(LAYOUT.subsystem)],
    ["a forged JSON marker", Buffer.from('{"live":true,"subsystem":"waitron-box-1"}')],
    ["4096 bytes of 0xff", new Uint8Array(4096).fill(0xff)],
  ];
  const disks = [
    ["blank", blankDisk],
    ["windows", windowsDisk],
    ["complete Waitron", completeWaitronDisk],
    ["damaged Waitron", (o) => waitronWith(luks(damaged(), damaged()), o)],
  ];

  it("uses a long accented tag over 48 UTF-8 bytes", () => {
    expect(Buffer.byteLength(longAccented)).toBeGreaterThan(48);
  });

  it.each(disks)("gives the same %s result for every tag", (_name, make) => {
    const expected = classifyOne(make());
    for (const [, nameTag] of tags) expect(classifyOne(make({ nameTag }))).toEqual(expected);
  });
});

describe("classifyDisk: disk ids", () => {
  it.each([
    INTERNAL_ID,
    "wwn-0x5002538e40a0b1c2",
    "usb-Ven#dor+Model=1@host\\x20Disk-0:0",
    "a".repeat(255),
  ])("accepts %s", (diskId) => {
    expect(classifyOne(blankDisk({ diskId }))).toEqual(
      result({ kind: "recognised-other", diskId, recognised: "blank" }),
    );
  });

  it.each(["../sda", "/dev/sda", ".", "..", "nvme-Samsungé_SSD", "a".repeat(256), "", 7])(
    "refuses %s",
    (diskId) => {
      expect(() => classifyOne(blankDisk({ diskId }))).toThrowError(invalid);
    },
  );
});

describe("classifyDisk: malformed observations", () => {
  const cases = [
    ["a null observation", () => null],
    ["an array observation", () => []],
    ["an extra machine key", () => ({ ...machine([blankDisk()]), extra: 1 })],
    [
      "a missing machine key",
      () => {
        const m = machine([blankDisk()]);
        delete m.secureBoot;
        return m;
      },
    ],
    ["an unknown tpm value", () => machine([blankDisk()], { tpm: "on" })],
    ["an unknown secureBoot value", () => machine([blankDisk()], { secureBoot: "on" })],
    ["disks that are not an array", () => machine("disks")],
    ["a disk that is not an object", () => machine([null])],
    ["an extra disk key", () => machine([{ ...blankDisk(), extra: 1 }])],
    ["an unknown attachment", () => machine([blankDisk({ attachment: "usb" })])],
    ["an unknown table", () => machine([blankDisk({ table: "apm" })])],
    ["partitions that are not an array", () => machine([disk({ partitions: {} })])],
    ["partitions when table is none", () => machine([blankDisk({ partitions: [efi()] })])],
    [
      "partitions when table is unreadable",
      () => machine([disk({ table: "unreadable", partitions: [efi()] })]),
    ],
    ["a nameTag string", () => machine([blankDisk({ nameTag: "Bar" })])],
    ["a nameTag Buffer-like array", () => machine([blankDisk({ nameTag: [1, 2] })])],
    ["a whole that is not an object", () => machine([blankDisk({ whole: "none" })])],
    ["an extra whole key", () => machine([blankDisk({ whole: { ...plain("none"), x: 1 } })])],
    ["an unknown content kind", () => machine([blankDisk({ whole: plain("ext4") })])],
    [
      "luks on non-luks2 content",
      () => machine([blankDisk({ whole: { ...luks(), content: "ntfs" } })]),
    ],
    ["luks2 content without luks", () => machine([blankDisk({ whole: plain("luks2") })])],
    [
      "luks with one header",
      () => machine([blankDisk({ whole: { content: "luks2", luks: [valid()] } })]),
    ],
    [
      "luks that is not an array",
      () => machine([blankDisk({ whole: { content: "luks2", luks: { 0: valid(), 1: valid() } } })]),
    ],
    ["a header that is not an object", () => machine([blankDisk({ whole: luks(null, valid()) })])],
    [
      "an extra header key",
      () => machine([blankDisk({ whole: luks({ ...valid(), extra: 1 }, valid()) })]),
    ],
    [
      "an unknown header state",
      () => machine([blankDisk({ whole: luks({ ...damaged(), state: "torn" }, valid()) })]),
    ],
    [
      "a valid header with a null subsystem",
      () => machine([blankDisk({ whole: luks({ ...valid(), subsystem: null }, valid()) })]),
    ],
    [
      "a valid header with an uppercase uuid",
      () => machine([blankDisk({ whole: luks(valid(LAYOUT.subsystem, LUKS_UUID.toUpperCase())) })]),
    ],
    [
      "a valid header with a uuid without dashes",
      () =>
        machine([
          blankDisk({ whole: luks(valid(LAYOUT.subsystem, LUKS_UUID.replaceAll("-", ""))) }),
        ]),
    ],
    [
      "a damaged header with a uuid",
      () => machine([blankDisk({ whole: luks({ ...damaged(), uuid: LUKS_UUID }, valid()) })]),
    ],
    [
      "an absent header with a subsystem",
      () => machine([blankDisk({ whole: luks(valid(), { ...absent(), subsystem: "x" }) })]),
    ],
    [
      "a partition missing its name",
      () => {
        const p = efi();
        delete p.name;
        return machine([disk({ partitions: [p] })]);
      },
    ],
    [
      "a partition name that is not a string",
      () => machine([disk({ partitions: [partition(plain("ntfs"), BASIC_DATA_TYPE, 3)] })]),
    ],
    ["an extra partition key", () => machine([disk({ partitions: [{ ...efi(), extra: 1 }] })])],
    [
      "an uppercase partition typeGuid",
      () =>
        machine([disk({ partitions: [partition(plain("ntfs"), BASIC_DATA_TYPE.toUpperCase())] })]),
    ],
    [
      "a typeGuid array that reads as a canonical GUID",
      () => machine([disk({ partitions: [partition(plain("ntfs"), [BASIC_DATA_TYPE])] })]),
    ],
    [
      "a header uuid array that reads as a canonical uuid",
      () => machine([blankDisk({ whole: luks(valid(LAYOUT.subsystem, [LUKS_UUID])) })]),
    ],
    [
      "a null typeGuid on gpt",
      () => machine([disk({ partitions: [partition(plain("ntfs"), null)] })]),
    ],
    [
      "a typeGuid on mbr",
      () =>
        machine([disk({ table: "mbr", partitions: [partition(plain("ntfs"), BASIC_DATA_TYPE)] })]),
    ],
    [
      "a partition with luks on ntfs content",
      () =>
        machine([
          disk({
            partitions: [partition({ content: "ntfs", luks: luks().luks }, BASIC_DATA_TYPE)],
          }),
        ]),
    ],
  ];

  it.each(cases)("refuses %s", (_name, make) => {
    expect(() => classifyDisk(make())).toThrowError(invalid);
  });

  it("returns a frozen classification", () => {
    expect(Object.isFrozen(classifyOne(windowsDisk()))).toBe(true);
  });
});
