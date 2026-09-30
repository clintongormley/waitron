import crypto, { randomUUID } from "node:crypto";

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
