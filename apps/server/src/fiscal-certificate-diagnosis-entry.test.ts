import { Duplex } from "node:stream";
import { Socket } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { runCertificateDiagnosisEntry } from "./fiscal-certificate-diagnosis-dispatch.js";

vi.mock("node:net", async (original) => ({
  ...(await original<typeof import("node:net")>()),
  Socket: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
});
it.each([false, true])(
  "the entry exits unsuccessfully only for an interrupted channel (%s)",
  async (interrupted) => {
    const output: string[] = [];
    const channel = new Duplex({
      read() {},
      write(data, _encoding, callback) {
        output.push(data.toString());
        callback();
      },
    });
    vi.mocked(Socket).mockImplementation(function () {
      return channel as Socket;
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("entry interrupted");
    });
    const pending = runCertificateDiagnosisEntry(() => ({
      diagnoseInChild: async () => ({ selected: true }),
    }));
    channel.push(interrupted ? "null\n" : '{"type":"run","fiscalId":"fixture","input":null}\n');
    if (interrupted) {
      await expect(pending).rejects.toThrow("entry interrupted");
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(output).toEqual([]);
    } else {
      await pending;
      expect(exit).not.toHaveBeenCalled();
      expect(output.map((frame) => JSON.parse(frame))).toEqual([
        { type: "result", value: { selected: true } },
      ]);
    }
    expect(channel.destroyed).toBe(true);
    expect(channel.listenerCount("data")).toBe(0);
  },
);
