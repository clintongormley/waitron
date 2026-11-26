/** A read the caller can cancel: an aborted read rejects with `fetch`'s own abort error, which
 * `isNetworkFailure` counts as no answer. */
export interface ReadOptions {
  signal?: AbortSignal;
}
export type TillRequest = <T>(
  path: string,
  method: string,
  body?: unknown,
  signal?: AbortSignal,
  options?: { headers?: Record<string, string>; namesPerson?: boolean },
) => Promise<T>;
