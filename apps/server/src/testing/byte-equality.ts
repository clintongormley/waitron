import { Buffer } from "node:buffer";

// Vitest compares a typed array element by element through its generic iterable path, which made
// whole-table `toEqual`s over receipt payloads take seconds. Unlike Vitest's own equality, this
// ignores non-index own properties added to a byte array; a database driver never sets them.
export function equalBytes(a: unknown, b: unknown): boolean | undefined {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return undefined;
  if (a.constructor !== b.constructor) return undefined;
  return Buffer.compare(a, b) === 0;
}
