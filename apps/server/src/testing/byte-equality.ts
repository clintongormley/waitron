import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";

// Vitest compares a typed array element by element through its generic iterable path, which made
// whole-table `toEqual`s over receipt payloads take seconds. Differing bytes answer `false`. Equal
// bytes answer `true` only when neither array has an enumerable own key besides its indices, string
// or symbol, because Vitest 4.1.11 also compares a byte array's own enumerable string keys;
// otherwise Vitest decides.
export function equalBytes(a: unknown, b: unknown): boolean | undefined {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return undefined;
  if (a.constructor !== b.constructor) return undefined;
  if (Buffer.compare(a, b) !== 0) return false;
  return onlyIndices(a) && onlyIndices(b) ? true : undefined;
}

// Node's strict deep equality compares those keys without listing every index, as `Object.keys`
// does. The bare twin is built as a plain `Uint8Array`, so a subclass constructor is never called;
// a detached array has length 0 and memory that cannot be viewed.
function onlyIndices(bytes: Uint8Array): boolean {
  const bare =
    bytes.length === 0
      ? new Uint8Array(0)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  return isDeepStrictEqual(bytes, Object.setPrototypeOf(bare, Object.getPrototypeOf(bytes)));
}
