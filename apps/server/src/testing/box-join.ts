import { generateKeyPairSync, randomBytes } from "node:crypto";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import type { Hono } from "hono";
import { withTransaction, type Database } from "@waitron/db";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  JOIN_CANCEL_LABEL,
  JOIN_HELLO_LABEL,
  JOIN_POLL_LABEL,
  JOIN_REVEAL_LABEL,
  helloMessageFields,
  joinCode,
  signJoinMessage,
  type JoinField,
} from "../box-join-code.js";
import {
  mountBoxJoinApi,
  mountBoxJoinPersonApi,
  type BoxJoinPersonApiDeps,
} from "../box-join-api.js";
import {
  createBoxJoinRequests,
  type BoxJoinRequests,
  type JoinHello,
} from "../box-join-requests.js";
import { unlockJoinBundle, type LockedJoinBundle } from "../box-join-seal.js";
import { boxHostnameFor } from "../box-name.js";
import type { Logger } from "../logger.js";
import { generateStandbyIdentity, type StandbyIdentity } from "../reserved-identity.js";
import { setFreshManagementSignIn } from "./fresh-management-sign-in.js";

/** The origin every request below is sent to, so a person's request comes from this box's page. */
export const JOIN_ORIGIN = "https://waitron.local";

/** A new box asking to join: what it sends, and the keys it keeps. */
export interface JoiningBox {
  identity: StandbyIdentity;
  hello: JoinHello;
  address: string;
  encryptionPrivateKey: string;
  newNonce: Buffer;
  /** The last sequence number it signed. */
  seq: number;
}

export function joiningBox(
  address: string,
  options: {
    identity?: StandbyIdentity;
    /** Draws identities until the box's name differs from this node's. */
    unlikeNodeId?: string;
    addresses?: string[];
    contactUrl?: string;
    storeUrl?: string;
  } = {},
): JoiningBox {
  let identity = options.identity ?? generateStandbyIdentity();
  while (
    options.unlikeNodeId !== undefined &&
    boxHostnameFor(identity.nodeId) === boxHostnameFor(options.unlikeNodeId)
  )
    identity = generateStandbyIdentity();
  const ek = generateKeyPairSync("x25519");
  return {
    identity,
    address,
    encryptionPrivateKey: ek.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    newNonce: randomBytes(32),
    seq: 0,
    hello: {
      newNodeId: identity.nodeId,
      newPublicKey: identity.publicKey,
      encryptionKey: ek.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      contactUrl: options.contactUrl ?? `https://${address}:8443`,
      storeUrl: options.storeUrl ?? `https://${address}:9000`,
      addresses: options.addresses ?? [address],
    },
  };
}

export function signedBy(
  box: JoiningBox,
  label: string,
  requestId: string,
  seq: number,
  fields: JoinField[],
): string {
  return signJoinMessage(label, requestId, seq, fields, box.identity.privateKey);
}

export function helloBody(
  box: JoiningBox,
  overrides: Record<string, unknown> = {},
  at = Date.now(),
): Record<string, unknown> {
  let signature = "";
  try {
    signature = signedBy(box, JOIN_HELLO_LABEL, "", 0, helloMessageFields(box.hello, at));
  } catch {
    // A field that cannot be signed goes unsigned, for the route's own shape check to answer.
  }
  return { protocol: 1, ...box.hello, at, signature, ...overrides };
}

export function revealBody(box: JoiningBox, requestId: string): Record<string, unknown> {
  return {
    requestId,
    seq: 1,
    newNonce: box.newNonce.toString("base64"),
    signature: signedBy(box, JOIN_REVEAL_LABEL, requestId, 1, [box.newNonce]),
  };
}

/** A box-to-box request, from `from`. */
export function boxPost(app: Hono, path: string, body: unknown, from: string): Promise<Response> {
  return Promise.resolve(
    app.request(
      `${JOIN_ORIGIN}/api/node/join/${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      { incoming: { socket: { remoteAddress: from } } },
    ),
  );
}

export interface HelloAnswer {
  requestId: string;
  mainNodeId: string;
  mainPublicKey: string;
  commitment: string;
  expiresAt: string;
}

/** The new box's request, once revealed: listed on the main box, with the code the new box shows. */
export interface ListedJoin {
  requestId: string;
  code: string;
  box: JoiningBox;
  mainPublicKey: string;
}

/** A hello and its reveal, so the request is listed. Answers the refusal when either is refused. */
export async function askToJoin(
  app: Hono,
  box: JoiningBox,
  at = Date.now(),
): Promise<ListedJoin | Response> {
  const hello = await boxPost(app, "hello", helloBody(box, {}, at), box.address);
  if (hello.status !== 200) return hello;
  const answer = (await hello.json()) as HelloAnswer;
  const reveal = await boxPost(app, "reveal", revealBody(box, answer.requestId), box.address);
  if (reveal.status !== 200) return reveal;
  box.seq = 1;
  const { mainNonce } = (await reveal.json()) as { mainNonce: string };
  const code = joinCode({
    ...box.hello,
    mainNodeId: answer.mainNodeId,
    mainPublicKey: answer.mainPublicKey,
    newNonce: box.newNonce,
    mainNonce: Buffer.from(mainNonce, "base64"),
    requestId: answer.requestId,
  });
  return { requestId: answer.requestId, code, box, mainPublicKey: answer.mainPublicKey };
}

export async function listedJoin(app: Hono, box: JoiningBox, at = Date.now()): Promise<ListedJoin> {
  const listed = await askToJoin(app, box, at);
  if (listed instanceof Response)
    throw new Error(`join not listed: ${listed.status} ${await listed.text()}`);
  return listed;
}

export async function pollJoin(app: Hono, listed: ListedJoin, at = Date.now()): Promise<unknown> {
  listed.box.seq += 1;
  const { requestId, box } = listed;
  const response = await boxPost(
    app,
    "poll",
    {
      requestId,
      seq: box.seq,
      at,
      signature: signedBy(box, JOIN_POLL_LABEL, requestId, box.seq, [Buffer.from(String(at))]),
    },
    box.address,
  );
  return response.json();
}

export async function cancelJoin(app: Hono, listed: ListedJoin): Promise<Response> {
  listed.box.seq += 1;
  const { requestId, box } = listed;
  return boxPost(
    app,
    "cancel",
    {
      requestId,
      seq: box.seq,
      signature: signedBy(box, JOIN_CANCEL_LABEL, requestId, box.seq, []),
    },
    box.address,
  );
}

/** Opens what an approved poll handed the new box, as the new box does; null when it does not open. */
export function unlockJoin(listed: ListedJoin, locked: LockedJoinBundle): unknown {
  const opened = unlockJoinBundle({
    requestId: listed.requestId,
    locked,
    encryptionKey: listed.box.hello.encryptionKey,
    encryptionPrivateKey: listed.box.encryptionPrivateKey,
    mainPublicKey: listed.mainPublicKey,
  });
  return opened === null ? null : JSON.parse(opened.toString("utf8"));
}

/** A dashboard sign-in cookie for `personId`, its last password check fresh unless `fresh` is false. */
export async function signedInCookie(
  db: Database,
  personId: string,
  fresh = true,
): Promise<string> {
  const session = await withTransaction(db, (tx) =>
    startManagementSession(tx, { method: "password", personId }),
  );
  const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
  await withTransaction(db, (tx) => setFreshManagementSignIn(tx, cookie, fresh));
  return cookie;
}

export interface PersonSent {
  cookie: string;
  headers?: Record<string, string>;
  env?: Record<string, unknown>;
  body?: unknown;
}

/** A person's request from this box's own page, over an encrypted connection. */
export async function personPost(
  app: Hono,
  path: string,
  sent: PersonSent,
): Promise<{ status: number; body: unknown }> {
  const socket = new TLSSocket(new Socket());
  try {
    const response = await app.request(
      `${JOIN_ORIGIN}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sent.cookie,
          origin: JOIN_ORIGIN,
          ...sent.headers,
        },
        body: JSON.stringify(sent.body ?? {}),
      },
      { incoming: { socket }, ...sent.env },
    );
    const text = await response.text();
    return { status: response.status, body: text === "" ? null : JSON.parse(text) };
  } finally {
    socket.destroy();
  }
}

export const checkJoin = (app: Hono, requestId: string, sent: PersonSent) =>
  personPost(app, `/management-api/box-joins/${requestId}/check`, sent);
export const approveJoin = (app: Hono, requestId: string, body: unknown, sent: PersonSent) =>
  personPost(app, `/management-api/box-joins/${requestId}/approve`, { ...sent, body });
export const dismissJoin = (app: Hono, requestId: string, sent: PersonSent) =>
  personPost(app, `/management-api/box-joins/${requestId}/dismiss`, sent);

/** Mounts the box-to-box and the person routes on one request store, and returns the store. */
export function mountBoxJoin(
  app: Hono,
  deps: Omit<BoxJoinPersonApiDeps, "requests"> & { requests?: BoxJoinRequests; log?: Logger },
): BoxJoinRequests {
  const requests = deps.requests ?? createBoxJoinRequests();
  const { appDb, node, ring, designated, now, log, ...rest } = deps;
  mountBoxJoinApi(app, { appDb, node, ring, designated, requests, now }, log);
  mountBoxJoinPersonApi(app, { appDb, node, ring, designated, now, ...rest, requests }, log);
  return requests;
}

/**
 * A whole join on routes {@link mountBoxJoin} mounted: hello, reveal, the person's tap on the right
 * code, then the new box's poll and unlock. Answers as the password route `POST
 * /management-api/mirror-bundle` did, so its callers' checks read the same: 200 with the bundle
 * when the poll hands one that opens, otherwise the hello's, reveal's or approve's refusal. A
 * refused approve dismisses the request, so it holds no place in the store.
 */
export async function joinAsBundleAnswer(
  app: Hono,
  join: {
    box: JoiningBox;
    sent: PersonSent;
    moduleOperation?: unknown;
    at?: number;
  },
): Promise<Response> {
  const listed = await askToJoin(app, join.box, join.at);
  if (listed instanceof Response) return listed;
  const approved = await approveJoin(
    app,
    listed.requestId,
    { code: listed.code, moduleOperation: join.moduleOperation },
    join.sent,
  );
  if (approved.status !== 202) {
    await dismissJoin(app, listed.requestId, join.sent);
    return Response.json(approved.body, { status: approved.status });
  }
  const answer = (await pollJoin(app, listed)) as { state: string; locked?: LockedJoinBundle };
  if (answer.state !== "approved" || answer.locked === undefined)
    throw new Error(`approved join not handed over: ${JSON.stringify(answer)}`);
  const bundle = unlockJoin(listed, answer.locked);
  if (bundle === null) throw new Error("approved join's bundle does not open");
  return Response.json(bundle, { status: 200 });
}
