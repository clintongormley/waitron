import { Buffer } from "node:buffer";
import { TextDecoder, TextEncoder } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  LUKS2_TOKENS_MAX,
  NAME_TAG_MAX_BYTES,
  NAME_TAG_MAX_CODE_POINTS,
  NAME_TAG_METADATA_MAX_BYTES,
  NAME_TAG_TYPE,
  NAME_TAG_VERSION,
  decodeNameTag,
  encodeNameTag,
  findNameTag,
  usableVenueName,
} from "./name-tag.mjs";

/** @param {string} text */
const utf8 = (text) => new TextEncoder().encode(text);

/** @param {string} name @param {boolean} live */
const canonicalText = (name, live) =>
  JSON.stringify({ type: "waitron-name-tag", keyslots: [], version: 1, name, live });

/** @param {string} name @param {boolean} live */
const canonical = (name, live) => utf8(canonicalText(name, live));

const EMOJI_256 = "\u{1F600}".repeat(256);
const QUOTES_256 = '"'.repeat(256);

const UNUSABLE_NAMES = [
  ["empty", ""],
  ["257 emoji", "\u{1F600}".repeat(257)],
  ["a bell", "Bar\u0007"],
  ["U+0085", "Bar\u0085"],
  ["DEL", "Bar\u007F"],
  ["a tab", "Bar\t"],
  ["a lone surrogate", "Bar\uD800"],
  ["a number", 7],
  ["null", null],
];

describe("name tag constants", () => {
  it("have the format's values", () => {
    expect(NAME_TAG_TYPE).toBe("waitron-name-tag");
    expect(NAME_TAG_VERSION).toBe(1);
    expect(NAME_TAG_MAX_CODE_POINTS).toBe(256);
    expect(NAME_TAG_MAX_BYTES).toBe(1100);
    expect(LUKS2_TOKENS_MAX).toBe(32);
  });

  it("the longest name of four-byte characters fills NAME_TAG_MAX_BYTES exactly", () => {
    expect(encodeNameTag({ name: EMOJI_256, live: false }).length).toBe(NAME_TAG_MAX_BYTES);
  });

  it("256 quotes take 588 bytes, each written as an escape", () => {
    expect(encodeNameTag({ name: QUOTES_256, live: false }).length).toBe(588);
  });
});

describe("usableVenueName", () => {
  it.each([
    ["Bar Santet", "Bar Santet"],
    ["a decomposed name", "Bar A\u0300ngels", "Bar \u00C0ngels"],
    ["256 emoji", EMOJI_256],
    ["768 code points that compose to 256", "e\u0323\u0302".repeat(256), "\u1EC7".repeat(256)],
  ])("%s → its NFC form", (_label, input, expected = input) => {
    expect(usableVenueName(input)).toBe(expected);
  });

  it.each(UNUSABLE_NAMES)("%s → null", (_label, input) => {
    expect(usableVenueName(input)).toBeNull();
  });
});

describe("encodeNameTag", () => {
  it("writes the one canonical byte form", () => {
    expect(encodeNameTag({ name: "Bar \u00C0ngels", live: true })).toEqual(
      utf8(
        '{"type":"waitron-name-tag","keyslots":[],"version":1,"name":"Bar \u00C0ngels","live":true}',
      ),
    );
  });

  it("stores a decomposed name composed", () => {
    expect(encodeNameTag({ name: "Bar A\u0300ngels", live: false })).toEqual(
      canonical("Bar \u00C0ngels", false),
    );
  });

  it("returns a fresh array on each call", () => {
    const first = encodeNameTag({ name: "Bar", live: true });
    const second = encodeNameTag({ name: "Bar", live: true });
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("keeps a name that looks like a marker inside one JSON string", () => {
    const name = '","subsystem":"waitron-box-1","label":"x';
    const parsed = JSON.parse(new TextDecoder().decode(encodeNameTag({ name, live: true })));
    expect(Object.keys(parsed)).toEqual(["type", "keyslots", "version", "name", "live"]);
    expect(parsed.name).toBe(name);
  });

  it.each(UNUSABLE_NAMES.filter(([, name]) => typeof name === "string"))(
    "a name that is %s → throws name-unusable",
    (_label, name) => {
      expect(() => encodeNameTag(/** @type {any} */ ({ name, live: true }))).toThrow(
        expect.objectContaining({ code: "name_tag.tag_invalid", reason: "name-unusable" }),
      );
    },
  );

  it.each([
    ["null", null],
    ["live missing", { name: "Bar" }],
    ["an extra key", { name: "Bar", live: true, extra: 1 }],
    ["live as a string", { name: "Bar", live: "true" }],
    ["name as a number", { name: 7, live: true }],
    ["name as null", { name: null, live: true }],
  ])("%s → throws tag-invalid", (_label, tag) => {
    expect(() => encodeNameTag(/** @type {any} */ (tag))).toThrow(
      expect.objectContaining({ code: "name_tag.tag_invalid", reason: "tag-invalid" }),
    );
  });
});

describe("decodeNameTag round trip", () => {
  const names = [
    "Bar Santet",
    "Bar \u00C0ngels",
    "Caf\u00E9 \u00C0ngels and the Old Cr\u00E8me Br\u00FBl\u00E9e Kitchen on Main Street",
    EMOJI_256,
    QUOTES_256,
    "\\".repeat(256),
    "a/b",
  ];
  const cases = names.flatMap((name) => [
    [[...name].slice(0, 20).join(""), true, name],
    [[...name].slice(0, 20).join(""), false, name],
  ]);

  it.each(cases)("%s (live %s) comes back unchanged and frozen", (_label, live, name) => {
    const tag = { name, live };
    const decoded = decodeNameTag(encodeNameTag(tag));
    expect(decoded).toEqual(tag);
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it("a decomposed input comes back composed", () => {
    expect(decodeNameTag(encodeNameTag({ name: "Bar A\u0300ngels", live: true }))).toEqual({
      name: "Bar \u00C0ngels",
      live: true,
    });
  });
});

describe("decodeNameTag answers null", () => {
  const base = canonicalText("Bar", true);
  const withName = (/** @type {string} */ raw) =>
    `{"type":"waitron-name-tag","keyslots":[],"version":1,"name":${raw},"live":true}`;
  const bytesWithFF = (() => {
    const bytes = canonical("Bar", true);
    bytes[bytes.indexOf(0x42)] = 0xff;
    return bytes;
  })();

  it.each([
    ["a space after the first brace", utf8(base.replace("{", "{ "))],
    ["a final newline", utf8(base + "\n")],
    [
      "name and live swapped",
      utf8('{"type":"waitron-name-tag","keyslots":[],"version":1,"live":true,"name":"Bar"}'),
    ],
    ["an extra subsystem key", utf8(base.replace("}", ',"subsystem":"waitron-box-1"}'))],
    ["live missing", utf8(base.replace(',"live":true', ""))],
    ["type luks2-name-tag", utf8(base.replace("waitron-name-tag", "luks2-name-tag"))],
    ["type Waitron-name-tag", utf8(base.replace("waitron-name-tag", "Waitron-name-tag"))],
    ['keyslots ["0"]', utf8(base.replace('"keyslots":[]', '"keyslots":["0"]'))],
    ["version 2", utf8(base.replace('"version":1', '"version":2'))],
    ['version "1"', utf8(base.replace('"version":1', '"version":"1"'))],
    ["version written 1.0", utf8(base.replace('"version":1', '"version":1.0'))],
    ['live "true"', utf8(base.replace('"live":true', '"live":"true"'))],
    ["an empty name", canonical("", true)],
    ["a decomposed name", canonical("Bar A\u0300ngels", true)],
    ["257 ASCII letters", canonical("a".repeat(257), true)],
    ["a name holding U+0085", canonical("Bar\u0085", true)],
    ["a name written with a JSON escape", utf8(withName('"Bar \\u00c0ngels"'))],
    ["a byte-order mark first", utf8("\uFEFF" + base)],
    ["a 0xFF byte inside the name", bytesWithFF],
    ["not json", utf8("not json")],
    ["an array", utf8("[]")],
    ["null", utf8("null")],
  ])("%s", (_label, bytes) => {
    expect(decodeNameTag(bytes)).toBeNull();
  });

  it("the escaped name parses to the same value as a canonical one", () => {
    expect(JSON.parse(withName('"Bar \\u00c0ngels"')).name).toBe("Bar \u00C0ngels");
  });

  it("an oversized input is refused before JSON.parse runs", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(decodeNameTag(new Uint8Array(NAME_TAG_MAX_BYTES + 1).fill(0x20))).toBeNull();
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });
});

describe("decodeNameTag input", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", canonicalText("Bar", true)],
    ["an Array", Array.from(canonical("Bar", true))],
    ["a Buffer-like plain object", { type: "Buffer", data: Array.from(canonical("Bar", true)) }],
  ])("%s → throws name_tag.input_invalid", (_label, value) => {
    expect(() => decodeNameTag(/** @type {any} */ (value))).toThrow(
      expect.objectContaining({ code: "name_tag.input_invalid", reason: "input-invalid" }),
    );
  });

  it("a Buffer holding canonical bytes decodes", () => {
    expect(decodeNameTag(Buffer.from(canonical("Bar", true)))).toEqual({
      name: "Bar",
      live: true,
    });
  });
});

const REAL_DUMP = `{
  "keyslots":{
    "0":{
      "type":"luks2",
      "key_size":64,
      "af":{
        "type":"luks1",
        "stripes":4000,
        "hash":"sha256"
      },
      "area":{
        "type":"raw",
        "offset":"32768",
        "size":"258048",
        "encryption":"aes-xts-plain64",
        "key_size":64
      },
      "kdf":{
        "type":"pbkdf2",
        "hash":"sha256",
        "iterations":1000,
        "salt":"I6yEof6QPPd2ryE0K/5SCaHhcJPTOqOa+ln+dx1Ttkc="
      }
    }
  },
  "tokens":{
    "0":{
      "type":"waitron-name-tag",
      "keyslots":[],
      "version":1,
      "name":"Bar \u00C0ngels",
      "live":true
    }
  },
  "segments":{
    "0":{
      "type":"crypt",
      "offset":"16777216",
      "size":"dynamic",
      "iv_tweak":"0",
      "encryption":"aes-xts-plain64",
      "sector_size":4096
    }
  },
  "digests":{
    "0":{
      "type":"pbkdf2",
      "keyslots":[
        "0"
      ],
      "segments":[
        "0"
      ],
      "hash":"sha256",
      "iterations":1000,
      "salt":"Y6PcR+jNKMBz6odZDxDfPoo9imDg54+aw3/AE2F5fpY=",
      "digest":"eqDuknDpVH6tdKmfWlW6jAZY2e/Sf8EmNbvCRIiZqCM="
    }
  },
  "config":{
    "json_size":"12288",
    "keyslots_size":"16744448"
  }
}`;

const { tokens: REAL_TOKENS, ...BASE } = JSON.parse(REAL_DUMP);

/** @param {unknown} tokens */
const header = (tokens) => utf8(JSON.stringify({ ...BASE, tokens }));

const TPM = { type: "systemd-tpm2", keyslots: ["0"], "tpm2-pcrs": [7] };
const RECOVERY = { type: "systemd-recovery", keyslots: ["0"] };

/** @param {string} name @param {boolean} live */
const tagObject = (name, live) => JSON.parse(canonicalText(name, live));

describe("findNameTag finds the one tag", () => {
  it("in a real cryptsetup 2.7.5 dump", () => {
    const bytes = findNameTag(utf8(REAL_DUMP));
    expect(bytes).toEqual(encodeNameTag({ name: "Bar \u00C0ngels", live: true }));
    expect(decodeNameTag(bytes)).toEqual({ name: "Bar \u00C0ngels", live: true });
  });

  it("in the same dump compacted", () => {
    expect(findNameTag(header(REAL_TOKENS))).toEqual(
      encodeNameTag({ name: "Bar \u00C0ngels", live: true }),
    );
  });

  it("among systemd's tokens", () => {
    expect(findNameTag(header({ 0: TPM, 1: RECOVERY, 2: tagObject("Bar Santet", false) }))).toEqual(
      canonical("Bar Santet", false),
    );
  });

  it("returns one malformed tag as it is, and it decodes to null", () => {
    const token = { type: NAME_TAG_TYPE, keyslots: [], version: 2, name: "Bar", live: true };
    const bytes = findNameTag(header({ 0: token }));
    expect(bytes).toEqual(utf8(JSON.stringify(token)));
    expect(decodeNameTag(bytes)).toBeNull();
  });

  it("keeps the token's own key order rather than repairing it", () => {
    const token = { live: true, name: "Bar", keyslots: [], type: NAME_TAG_TYPE, version: 1 };
    const bytes = findNameTag(header({ 0: token }));
    expect(bytes).toEqual(utf8(JSON.stringify(token)));
    expect(decodeNameTag(bytes)).toBeNull();
  });

  it("answers fresh bytes each call", () => {
    const input = utf8(REAL_DUMP);
    const first = findNameTag(input);
    first?.fill(0);
    expect(decodeNameTag(findNameTag(input))).toEqual({ name: "Bar \u00C0ngels", live: true });
  });
});

describe("findNameTag answers null", () => {
  const tag = tagObject("Bar", true);
  const withFF = utf8(REAL_DUMP);
  withFF[REAL_DUMP.indexOf("Bar")] = 0xff;

  it.each([
    ["no tokens", header({})],
    ["only systemd's tokens", header({ 0: TPM, 1: RECOVERY })],
    ["only a TPM token", header({ 0: TPM })],
    ["the same tag twice", header({ 2: tag, 5: tag })],
    ["two different tags", header({ 0: tag, 1: tagObject("Bar Santet", false) })],
    ["a tag and a version 2 tag", header({ 0: tag, 1: { ...tag, version: 2 } })],
    ["a token that is a string", header({ 0: NAME_TAG_TYPE })],
    ["type Waitron-name-tag", header({ 0: { type: "Waitron-name-tag", keyslots: [] } })],
    ["a 0xFF byte", withFF],
    ["a byte-order mark first", utf8("\uFEFF" + REAL_DUMP)],
    ["not json", utf8("not json")],
    ["an array", utf8("[]")],
    ["null", utf8("null")],
    ["no tokens key", utf8(JSON.stringify({ ...BASE }))],
    ["tokens an array", header([])],
    ["tokens null", header(null)],
  ])("%s", (_label, metadata) => {
    expect(findNameTag(metadata)).toBeNull();
  });

  it("checks the size before parsing", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      const big = new Uint8Array(NAME_TAG_METADATA_MAX_BYTES + 1).fill(0x20);
      expect(findNameTag(big)).toBeNull();
      expect(parse.mock.calls.length).toBe(0);
    } finally {
      parse.mockRestore();
    }
  });
});

describe("findNameTag at the size limit", () => {
  it("finds the tag in a header padded to exactly NAME_TAG_METADATA_MAX_BYTES", () => {
    const text = REAL_DUMP + " ".repeat(NAME_TAG_METADATA_MAX_BYTES - utf8(REAL_DUMP).length);
    const metadata = utf8(text);
    expect(metadata.length).toBe(NAME_TAG_METADATA_MAX_BYTES);
    expect(findNameTag(metadata)).toEqual(encodeNameTag({ name: "Bar \u00C0ngels", live: true }));
  });
});

describe("findNameTag input", () => {
  it("has a 16 MiB limit", () => {
    expect(NAME_TAG_METADATA_MAX_BYTES).toBe(16 * 1024 * 1024);
  });

  it.each([
    ["a string", REAL_DUMP],
    ["an Array", Array.from(utf8(REAL_DUMP))],
  ])("%s throws name_tag.input_invalid", (_label, input) => {
    expect(() => findNameTag(/** @type {any} */ (input))).toThrow(
      expect.objectContaining({ code: "name_tag.input_invalid", reason: "input-invalid" }),
    );
  });
});
