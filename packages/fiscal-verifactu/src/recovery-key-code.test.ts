import { expect, it } from "vitest";
import { encodeRecoveryKey, decodeRecoveryKey } from "./recovery-key-code.js";

const secret = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const printed = "06R9 T4FH M4H3 599J EEMM 5D5D ABTV 2RSX 6QDQ WE8M C";
const code = printed.replaceAll(" ", "");
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

it("prints the unchanged 192-bit key with two trailing check symbols in one grouped value", () => {
  expect(encodeRecoveryKey(secret)).toBe(printed);
  expect(decodeRecoveryKey(printed)).toBe(secret);
  expect(decodeRecoveryKey(code.toLowerCase().replaceAll("0", "o").replaceAll("1", "l"))).toBe(
    secret,
  );
});
it("refuses every single-symbol substitution, including either check symbol", () => {
  for (let i = 0; i < code.length; ++i)
    for (const symbol of alphabet)
      if (symbol !== code[i])
        expect(() => decodeRecoveryKey(code.slice(0, i) + symbol + code.slice(i + 1))).toThrow(
          "Recovery key refused",
        );
});
it("refuses each swap of unequal adjacent symbols, including the key/check boundary", () => {
  for (let i = 0; i < code.length - 1; ++i)
    if (code[i] !== code[i + 1])
      expect(() =>
        decodeRecoveryKey(code.slice(0, i) + code[i + 1]! + code[i]! + code.slice(i + 2)),
      ).toThrow("Recovery key refused");
});
it.each(["", "!", code.slice(1), code + "0", code.replace("M", "U"), null, 42])(
  "refuses malformed printed input %#",
  (value) => {
    expect(() => decodeRecoveryKey(value as string)).toThrow("Recovery key refused");
  },
);
it.each(["", "a".repeat(31), "a".repeat(33), "!".repeat(32), null])(
  "refuses malformed raw secrets %#",
  (value) => {
    expect(() => encodeRecoveryKey(value as string)).toThrow("Recovery key refused");
  },
);
it("round-trips zero, high-bit and mixed raw keys without changing their bytes", () => {
  for (const key of ["A".repeat(32), "_".repeat(32), "0123456789abcdefghijklmnopqrstuv"])
    expect(decodeRecoveryKey(encodeRecoveryKey(key))).toBe(key);
});

it("refuses nonzero spare key bits even when both check symbols are valid", () => {
  expect(() => decodeRecoveryKey("000000000000000000000000000000000000001ZT")).toThrow(
    "Recovery key refused",
  );
});
