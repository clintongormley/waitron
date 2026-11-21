import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import type { Hono } from "hono";
import type { BoxJoinAttempt, JoinAttemptState, JoinedBox } from "../box-join-attempt.js";
import {
  JOIN_REVEAL_LABEL,
  commitmentFor,
  revealAnswerFields,
  signJoinMessage,
  type JoinHelloFields,
} from "../box-join-code.js";
import { lockJoinBundle } from "../box-join-seal.js";
import { ownContactUrl } from "../box-name.js";
import type { MirrorBundle } from "../mirror-bundle.js";

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

/**
 * A main box that answers a new box's hello, reveal and polls as the real routes do, signed with
 * `keys`, and approves at once with the bundle `bundleFor` builds for the asking box. It checks
 * none of the new box's signatures or addresses: those are the real routes' to check.
 */
export function stubMainBox(main: {
  nodeId: string;
  keys: { publicKey: string; privateKey: string };
  bundleFor: (standby: { nodeId: string; publicKey: string }) => MirrorBundle;
}): (req: IncomingMessage, res: ServerResponse) => void {
  const requests = new Map<string, { hello: JoinHelloFields; mainNonce: Buffer }>();
  const answer = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  return (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<
        string,
        never
      >;
      if (req.url === "/api/node/join/hello") {
        const requestId = randomUUID();
        const mainNonce = randomBytes(32);
        const { newNodeId, newPublicKey, encryptionKey, contactUrl, storeUrl, addresses } = body;
        requests.set(requestId, {
          hello: { newNodeId, newPublicKey, encryptionKey, contactUrl, storeUrl, addresses },
          mainNonce,
        });
        answer(res, 200, {
          requestId,
          mainNodeId: main.nodeId,
          mainPublicKey: main.keys.publicKey,
          commitment: commitmentFor(requestId, mainNonce).toString("base64"),
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        });
        return;
      }
      const held = requests.get(body.requestId);
      if (held === undefined) {
        answer(res, 404, { error: { code: "mirror.join_not_found", params: {} } });
        return;
      }
      if (req.url === "/api/node/join/reveal") {
        const newNonce = Buffer.from(body.newNonce as string, "base64");
        answer(res, 200, {
          mainNonce: held.mainNonce.toString("base64"),
          signature: signJoinMessage(
            JOIN_REVEAL_LABEL,
            body.requestId,
            body.seq,
            revealAnswerFields(held.hello, newNonce, held.mainNonce),
            main.keys.privateKey,
          ),
        });
        return;
      }
      if (req.url === "/api/node/join/poll") {
        const bundle = main.bundleFor({
          nodeId: held.hello.newNodeId,
          publicKey: held.hello.newPublicKey,
        });
        answer(res, 200, {
          state: "approved",
          locked: lockJoinBundle({
            requestId: body.requestId,
            encryptionKey: held.hello.encryptionKey,
            bundle: Buffer.from(JSON.stringify(bundle)),
            mainPrivateKey: main.keys.privateKey,
          }),
        });
        return;
      }
      requests.delete(body.requestId);
      answer(res, 200, { state: "ended", reason: "cancelled" });
    });
  };
}
