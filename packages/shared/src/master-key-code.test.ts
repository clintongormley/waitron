import { describe, expect, it } from "vitest";
import { decodeMasterKeyCode, encodeMasterKeyCode, keySymbols } from "./index.js";

const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const fixedKey = Uint8Array.from({ length: 16 }, (_, i) => i);
// Computed once by a standalone `python3 -I` script doing its own base-31 and mod-953 arithmetic;
// never by this module.
const fixedPrinted = "222A 5AT7 UZRS FT4B J48X R4T7 TP8N";
const fixedCode = fixedPrinted.replaceAll(" ", "");

function refused(text: unknown): void {
  expect(() => decodeMasterKeyCode(text as string)).toThrow("shared.invalid_key_code");
}

describe("the fixed vectors", () => {
  it("prints a fixed key as seven groups of four", () => {
    expect(encodeMasterKeyCode(fixedKey)).toBe(fixedPrinted);
    expect(encodeMasterKeyCode(new Uint8Array(16))).toBe("2222 2222 2222 2222 2222 2222 2222");
    expect(encodeMasterKeyCode(new Uint8Array(16).fill(0xff))).toBe(
      "KQGT VBZM 585J J38Q RUAX WS3N G9AX",
    );
  });

  it("prints a master key id's 8 bytes as 13 symbols", () => {
    expect(keySymbols(Uint8Array.from([0x88, 0x28, 0x6c, 0xa8, 0x3b, 0xa0, 0x0b, 0xe7]))).toBe(
      "EG6BVNBFE8X3C",
    );
    expect(keySymbols(new Uint8Array(8))).toBe("2222222222222");
    expect(keySymbols(new Uint8Array(16).fill(0xff))).toBe("KQGTVBZM585JJ38QRUAXWS3NG9");
  });
});

describe("decodes the printed form to the same 16 bytes", () => {
  it.each([
    ["a fixed key", fixedKey],
    ["all zero bytes", new Uint8Array(16)],
    ["all 0xff bytes", new Uint8Array(16).fill(0xff)],
    ["a key with high and low bytes", Uint8Array.from([0x80, ...new Array<number>(14).fill(0), 1])],
  ])("%s", (_, key) => {
    expect(decodeMasterKeyCode(encodeMasterKeyCode(key))).toEqual(key);
  });

  it("accepts lower case, spaces and dashes", () => {
    expect(decodeMasterKeyCode(fixedCode.toLowerCase())).toEqual(fixedKey);
    expect(decodeMasterKeyCode(" 222a-5at7 uzrs--ft4b j48x-r4t7 tp8n ")).toEqual(fixedKey);
  });
});

describe("refusals", () => {
  it("refuses a code with one symbol changed", () => {
    for (let i = 0; i < fixedCode.length; ++i)
      for (const symbol of alphabet)
        if (symbol !== fixedCode[i])
          refused(fixedCode.slice(0, i) + symbol + fixedCode.slice(i + 1));
  });

  it("refuses two different neighbours swapped", () => {
    let swaps = 0;
    for (let i = 0; i < fixedCode.length - 1; ++i)
      if (fixedCode[i] !== fixedCode[i + 1]) {
        swaps += 1;
        refused(fixedCode.slice(0, i) + fixedCode[i + 1]! + fixedCode[i]! + fixedCode.slice(i + 2));
      }
    expect(swaps).toBeGreaterThan(20);
  });

  it.each(["0", "1", "I", "L", "O", "i", "l", "o"])("refuses 0, 1, I, L and O: %s", (symbol) => {
    refused(symbol + fixedCode.slice(1));
  });

  it.each(["\t", "\n", "_", ".", "ſ", "Ａ", "+"])("refuses any other symbol: %j", (symbol) => {
    refused(fixedCode.slice(0, 27) + symbol);
  });

  it("refuses a number of 2^128 or more", () => {
    // 2^128 with its correct check symbols, from the same outside script.
    refused("KQGTVBZM585JJ38QRUAXWS3NGAAP");
    refused("ZZZZZZZZZZZZZZZZZZZZZZZZZZAJ");
  });

  it.each([
    ["empty", ""],
    ["one short", fixedCode.slice(1)],
    ["one long", fixedCode + "2"],
    ["the 26 key symbols alone", fixedCode.slice(0, 26)],
  ])("refuses wrong lengths: %s", (_, text) => {
    refused(text);
  });

  it("refuses a value that is not text", () => {
    refused(null);
    refused(42);
  });

  it.each([15, 17, 0])("refuses to print %i bytes", (length) => {
    expect(() => encodeMasterKeyCode(new Uint8Array(length))).toThrow("shared.invalid_key_code");
  });
});
