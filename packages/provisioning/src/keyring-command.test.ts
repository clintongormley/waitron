import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { generateKeyRing, runKeyring } from "./keyring-command.js";
import type { ProvisioningIo } from "./io.js";

function recordingIo(
  answers: string[] = [""],
): ProvisioningIo & { lines: string[]; cleared: number } {
  const lines: string[] = [];
  let cleared = 0;
  const queue = [...answers];
  return {
    lines,
    get cleared() {
      return cleared;
    },
    stdout: (line) => lines.push(line),
    stderr: (line) => lines.push(line),
    prompt: async () => queue.shift() ?? "",
    clearScreen: () => {
      cleared += 1;
    },
  };
}

describe("generateKeyRing", () => {
  it("returns 32 bytes base64 at version 1", () => {
    const ring = generateKeyRing((n) => Buffer.alloc(n, 7));
    expect(Buffer.from(ring.key, "base64")).toHaveLength(32);
    expect(ring.version).toBe(1);
  });

  it("refuses a CSPRNG that short-changed it", () => {
    let thrown: unknown;
    try {
      generateKeyRing(() => Buffer.alloc(16));
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.key_generation_failed");
    expect(thrown.params).toEqual({ byteLength: 16 });
  });
});

describe("runKeyring", () => {
  it("prints the two variables an operator must set, then clears the screen", async () => {
    const io = recordingIo();
    const code = await runKeyring(io, (n) => Buffer.alloc(n, 7));
    expect(code).toBe(0);
    const printed = io.lines.join("\n");
    expect(printed).toContain("WAITRON_CREDENTIALS_KEY=");
    expect(printed).toContain("WAITRON_CREDENTIALS_KEY_VERSION=1");
    expect(io.cleared).toBe(1);
  });

  it("says plainly what clearing the screen does NOT do", async () => {
    const io = recordingIo();
    await runKeyring(io, (n) => Buffer.alloc(n, 7));
    const printed = io.lines.join("\n");
    // Spec §5: "The tool says so rather than implying the key is gone." A terminal logging to
    // disk, or tmux's own buffer, still has it.
    expect(printed).toMatch(/scrollback|logged to disk|tmux/i);
  });

  it("waits for the operator before clearing", async () => {
    const order: string[] = [];
    const io: ProvisioningIo = {
      stdout: () => order.push("print"),
      stderr: () => order.push("print"),
      prompt: async () => {
        order.push("prompt");
        return "";
      },
      clearScreen: () => order.push("clear"),
    };
    await runKeyring(io, (n) => Buffer.alloc(n, 7));
    // The key is unrecoverable once cleared, so the clear MUST come after an acknowledgement —
    // clearing on a timer would race an operator who had not yet copied it.
    expect(order.indexOf("prompt")).toBeLessThan(order.indexOf("clear"));
    expect(order.indexOf("print")).toBeLessThan(order.indexOf("prompt"));
  });
});
