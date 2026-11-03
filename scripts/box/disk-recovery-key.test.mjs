import { Buffer } from "node:buffer";
import { getRandomValues } from "node:crypto";
import { TextEncoder, inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISK_KEY_BYTES,
  DISK_KEY_LETTERS,
  DISK_KEY_TEXT_LENGTH,
  DISK_KEY_TEXT_MAX,
  diskRecoveryKeyPassphrase,
  formatDiskRecoveryKey,
  parseDiskRecoveryKey,
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

/**
 * @param {() => unknown} run
 * @param {string} reason
 */
function expectInvalid(run, reason) {
  const error = thrown(run);
  expect(error.code).toBe("disk_recovery_key.invalid");
  expect(error.reason).toBe(reason);
  expect(error.message).toBe("disk_recovery_key.invalid");
  expect(Object.keys(error).sort()).toEqual(["code", "reason"]);
  return error;
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
    expectInvalid(() => run(/** @type {Uint8Array} */ (value)), "not-bytes");
  });

  it.each([
    ["31 bytes", new Uint8Array(31)],
    ["33 bytes", new Uint8Array(33)],
    ["no bytes", new Uint8Array(0)],
    ["a subclass claiming 32", new LyingLength(31)],
  ])("refuses %s as wrong-length", (_what, value) => {
    expectInvalid(() => run(value), "wrong-length");
  });

  it("puts no key byte or letter in its error", () => {
    const canary = new Uint8Array(33);
    canary.set(COUNTING_KEY);
    const error = expectInvalid(() => run(canary), "wrong-length");
    const texts = [
      JSON.stringify(error),
      String(error),
      error.message,
      String(error.reason),
      inspect(error, { depth: 10, showHidden: true }),
    ];
    for (const text of texts)
      for (const secret of ["cbdefghi", "jklnrtuv", "0123456789abcdef"])
        expect(text).not.toContain(secret);
  });
});

const CDEFGHIJ = "cdefghij-cdefghij-cdefghij-cdefghij-cdefghij-cdefghij-cdefghij-cdefghij";
const IEFG = "iefgcelh-biduvkjv-cjvuncnk-vlfchdid-jhtuhhde-urkllkeg-ilkjgbrt-hjkbgktj";
const COUNTING_TEXT = "cbdefghi-jklnrtuv-cbdefghi-jklnrtuv-cbdefghi-jklnrtuv-cbdefghi-jklnrtuv";

/** @param {string} text */
function parsedKey(text) {
  const result = parseDiskRecoveryKey(text);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`);
  return result.key;
}

describe("parseDiskRecoveryKey reads systemd's vectors", () => {
  // systemd v257 src/test/test-recovery-key.c:100-134 and src/test/test-modhex.c:20-48.
  it.each([
    ["cdefghijcdefghijcdefghijcdefghijcdefghijcdefghijcdefghijcdefghij", CDEFGHIJ],
    [
      "cdefVhij-cDefghij-cdefkhij-cdufghij-cdefgdij-cidefIhj-cdefNijR-cdVfguij",
      "cdefvhij-cdefghij-cdefkhij-cdufghij-cdefgdij-cidefihj-cdefnijr-cdvfguij",
    ],
    [
      "BFGHICEHHIUVLKJIHFHEDlntruvcdefjiTUVKLNIJVTUTKJIHDFBCBGHIJHHFDBC",
      "bfghiceh-hiuvlkji-hfhedlnt-ruvcdefj-ituvklni-jvtutkji-hdfbcbgh-ijhhfdbc",
    ],
    ["iefgcelh-biduvkjv-cjvuncnk-vlfchdid-jhtuhhde-urkllkeg-ilkjgbrt-hjkbgktj", IEFG],
    ["iefgcelhbiduvkjvcjvuncnkvlfchdidjhtuhhdeurkllkegilkjgbrthjkbgktj", IEFG],
    ["IEFGCELH-BIDUVKJV-CJVUNCNK-VLFCHDID-JHTUHHDE-URKLLKEG-ILKJGBRT-HJKBGKTJ", IEFG],
    ["IEFGCELHBIDUVKJVCJVUNCNKVLFCHDIDJHTUHHDEURKLLKEGILKJGBRTHJKBGKTJ", IEFG],
    ["Iefgcelh-Biduvkjv-Cjvuncnk-Vlfchdid-Jhtuhhde-Urkllkeg-Ilkjgbrt-Hjkbgktj", IEFG],
    ["Iefgcelhbiduvkjvcjvuncnkvlfchdidjhtuhhdeurkllkegilkjgbrthjkbgktj", IEFG],
  ])("accepts %s", (input, normalised) => {
    expect(formatDiskRecoveryKey(parsedKey(input))).toBe(normalised);
  });

  it("accepts systemd's one-hyphen-missing text, which systemd refuses", () => {
    const text = "cdefghij-cdefghij-cdefghij-cdefghij-cdefghij-cdefghij-cdefghijcdefghij";
    expect(formatDiskRecoveryKey(parsedKey(text))).toBe(CDEFGHIJ);
  });

  it.each([
    ["1234-5678-90AB-CDEF-1234-5678-90AB-CDEF", { ok: false, reason: "letter", position: 1 }],
    ["", { ok: false, reason: "length", letters: 0 }],
    [
      "cde123hi-cdefgzij-cdefghij-cdefghij-cdefghij-cdefghij-cdefghijcdefghij",
      { ok: false, reason: "letter", position: 4 },
    ],
    [
      "iefgcelh-biduvkjv-cjvuncnk-vlfchdid-jhtuhhde-urkllkeg-ilkjgbrt-hjkbgkt",
      { ok: false, reason: "length", letters: 63 },
    ],
    [
      "iefgcelhbiduvkjvcjvuncnkvlfchdidjhtuhhdeurkllkegilkjgbrthjkbgkt",
      { ok: false, reason: "length", letters: 63 },
    ],
    [
      "IEFGCELHBIDUVKJVCJVUNCNKVLFCHDIDJHTUHHDEURKLLKEGILKJGBRTHJKBGKT",
      { ok: false, reason: "length", letters: 63 },
    ],
    [
      "xefgcelh-biduvkjv-cjvuncnk-vlfchdid-jhtuhhde-urkllkeg-ilkjgbrt-hjkbgktj",
      { ok: false, reason: "letter", position: 1 },
    ],
    [
      "Xefgcelh-biduvkjv-cjvuncnk-vlfchdid-jhtuhhde-urkllkeg-ilkjgbrt-hjkbgktj",
      { ok: false, reason: "letter", position: 1 },
    ],
    [
      "iefgcelh+biduvkjv-cjvuncnk-vlfchdid-jhtuhhde-urkllkeg-ilkjgbrt-hjkbgktj",
      { ok: false, reason: "letter", position: 9 },
    ],
    [
      "iefgcelhebiduvkjv-cjvuncnk-vlfchdid-jhtuhhde-urkllkeg-ilkjgbrt-hjkbgktj",
      { ok: false, reason: "length", letters: 65 },
    ],
  ])("refuses %j", (input, answer) => {
    expect(parseDiskRecoveryKey(input)).toEqual(answer);
  });
});

describe("parseDiskRecoveryKey round trip", () => {
  /** @type {Array<[string, (text: string) => string]>} */
  const SPELLINGS = [
    ["as printed", (text) => text],
    ["in upper case", (text) => text.toUpperCase()],
    ["without hyphens", (text) => text.replaceAll("-", "")],
    ["with spaces for hyphens", (text) => text.replaceAll("-", " ")],
    ["over two lines", (text) => `${text.slice(0, 35)}\r\n${text.slice(36)}`],
    ["padded with a tab and spaces", (text) => `\t  ${text}  \t `],
  ];

  for (const [name, key, text] of FORMATTED)
    it.each(SPELLINGS)(`reads ${name} %s`, (_spelling, spell) => {
      expect(parsedKey(spell(text))).toEqual(key);
    });

  it("reads 200 random keys back to themselves", () => {
    for (let i = 0; i < 200; i++) {
      const key = getRandomValues(new Uint8Array(32));
      expect(parsedKey(formatDiskRecoveryKey(key))).toEqual(key);
    }
  });

  it("gives a fresh array each parse", () => {
    const first = parsedKey(COUNTING_TEXT);
    const second = parsedKey(COUNTING_TEXT);
    expect(first).not.toBe(second);
    first.fill(0);
    expect(second).toEqual(COUNTING_KEY);
  });
});

describe("parseDiskRecoveryKey refusals", () => {
  /** @param {string} replacement */
  const atNine = (replacement) =>
    `${COUNTING_TEXT.slice(0, 8)}${replacement}${COUNTING_TEXT.slice(9)}`;

  it.each([
    ["a", "a"],
    ["o", "o"],
    ["a digit 0", "0"],
    ["c with cedilla", "\u00E7"],
    ["the Kelvin sign", "\u212A"],
    ["capital I with a dot", "\u0130"],
    ["a dotless i", "\u0131"],
    ["an en dash", "\u2013"],
    ["a no-break space", "\u00A0"],
    ["a full-width c", "\uFF43"],
  ])("refuses %s at position 9", (_name, character) => {
    expect(parseDiskRecoveryKey(atNine(character))).toEqual({
      ok: false,
      reason: "letter",
      position: 9,
    });
  });

  it("refuses an emoji at its own position before a later bad letter", () => {
    const text = `cb\u{1F600}${COUNTING_TEXT.slice(2, 20)}a${COUNTING_TEXT.slice(20)}`;
    expect(parseDiskRecoveryKey(text)).toEqual({ ok: false, reason: "letter", position: 3 });
    expect(parseDiskRecoveryKey("\u{1F600}a")).toEqual({
      ok: false,
      reason: "letter",
      position: 1,
    });
  });

  it("checks letters before the count", () => {
    expect(parseDiskRecoveryKey(`${"c".repeat(63)}a`)).toEqual({
      ok: false,
      reason: "letter",
      position: 64,
    });
  });

  it.each([
    ["63 letters", "c".repeat(63), 63],
    ["65 letters", "c".repeat(65), 65],
    ["only separators", " - \n", 0],
    ["4097 characters", "c".repeat(4097), null],
  ])("refuses %s by length", (_name, text, letters) => {
    expect(parseDiskRecoveryKey(text)).toEqual({ ok: false, reason: "length", letters });
  });

  it("reads exactly 4096 characters", () => {
    expect(DISK_KEY_TEXT_MAX).toBe(4096);
    const text = `${"c".repeat(64)}${" ".repeat(4032)}`;
    expect(text.length).toBe(4096);
    expect(parsedKey(text)).toEqual(new Uint8Array(32));
  });

  it.each([
    ["undefined", undefined],
    ["a number", 42],
    ["a String object", new String("c".repeat(64))],
  ])("throws not-text for %s", (_name, value) => {
    expectInvalid(() => parseDiskRecoveryKey(/** @type {string} */ (value)), "not-text");
  });
});

describe("parseDiskRecoveryKey keeps the key out of its answers", () => {
  const GROUPS = COUNTING_TEXT.split("-");
  const RUN = /[cbdefghijklnrtuv]{8}/i;

  /** @param {string} text */
  const expectNoKey = (text) => {
    for (const group of GROUPS) expect(text).not.toContain(group);
    expect(text).not.toMatch(RUN);
  };

  it.each([
    ["a letter replaced", `a${COUNTING_TEXT.slice(1)}`],
    ["a letter removed", COUNTING_TEXT.slice(1)],
    ["a letter added", `c${COUNTING_TEXT}`],
  ])("with %s", (_name, text) => {
    const result = parseDiskRecoveryKey(text);
    expect(result.ok).toBe(false);
    expectNoKey(JSON.stringify(result));
    expectNoKey(inspect(result, { depth: 10, showHidden: true }));
  });

  it("in its not-text error", () => {
    const error = expectInvalid(
      () =>
        parseDiskRecoveryKey(
          /** @type {string} */ (/** @type {unknown} */ (new String(COUNTING_TEXT))),
        ),
      "not-text",
    );
    expectNoKey(JSON.stringify(error));
    expectNoKey(String(error));
    const shown = inspect(error, { depth: 10, showHidden: true });
    for (const group of GROUPS) expect(shown).not.toContain(group);
  });
});

describe("the working arrays are zeroed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Lengths of the byte arrays `fill(0)` was called on after this point. */
  const zeroedLengths = () => {
    const fill = vi.spyOn(Uint8Array.prototype, "fill");
    return () =>
      fill.mock.calls.flatMap((call, index) =>
        call[0] === 0 && call.length === 1
          ? [/** @type {Uint8Array} */ (fill.mock.contexts[index]).length]
          : [],
      );
  };

  it("formatDiskRecoveryKey zeroes its 71 character codes", () => {
    const lengths = zeroedLengths();
    formatDiskRecoveryKey(COUNTING_KEY);
    expect(lengths()).toContain(71);
  });

  it.each([
    ["an accepted key", COUNTING_TEXT, true],
    ["a letter refusal", `a${COUNTING_TEXT.slice(1)}`, false],
    ["a length refusal", COUNTING_TEXT.slice(1), false],
  ])("parseDiskRecoveryKey zeroes its 64 half-bytes on %s", (_name, text, ok) => {
    const lengths = zeroedLengths();
    expect(parseDiskRecoveryKey(text).ok).toBe(ok);
    expect(lengths()).toContain(64);
  });
});
