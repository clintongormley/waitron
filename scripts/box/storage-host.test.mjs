import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleStorageRequest, storageCommand } from "./storage-host.mjs";

const OPTIONS = "ro,nosuid,nodev,noexec,noatime,nosymfollow,fmask=0133,dmask=0022";
const PERSON = '{"source":"person","person":"p1"}';
const SERVER = '{"source":"server"}';
const LIST = `storage.list {"actor":${SERVER}}`;
const RELEASE = `storage.release {"actor":${SERVER}}`;

/** @type {string} */
let scratch;
/** @type {string} */
let root;
/** @type {string} */
let stateDir;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "storage-host-"));
  root = join(scratch, "drives");
  stateDir = join(scratch, "state");
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * @param {string} kname @param {Record<string, unknown>} [extra]
 * @returns {Record<string, any>}
 */
const node = (kname, extra = {}) => ({
  kname,
  type: "part",
  tran: null,
  fstype: null,
  uuid: null,
  "maj:min": "8:1",
  mountpoints: [],
  ...extra,
});
/** @param {string} kname @param {string} tran @param {Record<string, any>[]} [children] */
const disk = (kname, tran, children, extra = {}) =>
  node(kname, { type: "disk", tran, ...(children ? { children } : {}), ...extra });
/** @param {string} kname @param {string} fstype @param {string} uuid @param {string} [device] */
const part = (kname, fstype, uuid, device = "8:17") =>
  node(kname, { fstype, uuid, "maj:min": device });

const BOX_DISK = disk("sda", "sata", [
  part("sda1", "vfat", "AAAA-0001", "8:1"),
  node("sda2", {
    fstype: "crypto_LUKS",
    children: [node("dm-0", { type: "crypt", fstype: "ext4", mountpoints: ["/"] })],
  }),
]);

const LSBLK = [
  "--json",
  "--list",
  "--output",
  "KNAME,PKNAME,TYPE,TRAN,FSTYPE,UUID,MAJ:MIN,MOUNTPOINTS",
];

/**
 * Fixtures are written as trees; lsblk's `--list` prints them flat, each row naming its parent and
 * carrying its disk's transport unless the fixture sets its own.
 * @param {Record<string, any>[]} entries @returns {Record<string, any>[]}
 */
const listRows = (entries, pkname = null, tran = null) =>
  entries.flatMap(({ children, ...entry }) => {
    const row = { ...entry, pkname, tran: entry.tran ?? tran };
    return [row, ...listRows(children ?? [], row.kname, row.tran)];
  });

/**
 * A stand-in host: lsblk answers `disks`, findmnt answers what is mounted, and mount and umount
 * change that.
 * @param {{ disks: Record<string, any>[], mounts?: { target: string, device: string }[],
 *   busy?: string[], events?: unknown[] }} host
 */
const fakeHost = (host) => {
  const events = host.events ?? [];
  const mounts = host.mounts ?? [];
  const run = vi.fn((command, args, limit) => {
    events.push(["run", command, ...args]);
    if (command === "lsblk") {
      expect(args).toEqual(LSBLK);
      return JSON.stringify({ blockdevices: host.rows ?? listRows(host.disks) });
    }
    if (command === "findmnt") {
      const filesystems = [
        { target: "/", "maj:min": "254:0" },
        ...mounts.map(({ target, device }) => ({ target, "maj:min": device })),
      ];
      return JSON.stringify({ filesystems });
    }
    if (command === "mount") {
      expect(limit).toBe(5000);
      const source = args.at(-2);
      const found = (host.rows ?? listRows(host.disks)).find(
        (entry) => `/dev/${entry.kname}` === source,
      );
      mounts.push({ target: args.at(-1), device: found["maj:min"] });
      return "";
    }
    if (command === "umount") {
      const target = args.at(-1);
      if (args[0] !== "-l" && host.busy?.includes(target)) throw new Error("target is busy");
      mounts.splice(
        mounts.findIndex((mount) => mount.target === target),
        1,
      );
      return "";
    }
    throw new Error(`unexpected ${command}`);
  });
  return Object.assign(host, { run, mounts, events });
};

/** @param {ReturnType<typeof fakeHost>} host */
const commands = (host, name) =>
  host.run.mock.calls.filter(([command]) => command === name).map(([, args]) => args);

/** @param {string} line @param {ReturnType<typeof fakeHost>} host */
const ask = async (line, host, log = () => {}) =>
  JSON.parse(await handleStorageRequest(line, { run: host.run, root, stateDir, log }));

/** The spare box's own disk, as `lsblk --list` printed it there (a1603-lsblk-spare.log). */
const SPARE_ROWS = [
  {
    kname: "nvme0n1",
    pkname: null,
    type: "disk",
    tran: "nvme",
    fstype: null,
    uuid: null,
    "maj:min": "259:0",
    mountpoints: [],
  },
  {
    kname: "nvme0n1p1",
    pkname: "nvme0n1",
    type: "part",
    tran: "nvme",
    fstype: "vfat",
    uuid: "D822-B452",
    "maj:min": "259:1",
    mountpoints: ["/boot/efi"],
  },
  {
    kname: "nvme0n1p2",
    pkname: "nvme0n1",
    type: "part",
    tran: "nvme",
    fstype: null,
    uuid: null,
    "maj:min": "259:2",
    mountpoints: [],
  },
  {
    kname: "nvme0n1p3",
    pkname: "nvme0n1",
    type: "part",
    tran: "nvme",
    fstype: "ntfs",
    uuid: "B0B435ACB4357646",
    "maj:min": "259:3",
    mountpoints: [],
  },
];
/** A stick in the same shape, as `--list` prints a USB disk and its partition. */
const STICK_ROWS = [
  { ...SPARE_ROWS[0], kname: "sda", tran: "usb", "maj:min": "8:0" },
  {
    ...SPARE_ROWS[3],
    kname: "sda1",
    pkname: "sda",
    tran: "usb",
    fstype: "exfat",
    uuid: "1234-ABCD",
    "maj:min": "8:1",
  },
];

describe("lsblk's flat list", () => {
  it("reads the rows the spare box printed, with a stick plugged in", async () => {
    const host = fakeHost({ rows: [...SPARE_ROWS, ...STICK_ROWS] });
    expect(await ask(LIST, host)).toEqual({
      ok: true,
      drives: [{ drive: "sda1", fileSystem: "exfat", readable: true }],
    });
    expect(commands(host, "mount")).toEqual([
      ["-t", "exfat", "-o", OPTIONS, "/dev/sda1", join(root, "sda1")],
    ]);
  });

  it("never lists or mounts an NTFS partition on a disk that is not USB", async () => {
    const host = fakeHost({ rows: SPARE_ROWS });
    expect(await ask(LIST, host)).toEqual({ ok: true, drives: [] });
    expect(commands(host, "mount")).toEqual([]);
    const sata = fakeHost({
      rows: SPARE_ROWS.map((row) => ({
        ...row,
        kname: row.kname.replace("nvme0n1p", "sdb").replace("nvme0n1", "sdb"),
        pkname: row.pkname === null ? null : "sdb",
        tran: "sata",
        mountpoints: [],
      })),
    });
    expect(await ask(LIST, sata)).toEqual({ ok: true, drives: [] });
    expect(commands(sata, "mount")).toEqual([]);
  });

  it("takes the transport from the disk, whatever its partitions say", async () => {
    const host = fakeHost({
      rows: [
        ...SPARE_ROWS.slice(0, 3),
        { ...SPARE_ROWS[3], tran: "usb" },
        { ...STICK_ROWS[0] },
        { ...STICK_ROWS[1], tran: null },
      ],
    });
    expect((await ask(LIST, host)).drives).toEqual([
      { drive: "sda1", fileSystem: "exfat", readable: true },
    ]);
  });
});

describe("storage.list", () => {
  it("logs verb, actor and permission before mounting", async () => {
    const events = [];
    const host = fakeHost({ disks: [disk("sdb", "usb", [part("sdb1", "vfat", "B-1")])], events });
    const log = (entry) => events.push(["log", entry]);
    await ask(`storage.list {"actor":${PERSON}}`, host, log);
    expect(events[0]).toEqual([
      "log",
      {
        verb: "storage.list",
        actor: { source: "person", person: "p1" },
        permission: "system.manage",
      },
    ]);
    expect(events.filter(([kind]) => kind === "log")).toHaveLength(1);
    expect(events.some(([, command]) => command === "mount")).toBe(true);
    await ask(LIST, host, log);
    expect(events.filter(([kind]) => kind === "log").at(-1)).toEqual([
      "log",
      { verb: "storage.list", actor: { source: "server" }, permission: null },
    ]);
  });

  it("mounts only USB drives, read-only", async () => {
    const host = fakeHost({
      disks: [
        BOX_DISK,
        disk("sdc", "sata", [part("sdc1", "exfat", "C-1", "8:33")]),
        disk("sdb", "usb", [part("sdb1", "vfat", "B-1")]),
      ],
    });
    expect(await ask(LIST, host)).toEqual({
      ok: true,
      drives: [{ drive: "sdb1", fileSystem: "vfat", readable: true }],
    });
    expect(commands(host, "mount")).toEqual([
      ["-t", "vfat", "-o", OPTIONS, "/dev/sdb1", join(root, "sdb1")],
    ]);
    expect(readdirSync(root)).toEqual(["sdb1"]);
  });

  it("skips the box's own disk and a disk with a mounted or encrypted partition", async () => {
    const host = fakeHost({
      disks: [
        disk("sdb", "usb", [
          part("sdb1", "vfat", "B-1"),
          node("sdb2", {
            fstype: "crypto_LUKS",
            children: [node("dm-1", { type: "crypt", fstype: "ext4" })],
          }),
        ]),
        disk("sdc", "usb", [
          part("sdc1", "exfat", "C-1", "8:33"),
          part("sdc2", "ntfs", "C-2", "8:34"),
        ]),
        disk("sdd", "usb", [part("sdd1", "vfat", "D-1", "8:49"), node("sdd2", { type: "lvm" })]),
        disk("sde", "usb", [
          node("sde1", {
            fstype: "linux_raid_member",
            children: [node("md0", { type: "raid1", fstype: "ext4" })],
          }),
        ]),
        { ...BOX_DISK, tran: "usb" },
      ],
    });
    host.disks[1].children[1].mountpoints = ["/mnt/elsewhere"];
    expect(await ask(LIST, host)).toEqual({ ok: true, drives: [] });
    expect(commands(host, "mount")).toEqual([]);
  });

  it("skips a partition with no file system and reports another format as other, unreadable", async () => {
    const host = fakeHost({
      disks: [
        disk("sdb", "usb", [node("sdb1"), part("sdb2", "ext4", "B-2", "8:18")]),
        disk("sdc", "usb", undefined, { fstype: "exfat", uuid: "C-0", "maj:min": "8:32" }),
        disk("sdd", "usb", undefined),
      ],
    });
    expect(await ask(LIST, host)).toEqual({
      ok: true,
      drives: [
        { drive: "sdb2", fileSystem: "other", readable: false },
        { drive: "sdc", fileSystem: "exfat", readable: true },
      ],
    });
    expect(commands(host, "mount").map((args) => args.at(-2))).toEqual(["/dev/sdc"]);
  });

  it("every mount names its type and carries ro and nosymfollow", async () => {
    const host = fakeHost({
      disks: [
        disk("sdb", "usb", [
          part("sdb1", "vfat", "B-1", "8:17"),
          part("sdb2", "exfat", "B-2", "8:18"),
          part("sdb3", "ntfs", "B-3", "8:19"),
        ]),
      ],
    });
    expect((await ask(LIST, host)).drives.map((drive) => drive.fileSystem)).toEqual([
      "vfat",
      "exfat",
      "ntfs",
    ]);
    const mounts = commands(host, "mount");
    expect(mounts.map((args) => args.slice(0, 2))).toEqual([
      ["-t", "vfat"],
      ["-t", "exfat"],
      ["-t", "ntfs3"],
    ]);
    for (const args of mounts) {
      expect(args[2]).toBe("-o");
      expect(args[3].split(",")).toEqual(expect.arrayContaining(["ro", "nosymfollow"]));
      expect(args[3]).toBe(OPTIONS);
    }
  });

  it("keeps a mount whose device and file-system id are unchanged, remounts a new stick under the same name, unmounts a pulled one", async () => {
    const host = fakeHost({
      disks: [
        disk("sdb", "usb", [part("sdb1", "vfat", "B-1", "8:17")]),
        disk("sdc", "usb", [part("sdc1", "exfat", "C-1", "8:33")]),
        disk("sdd", "usb", [part("sdd1", "exfat", "D-1", "8:49")]),
      ],
    });
    await ask(LIST, host);
    expect(commands(host, "mount")).toHaveLength(3);
    host.run.mockClear();

    host.disks[1] = disk("sdc", "usb", [part("sdc1", "exfat", "C-2", "8:33")]);
    host.disks.splice(2, 1);
    expect(await ask(LIST, host)).toEqual({
      ok: true,
      drives: [
        { drive: "sdb1", fileSystem: "vfat", readable: true },
        { drive: "sdc1", fileSystem: "exfat", readable: true },
      ],
    });
    expect(commands(host, "umount")).toEqual([[join(root, "sdc1")], [join(root, "sdd1")]]);
    expect(commands(host, "mount").map((args) => args.at(-2))).toEqual(["/dev/sdc1"]);
    expect(readdirSync(root).sort()).toEqual(["sdb1", "sdc1"]);
    host.run.mockClear();

    host.disks[0] = disk("sdb", "usb", [part("sdb1", "vfat", "B-1", "8:18")]);
    await ask(LIST, host);
    expect(commands(host, "umount")).toEqual([[join(root, "sdb1")]]);
    expect(commands(host, "mount").map((args) => args.at(-2))).toEqual(["/dev/sdb1"]);
  });

  it("remounts a drive with no file-system id, never counting it unchanged", async () => {
    const host = fakeHost({
      disks: [disk("sdb", "usb", [node("sdb1", { fstype: "vfat", "maj:min": "8:17" })])],
    });
    await ask(LIST, host);
    host.run.mockClear();
    expect(await ask(LIST, host)).toEqual({
      ok: true,
      drives: [{ drive: "sdb1", fileSystem: "vfat", readable: true }],
    });
    expect(commands(host, "umount")).toEqual([[join(root, "sdb1")]]);
    expect(commands(host, "mount").map((args) => args.at(-2))).toEqual(["/dev/sdb1"]);
  });

  it("unmounts every pulled drive it can, then fails when one will not unmount", async () => {
    const host = fakeHost({
      disks: [],
      mounts: [
        { target: join(root, "sdb1"), device: "8:17" },
        { target: join(root, "sdc1"), device: "8:33" },
      ],
    });
    const run = host.run.getMockImplementation();
    host.run.mockImplementation((command, args, limit) => {
      if (command === "umount" && args.at(-1) === join(root, "sdb1")) throw new Error("stuck");
      return run(command, args, limit);
    });
    expect(await ask(LIST, host)).toEqual({ ok: false, reason: "host_failed" });
    expect(host.mounts.map((mount) => mount.target)).toEqual([join(root, "sdb1")]);
  });

  it("remounts a drive folder it holds no record of", async () => {
    const host = fakeHost({
      disks: [disk("sdb", "usb", [part("sdb1", "vfat", "B-1", "8:17")])],
      mounts: [{ target: join(root, "sdb1"), device: "8:17" }],
    });
    await ask(LIST, host);
    expect(commands(host, "umount")).toEqual([[join(root, "sdb1")]]);
    expect(commands(host, "mount")).toHaveLength(1);
  });

  it("names at most the first 16 drives by kernel name, and mounts no others", async () => {
    const letters = "bcdefghijklmnopqr";
    const host = fakeHost({
      disks: [...letters]
        .reverse()
        .map((letter, index) =>
          disk(`sd${letter}`, "usb", [part(`sd${letter}1`, "vfat", `U-${index}`, `8:${index}`)]),
        ),
    });
    const { drives } = await ask(LIST, host);
    expect(drives.map((drive) => drive.drive)).toEqual(
      [...letters.slice(0, 16)].map((l) => `sd${l}1`),
    );
    expect(commands(host, "mount")).toHaveLength(16);
    expect(commands(host, "mount").map((args) => args.at(-2))).not.toContain("/dev/sdr1");
  });

  it("a mount that fails is unreadable and leaves no folder", async () => {
    const host = fakeHost({ disks: [disk("sdb", "usb", [part("sdb1", "vfat", "B-1")])] });
    const run = host.run.getMockImplementation();
    host.run.mockImplementation((command, args, limit) => {
      if (command === "mount") throw new Error("bad superblock");
      return run(command, args, limit);
    });
    expect(await ask(LIST, host)).toEqual({
      ok: true,
      drives: [{ drive: "sdb1", fileSystem: "vfat", readable: false }],
    });
    expect(readdirSync(root)).toEqual([]);
  });

  it("answers host_failed when lsblk fails, and refuses another verb's line", async () => {
    const run = vi.fn(() => {
      throw new Error("no lsblk");
    });
    expect(await handleStorageRequest(LIST, { run, root, stateDir, log: () => {} })).toBe(
      '{"ok":false,"reason":"host_failed"}\n',
    );
    const other = vi.fn();
    expect(
      await handleStorageRequest(`network.read {"actor":${SERVER}}`, {
        run: other,
        root,
        stateDir,
      }),
    ).toBe('{"ok":false,"reason":"unknown_request"}\n');
    expect(
      await handleStorageRequest(`storage.list {"actor":{"source":"nobody"}}`, { run: other }),
    ).toBe('{"ok":false,"reason":"actor_invalid"}\n');
    expect(other).not.toHaveBeenCalled();
  });
});

describe("time limits", () => {
  it("a mount past its limit is unreadable and none starts after the deadline", async () => {
    let time = 0;
    const host = fakeHost({
      disks: [
        disk("sdb", "usb", [part("sdb1", "vfat", "B-1", "8:17")]),
        disk("sdc", "usb", [part("sdc1", "vfat", "C-1", "8:33")]),
        disk("sdd", "usb", [part("sdd1", "vfat", "D-1", "8:49")]),
      ],
    });
    const exec = vi.fn((command, args) => {
      if (command === "mount" && args.at(-2) === "/dev/sdb1") {
        time = 8000;
        throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
      }
      if (command === "mount" && args.at(-2) === "/dev/sdc1") {
        time = 12_000;
        return "";
      }
      return host.run(command, args);
    });
    const run = storageCommand({ now: () => time, exec });
    const answer = JSON.parse(
      await handleStorageRequest(LIST, { run, root, stateDir, log: () => {} }),
    );
    expect(answer.drives).toEqual([
      { drive: "sdb1", fileSystem: "vfat", readable: false },
      { drive: "sdc1", fileSystem: "vfat", readable: true },
      { drive: "sdd1", fileSystem: "vfat", readable: false },
    ]);
    const mounts = exec.mock.calls.filter(([command]) => command === "mount");
    expect(mounts.map(([, args, options]) => [args.at(-2), options.timeout])).toEqual([
      ["/dev/sdb1", 5000],
      ["/dev/sdc1", 4000],
    ]);
    expect(existsSync(join(root, "sdd1"))).toBe(false);
  });

  it("kills a command that ignores SIGTERM at its limit", () => {
    const run = storageCommand();
    const started = performance.now();
    expect(() =>
      run(
        process.execPath,
        ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 4000);"],
        250,
      ),
    ).toThrow();
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("gives every command one twelve-second deadline", () => {
    let time = 0;
    const exec = vi.fn(() => "out");
    const run = storageCommand({ now: () => time, exec });
    expect(run("lsblk", ["--json"])).toBe("out");
    time = 9000;
    run("mount", ["x"], 5000);
    time = 11_000;
    run("mount", ["y"], 5000);
    expect(exec.mock.calls.map((call) => call[2].timeout)).toEqual([12_000, 3000, 1000]);
    time = 12_000;
    expect(() => run("umount", ["z"])).toThrow("storage deadline");
    expect(exec).toHaveBeenCalledTimes(3);
  });
});

describe("defaults", () => {
  it("logs to standard error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handleStorageRequest(RELEASE, { run: fakeHost({ disks: [] }).run, root, stateDir });
      expect(error.mock.calls).toEqual([
        ['{"verb":"storage.release","actor":{"source":"server"},"permission":null}'],
      ]);
    } finally {
      error.mockRestore();
    }
  });

  it("runs a real command in the C locale within the deadline", () => {
    const run = storageCommand();
    expect(run(process.execPath, ["-e", "process.stdout.write(process.env.LC_ALL)"])).toBe("C");
  });
});

describe("storage.release", () => {
  it("release unmounts every drive, lazily when busy", async () => {
    const host = fakeHost({
      disks: [
        disk("sdb", "usb", [part("sdb1", "vfat", "B-1", "8:17")]),
        disk("sdc", "usb", [part("sdc1", "exfat", "C-1", "8:33")]),
      ],
      mounts: [{ target: "/mnt/other", device: "8:65" }],
    });
    await ask(LIST, host);
    host.run.mockClear();
    host.busy = [join(root, "sdc1")];
    expect(await ask(RELEASE, host)).toEqual({ ok: true, released: 2 });
    expect(commands(host, "umount")).toEqual([
      [join(root, "sdb1")],
      [join(root, "sdc1")],
      ["-l", join(root, "sdc1")],
    ]);
    expect(host.mounts).toEqual([{ target: "/mnt/other", device: "8:65" }]);
    expect(readdirSync(root)).toEqual([]);
    host.run.mockClear();
    expect(await ask(RELEASE, host)).toEqual({ ok: true, released: 0 });
    expect(commands(host, "umount")).toEqual([]);
  });

  it("releases every other drive when one will not unmount, keeps its record and fails", async () => {
    const host = fakeHost({
      disks: [
        disk("sdb", "usb", [part("sdb1", "vfat", "B-1", "8:17")]),
        disk("sdc", "usb", [part("sdc1", "exfat", "C-1", "8:33")]),
      ],
    });
    await ask(LIST, host);
    const run = host.run.getMockImplementation();
    host.run.mockImplementation((command, args, limit) => {
      if (command === "umount" && args.at(-1) === join(root, "sdb1")) throw new Error("stuck");
      return run(command, args, limit);
    });
    host.run.mockClear();
    expect(await ask(RELEASE, host)).toEqual({ ok: false, reason: "host_failed" });
    expect(commands(host, "umount")).toEqual([
      [join(root, "sdb1")],
      ["-l", join(root, "sdb1")],
      [join(root, "sdc1")],
    ]);
    expect(host.mounts.map((mount) => mount.target)).toEqual([join(root, "sdb1")]);
    expect(readdirSync(root)).toEqual(["sdb1"]);
    host.run.mockImplementation(run);
    host.run.mockClear();
    await ask(LIST, host);
    expect(commands(host, "umount")).toEqual([]);
    expect(commands(host, "mount").map((args) => args.at(-2))).toEqual(["/dev/sdc1"]);
  });

  it("logs before unmounting", async () => {
    const events = [];
    const host = fakeHost({
      disks: [],
      mounts: [{ target: join(root, "sdb1"), device: "8:17" }],
      events,
    });
    await ask(`storage.release {"actor":${PERSON}}`, host, (entry) => events.push(["log", entry]));
    expect(events[0]).toEqual([
      "log",
      {
        verb: "storage.release",
        actor: { source: "person", person: "p1" },
        permission: "system.manage",
      },
    ]);
  });
});
