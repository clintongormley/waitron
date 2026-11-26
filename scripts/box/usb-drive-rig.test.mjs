import { describe, expect, it } from "vitest";
import { parseBackupArchiveKey } from "../../apps/server/src/backup-keys.ts";
import {
  USB_FILE_BYTES,
  hotplugCommands,
  monitorRefused,
  usbBackupName,
  usbDriveFailures,
  usbFileBytes,
  usbGuestScript,
  usbImageBytes,
} from "./usb-drive-rig.mjs";

const name = usbBackupName(new Date("2026-11-26T10:20:30.456Z"));
const sha256 = "a".repeat(64);
const passing = {
  list: { ok: true, drives: [{ drive: "sda", fileSystem: "exfat", readable: true }] },
  drive: "sda",
  uid: "10001",
  sha256,
  release: { ok: true, released: 1 },
  goneInContainer: true,
};

describe("the USB drive bench case", () => {
  it("names its file as the server names a backup archive", () => {
    expect(parseBackupArchiveKey(name)?.timestamp.toISOString()).toBe("2026-11-26T10:20:30.000Z");
    expect(usbBackupName(new Date())).not.toBe(usbBackupName(new Date()));
  });

  it("writes a file past FAT32's 4 GiB limit unless told a smaller size", () => {
    expect(USB_FILE_BYTES).toBe(4_400_000_000);
    expect(USB_FILE_BYTES).toBeGreaterThan(2 ** 32);
    expect(usbFileBytes(undefined)).toBe(USB_FILE_BYTES);
    expect(usbFileBytes("")).toBe(USB_FILE_BYTES);
    expect(usbFileBytes("1048576")).toBe(1_048_576);
  });

  it.each(["0", "-5", "1.5", "12abc", " 12", "9007199254740993"])(
    "refuses %j as a file size",
    (value) => {
      expect(() => usbFileBytes(value)).toThrow(
        "B3_USB_FILE_BYTES must be a whole number of bytes",
      );
    },
  );

  it("leaves room for the file system around the file, in whole MiB", () => {
    const bytes = usbImageBytes(USB_FILE_BYTES);
    expect(bytes % 2 ** 20).toBe(0);
    expect(bytes - USB_FILE_BYTES).toBeGreaterThanOrEqual(64 * 2 ** 20);
    expect(usbImageBytes(1)).toBe(65 * 2 ** 20);
  });

  it("plugs the image in read-only as a USB disk on the case's own controller", () => {
    expect(hotplugCommands("/work/drive/usb-drive.img")).toEqual([
      "drive_add 0 if=none,id=usbdrive,file=/work/drive/usb-drive.img,format=raw,readonly=on",
      "device_add usb-storage,bus=usb.0,drive=usbdrive,id=usbdisk,serial=waitron-rig-drive",
    ]);
  });

  it("refuses an image path the monitor would split into options", () => {
    expect(() => hotplugCommands("/work/a,b/usb-drive.img")).toThrow("usb image path");
    expect(() => hotplugCommands("/work/a b/usb-drive.img")).toThrow("usb image path");
  });

  it.each([
    ["Error: Duplicate ID 'usbdrive' for drive", true],
    ["Could not open '/work/x.img': No such file or directory", true],
    ["device_add failed", true],
    [
      "QEMU 10.0.2 monitor - type 'help' for more information\n(qemu) drive_add 0 x\nOK\n(qemu) ",
      false,
    ],
  ])("reads the monitor's answer %j as refused: %s", (transcript, refused) => {
    expect(monitorRefused(transcript)).toBe(refused);
  });

  it("accepts a guest that listed, read, released and lost the drive", () => {
    expect(usbDriveFailures(passing, sha256)).toEqual([]);
    expect(usbDriveFailures({ ...passing, release: { ok: true, released: 2 } }, sha256)).toEqual(
      [],
    );
  });

  it.each([
    ["a refused list", { list: { ok: false, error: "busy" } }, "list"],
    ["no drive", { list: { ok: true, drives: [] } }, "drive"],
    ["a list with no drives field", { list: { ok: true } }, "drive"],
    [
      "a drive read as another format",
      { list: { ok: true, drives: [{ drive: "sda", fileSystem: "vfat", readable: true }] } },
      "drive",
    ],
    [
      "an unreadable drive",
      { list: { ok: true, drives: [{ drive: "sda", fileSystem: "exfat", readable: false }] } },
      "drive",
    ],
    [
      "two drives",
      {
        list: {
          ok: true,
          drives: [
            { drive: "sda", fileSystem: "exfat", readable: true },
            { drive: "sdb", fileSystem: "exfat", readable: true },
          ],
        },
      },
      "drive",
    ],
    ["a read under another drive name", { drive: "sdb" }, "drive"],
    ["a read as another user", { uid: "0" }, "uid"],
    ["another hash", { sha256: "b".repeat(64) }, "hash"],
    ["no hash", { sha256: undefined }, "hash"],
    ["a refused release", { release: { ok: false, error: "busy" } }, "release"],
    ["a release of nothing", { release: { ok: true, released: 0 } }, "release"],
    ["a file still seen after release", { goneInContainer: false }, "still-visible"],
  ])("refuses %s", (_name, patch, failure) => {
    expect(usbDriveFailures({ ...passing, ...patch }, sha256)).toEqual([failure]);
  });

  it("refuses a guest that sent nothing", () => {
    expect(usbDriveFailures(undefined, sha256)).toEqual(["list"]);
  });

  it("builds a guest script that parses and reads the named file through the app container", () => {
    const script = usbGuestScript(name);
    expect(() => new Function("require", script)).not.toThrow();
    expect(script).toContain(JSON.stringify(name));
    expect(script).toContain("storage.list");
    expect(script).toContain("storage.release");
    expect(script).toContain("B3_USB_WAITING");
  });

  it("refuses a file name that is not a backup archive's", () => {
    expect(() => usbGuestScript("../etc/passwd")).toThrow("usb file name");
  });
});

describe("the USB drive guest script", () => {
  it("waits for the drive, reads it in the app container, releases it and checks it is gone", async () => {
    const { mkdtempSync, writeFileSync, rmSync, existsSync } = await import("node:fs");
    const { createServer } = await import("node:net");
    const { spawn } = await import("node:child_process");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "usb-guest-"));
    const released = join(root, "released");
    const requests = [];
    let lists = 0;
    const server = createServer((socket) => {
      let text = "";
      socket.on("data", (bytes) => {
        text += bytes;
        if (!text.endsWith("\n")) return;
        requests.push(text.trim());
        if (text.startsWith("storage.list")) {
          lists += 1;
          const drives = lists < 2 ? [] : [{ drive: "sda", fileSystem: "exfat", readable: true }];
          socket.end(JSON.stringify({ ok: true, drives }) + "\n");
        } else {
          writeFileSync(released, "");
          socket.end(JSON.stringify({ ok: true, released: 1 }) + "\n");
        }
      });
    });
    const socketPath = join(root, "box.sock");
    await new Promise((done) => server.listen(socketPath, done));
    try {
      writeFileSync(join(root, "setpriv"), '#!/bin/sh\nshift 3\nexec "$@"\n', { mode: 0o700 });
      writeFileSync(
        join(root, "docker"),
        `#!/bin/sh
if [ "$1" = compose ]; then echo app-id; exit 0; fi
shift 4
case "$1" in
  id) echo 10001 ;;
  sha256sum) echo "${sha256}  $2" ;;
  test) [ ! -e "${released}" ] ;;
esac
`,
        { mode: 0o700 },
      );
      const script = usbGuestScript(name, { socket: socketPath, box: root });
      const output = await new Promise((done, reject) => {
        const child = spawn(process.execPath, ["-e", script], {
          env: { ...process.env, PATH: `${root}:${process.env.PATH}` },
        });
        let text = "";
        child.stdout.on("data", (bytes) => (text += bytes));
        child.on("error", reject);
        child.on("exit", () => done(text));
      });
      const lines = output.trim().split("\n");
      expect(lines[0]).toBe("B3_USB_WAITING");
      const result = JSON.parse(lines[1].slice("B3_USB_RESULT:".length));
      expect(usbDriveFailures(result, sha256)).toEqual([]);
      expect(requests).toEqual([
        'storage.list {"actor":{"source":"server"}}',
        'storage.list {"actor":{"source":"server"}}',
        'storage.release {"actor":{"source":"server"}}',
      ]);
      expect(existsSync(released)).toBe(true);
    } finally {
      server.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
});
