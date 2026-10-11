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

  it("leaves equal bytes to Vitest when either array carries another own property", () => {
    const bare = new Uint8Array([1, 2]);
    expect(equalBytes(Object.assign(new Uint8Array([1, 2]), { extra: 1 }), bare)).toBeUndefined();
    expect(
      equalBytes(bare, Object.assign(new Uint8Array([1, 2]), { [Symbol("s")]: 1 })),
    ).toBeUndefined();
    expect(equalBytes(Buffer.from([1, 2]), Buffer.from([1, 2]))).toBe(true);
  });
});

describe("the registered tester", () => {
  it("is what toEqual uses for byte arrays in this config", () => {
    // Vitest's own equality walks a byte array through its iterator; the tester never does.
    let iterated = 0;
    class Counted extends Uint8Array {
      override [Symbol.iterator]() {
        iterated += 1;
        return super[Symbol.iterator]();
      }
    }
    expect(new Counted([1, 2, 3])).toEqual(new Counted([1, 2, 3]));
    expect(iterated).toBe(0);
  });

  it("still fails toEqual on a table whose byte arrays differ in one byte", () => {
    const table = [{ id: 1, payload: new Uint8Array([1, 2, 3]) }];
    const changed = [{ id: 1, payload: new Uint8Array([1, 2, 4]) }];
    expect(() => expect(table).toEqual(changed)).toThrow();
    expect(table).toEqual([{ id: 1, payload: new Uint8Array([1, 2, 3]) }]);
  });

  it("fails every matcher when the same bytes carry different extra properties", () => {
    const one = Object.assign(new Uint8Array([1, 2, 3]), { extra: 1 });
    const two = Object.assign(new Uint8Array([1, 2, 3]), { extra: 2 });
    const bare = new Uint8Array([1, 2, 3]);
    for (const [a, b] of [
      [one, two],
      [one, bare],
      [bare, one],
    ]) {
      expect(() => expect(a).toEqual(b)).toThrow();
      expect(() => expect(a).toStrictEqual(b)).toThrow();
      expect(() => expect(a).toMatchObject(b)).toThrow();
      expect(() => expect({ payload: a }).toEqual({ payload: b })).toThrow();
    }
  });

  it("passes every matcher when the same bytes carry the same extra properties", () => {
    const one = Object.assign(new Uint8Array([1, 2, 3]), { extra: 1 });
    const same = Object.assign(new Uint8Array([1, 2, 3]), { extra: 1 });
    expect(one).toEqual(same);
    expect(one).toStrictEqual(same);
    expect(one).toMatchObject(same);
  });
});
