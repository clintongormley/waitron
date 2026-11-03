import { Buffer } from "node:buffer";
import { TextDecoder, TextEncoder } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { WAITRON_LAYOUTS, classifyDisk } from "./disk-state.mjs";
import { createInstallerState, nextInstallerStep } from "./installer-policy.mjs";
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
  planNameTagWrite,
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
    ["a null name", utf8(withName("null"))],
    ["a number name", utf8(withName("7"))],
    ["a true name", utf8(withName("true"))],
    ["an array name", utf8(withName("[]"))],
    ["an object name", utf8(withName("{}"))],
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

const BAR = { name: "Bar Santet", live: true };

/** @param {number} n */
const others = (n) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { type: "filler", keyslots: [] }]));

/** @param {"import"|"replace"} op @param {number} tokenId @param {{name: string, live: boolean}} tag */
const put = (op, tokenId, tag) => ({ op, tokenId, json: encodeNameTag(tag) });
/** @param {number} tokenId */
const remove = (tokenId) => ({ op: "remove", tokenId });

describe("planNameTagWrite adds a tag", () => {
  it("imports at 0 into a header with no tokens", () => {
    expect(planNameTagWrite(header({}), BAR)).toEqual({
      kind: "write",
      reason: null,
      steps: [put("import", 0, BAR)],
    });
  });

  it("imports at the first number after systemd's tokens", () => {
    expect(planNameTagWrite(header({ 0: TPM, 1: RECOVERY }), BAR).steps).toEqual([
      put("import", 2, BAR),
    ]);
  });

  it("imports at the lowest free number, not the one after the highest", () => {
    expect(planNameTagWrite(header({ 0: TPM, 1: RECOVERY, 3: TPM }), BAR)).toEqual({
      kind: "write",
      reason: null,
      steps: [put("import", 2, BAR)],
    });
  });

  it("refuses when all 32 numbers are taken by other tokens", () => {
    expect(planNameTagWrite(header(others(LUKS2_TOKENS_MAX)), BAR)).toEqual({
      kind: "refused",
      reason: "no-free-token",
      steps: [],
    });
  });

  it("imports at 31 when only 31 is free", () => {
    expect(planNameTagWrite(header(others(31)), BAR)).toEqual({
      kind: "write",
      reason: null,
      steps: [put("import", 31, BAR)],
    });
  });

  it("replaces a tag at 31 when every other number is taken", () => {
    const tokens = { ...others(31), 31: tagObject("Old", false) };
    expect(planNameTagWrite(header(tokens), BAR)).toEqual({
      kind: "write",
      reason: null,
      steps: [put("replace", 31, BAR)],
    });
  });
});

describe("planNameTagWrite changes a tag", () => {
  it("leaves an equal tag unchanged", () => {
    expect(planNameTagWrite(header({ 4: tagObject("Bar Santet", true) }), BAR)).toEqual({
      kind: "unchanged",
      reason: null,
      steps: [],
    });
  });

  it("replaces a tag whose live flag differs", () => {
    const tag = { name: "Bar Santet", live: false };
    expect(planNameTagWrite(header({ 4: tagObject("Bar Santet", true) }), tag)).toEqual({
      kind: "write",
      reason: null,
      steps: [put("replace", 4, tag)],
    });
  });

  it("replaces the lowest of two tags, then removes the other", () => {
    const tokens = { 5: tagObject("Old", true), 2: tagObject("Old", true) };
    expect(planNameTagWrite(header(tokens), BAR)).toEqual({
      kind: "write",
      reason: null,
      steps: [put("replace", 2, BAR), remove(5)],
    });
  });

  it("replaces two equal tags with one", () => {
    const tokens = { 1: tagObject("Bar Santet", true), 3: tagObject("Bar Santet", true) };
    expect(planNameTagWrite(header(tokens), BAR).steps).toEqual([
      put("replace", 1, BAR),
      remove(3),
    ]);
  });

  it("replaces a lone malformed Waitron token", () => {
    const token = { type: NAME_TAG_TYPE, keyslots: [], version: 2, name: "Bar Santet", live: true };
    expect(planNameTagWrite(header({ 0: TPM, 6: token }), BAR)).toEqual({
      kind: "write",
      reason: null,
      steps: [put("replace", 6, BAR)],
    });
  });

  it("replaces a tag with the right values in another key order", () => {
    const token = { live: true, name: "Bar Santet", keyslots: [], type: NAME_TAG_TYPE, version: 1 };
    expect(planNameTagWrite(header({ 3: token }), BAR).steps).toEqual([put("replace", 3, BAR)]);
  });

  it("compares the composed name", () => {
    const metadata = header({ 0: TPM, 1: tagObject("Bar \u00C0ngels", true) });
    expect(planNameTagWrite(metadata, { name: "Bar A\u0300ngels", live: true })).toEqual({
      kind: "unchanged",
      reason: null,
      steps: [],
    });
  });

  it("writes the composed name", () => {
    expect(planNameTagWrite(header({}), { name: "Bar A\u0300ngels", live: true }).steps).toEqual([
      put("import", 0, { name: "Bar \u00C0ngels", live: true }),
    ]);
  });
});

describe("planNameTagWrite with no tag wanted", () => {
  it("removes the box's tag", () => {
    expect(planNameTagWrite(header({ 4: tagObject("Old", true), 0: TPM }), null)).toEqual({
      kind: "remove",
      reason: null,
      steps: [remove(4)],
    });
  });

  it("removes every Waitron token in ascending order", () => {
    const tokens = { 9: tagObject("Old", true), 0: TPM, 2: { type: NAME_TAG_TYPE } };
    expect(planNameTagWrite(header(tokens), null).steps).toEqual([remove(2), remove(9)]);
  });

  it("leaves a header without a tag unchanged", () => {
    expect(planNameTagWrite(header({ 0: TPM }), null)).toEqual({
      kind: "unchanged",
      reason: null,
      steps: [],
    });
  });

  it.each([
    ["257 four-byte characters", "\u{1F600}".repeat(257)],
    ["a tab", "Bar\tSantet"],
  ])("removes the tag when the name has %s", (_label, name) => {
    const metadata = header({ 0: TPM, 4: tagObject("Old", true) });
    expect(planNameTagWrite(metadata, { name, live: true })).toEqual({
      kind: "remove",
      reason: "name-unusable",
      steps: [remove(4)],
    });
  });

  it.each([
    ["257 four-byte characters", "\u{1F600}".repeat(257)],
    ["a tab", "Bar\tSantet"],
  ])("leaves a header without a tag unchanged when the name has %s", (_label, name) => {
    expect(planNameTagWrite(header({ 0: TPM }), { name, live: true })).toEqual({
      kind: "unchanged",
      reason: "name-unusable",
      steps: [],
    });
  });
});

describe("planNameTagWrite refuses metadata it cannot read", () => {
  it.each([
    ["not json", utf8("not json")],
    ["no tokens key", utf8(JSON.stringify({ ...BASE }))],
    ["token 32", header({ 0: TPM, 32: TPM })],
    ["token 007", header({ "007": TPM })],
    ["token -1", header({ "-1": TPM })],
    ["token a", header({ a: TPM })],
    ["an empty token key", header({ "": TPM })],
    ["token 1.0", header({ "1.0": TPM })],
  ])("%s", (_label, metadata) => {
    expect(planNameTagWrite(metadata, BAR)).toEqual({
      kind: "refused",
      reason: "metadata-unreadable",
      steps: [],
    });
    expect(planNameTagWrite(metadata, null)).toEqual({
      kind: "refused",
      reason: "metadata-unreadable",
      steps: [],
    });
  });

  it("accepts token 31", () => {
    expect(planNameTagWrite(header({ 31: TPM }), BAR).steps).toEqual([put("import", 0, BAR)]);
  });
});

describe("planNameTagWrite input", () => {
  it.each([
    ["a name alone", { name: "Bar" }],
    ["a string", "Bar"],
    ["a live flag that is a string", { name: "Bar", live: "yes" }],
    ["an extra key", { name: "Bar", live: true, extra: 1 }],
    ["undefined", undefined],
  ])("a tag that is %s throws name_tag.tag_invalid", (_label, tag) => {
    expect(() => planNameTagWrite(header({}), /** @type {any} */ (tag))).toThrow(
      expect.objectContaining({ code: "name_tag.tag_invalid", reason: "tag-invalid" }),
    );
  });

  it("checks the tag before the metadata", () => {
    expect(() => planNameTagWrite(utf8("not json"), /** @type {any} */ ({ name: "Bar" }))).toThrow(
      expect.objectContaining({ code: "name_tag.tag_invalid", reason: "tag-invalid" }),
    );
  });

  it("metadata that is a string throws name_tag.input_invalid", () => {
    expect(() =>
      planNameTagWrite(/** @type {any} */ (JSON.stringify({ tokens: {} })), BAR),
    ).toThrow(expect.objectContaining({ code: "name_tag.input_invalid", reason: "input-invalid" }));
  });
});

describe("planNameTagWrite answers", () => {
  it("are frozen all the way to each step", () => {
    const plan = planNameTagWrite(
      header({ 2: tagObject("Old", true), 5: tagObject("Old", true) }),
      BAR,
    );
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.steps)).toBe(true);
    expect(plan.steps).toHaveLength(2);
    for (const step of plan.steps) expect(Object.isFrozen(step)).toBe(true);
    const refused = planNameTagWrite(utf8("not json"), BAR);
    expect(Object.isFrozen(refused)).toBe(true);
    expect(Object.isFrozen(refused.steps)).toBe(true);
  });

  it("hold a fresh json array in each plan", () => {
    const metadata = header({});
    const first = planNameTagWrite(metadata, BAR).steps[0];
    const second = planNameTagWrite(metadata, BAR).steps[0];
    if (first.op === "remove" || second.op === "remove") throw new Error("expected an import");
    expect(first.json).not.toBe(second.json);
    expect(first.json).toEqual(second.json);
    first.json.fill(0);
    expect(planNameTagWrite(metadata, BAR).steps[0]).toEqual(put("import", 0, BAR));
  });
});

const EFI_TYPE = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
const XBOOTLDR_TYPE = "bc13c2ff-59e6-4262-a352-b275fd6f7172";
const LUKS_UUID = "2f0e8c1a-5b7d-4e3f-9a6c-1d2b3c4d5e6f";
const LAYOUT = WAITRON_LAYOUTS[0];
const INTERNAL_ID = "nvme-Samsung_SSD_980_500GB_S64DNF0R123456A";

const valid = (subsystem = LAYOUT.subsystem, uuid = LUKS_UUID) => ({
  state: "valid",
  subsystem,
  uuid,
});
const plain = (content) => ({ content, luks: null });
const luks = (primary = valid(), secondary = valid()) => ({
  content: "luks2",
  luks: [primary, secondary],
});
const partition = (signature, typeGuid, name = "") => ({ ...signature, typeGuid, name });
const efi = () => partition(plain("vfat"), EFI_TYPE, "EFI System Partition");
const boot = () => partition(plain("other"), XBOOTLDR_TYPE, "boot");
const waitronPartition = (signature = luks()) =>
  partition(signature, LAYOUT.typeGuid, LAYOUT.partitionName);
const disk = (overrides = {}) => ({
  diskId: INTERNAL_ID,
  attachment: "internal",
  table: "gpt",
  partitions: [],
  whole: plain("none"),
  nameTag: null,
  ...overrides,
});
const completeWaitronDisk = (overrides = {}) =>
  disk({ partitions: [efi(), boot(), waitronPartition()], ...overrides });
const machine = (disks, overrides = {}) => ({
  tpm: "enabled",
  secureBoot: "user-mode",
  disks,
  ...overrides,
});

/**
 * The test's own stand-in for cryptsetup's token commands, as re-map finding 3 measured them.
 * @param {{tokens: Record<string, unknown>}} start @param {readonly any[]} steps
 */
const apply = (start, steps) => {
  const after = globalThis.structuredClone(start);
  for (const step of steps) {
    const key = String(step.tokenId);
    const used = Object.hasOwn(after.tokens, key);
    if (step.op === "import" && (used || step.tokenId < 0 || step.tokenId > 31))
      throw new Error(`import onto token ${key}`);
    if (step.op === "remove" && !used) throw new Error(`remove of free token ${key}`);
    if (step.op === "remove") delete after.tokens[key];
    else after.tokens[key] = JSON.parse(new TextDecoder().decode(step.json));
  }
  return after;
};

/** @param {Record<string, unknown>} tokens */
const readBack = (tokens) => {
  const bytes = findNameTag(header(tokens));
  return bytes === null ? null : decodeNameTag(bytes);
};

const OLD = { name: "Old Name", live: false };
const OTHER = { name: "Other Name", live: true };
const MALFORMED = { type: NAME_TAG_TYPE, keyslots: [], version: 1, name: "Bar", live: "yes" };
const NULL_NAME = { type: NAME_TAG_TYPE, keyslots: [], version: 1, name: null, live: true };
const old = () => tagObject(OLD.name, OLD.live);

/** screen: the one good tag the installer should show for the start header, or null. */
const STARTS = [
  { label: "no tokens", tokens: {}, screen: null },
  { label: "systemd tokens only", tokens: { 0: TPM, 1: RECOVERY }, screen: null },
  { label: "a tag at 0", tokens: { 0: old() }, screen: OLD },
  { label: "a tag at 7 beside TPM at 0", tokens: { 0: TPM, 7: old() }, screen: OLD },
  { label: "two equal tags at 2 and 5", tokens: { 2: old(), 5: old() }, screen: null },
  {
    label: "two different tags",
    tokens: { 2: old(), 5: tagObject(OTHER.name, OTHER.live) },
    screen: null,
  },
  { label: "a malformed Waitron token", tokens: { 3: MALFORMED }, screen: null },
  { label: "a Waitron token whose name is null", tokens: { 3: NULL_NAME }, screen: null },
  { label: "31 other tokens", tokens: others(31), screen: null },
  { label: "31 other tokens and a tag at 31", tokens: { ...others(31), 31: old() }, screen: OLD },
  { label: "32 other tokens", tokens: others(32), screen: null },
].map((start) => ({ ...start, object: { ...BASE, tokens: start.tokens } }));

const DESIRED = [
  ["BAR", BAR],
  ["Bar \u00C0ngels, not live", { name: "Bar \u00C0ngels", live: false }],
  ["256 emoji", { name: EMOJI_256, live: true }],
  ["256 quotes", { name: QUOTES_256, live: false }],
  ["a decomposed name", { name: "Bar A\u0300ngels", live: true }],
  ["no tag", null],
  ["257 emoji", { name: "\u{1F600}".repeat(257), live: true }],
];

/** @param {{name: string, live: boolean}|null} tag */
const expectedTag = (tag) => {
  const name = tag === null ? null : usableVenueName(tag.name);
  return name === null ? null : { name, live: /** @type {any} */ (tag).live };
};

/** @param {Record<string, unknown>} tokens */
const waitronNumbers = (tokens) =>
  Object.keys(tokens).filter((key) => /** @type {any} */ (tokens[key]).type === NAME_TAG_TYPE);

const ALL_PAIRS = STARTS.flatMap((start) =>
  DESIRED.map(([desiredLabel, desired]) => {
    const plan = planNameTagWrite(header(start.tokens), desired);
    return { label: `${start.label} + ${desiredLabel}`, start, desired, plan };
  }),
);
const PAIRS = ALL_PAIRS.filter(({ plan }) => plan.kind !== "refused");
/** A step the stand-in refuses fails the pair's own cases, not the file's load. */
const RESULTS = PAIRS.map((pair) => {
  let after = null;
  let error = null;
  try {
    after = apply(pair.start.object, pair.plan.steps);
  } catch (caught) {
    error = caught;
  }
  const tokens = () => {
    if (error !== null) throw error;
    return /** @type {any} */ (after).tokens;
  };
  return { ...pair, error, tokens };
});

describe("name tag sweep: the pairs it covers", () => {
  it("skips only 32 other tokens with a usable name, refused no-free-token", () => {
    const refused = ALL_PAIRS.filter(({ plan }) => plan.kind === "refused");
    expect(refused.map(({ label }) => label)).toEqual(
      DESIRED.filter(([, tag]) => expectedTag(tag) !== null).map(
        ([label]) => `32 other tokens + ${label}`,
      ),
    );
    for (const { plan } of refused) expect(plan.reason).toBe("no-free-token");
  });
});

describe("name tag sweep: steps name only Waitron's tokens or a free number", () => {
  it.each(PAIRS)("$label", ({ start, plan }) => {
    const ours = waitronNumbers(start.tokens);
    for (const step of plan.steps) {
      const key = String(step.tokenId);
      expect(ours.includes(key) || !Object.hasOwn(start.tokens, key)).toBe(true);
    }
  });
});

describe("name tag sweep: the bytes carry nothing but the desired tag", () => {
  it.each(PAIRS.filter(({ plan }) => plan.steps.some((step) => step.op !== "remove")))(
    "$label",
    ({ desired, plan }) => {
      for (const step of plan.steps) {
        if (step.op === "remove") continue;
        expect(decodeNameTag(step.json)).toEqual(expectedTag(desired));
        expect(Object.keys(JSON.parse(new TextDecoder().decode(step.json)))).toEqual([
          "type",
          "keyslots",
          "version",
          "name",
          "live",
        ]);
      }
    },
  );
});

describe("name tag sweep: nothing else changes (against this test's stand-in for cryptsetup, not a real header)", () => {
  it.each(RESULTS)("$label", ({ start, tokens }) => {
    const after = tokens();
    for (const [key, token] of Object.entries(start.tokens))
      if (/** @type {any} */ (token).type !== NAME_TAG_TYPE) expect(after[key]).toEqual(token);
  });
});

describe("name tag sweep: the result reads back as the desired tag (on this test's stand-in for cryptsetup)", () => {
  it.each(RESULTS)("$label", ({ desired, tokens }) => {
    expect(readBack(tokens())).toEqual(expectedTag(desired));
  });
});

describe("name tag sweep: planning again on the result answers unchanged (on this test's stand-in for cryptsetup)", () => {
  it.each(RESULTS)("$label", ({ desired, tokens }) => {
    expect(planNameTagWrite(header(tokens()), desired).kind).toBe("unchanged");
  });
});

describe("name tag sweep: a write cut between steps (against this test's stand-in for cryptsetup)", () => {
  const multiStep = PAIRS.filter(({ plan }) => plan.steps.length >= 2);

  it("covers write and remove plans", () => {
    expect(new Set(multiStep.map(({ plan }) => plan.kind))).toEqual(new Set(["write", "remove"]));
  });

  it.each(multiStep)("$label", ({ start, desired, plan }) => {
    const startTags = waitronNumbers(start.tokens).map((key) => readBack({ 0: start.tokens[key] }));
    for (let length = 1; length < plan.steps.length; length++) {
      const seen = readBack(apply(start.object, plan.steps.slice(0, length)).tokens);
      if (plan.kind === "write") {
        expect([null, expectedTag(desired)]).toContainEqual(seen);
      } else if (seen !== null) {
        expect(waitronNumbers(start.tokens).length).toBeGreaterThanOrEqual(2);
        expect(startTags).toContainEqual(seen);
      }
    }
  });
});

const RECOGNISED = classifyDisk(machine([completeWaitronDisk({ nameTag: null })]));

const tagged = (/** @type {Record<string, unknown>} */ tokens) =>
  findNameTag(header(tokens)) !== null;

/** @param {Record<string, unknown>} tokens */
const expectRecognised = (tokens) => {
  const nameTag = findNameTag(header(tokens));
  expect(nameTag).not.toBeNull();
  expect(classifyDisk(machine([completeWaitronDisk({ nameTag })]))).toEqual(RECOGNISED);
};

describe("name tag sweep: the disk is still recognised whatever its tag", () => {
  it("is recognised as Waitron's with no tag", () => {
    expect(RECOGNISED.kind).toBe("waitron");
  });

  it.each(STARTS.filter((start) => tagged(start.tokens)))("start: $label", ({ tokens }) => {
    expectRecognised(tokens);
  });
});

describe("name tag sweep: the disk is still recognised whatever its tag, results (on this test's stand-in for cryptsetup)", () => {
  it.each(RESULTS.filter(({ error, tokens }) => error !== null || tagged(tokens())))(
    "$label",
    ({ tokens }) => {
      expectRecognised(tokens());
    },
  );
});

/** @param {Record<string, unknown>} tokens @param {{name: string, live: boolean}|null} tag */
const expectScreen = (tokens, tag) => {
  const state = createInstallerState({ atMs: 0, clockFloorMs: 0, eraseWord: "ERASE-CONFIRM" });
  const found = nextInstallerStep(state, {
    kind: "observed",
    atMs: 1000,
    observation: machine([completeWaitronDisk()]),
    venueTag: readBack(tokens),
  });
  const keyed = nextInstallerStep(found.state, { kind: "key", atMs: 2000 });
  expect(found.message.params.venueName).toBe(tag === null ? null : tag.name.normalize("NFC"));
  expect(found.message.params.live).toBe(tag === null ? null : tag.live);
  expect(keyed.message.params.prompt).toBe(tag === null ? "erase-word" : "venue-name");
};

describe("name tag sweep: the installer's screen shows the starting header's tag", () => {
  it.each(STARTS)("$label", ({ tokens, screen }) => {
    expectScreen(tokens, screen);
  });
});

describe("name tag sweep: the installer's screen shows the result's tag (on this test's stand-in for cryptsetup)", () => {
  it.each(RESULTS)("$label", ({ tokens, desired }) => {
    expectScreen(tokens(), expectedTag(desired));
  });
});
