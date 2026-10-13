import { request, type ClientRequest } from "node:http";
import type { Socket } from "node:net";

const MAX_REPLY_BYTES = 64 * 1024;

/**
 * What one IPP request over HTTP came to. `unreachable` means no connection opened before an error,
 * the deadline or the signal ended the exchange, so the printer received nothing; `no_answer` means
 * the connection opened and no usable reply came, so it may have received the whole request.
 */
export type IppExchange =
  | { kind: "reply"; body: Buffer }
  | { kind: "http_refused" }
  | { kind: "unreachable" }
  | { kind: "no_answer" };

/**
 * POSTs one IPP request on a connection of its own and waits for the reply, at most `timeoutMs`,
 * or until `signal` aborts. It never retries.
 */
export function exchangeIpp(
  host: string,
  port: number,
  resourcePath: string,
  body: Buffer,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<IppExchange> {
  return new Promise((resolve) => {
    let req: ClientRequest | undefined;
    let connected = false;
    let finished = false;
    const finish = (outcome: IppExchange): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", giveUp);
      req?.destroy();
      resolve(outcome);
    };
    const giveUp = (): void => finish({ kind: connected ? "no_answer" : "unreachable" });
    const timer = setTimeout(giveUp, timeoutMs);
    signal?.addEventListener("abort", giveUp, { once: true });
    if (signal?.aborted) giveUp();
    if (finished) return;
    try {
      req = request(
        {
          host,
          port,
          path: resourcePath,
          method: "POST",
          agent: false,
          // An HP M181fw aborted the same Print-Job sent with content-length and printed it chunked
          // (owner check 2026-10-12: jobs 918 and 919 against 920).
          headers: { "content-type": "application/ipp", "transfer-encoding": "chunked" },
        },
        (res) => {
          if (res.statusCode !== 200) {
            finish({ kind: "http_refused" });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_REPLY_BYTES) finish({ kind: "no_answer" });
            else chunks.push(chunk);
          });
          res.on("end", () => finish({ kind: "reply", body: Buffer.concat(chunks) }));
          res.on("error", () => finish({ kind: "no_answer" }));
        },
      );
      req.on("socket", (socket: Socket) =>
        socket.once("connect", () => {
          connected = true;
        }),
      );
      req.on("error", giveUp);
      req.end(body);
    } catch {
      finish({ kind: "unreachable" });
    }
  });
}

export async function queryIppAttributes(
  host: string,
  port: number,
  resourcePath: string,
  timeoutMs: number,
  encode: () => Buffer,
): Promise<Uint8Array | undefined> {
  let body: Buffer;
  try {
    body = encode();
  } catch {
    return undefined;
  }
  const reply = await exchangeIpp(host, port, resourcePath, body, timeoutMs);
  return reply.kind === "reply" ? reply.body : undefined;
}
