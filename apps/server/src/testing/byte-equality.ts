import { Buffer } from "node:buffer";

// Vitest compares a typed array element by element through its generic iterable path, which made
// whole-table `toEqual`s over receipt payloads take seconds. Equal bytes answer `true` only when
// neither array has an own property besides its indices, because Vitest 4.1.11 also compares a
// byte array's own enumerable string keys; any other pair is left to Vitest.
export function equalBytes(a: unknown, b: unknown): boolean | undefined {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return undefined;
  if (a.constructor !== b.constructor) return undefined;
  if (Buffer.compare(a, b) !== 0) return false;
  return onlyIndices(a) && onlyIndices(b) ? true : undefined;
}

function onlyIndices(bytes: Uint8Array): boolean {
  return (
    Object.keys(bytes).length === bytes.length && Object.getOwnPropertySymbols(bytes).length === 0
  );
}
