import type { Http2Bindings, HttpBindings } from "@hono/node-server";
import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";

type Fetch = (request: Request, env: HttpBindings | Http2Bindings) => unknown;

export interface ResetAnswer {
  status: number;
  body: string;
}

/**
 * Wraps a listener's `fetch` so the next request it is armed for reaches the app only after its
 * connection has closed, as a client that resets straight after sending leaves it.
 */
export function resetObserver() {
  let armed:
    | { arrived: () => void; answered: (answer: ResetAnswer) => void; failed: (e: unknown) => void }
    | undefined;
  const wrap =
    (fetch: Fetch): Fetch =>
    async (request, env) => {
      const waiting = armed;
      if (waiting === undefined) return fetch(request, env);
      armed = undefined;
      try {
        const socket = env.incoming.socket;
        const closed = new Promise<void>((resolve) =>
          socket.destroyed ? resolve() : socket.once("close", () => resolve()),
        );
        waiting.arrived();
        await closed;
        if (!env.incoming.complete)
          throw new Error("the connection closed before the whole request");
        const response = (await fetch(request, env)) as Response;
        waiting.answered({ status: response.status, body: await response.clone().text() });
        return response;
      } catch (error) {
        waiting.failed(error);
        throw error;
      }
    };
  /** Sends `request` (a whole HTTP/1.1 message) to `port`, resets the connection once the server
   * holds the request, and resolves with what the app answered after the reset. */
  const sendThenReset = async (
    port: number,
    request: string,
    { tls = false }: { tls?: boolean } = {},
  ): Promise<ResetAnswer> => {
    let arrived!: () => void;
    const held = new Promise<void>((resolve) => (arrived = resolve));
    const answer = new Promise<ResetAnswer>((answered, failed) => {
      armed = { arrived, answered, failed };
    });
    const raw: Socket = connectTcp(port, "127.0.0.1");
    raw.on("error", () => {});
    const sent = new Promise<void>((resolve, reject) => {
      const write = (stream: Socket) => stream.write(request, (e) => (e ? reject(e) : resolve()));
      if (!tls) raw.once("connect", () => write(raw));
      else {
        const secure = connectTls({ socket: raw, rejectUnauthorized: false });
        secure.on("error", () => {});
        secure.once("secureConnect", () => write(secure));
      }
    });
    await sent;
    await Promise.race([held, answer]);
    raw.resetAndDestroy();
    return answer;
  };
  return { wrap, sendThenReset };
}
