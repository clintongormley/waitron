import crypto, { randomUUID } from "node:crypto";
import { vi } from "vitest";

/**
 * Ids that sort against the order they are made in, so a tie broken by id gives the reverse of
 * the taking order on every run rather than by chance.
 */
export function descendingIds() {
  const real = crypto.randomUUID.bind(crypto);
  let made = 0;
  return () =>
    `${(0xffffffff - made++).toString(16)}${real().slice(8)}` as ReturnType<typeof randomUUID>;
}

/** Give row IDs the same minting millisecond, with their tie-breakers in a prescribed order. */
export function mockRowIdOrder(order: "ascending" | "descending"): () => void {
  const random = globalThis.crypto.randomUUID();
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
  let sequence = 0x80000000;
  const tail = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
    sequence += order === "ascending" ? 1 : -1;
    return `00000000-0000-4${random.slice(15, 18)}-${random.slice(19, 23)}-${random.slice(24, 28)}${sequence.toString(16).padStart(8, "0")}`;
  });
  return () => {
    tail.mockRestore();
    clock.mockRestore();
  };
}
