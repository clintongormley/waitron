import { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { runBluetoothctl } from "./bluetooth-command.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

describe("runBluetoothctl", () => {
  it("bounds the command and returns its output", async () => {
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      (args[3] as (error: null, stdout: string) => void)(null, "Device AA:BB:CC:DD:EE:FF Printer");
      return undefined as never;
    });
    await expect(runBluetoothctl(["devices"])).resolves.toContain("Printer");
    expect(execFile).toHaveBeenCalledWith(
      "bluetoothctl",
      ["devices"],
      {
        timeout: 15_000,
        killSignal: "SIGKILL",
        maxBuffer: 1_048_576,
        encoding: "utf8",
      },
      expect.any(Function),
    );
  });

  it.each(["ENOENT", "command exited 1", "command timed out"])(
    "rejects %s instead of returning an empty scan",
    async (message) => {
      const error = new Error(message);
      vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
        (args[3] as (error: Error, stdout: string) => void)(error, "");
        return undefined as never;
      });
      await expect(runBluetoothctl(["scan", "on"])).rejects.toBe(error);
    },
  );
});
