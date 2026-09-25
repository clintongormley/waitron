import { Agent, type Dispatcher, fetch as undiciFetch } from "undici";

type HttpClient = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

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
 * A tunnel-aware `HttpClient`. The caller dials the RELAY's address, but the certificate belongs to the
 * BOX: the relay only splices bytes and never terminates TLS.
 *
 * `servername` drives both the SNI and Node's default `checkServerIdentity` hostname, so the cert is
 * checked against the box hostname, not the relay's URL host. `ca` is the box's private CA; omitted,
 * Node's default store rejects the self-signed leaf. `rejectUnauthorized` is never lowered.
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
