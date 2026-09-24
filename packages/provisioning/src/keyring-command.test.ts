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
    // Throws rather than returning "", so an edit that read a secret here fails instead of
    // passing quietly.
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
    expect(printed).toMatch(/scrollback|logged to disk|tmux/i);
  });

  it("waits for the operator before clearing", async () => {
    // The answer is a gate this test holds open: a `prompt` that returned at once would record the
    // same order whether or not `runKeyring` awaited it.
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
    // Nothing here is timer-based, so a `runKeyring` not suspended on the prompt would have cleared.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toContain("prompt");
    expect(order).not.toContain("clear");

    answer();
    expect(await running).toBe(0);
    expect(order).toContain("clear");
    expect(order.indexOf("prompt")).toBeLessThan(order.indexOf("clear"));
    expect(order.indexOf("print")).toBeLessThan(order.indexOf("prompt"));
  });
});
