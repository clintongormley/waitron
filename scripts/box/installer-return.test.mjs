import { afterEach, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { installerReturn } from "./installer-return.mjs";
import { installerNameNotice } from "./installer-name-notice.mjs";

vi.mock("./installer-name-notice.mjs", () => ({ installerNameNotice: vi.fn() }));
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
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (command === fail) throw new Error("firmware refused");
    if (command === "sfdisk")
      return JSON.stringify({
        partitiontable: {
          label: "gpt",
          partitions: [
            { node: "/dev/vdb1", type: type ?? "C12A7328-F81F-11D2-BA4B-00A0C93EC93B", uuid: guid },
          ],
        },
      });
    if (command === "systemctl") return "";
    if (args[0] === "--create-only") made = true;
    if (args[0] === "--bootnext") next = args[1];
    return `BootCurrent: 0001\nBootOrder: ${next ? order : "0001,0002,0000,0003"}\n${next ? `BootNext: ${next}\n` : ""}${made ? created : entries}\n`;
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
});

it("starts the installed disk after fifteen silent seconds, without changing boot order", async () => {
  const f = fixture();
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
  expect(f.calls).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await done;
  expect(f.text).toContain("Reinstall, erase and recovery-key inspection are unavailable");
  expect(f.text).not.toContain("secret");
  expect(f.calls.at(-1)).toEqual(["systemctl", "reboot", "--no-block"]);
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
