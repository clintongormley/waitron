import { fetch as undiciFetch } from "undici";
import type { HttpClient } from "@waitron/sync";

/**
 * The production HTTP client behind the pull worker's `HttpClient` seam — undici's `fetch` (the same
 * client `aeat-transport.ts` builds on), adapting its `Response` to the tiny `{ status, text() }`
 * surface `@waitron/sync` needs. Kept separate so boot wires a named value and a test can inject a
 * fake instead (as `syncPullOnce`/`runSyncPull`'s own suites do).
 */
export const fetchHttpClient: HttpClient = (url, init) =>
  undiciFetch(url, { method: init.method ?? "GET", headers: init.headers, body: init.body });
