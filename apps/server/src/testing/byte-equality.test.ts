import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { equalBytes } from "./byte-equality.js";

describe("equalBytes", () => {
  it("answers true for byte arrays holding the same bytes", () => {
    expect(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(equalBytes(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it("answers false when one byte differs", () => {
    expect(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 9, 3]))).toBe(false);
    expect(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it("answers false when the lengths differ", () => {
    expect(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
  });

  it("compares views by their own bytes, not their backing buffer", () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]).buffer;
    const view = new Uint8Array(backing, 2, 3);
    expect(equalBytes(view, new Uint8Array([1, 2, 3]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2, 3]), view)).toBe(true);
    expect(equalBytes(view, new Uint8Array([9, 9, 1]))).toBe(false);
    expect(equalBytes(view, new Uint8Array(backing))).toBe(false);
  });

  it("leaves anything but two byte arrays of one constructor to Vitest", () => {
    expect(equalBytes(new Uint8Array([1]), [1])).toBeUndefined();
    expect(equalBytes([1], new Uint8Array([1]))).toBeUndefined();
    expect(equalBytes(new Uint8Array([1]), Buffer.from([1]))).toBeUndefined();
    expect(equalBytes(new Uint8Array([1]), new Uint16Array([1]))).toBeUndefined();
    expect(equalBytes("a", "a")).toBeUndefined();
  });
});

describe("the registered tester", () => {
  it("is what toEqual uses for byte arrays in this config", () => {
    // Vitest's own equality also compares own enumerable keys, so this passes only when
    // `equalBytes` is registered through the setup file.
    expect(new Uint8Array([1])).toEqual(Object.assign(new Uint8Array([1]), { extra: 1 }));
  });

  it("still fails toEqual on a table whose byte arrays differ in one byte", () => {
    const table = [{ id: 1, payload: new Uint8Array([1, 2, 3]) }];
    const changed = [{ id: 1, payload: new Uint8Array([1, 2, 4]) }];
    expect(() => expect(table).toEqual(changed)).toThrow();
    expect(table).toEqual([{ id: 1, payload: new Uint8Array([1, 2, 3]) }]);
  });
});
