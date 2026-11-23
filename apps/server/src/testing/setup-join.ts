import { rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { loadKeyRing, nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import { nodes } from "@waitron/db";
import { mountBoxJoinApi } from "../box-join-api.js";
import type { BoxJoinAttempt, JoinAttemptState, JoinedBox } from "../box-join-attempt.js";
import { lockJoinBundle } from "../box-join-seal.js";
import { establishNodeIdentity, readNodeIdentityKey } from "../node-identity.js";
import { freshVenue } from "./boot-harness.js";
import { waitUntil } from "./scenario-stages.js";
import type { MirrorBundle } from "../mirror-bundle.js";

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
      state = { state: "approved" };
      return { code: CODE, timeLeftMs: 900_000 };
    },
    confirm: async () => {},
    cancel: async () => {
      state = null;
      held = null;
    },
    current: () => state,
    joined: () => held,
  };
}

/** How a test sends the new box's setup page's requests; `handle` travels as the join handle. */
export type SetupPageSend = (
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; handle?: string },
) => Promise<Response>;

type Wait = (what: string, ms: number, probe: () => Promise<true | undefined>) => Promise<unknown>;

const untilApproved: Wait = (what, ms, probe) => waitUntil(what, ms, probe, undefined, 250);

/**
 * Join the main box at `primaryUrl` on the new box's setup page, say Yes there, let `approve` act on
 * the main box (an answer it gives is the result), wait until the join is approved, then finish
 * joining. Answers Join's or the Yes's refusal, `approve`'s answer, or the finish's answer.
 */
export async function joinThenFinish(
  send: SetupPageSend,
  primaryUrl: string,
  options: {
    approve?: (shown: { code: string; handle: string }) => Promise<Response | undefined>;
    wait?: Wait;
    waitMs?: number;
  } = {},
): Promise<Response> {
  const started = await send("/setup-api/join/start", { body: { primaryUrl } });
  if (started.status !== 200) return started;
  const shown = (await started.json()) as { code: string; handle: string };
  const confirmed = await send("/setup-api/join/confirm", { handle: shown.handle });
  if (confirmed.status !== 204) return confirmed;
  const answered = await options.approve?.(shown);
  if (answered !== undefined) return answered;
  await (options.wait ?? untilApproved)(
    "the main box to approve the join",
    options.waitMs ?? 20_000,
    async () => {
      const read = await send("/setup-api/join", { method: "GET", handle: shown.handle });
      const body = await read.text();
      if (read.status !== 200) throw new Error(`the join state read answered ${body}`);
      const { state } = JSON.parse(body) as { state: string };
      if (/^(ended|failed|replaced|none)$/.test(state)) throw new Error(`the join is ${body}`);
      return state === "approved" ? true : undefined;
    },
  );
  return send("/setup-api/adopt", { body: {}, handle: shown.handle });
}

const PAGE = "https://box.test";

/**
 * {@link joinThenFinish} on `app`'s setup routes, from the box's own page over an encrypted
 * connection.
 */
export async function finishJoining(
  app: Hono,
  primaryUrl = "https://primary.example",
): Promise<Response> {
  const socket = new TLSSocket(new Socket());
  try {
    return await joinThenFinish(
      (path, { method = "POST", body, handle }) =>
        Promise.resolve(
          app.request(
            `${PAGE}${path}`,
            {
              method,
              headers: {
                "content-type": "application/json",
                origin: PAGE,
                ...(handle === undefined ? {} : { "x-waitron-join-handle": handle }),
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            },
            { incoming: { socket } },
          ),
        ),
      primaryUrl,
    );
  } finally {
    socket.destroy();
  }
}

/**
 * A main box's real box-to-box join routes, on a database of its own whose node `nodeId` holds
 * `keys`, as a listener for the new box's real requests. A network delivers the new box's requests
 * from an address it holds, so each arrives from the first address its hello listed. `approve`
 * stands in for the person who saw `code` on the new box choosing Add as spare, approving with the
 * bundle `bundleFor` builds for the asking box, locked as the person's approve locks it.
 */
export async function mainBoxJoinRoutes(main: {
  nodeId: string;
  bundleFor: (standby: { nodeId: string; publicKey: string }) => MirrorBundle;
}) {
  const box = await freshVenue();
  const { venue, node } = box.store;
  await venue.insert(nodes).values({ id: main.nodeId, name: "Main box" });
  await establishNodeIdentity({ ownerDb: venue, node, ring: MAIN_RING }, main.nodeId);
  const privateKey = await readNodeIdentityKey(node, MAIN_RING, main.nodeId);
  const app = new Hono();
  const requests = mountBoxJoinApi(app, {
    appDb: venue,
    node,
    ring: MAIN_RING,
    designated: { nodeId: main.nodeId },
  });
  let from: string | undefined;
  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (req.url === "/api/node/join/hello")
        from = (JSON.parse(body) as { addresses?: string[] }).addresses?.[0];
      void Promise.resolve(
        app.request(
          `https://main.test${req.url}`,
          { method: req.method, headers: { "content-type": "application/json" }, body },
          { incoming: { socket: { remoteAddress: from } } },
        ),
      ).then(async (response) => {
        res.writeHead(response.status, { "content-type": "application/json" });
        res.end(await response.text());
      });
    });
  };
  return {
    keys: { privateKey, publicKey: nodeSigningPublicKey(privateKey) },
    listener,
    approve: async ({ code }: { code: string }): Promise<undefined> => {
      const [listed] = requests.listed();
      const checked = listed === undefined ? undefined : requests.check(listed.id);
      if (checked === undefined || "refused" in checked) throw new Error("no join is listed");
      if (checked.code !== code) throw new Error("the two boxes show different codes");
      const begun = requests.approve.begin(listed!.id);
      if (!("encryptionKey" in begun)) throw new Error(`approve refused: ${begun.refused}`);
      const { newNodeId, newPublicKey } = checked.hello;
      const bundle = main.bundleFor({ nodeId: newNodeId, publicKey: newPublicKey });
      const locked = lockJoinBundle({
        requestId: listed!.id,
        encryptionKey: begun.encryptionKey,
        bundle: Buffer.from(JSON.stringify(bundle)),
        mainPrivateKey: privateKey,
      });
      if (!requests.approve.finish(listed!.id, locked)) throw new Error("approve not finished");
      return undefined;
    },
    close: async () => {
      await box.store.close();
      await rm(box.directory, { recursive: true, force: true });
    },
  };
}

const MAIN_RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x4d).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
