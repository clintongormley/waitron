import { type Dispatcher, fetch as undiciFetch } from "undici";
import type { HttpClient } from "@waitron/sync";

/**
 * The one place the `@waitron/sync` `HttpClient` seam is mapped onto undici's `fetch` — its `Response`
 * adapted to the tiny `{ status, text() }` surface `@waitron/sync` needs. An optional `dispatcher`
 * (an undici `Agent`) is spread only when present, so an absent one leaves undici's global default.
 * `fetchHttpClient` (below) and `tunnelHttpClient` (`tunnel-http.ts`) both build on this, so the
 * mapping evolves in one spot rather than two.
 */
export const undiciHttpClient =
  (dispatcher?: Dispatcher): HttpClient =>
  (url, init) =>
    undiciFetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      ...(dispatcher === undefined ? {} : { dispatcher }),
    });

/**
 * The production HTTP client behind the pull worker's `HttpClient` seam — undici's `fetch` on the
 * global dispatcher (the same client `aeat-transport.ts` builds on). Kept as a named value so boot
 * wires it and a test can inject a fake instead (as `syncPullOnce`/`runSyncPull`'s own suites do).
 */
export const fetchHttpClient: HttpClient = undiciHttpClient();
