import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BLUETOOTH_INFO_DEVICES,
  createBluetoothctlHost,
  parseBluetoothctlDevices,
  parseBluetoothctlInfo,
  parseRemoveResult,
} from "./bluetooth.js";
import { pairWithBluetoothctl, runBluetoothctl } from "./bluetooth-command.js";

// Synthesised in the tool's documented format (ANSI colour codes and \r included), NOT a real
// capture.
const DEVICES_OUTPUT =
  "[0;94m[NEW][0m Device AA:BB:CC:DD:EE:FF Star TSP100\r\n" +
  "[NEW] Device 11:22:33:44:55:66 HP Printer\r\n" +
  "[NEW] Device 99:88:77:66:55:44 99-88-77-66-55-44\r\n";

describe("parseBluetoothctlDevices", () => {
  it("extracts MAC + name from Device lines, ignoring ANSI codes and CRs", () => {
    expect(parseBluetoothctlDevices(DEVICES_OUTPUT)).toEqual([
      { mac: "AA:BB:CC:DD:EE:FF", name: "Star TSP100" },
      { mac: "11:22:33:44:55:66", name: "HP Printer" },
      { mac: "99:88:77:66:55:44" },
    ]);
  });

  it("dedupes by MAC, keeping the most recent name", () => {
    const text =
      "[NEW] Device AA:BB:CC:DD:EE:FF Unknown\r\n[CHG] Device AA:BB:CC:DD:EE:FF Star TSP100\r\n";
    expect(parseBluetoothctlDevices(text)).toEqual([
      { mac: "AA:BB:CC:DD:EE:FF", name: "Star TSP100" },
    ]);
  });

  it("returns nothing for output with no Device lines", () => {
    expect(parseBluetoothctlDevices("Agent registered\r\nDiscovery started\r\n")).toEqual([]);
  });
});

describe("createBluetoothctlHost", () => {
  it.each([
    "No default controller available",
    "Failed to start discovery: org.bluez.Error.NotReady",
  ])("reports a refused scan: %s", async (output) => {
    const run = vi.fn().mockResolvedValueOnce(output).mockResolvedValue("");
    await expect(createBluetoothctlHost({ run }).scan()).rejects.toThrow(output);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("scan() runs an inquiry then lists devices, mapped to DiscoveredDevice", async () => {
    const run = vi.fn<(args: string[]) => Promise<string>>(async (args) =>
      args.includes("scan") ? "Discovery started\r\n" : DEVICES_OUTPUT,
    );
    const host = createBluetoothctlHost({ run, scanSeconds: 4 });
    const found = await host.scan();
    expect(run).toHaveBeenNthCalledWith(1, ["--timeout", "4", "scan", "on"]);
    expect(run).toHaveBeenNthCalledWith(2, ["devices"]);
    expect(found).toEqual([
      { transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF", name: "Star TSP100" },
      { transport: "bluetooth", localKey: "11:22:33:44:55:66", name: "HP Printer" },
      { transport: "bluetooth", localKey: "99:88:77:66:55:44" },
    ]);
  });

  it("pair() hands the address and the PIN to the interactive pairing, never to a one-shot command", async () => {
    const run = vi.fn<(args: string[]) => Promise<string>>(async () => "");
    const pair = vi.fn(async (mac: string) => ({ ok: true, localKey: mac }));
    const host = createBluetoothctlHost({ run, pair });
    expect(await host.pair("AA:BB:CC:DD:EE:FF", "1234")).toStrictEqual({
      ok: true,
      localKey: "AA:BB:CC:DD:EE:FF",
    });
    expect(pair).toHaveBeenCalledWith("AA:BB:CC:DD:EE:FF", "1234");
    expect(run).not.toHaveBeenCalled();
  });

  // bluez 5.82 client/main.c `cmd_devices`: with no controller it prints this line and exits 0.
  it("paired() refuses, rather than listing nothing, when BlueZ has no controller", async () => {
    const run = vi.fn<(args: string[]) => Promise<string>>(
      async () => "No default controller available\n",
    );
    await expect(createBluetoothctlHost({ run }).paired()).rejects.toThrow(
      "No default controller available",
    );
  });

  it("paired() bounds its wait for BlueZ with a kill deadline, not bluetoothctl's --timeout", async () => {
    const run = vi.fn<(args: string[], opts?: { timeoutMs?: number }) => Promise<string>>(
      async () => "",
    );
    await createBluetoothctlHost({ run, listTimeoutMs: 3_000 }).paired();
    expect(run).toHaveBeenCalledWith(["devices", "Paired"], { timeoutMs: 3_000 });
  });

  it("paired() lists only bonded devices", async () => {
    const run = vi.fn<(args: string[]) => Promise<string>>(
      async () => "[NEW] Device AA:BB:CC:DD:EE:FF Star TSP100\r\n",
    );
    const host = createBluetoothctlHost({ run });
    expect(await host.paired()).toEqual([{ mac: "AA:BB:CC:DD:EE:FF", name: "Star TSP100" }]);
    expect(run).toHaveBeenCalledWith(["devices", "Paired"]);
  });
});

// Sources: BlueZ's bluetoothctl manual (https://github.com/bluez/bluez/blob/master/doc/bluetoothctl.rst),
// its RemoveDevice contract (https://github.com/bluez/bluez/blob/master/doc/org.bluez.Adapter.rst),
// and the Bluetooth SIG Assigned Numbers (https://www.bluetooth.com/specifications/assigned-numbers/):
// major device class 0x06 is Imaging (bits 12-8 of the class), minor bit 7 is Printer, and
// 00001101-0000-1000-8000-00805f9b34fb is the Serial Port profile.
//
// The owner's box, BlueZ 5.82, 2026-09-29: `info` for the owner's printer before pairing. The
// Name/Class/Icon/Paired/Bonded/Trusted/LegacyPairing/UUID values and RSSI -78 were recorded there;
// the column spacing of the UUID lines, the Alias/Blocked/RSSI hex lines and the AdvertisingFlags
// layout are synthesised in bluetoothctl's documented shape.
const OWNER_PRINTER_INFO =
  "Device 5A:4A:45:D4:FB:BB (public)\n" +
  "\tName: BlueTooth Printer\n" +
  "\tAlias: BlueTooth Printer\n" +
  "\tClass: 0x00040680 (263808)\n" +
  "\tIcon: printer\n" +
  "\tPaired: no\n" +
  "\tBonded: no\n" +
  "\tTrusted: no\n" +
  "\tBlocked: no\n" +
  "\tConnected: no\n" +
  "\tLegacyPairing: no\n" +
  "\tUUID: Serial Port               (00001101-0000-1000-8000-00805f9b34fb)\n" +
  "\tUUID: PnP Information           (00001200-0000-1000-8000-00805f9b34fb)\n" +
  "\tUUID: Unknown                   (000018f0-0000-1000-8000-00805f9b34fb)\n" +
  "\tUUID: Vendor specific           (e7810a71-73ae-499d-8c15-faa9aef0c3f2)\n" +
  "\tRSSI: 0xffffffb2 (-78)\n" +
  "\tAdvertisingFlags:\n" +
  "  02                                               .\n";

/** Synthesised: a device header plus the given lines, none of which marks it a printer unless the
 * case adds one. */
function info(...lines: string[]): string {
  return ["Device 11:22:33:44:55:66 (public)", "\tName: Thing", ...lines.map((l) => `\t${l}`)]
    .join("\n")
    .concat("\n");
}

describe("parseBluetoothctlInfo", () => {
  it("marks the owner's printer, which carries all three signs", () => {
    expect(parseBluetoothctlInfo(OWNER_PRINTER_INFO)).toStrictEqual({ printerLike: true });
  });

  it("marks a device by its printer icon alone", () => {
    expect(parseBluetoothctlInfo(info("Icon: printer"))).toStrictEqual({ printerLike: true });
  });

  it("marks a device whose class is imaging with the printer bit set, and no other sign", () => {
    // 0x040680 is the owner's class; 0x0680 is the class with no service bits at all.
    expect(parseBluetoothctlInfo(info("Class: 0x00000680 (1664)"))).toStrictEqual({
      printerLike: true,
    });
  });

  it("does not mark an imaging device without the printer bit, nor a printer bit in another major class", () => {
    // 0x0620: imaging, camera bit. 0x0580: peripheral (major 0x05), mouse — bit 7 set, wrong major.
    expect(parseBluetoothctlInfo(info("Class: 0x00000620 (1568)"))).toStrictEqual({});
    expect(parseBluetoothctlInfo(info("Class: 0x00000580 (1408)"))).toStrictEqual({});
  });

  it("marks a device by the Serial Port UUID alone", () => {
    expect(
      parseBluetoothctlInfo(
        info("UUID: Serial Port               (00001101-0000-1000-8000-00805F9B34FB)"),
      ),
    ).toStrictEqual({ printerLike: true });
  });

  it("leaves a device with none of the three signs unmarked", () => {
    expect(
      parseBluetoothctlInfo(
        info(
          "Class: 0x00240404 (2360324)",
          "Icon: audio-headset",
          "UUID: Audio Sink                (0000110b-0000-1000-8000-00805f9b34fb)",
          "Modalias: usb:v05ACp0239d0644",
        ),
      ),
    ).toStrictEqual({});
  });

  it("reads coloured, CR-terminated lines and ignores malformed ones", () => {
    const text =
      "\x1b[0;94mDevice 11:22:33:44:55:66\x1b[0m (public)\r\n" +
      "\tClass: not-a-number\r\n" +
      "\tIcon:\r\n" +
      "\tUUID: Serial Port\r\n" +
      "garbage without a colon\r\n" +
      "\t\x1b[1;39mIcon: printer\x1b[0m\r\n";
    expect(parseBluetoothctlInfo(text)).toStrictEqual({ printerLike: true });
    expect(parseBluetoothctlInfo(text.replace("Icon: printer", "Icon: phone"))).toStrictEqual({});
  });
});

describe("parseRemoveResult", () => {
  const MAC = "5A:4A:45:D4:FB:BB";

  // The owner's box, BlueZ 5.82, 2026-09-29: removing a paired printer, exit 0.
  it("reads the measured removal as success", () => {
    expect(
      parseRemoveResult(`[DEL] Device ${MAC} BlueTooth Printer\nDevice has been removed\n`, MAC, 0),
    ).toStrictEqual({ ok: true });
  });

  // The owner's box, BlueZ 5.82, 2026-09-29: removing an address BlueZ no longer knows, exit 1.
  it("reads an address already gone as success, because gone is what Forget wants", () => {
    expect(parseRemoveResult(`Device ${MAC} not available\n`, MAC, 1)).toStrictEqual({ ok: true });
    expect(parseRemoveResult(`Device ${MAC} not available\n`, MAC.toLowerCase(), 1)).toStrictEqual({
      ok: true,
    });
  });

  it("does not read another address being unavailable as this one gone", () => {
    expect(parseRemoveResult("Device 11:22:33:44:55:66 not available\n", MAC, 1)).toStrictEqual({
      ok: false,
      error: "removal did not complete",
    });
  });

  // Synthesised in bluetoothctl's documented `Failed to remove device: <error>` shape.
  it("reports a refused removal with BlueZ's reason", () => {
    expect(
      parseRemoveResult(
        "\x1b[0;91mFailed to remove device: org.freedesktop.DBus.Error.AccessDenied\x1b[0m\r\n",
        MAC,
        1,
      ),
    ).toStrictEqual({ ok: false, error: "org.freedesktop.DBus.Error.AccessDenied" });
  });

  it("reports no output as a removal that did not complete", () => {
    expect(parseRemoveResult("", MAC, 0)).toStrictEqual({
      ok: false,
      error: "removal did not complete",
    });
  });
});

type Run = (args: string[], opts?: { timeoutMs?: number }) => Promise<string>;

function deferred(): {
  promise: Promise<string>;
  resolve: (v: string) => void;
  reject: (e: Error) => void;
} {
  let resolve!: (v: string) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createBluetoothctlHost — scan() marks printer-like devices", () => {
  it("asks `info` for a listed device and marks it when it looks like a printer", async () => {
    const run = vi.fn<Run>(async (args) => {
      if (args.includes("scan")) return "Discovery started\n";
      if (args[0] === "devices") return "Device 5A:4A:45:D4:FB:BB BlueTooth Printer\n";
      return OWNER_PRINTER_INFO;
    });
    expect(await createBluetoothctlHost({ run }).scan()).toStrictEqual([
      {
        transport: "bluetooth",
        localKey: "5A:4A:45:D4:FB:BB",
        name: "BlueTooth Printer",
        printerLike: true,
      },
    ]);
    expect(run).toHaveBeenCalledWith(["info", "5A:4A:45:D4:FB:BB"]);
  });

  it("keeps a device whose `info` fails, unmarked, while another still comes back marked", async () => {
    const run = vi.fn<Run>(async (args) => {
      if (args.includes("scan")) return "";
      if (args[0] === "devices")
        return "Device 11:22:33:44:55:66 Gone\nDevice 5A:4A:45:D4:FB:BB BlueTooth Printer\n";
      if (args[1] === "11:22:33:44:55:66")
        throw new Error("Device 11:22:33:44:55:66 not available");
      return OWNER_PRINTER_INFO;
    });
    expect(await createBluetoothctlHost({ run }).scan()).toStrictEqual([
      { transport: "bluetooth", localKey: "11:22:33:44:55:66", name: "Gone" },
      {
        transport: "bluetooth",
        localKey: "5A:4A:45:D4:FB:BB",
        name: "BlueTooth Printer",
        printerLike: true,
      },
    ]);
  });

  it("starts the first eight `info` calls together, never asks about a ninth, and keeps all nine", async () => {
    expect(MAX_BLUETOOTH_INFO_DEVICES).toBe(8);
    const macs = Array.from({ length: 9 }, (_, i) => `AA:BB:CC:DD:EE:0${i + 1}`);
    const pending = new Map<string, ReturnType<typeof deferred>>();
    const run = vi.fn<Run>((args) => {
      if (args.includes("scan")) return Promise.resolve("");
      if (args[0] === "devices")
        return Promise.resolve(macs.map((m) => `Device ${m} P${m.slice(-1)}`).join("\n"));
      const d = deferred();
      pending.set(args[1]!, d);
      return d.promise;
    });
    const scanning = createBluetoothctlHost({ run }).scan();
    await vi.waitFor(() => expect(pending.size).toBe(8));
    expect([...pending.keys()]).toStrictEqual(macs.slice(0, 8));
    pending.get(macs[0]!)!.resolve(info("Icon: printer"));
    pending.get(macs[1]!)!.reject(new Error("killed"));
    for (const mac of macs.slice(2, 8)) pending.get(mac)!.resolve(info("Icon: phone"));
    const found = await scanning;
    expect(found.map((d) => d.localKey)).toStrictEqual(macs);
    expect(found.filter((d) => d.printerLike === true).map((d) => d.localKey)).toStrictEqual([
      macs[0],
    ]);
    expect(run).not.toHaveBeenCalledWith(["info", macs[8]]);
  });
});

describe("createBluetoothctlHost — forget()", () => {
  const MAC = "5A:4A:45:D4:FB:BB";

  it("runs `remove` and decodes the removal", async () => {
    const run = vi.fn<Run>(
      async () => `[DEL] Device ${MAC} BlueTooth Printer\nDevice has been removed\n`,
    );
    expect(await createBluetoothctlHost({ run }).forget(MAC)).toStrictEqual({ ok: true });
    expect(run).toHaveBeenCalledWith(["remove", MAC]);
  });

  it("decodes the output a failed exit carries, not only its message", async () => {
    const run = vi.fn<Run>(async () => {
      throw Object.assign(new Error("Command failed: bluetoothctl remove"), {
        code: 1,
        killed: false,
        signal: null,
        stdout: `Device ${MAC} not available\n`,
      });
    });
    expect(await createBluetoothctlHost({ run }).forget(MAC)).toStrictEqual({ ok: true });
  });

  it("reports BlueZ's reason when a failed exit printed one", async () => {
    const run = vi.fn<Run>(async () => {
      throw Object.assign(new Error("Command failed: bluetoothctl remove"), {
        stdout: "Failed to remove device: org.bluez.Error.NotReady\n",
      });
    });
    expect(await createBluetoothctlHost({ run }).forget(MAC)).toStrictEqual({
      ok: false,
      error: "org.bluez.Error.NotReady",
    });
  });

  // bluetoothctl 5.82 `remove *` removes every device BlueZ knows, and `remove ""` prints a
  // "not available" line this decoder would read as success (READ, client/main.c cmd_remove).
  it.each(["*", "", "5A:4A:45:D4:FB", "5A-4A-45-D4-FB-BB"])(
    "refuses the address %j without running bluetoothctl",
    async (address) => {
      const run = vi.fn<Run>(async () => "Device has been removed\n");
      expect(await createBluetoothctlHost({ run }).forget(address)).toStrictEqual({
        ok: false,
        error: "not a Bluetooth address",
      });
      expect(run).not.toHaveBeenCalled();
    },
  );

  // bluez 5.82 client/main.c cmd_remove: with no controller it prints this and exits 1. READ.
  it("reports a box with no Bluetooth controller by name, not as a failed command", async () => {
    const run = vi.fn<Run>(async () => {
      throw Object.assign(new Error(`Command failed: bluetoothctl remove ${MAC}`), {
        stdout: "No default controller available\n",
      });
    });
    expect(await createBluetoothctlHost({ run }).forget(MAC)).toStrictEqual({
      ok: false,
      error: "No default controller available",
    });
  });

  it("reports the command's own error when it printed nothing, as a kill or a missing binary does", async () => {
    const run = vi.fn<Run>(async () => {
      throw Object.assign(new Error("spawn bluetoothctl ENOENT"), { stdout: "" });
    });
    expect(await createBluetoothctlHost({ run }).forget(MAC)).toStrictEqual({
      ok: false,
      error: "spawn bluetoothctl ENOENT",
    });
    const bare = vi.fn<Run>(async () => {
      throw "not an Error";
    });
    expect(await createBluetoothctlHost({ run: bare }).forget(MAC)).toStrictEqual({
      ok: false,
      error: "not an Error",
    });
  });

  const exited = (stdout: string, fields: object) => async (): Promise<string> => {
    throw Object.assign(new Error("Command failed: bluetoothctl remove"), { ...fields, stdout });
  };
  const gone = `Device ${MAC} not available\n`;

  it("reads exit 0 after 'not available' as a removal that did not complete", async () => {
    expect(await createBluetoothctlHost({ run: async () => gone }).forget(MAC)).toStrictEqual({
      ok: false,
      error: "removal did not complete",
    });
  });

  it.each([
    ["exit 2 after 'not available'", gone, { code: 2, killed: false, signal: null }],
    [
      "exit 1 after 'Device has been removed'",
      "Device has been removed\n",
      { code: 1, killed: false, signal: null },
    ],
    ["a kill after 'not available'", gone, { code: null, killed: true, signal: "SIGKILL" }],
    ["a signal after 'not available'", gone, { code: 1, killed: false, signal: "SIGTERM" }],
    [
      "exit 1 from a killed run after 'not available'",
      gone,
      { code: 1, killed: true, signal: null },
    ],
  ] as const)("reads %s as failure, reporting the command's error", async (_, stdout, fields) => {
    const result = await createBluetoothctlHost({ run: exited(stdout, fields) }).forget(MAC);
    expect(result).toStrictEqual({ ok: false, error: "Command failed: bluetoothctl remove" });
  });
});

// A stand-in `bluetoothctl` on PATH, so forget() runs through the real `runBluetoothctl` and the
// real `execFile`: a non-zero exit rejects, and the output has to survive that rejection.
describe("forget() through the real runBluetoothctl", () => {
  const MAC = "5A:4A:45:D4:FB:BB";
  let dir: string;
  let savedPath: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "print-agent-bt-remove-"));
    savedPath = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${savedPath ?? ""}`;
  });
  afterEach(async () => {
    process.env.PATH = savedPath;
    await rm(dir, { recursive: true, force: true });
  });

  async function fake(body: string): Promise<void> {
    await writeFile(join(dir, "bluetoothctl"), `#!/bin/sh\n${body}\n`);
    await chmod(join(dir, "bluetoothctl"), 0o755);
  }

  it("reads the measured exit-1 'not available' as success", async () => {
    await fake(`echo "Device $2 not available"; exit 1`);
    expect(await createBluetoothctlHost({ run: runBluetoothctl }).forget(MAC)).toStrictEqual({
      ok: true,
    });
  });

  it("reads the measured exit-0 removal as success", async () => {
    await fake(`echo "[DEL] Device $2 BlueTooth Printer"; echo "Device has been removed"; exit 0`);
    expect(await createBluetoothctlHost({ run: runBluetoothctl }).forget(MAC)).toStrictEqual({
      ok: true,
    });
  });

  it("reads an exit-1 refusal as failure with BlueZ's reason", async () => {
    await fake(`echo "Failed to remove device: org.freedesktop.DBus.Error.AccessDenied"; exit 1`);
    expect(await createBluetoothctlHost({ run: runBluetoothctl }).forget(MAC)).toStrictEqual({
      ok: false,
      error: "org.freedesktop.DBus.Error.AccessDenied",
    });
  });

  it("reads exit 2 after 'not available' as failure", async () => {
    await fake(`echo "Device $2 not available"; exit 2`);
    expect(await createBluetoothctlHost({ run: runBluetoothctl }).forget(MAC)).toStrictEqual({
      ok: false,
      error: `Command failed: bluetoothctl remove ${MAC}\n`,
    });
  });

  it("reads exit 1 after 'Device has been removed' as failure", async () => {
    await fake(`echo "Device has been removed"; exit 1`);
    expect(await createBluetoothctlHost({ run: runBluetoothctl }).forget(MAC)).toStrictEqual({
      ok: false,
      error: `Command failed: bluetoothctl remove ${MAC}\n`,
    });
  });

  it("reads a kill after 'not available' as failure", async () => {
    await fake(`echo "Device $2 not available"; kill -9 $$`);
    expect(await createBluetoothctlHost({ run: runBluetoothctl }).forget(MAC)).toStrictEqual({
      ok: false,
      error: `Command failed: bluetoothctl remove ${MAC}\n`,
    });
  });
});

// A stand-in `bluetoothctl` on PATH speaking the interactive protocol measured 2026-09-29 with the
// image's bluetoothctl 5.82 against a stand-in BlueZ: prompts with no newline, the PIN echoed back, `quit` read last. It records what it was sent,
// so the pipes are proven against a real child process and the real `spawn`.
describe("pair() through the real spawn", () => {
  const MAC = "86:67:7A:00:00:01";
  let dir: string;
  let savedPath: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "print-agent-bt-pair-"));
    savedPath = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${savedPath ?? ""}`;
    const pad = `\\r%79s\\r`;
    const prompt = `\\033[0;94m[bluetoothctl]> \\033[0m`;
    await writeFile(
      join(dir, "bluetoothctl"),
      [
        "#!/bin/sh",
        `log="${join(dir, "stdin.log")}"`,
        // Given a command, the real one runs one-shot and registers no agent (measured the same way).
        `if [ "$#" -ne 0 ]; then echo "one-shot $*" > "$log"; exit 1; fi`,
        `printf 'Waiting to connect to bluetoothd...'`,
        `printf '${pad}Agent registered\\n${prompt}' ''`,
        `read -r cmd; echo "$cmd" >> "$log"; echo "$cmd"`,
        `printf 'Attempting to pair with %s\\n${prompt}' "\${cmd#pair }"`,
        `printf '${pad}Request PIN code\\n${prompt}\\r\\033[1;39m[agent] Enter PIN code: \\033[0m' ''`,
        `read -r pin; echo "$pin" >> "$log"; echo "$pin"`,
        `if [ "$pin" = 1234 ]; then`,
        `  printf '${pad}Pairing successful\\n${prompt}' ''`,
        `else`,
        `  printf '${pad}Failed to pair: org.bluez.Error.AuthenticationFailed\\n${prompt}' ''`,
        `fi`,
        `read -r last; echo "$last" >> "$log"`,
        `exit 0`,
      ].join("\n"),
    );
    await chmod(join(dir, "bluetoothctl"), 0o755);
  });
  afterEach(async () => {
    process.env.PATH = savedPath;
    await rm(dir, { recursive: true, force: true });
  });

  const sent = (): Promise<string> => readFile(join(dir, "stdin.log"), "utf8");

  it("pairs with the right PIN, sending pair, the PIN and quit in that order", async () => {
    const host = createBluetoothctlHost({ run: runBluetoothctl, pair: pairWithBluetoothctl });
    expect(await host.pair(MAC, "1234")).toStrictEqual({ ok: true, localKey: MAC });
    expect(await sent()).toBe(`pair ${MAC}\n1234\nquit\n`);
  });

  it("reports a wrong PIN, without the PIN in the result", async () => {
    const outcome = await pairWithBluetoothctl(MAC, "9999");
    expect(outcome).toStrictEqual({ ok: false, error: "wrong PIN" });
    expect(await sent()).toBe(`pair ${MAC}\n9999\nquit\n`);
  });

  it("reports a bluetoothctl that is not installed", async () => {
    process.env.PATH = dir;
    await rm(join(dir, "bluetoothctl"));
    expect(await pairWithBluetoothctl(MAC, "1234")).toStrictEqual({
      ok: false,
      error: "spawn bluetoothctl ENOENT",
    });
  });
});
