import { Agent, type Dispatcher, fetch as undiciFetch } from "undici";

/** The tiny HTTP seam a tunnel client fulfils: a request over `{ url, init }` resolving to just the
 * `{ status, text() }` surface the caller reads. Defined locally now that the outbox pull client that
 * once declared it is gone (swap S5). */
type HttpClient = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/**
 * Map the `HttpClient` seam onto undici's `fetch` — its `Response` adapted to the tiny
 * `{ status, text() }` surface the caller needs. An optional `dispatcher` (an undici `Agent`) is
 * spread only when present, so an absent one leaves undici's global default. Inlined here (it used to
 * live in the now-deleted `sync-http.ts`) since `tunnelHttpClient` is its only remaining caller.
 */
const undiciHttpClient =
  (dispatcher?: Dispatcher): HttpClient =>
  (url, init) =>
    undiciFetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      ...(dispatcher === undefined ? {} : { dispatcher }),
    });

/**
 * A tunnel-aware `HttpClient`, adapting undici's `Response` to `{ status, text() }`.
 * The difference from a plain client is where TLS terminates: the caller sets `peer.url` to the RELAY's
 * address, but
 * the certificate belongs to the BOX. So the connection dials the relay while validating the box's
 * identity end-to-end — the relay only splices bytes and never terminates TLS.
 *
 * The `undici` `Agent`'s `connect` block is where that split lives (the custom-`connect` pattern
 * `aeat-transport.ts`'s `mtlsFetch` uses):
 *  - `servername` drives BOTH the SNI sent in the handshake and Node's default `checkServerIdentity`
 *    hostname — so the cert is checked against the box hostname (`opts.servername`), not against the
 *    relay's URL host. This is the faithful path a real box hostname uses; `tunnel-http.test.ts` pins
 *    it with a cert whose only SAN is the box hostname and no IP SAN.
 *  - `ca` is the box's private CA, the trust anchor for its self-signed leaf. Omitted, Node's default
 *    store applies and the self-signed leaf is rejected — the test's second case proves that, so the
 *    validation in the passing case is real and not bypassed. `rejectUnauthorized` is never lowered.
 *
 * Each option is spread only when present, so an absent one leaves undici's default rather than
 * overriding it with `undefined`.
 */
export function tunnelHttpClient(opts: { ca?: string; servername?: string }): HttpClient {
  const dispatcher = new Agent({
    connect: {
      ...(opts.servername === undefined ? {} : { servername: opts.servername }),
      ...(opts.ca === undefined ? {} : { ca: opts.ca }),
    },
  });
  return undiciHttpClient(dispatcher);
}
