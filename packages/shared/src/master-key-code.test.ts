import { expect, it } from "vitest";
import { decodeMasterKeyCode, encodeMasterKeyCode } from "./master-key-code.js";
import { normaliseTypedCode, TYPED_CODE_ALPHABET } from "./index.js";

const secret = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const printed = "06R9 T4FH M4H3 599J EEMM 5D5D ABTV 2RSX 6QDQ WE8M C";
const code = printed.replaceAll(" ", "");
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

it("prints the unchanged 192-bit key with two trailing check symbols in one grouped value", () => {
  expect(encodeMasterKeyCode(secret)).toBe(printed);
  expect(decodeMasterKeyCode(printed)).toBe(secret);
  expect(decodeMasterKeyCode(code.toLowerCase().replaceAll("0", "o").replaceAll("1", "l"))).toBe(
    secret,
  );
});
it("refuses every single-symbol substitution, including either check symbol", () => {
  for (let i = 0; i < code.length; ++i)
    for (const symbol of alphabet)
      if (symbol !== code[i])
        expect(() => decodeMasterKeyCode(code.slice(0, i) + symbol + code.slice(i + 1))).toThrow(
          "shared.invalid_key_code",
        );
});
it("refuses each swap of unequal adjacent symbols, including the key/check boundary", () => {
  for (let i = 0; i < code.length - 1; ++i)
    if (code[i] !== code[i + 1])
      expect(() =>
        decodeMasterKeyCode(code.slice(0, i) + code[i + 1]! + code[i]! + code.slice(i + 2)),
      ).toThrow("shared.invalid_key_code");
});
it.each(["", "!", code.slice(1), code + "0", code.replace("M", "U"), null, 42])(
  "refuses malformed printed input %#",
  (value) => {
    expect(() => decodeMasterKeyCode(value as string)).toThrow("shared.invalid_key_code");
  },
);
it.each(["", "a".repeat(31), "a".repeat(33), "!".repeat(32), null])(
  "refuses malformed raw secrets %#",
  (value) => {
    expect(() => encodeMasterKeyCode(value as string)).toThrow("shared.invalid_key_code");
  },
);
it("round-trips zero, high-bit and mixed raw keys without changing their bytes", () => {
  for (const key of ["A".repeat(32), "_".repeat(32), "0123456789abcdefghijklmnopqrstuv"])
    expect(decodeMasterKeyCode(encodeMasterKeyCode(key))).toBe(key);
});

it("refuses nonzero spare key bits even when both check symbols are valid", () => {
  expect(() => decodeMasterKeyCode("000000000000000000000000000000000000001ZT")).toThrow(
    "shared.invalid_key_code",
  );
});

it("reads a 1 typed as i or l, and keeps base64url's - and _ through the round trip", () => {
  const key = "Ab-_".repeat(8);
  const keyPrinted = encodeMasterKeyCode(key);
  expect(keyPrinted).toContain("1");
  expect(decodeMasterKeyCode(keyPrinted.replaceAll("1", "l"))).toBe(key);
  expect(decodeMasterKeyCode(keyPrinted.replaceAll("1", "i"))).toBe(key);
});

it("refuses symbols outside the alphabet even when the check symbols balance", () => {
  expect(() => decodeMasterKeyCode("9FXXXES72K7VF3Q07H1UCB12GD0QRN3ETGZ5U6RHD")).toThrow(
    "shared.invalid_key_code",
  );
});

it("normalises typed text through the package's public name: separators out, aliases to digits", () => {
  expect(normaliseTypedCode("o-i L\taz\r\n9")).toBe("011AZ9");
  expect(TYPED_CODE_ALPHABET).toBe(alphabet);
  for (const bad of [" ", "\v", "U", "=", "ı"])
    expect(() => normaliseTypedCode(`0${bad}`)).toThrow("shared.invalid_key_code");
});
