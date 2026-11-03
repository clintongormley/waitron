import { Buffer } from "node:buffer";
import { TextEncoder } from "node:util";
import { describe, expect, it } from "vitest";
import {
  DISK_KEY_BYTES,
  DISK_KEY_LETTERS,
  DISK_KEY_TEXT_LENGTH,
  diskRecoveryKeyPassphrase,
  formatDiskRecoveryKey,
} from "./disk-recovery-key.mjs";

const ascii = (/** @type {string} */ text) => new TextEncoder().encode(text);

const ZERO_KEY = new Uint8Array(32);
const FF_KEY = new Uint8Array(32).fill(0xff);
const COUNTING_ROW = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];
const COUNTING_KEY = new Uint8Array([
  ...COUNTING_ROW,
  ...COUNTING_ROW,
  ...COUNTING_ROW,
  ...COUNTING_ROW,
]);
const HIGH_FIRST_KEY = new Uint8Array(32);
HIGH_FIRST_KEY[0] = 0x10;

/** @type {Array<[string, Uint8Array, string]>} */
const FORMATTED = [
  ["all zero", ZERO_KEY, "cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc"],
  ["all 0xFF", FF_KEY, "vvvvvvvv-vvvvvvvv-vvvvvvvv-vvvvvvvv-vvvvvvvv-vvvvvvvv-vvvvvvvv-vvvvvvvv"],
  [
    "every half-byte value",
    COUNTING_KEY,
    "cbdefghi-jklnrtuv-cbdefghi-jklnrtuv-cbdefghi-jklnrtuv-cbdefghi-jklnrtuv",
  ],
  [
    "0x10 first",
    HIGH_FIRST_KEY,
    "bccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc",
  ],
];

/** @param {() => unknown} run */
function thrown(run) {
  try {
    run();
  } catch (error) {
    return /** @type {Error & { code?: string, reason?: string }} */ (error);
  }
  throw new Error("expected a throw");
}

class LyingLength extends Uint8Array {
  get length() {
    return 32;
  }
}

describe("the constants", () => {
  it("are systemd's letters in half-byte order, 32 bytes and 71 characters", () => {
    expect(DISK_KEY_LETTERS).toBe("cbdefghijklnrtuv");
    expect(DISK_KEY_BYTES).toBe(32);
    expect(DISK_KEY_TEXT_LENGTH).toBe(71);
  });
});

describe("formatDiskRecoveryKey", () => {
  it.each(FORMATTED)("formats %s", (_name, key, text) => {
    expect(formatDiskRecoveryKey(key)).toBe(text);
  });

  it("writes the high half of a byte first", () => {
    expect(formatDiskRecoveryKey(HIGH_FIRST_KEY).startsWith("bc")).toBe(true);
  });

  it("accepts a Buffer", () => {
    expect(formatDiskRecoveryKey(Buffer.from(COUNTING_KEY))).toBe(
      "cbdefghi-jklnrtuv-cbdefghi-jklnrtuv-cbdefghi-jklnrtuv-cbdefghi-jklnrtuv",
    );
  });
});

describe("diskRecoveryKeyPassphrase", () => {
  it.each(FORMATTED)("gives the 71 ASCII bytes of %s", (_name, key, text) => {
    const bytes = diskRecoveryKeyPassphrase(key);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(71);
    expect(bytes).toEqual(ascii(text));
  });

  it("gives a new array each call", () => {
    const first = diskRecoveryKeyPassphrase(COUNTING_KEY);
    const second = diskRecoveryKeyPassphrase(COUNTING_KEY);
    expect(first).not.toBe(second);
    first.fill(0);
    expect(second).toEqual(
      ascii("cbdefghi-jklnrtuv-cbdefghi-jklnrtuv-cbdefghi-jklnrtuv-cbdefghi-jklnrtuv"),
    );
  });

  it("accepts a Buffer", () => {
    expect(diskRecoveryKeyPassphrase(Buffer.alloc(32))).toEqual(
      ascii("cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc-cccccccc"),
    );
  });
});

describe.each([
  ["formatDiskRecoveryKey", formatDiskRecoveryKey],
  ["diskRecoveryKeyPassphrase", diskRecoveryKeyPassphrase],
])("%s's byte check", (_name, run) => {
  it("leaves the input unchanged", () => {
    for (const [, key] of FORMATTED) {
      const copy = Uint8Array.from(key);
      run(key);
      expect(key).toEqual(copy);
    }
  });

  it.each([
    ["a plain array", Array.from({ length: 32 }, () => 0)],
    ["a string", "c".repeat(32)],
    ["null", null],
    ["an ArrayBuffer", new ArrayBuffer(32)],
    ["a Uint16Array", new Uint16Array(32)],
  ])("refuses %s as not-bytes", (_what, value) => {
    const error = thrown(() => run(/** @type {Uint8Array} */ (value)));
    expect(error.code).toBe("disk_recovery_key.invalid");
    expect(error.reason).toBe("not-bytes");
  });

  it.each([
    ["31 bytes", new Uint8Array(31)],
    ["33 bytes", new Uint8Array(33)],
    ["no bytes", new Uint8Array(0)],
    ["a subclass claiming 32", new LyingLength(31)],
  ])("refuses %s as wrong-length", (_what, value) => {
    const error = thrown(() => run(value));
    expect(error.code).toBe("disk_recovery_key.invalid");
    expect(error.reason).toBe("wrong-length");
  });

  it("puts no key byte or letter in its error", () => {
    const canary = new Uint8Array(33);
    canary.set(COUNTING_KEY);
    const error = thrown(() => run(canary));
    const texts = [JSON.stringify(error), String(error), error.message, String(error.reason)];
    for (const text of texts)
      for (const secret of ["cbdefghi", "jklnrtuv", "0123456789abcdef"])
        expect(text).not.toContain(secret);
  });
});
