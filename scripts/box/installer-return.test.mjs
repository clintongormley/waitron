import { afterEach, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import process from "node:process";
import console from "node:console";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { installerReturn } from "./installer-return.mjs";
import { installerNameNotice } from "./installer-name-notice.mjs";

vi.mock("./installer-name-notice.mjs", () => ({ installerNameNotice: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
const guid = "1764b79f-2a5b-4430-a72c-614275564f09";
// Captured efibootmgr 18 output: B3-17 source guest, 11 November 2026.
const entry = (id = "0004", active = "*", loader = "\\EFI\\BOOT\\BOOTX64.EFI") =>
  `Boot${id}${active} B317_TARGET\tHD(1,GPT,${guid},0x800,0x20000)/File(${loader})`;
function fixture({
  entries = entry(),
  created = entry(),
  type,
  fail,
  order = "0001,0002,0000,0003",
  missingOrder = false,
  label = "gpt",
  node = "/dev/vdb1",
  uuid = guid,
  createdOrder = "0001,0002,0000,0003",
  nextReadback,
  removedAfterNext = false,
} = {}) {
  vi.useFakeTimers();
  installerNameNotice.mockResolvedValue("This box already has Waitron (Harbour Restaurant Ltd).");
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = vi.fn((raw) => {
    input.isRaw = raw;
  });
  const output = new PassThrough();
  let text = "";
  output.on("data", (bytes) => {
    text += bytes.toString();
  });
  const calls = [];
  let next;
  let made = false;
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === fail) throw new Error("firmware refused");
    if (command === "sfdisk")
      return JSON.stringify({
        partitiontable: {
          label,
          partitions: [{ node, type: type ?? "C12A7328-F81F-11D2-BA4B-00A0C93EC93B", uuid }],
        },
      });
    if (command === "systemctl") return "";
    if (args[0] === "--create-only") made = true;
    if (args[0] === "--bootnext") next = args[1];
    const readback = nextReadback === undefined ? next : nextReadback;
    return `BootCurrent: 0001\n${missingOrder ? "" : `BootOrder: ${next ? order : made ? createdOrder : "0001,0002,0000,0003"}\n`}${next && readback ? `BootNext: ${readback}\n` : ""}${next && removedAfterNext ? "" : made ? created : entries}\n`;
  };
  return {
    input,
    output,
    run,
    calls,
    get text() {
      return text;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it("starts the installed disk after fifteen silent seconds, without changing boot order", async () => {
  const f = fixture();
  f.input.pause();
  const done = installerReturn("/dev/vdb", f);
  await vi.advanceTimersByTimeAsync(14999);
  expect(f.calls).toEqual([]);
  expect(f.text).toContain("Press any key to pause");
  await vi.advanceTimersByTimeAsync(1);
  await done;
  expect(f.calls).toEqual([
    ["sfdisk", "--json", "/dev/vdb"],
    ["efibootmgr", "-v"],
    ["efibootmgr", "--bootnext", "0004"],
    ["efibootmgr", "-v"],
    ["systemctl", "reboot", "--no-block"],
  ]);
  expect(f.input.isRaw).toBe(false);
  expect(f.input.listenerCount("data")).toBe(0);
  expect(f.input.isPaused()).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("discards buffered keys and resets a two-minute idle return after each new chunk", async () => {
  const f = fixture();
  f.input.write("earlier typing");
  const done = installerReturn("/dev/vdb", f);
  await vi.advanceTimersByTimeAsync(119000);
  expect(f.calls).toEqual([]);
  f.input.write("secret typed with no Enter");
  await vi.advanceTimersByTimeAsync(119999);
  f.input.emit("data", "");
  expect(f.calls).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await done;
  expect(f.text).toContain("Reinstall, erase and recovery-key inspection are unavailable");
  expect(f.text).not.toContain("secret");
  expect(f.text.match(/Reinstall, erase/g)).toHaveLength(1);
  expect(f.calls.at(-1)).toEqual(["systemctl", "reboot", "--no-block"]);
  expect(f.input.isPaused()).toBe(true);
});

it("disables terminal echo before inviting typing", async () => {
  const f = fixture();
  let rawAtPrompt;
  f.output.on("data", (bytes) => {
    if (bytes.toString().includes("Press any key")) {
      rawAtPrompt = f.input.isRaw;
      f.input.write("immediate typing");
    }
  });
  const done = installerReturn("/dev/vdb", f);
  await vi.advanceTimersByTimeAsync(120000);
  await done;
  expect(rawAtPrompt).toBe(true);
  expect(f.input.isPaused()).toBe(true);
});

it.each(["non-tty", "raw-error", "eof", "error"])(
  "keeps the return deadline when keys are unavailable: %s",
  async (kind) => {
    const f = fixture();
    if (kind === "non-tty") f.input.isTTY = false;
    if (kind === "raw-error")
      f.input.setRawMode.mockImplementation(() => {
        throw new Error("not a terminal");
      });
    const done = installerReturn("/dev/vdb", f);
    await vi.advanceTimersByTimeAsync(1);
    if (kind === "eof") f.input.end();
    if (kind === "error") f.input.emit("error", new Error("disconnected"));
    await vi.advanceTimersByTimeAsync(14999);
    await done;
    expect(f.text).toContain("Keys unavailable");
    expect(f.calls.at(-1)).toEqual(["systemctl", "reboot", "--no-block"]);
  },
);

it("selects the lowest active exact loader/ESP match rather than a label or inactive entry", async () => {
  const f = fixture({
    entries: [
      entry("0001", " "),
      entry("0002", "*", "\\EFI\\other.EFI"),
      entry("0009"),
      entry("0004").toUpperCase(),
    ].join("\n"),
  });
  const done = installerReturn("/dev/vdb", f);
  await vi.advanceTimersByTimeAsync(15000);
  await done;
  expect(f.calls).toContainEqual(["efibootmgr", "--bootnext", "0004"]);
});

it("creates a missing exact entry without inserting it into BootOrder, then verifies it", async () => {
  const f = fixture({ entries: entry("0004", "*", "\\EFI\\other.EFI") });
  const done = installerReturn("/dev/vdb", f);
  await vi.advanceTimersByTimeAsync(15000);
  await done;
  expect(f.calls.slice(2, 4)).toEqual([
    [
      "efibootmgr",
      "--create-only",
      "--disk",
      "/dev/vdb",
      "--part",
      "1",
      "--label",
      "Waitron",
      "--loader",
      "\\EFI\\BOOT\\BOOTX64.EFI",
    ],
    ["efibootmgr", "-v"],
  ]);
});

it.each([
  { type: "not-an-esp" },
  { missingOrder: true },
  { label: "dos" },
  { node: "/dev/vdb2" },
  { uuid: "not-a-guid", entries: entry().replace(guid, "not-a-guid") },
  { entries: "", createdOrder: "0004,0001" },
  { nextReadback: null },
  { nextReadback: "0009" },
  { removedAfterNext: true },
  { entries: "", created: "" },
  { order: "0004,0001" },
  { fail: "efibootmgr" },
  { fail: "systemctl" },
])("fails without retry or disk writes when return cannot be verified (%j)", async (options) => {
  const f = fixture(options);
  const done = installerReturn("/dev/vdb", f);
  const settled = done.then(
    () => null,
    (error) => error,
  );
  await vi.advanceTimersByTimeAsync(15000);
  expect((await settled)?.message).toBe(
    "Cannot start the installed box. Remove the USB and restart.",
  );
  expect(f.text).toContain("Cannot start the installed box");
  expect(f.calls.filter(([command]) => command === "systemctl")).toHaveLength(
    options.fail === "systemctl" ? 1 : 0,
  );
  expect(f.input.isRaw).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("leaves a foreign or unreadable disk at the occupied refusal without starting a timer", async () => {
  const f = fixture();
  installerNameNotice.mockResolvedValue(null);
  await expect(installerReturn("/dev/vdb", f)).rejects.toThrow("install.refused:occupied");
  expect(f.calls).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])(
  "the shell entry point uses bounded commands and reports failure (%s)",
  async (refused) => {
    const f = fixture();
    if (refused) installerNameNotice.mockResolvedValue(null);
    execFileSync.mockImplementation(f.run);
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalArgv = process.argv;
    const originalCode = process.exitCode;
    try {
      process.argv = [process.execPath, resolve("scripts/box/installer-return.mjs"), "/dev/vdb"];
      vi.resetModules();
      const done = import("./installer-return.mjs");
      if (!refused) {
        await vi.waitFor(() => expect(output).toHaveBeenCalled());
        await vi.advanceTimersByTimeAsync(15000);
      }
      await done;
      if (refused) {
        expect(process.exitCode).toBe(1);
        expect(error).toHaveBeenCalledWith("install.refused:occupied");
        expect(execFileSync).not.toHaveBeenCalled();
      } else {
        expect(f.calls.at(-1)).toEqual(["systemctl", "reboot", "--no-block"]);
        expect(
          execFileSync.mock.calls.every(
            ([, , options]) => options.timeout === 12000 && options.maxBuffer === 1048576,
          ),
        ).toBe(true);
      }
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalCode;
    }
  },
);
