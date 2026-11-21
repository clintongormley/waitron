import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import type { Hono } from "hono";
import type { BoxJoinAttempt, JoinAttemptState, JoinedBox } from "../box-join-attempt.js";
import { ownContactUrl } from "../box-name.js";

/** The store address a new box advertised at `advertisedOrigin` sends, as the join attempt builds it. */
export function joinStoreUrl(advertisedOrigin: string, nodeId: string, storePort = 7443): string {
  const store = new URL(ownContactUrl(advertisedOrigin, nodeId));
  store.protocol = "https:";
  store.port = String(storePort);
  return store.origin;
}

/**
 * Stands in for `createBoxJoinAttempt` once the main box has approved: every Join is approved at
 * once and holds `joined`, which `joined` may build only when the Join is made.
 */
export function approvedJoinAttempt(joined: () => JoinedBox | Promise<JoinedBox>): BoxJoinAttempt {
  const CODE = "482913";
  let state: JoinAttemptState | null = null;
  let held: JoinedBox | null = null;
  return {
    start: async () => {
      held = await joined();
      state = { state: "approved", code: CODE };
      return { code: CODE, addresses: [], expiresAt: new Date(Date.now() + 900_000).toISOString() };
    },
    cancel: async () => {
      state = null;
      held = null;
    },
    current: () => state,
    joined: () => held,
  };
}

const PAGE = "https://box.test";

/**
 * Join, then Finish joining, on `app`'s setup routes, from the box's own page over an encrypted
 * connection. Answers Join's refusal, or Finish joining's answer.
 */
export async function finishJoining(
  app: Hono,
  primaryUrl = "https://primary.example",
): Promise<Response> {
  const socket = new TLSSocket(new Socket());
  try {
    const send = (path: string, body: unknown, handle?: string) =>
      Promise.resolve(
        app.request(
          `${PAGE}/setup-api/${path}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: PAGE,
              ...(handle === undefined ? {} : { "x-waitron-join-handle": handle }),
            },
            body: JSON.stringify(body),
          },
          { incoming: { socket } },
        ),
      );
    const started = await send("join/start", { primaryUrl });
    if (started.status !== 200) return started;
    const { handle } = (await started.json()) as { handle: string };
    return await send("adopt", {}, handle);
  } finally {
    socket.destroy();
  }
}
