import type { AdjustmentsApi } from "./client.js";

/** A query's first read is the person's own request, unless `initial` is false; every read after it
 * is a refresh live data asked for, and passive, so a screen left open does not keep the session
 * signed in. */
export function firstReadThenPassive<T>(
  api: () => AdjustmentsApi,
  read: (api: AdjustmentsApi) => Promise<T>,
  initial = true,
): () => Promise<T> {
  let first = initial;
  return () => {
    const client = first ? api() : api().background;
    first = false;
    return read(client);
  };
}
