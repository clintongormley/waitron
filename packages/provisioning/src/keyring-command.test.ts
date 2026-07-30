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
    // `runKeyring` must never reach this: it PRINTS a secret it generated and reads nothing back
    // but an acknowledgement. Throwing rather than returning "" is what makes that assertion
    // rather than an assumption — a future edit that read the key ring back through an echo-off
    // prompt would fail here instead of passing quietly.
    promptSecret: async () => {
      throw new Error("runKeyring must not read a secret");
    },
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
    // The operator's answer is a gate THIS TEST holds open, not a promise that resolves on its own.
    // That is the whole point: a `prompt` that merely pushed its marker and returned would record
    // the identical order whether or not `runKeyring` awaited it, because the marker is pushed
    // before any await boundary. The earlier version of this test did exactly that and passed with
    // `await io.prompt(...)` changed to `void io.prompt(...)` — the fire-and-forget bug that wipes
    // an unrecoverable key off the screen before the operator has copied it. Verified by running
    // that mutant: this version fails on the `not.toContain("clear")` assertion below, the old one
    // stayed green.
    const order: string[] = [];
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const io: ProvisioningIo = {
      stdout: () => order.push("print"),
      stderr: () => order.push("print"),
      prompt: async () => {
        order.push("prompt");
        await answered;
        return "";
      },
      promptSecret: async () => {
        throw new Error("runKeyring must not read a secret");
      },
      clearScreen: () => order.push("clear"),
    };
    const running = runKeyring(io, (n) => Buffer.alloc(n, 7));
    // Drain every microtask that CAN run. Nothing here is timer-based, so if `runKeyring` were not
    // suspended on the prompt it would already have cleared by now.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toContain("prompt");
    // The key is unrecoverable once cleared, so the clear MUST come after an acknowledgement —
    // clearing on a timer, or not awaiting at all, would race an operator who had not yet copied it.
    expect(order).not.toContain("clear");

    answer();
    expect(await running).toBe(0);
    expect(order).toContain("clear");
    expect(order.indexOf("prompt")).toBeLessThan(order.indexOf("clear"));
    expect(order.indexOf("print")).toBeLessThan(order.indexOf("prompt"));
  });
});
