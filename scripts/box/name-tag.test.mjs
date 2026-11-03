import { Buffer } from "node:buffer";
import { TextDecoder, TextEncoder } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  LUKS2_TOKENS_MAX,
  NAME_TAG_MAX_BYTES,
  NAME_TAG_MAX_CODE_POINTS,
  NAME_TAG_TYPE,
  NAME_TAG_VERSION,
  decodeNameTag,
  encodeNameTag,
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
    ["a decomposed name", "Bar Àngels", "Bar Àngels"],
    ["256 emoji", EMOJI_256],
    ["768 code points that compose to 256", "ệ".repeat(256), "ệ".repeat(256)],
  ])("%s → its NFC form", (_label, input, expected = input) => {
    expect(usableVenueName(input)).toBe(expected);
  });

  it.each(UNUSABLE_NAMES)("%s → null", (_label, input) => {
    expect(usableVenueName(input)).toBeNull();
  });
});

describe("encodeNameTag", () => {
  it("writes the one canonical byte form", () => {
    expect(encodeNameTag({ name: "Bar Àngels", live: true })).toEqual(
      utf8('{"type":"waitron-name-tag","keyslots":[],"version":1,"name":"Bar Àngels","live":true}'),
    );
  });

  it("stores a decomposed name composed", () => {
    expect(encodeNameTag({ name: "Bar Àngels", live: false })).toEqual(
      canonical("Bar Àngels", false),
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
    "Bar Àngels",
    "Café Àngels and the Old Crème Brûlée Kitchen on Main Street",
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
    expect(decodeNameTag(encodeNameTag({ name: "Bar Àngels", live: true }))).toEqual({
      name: "Bar Àngels",
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
    ["a decomposed name", canonical("Bar Àngels", true)],
    ["257 ASCII letters", canonical("a".repeat(257), true)],
    ["a name holding U+0085", canonical("Bar\u0085", true)],
    ["a name written with a JSON escape", utf8(withName('"Bar \\u00c0ngels"'))],
    ["a byte-order mark first", utf8("﻿" + base)],
    ["a 0xFF byte inside the name", bytesWithFF],
    ["not json", utf8("not json")],
    ["an array", utf8("[]")],
    ["null", utf8("null")],
  ])("%s", (_label, bytes) => {
    expect(decodeNameTag(bytes)).toBeNull();
  });

  it("the escaped name parses to the same value as a canonical one", () => {
    expect(JSON.parse(withName('"Bar \\u00c0ngels"')).name).toBe("Bar Àngels");
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
