// `POST /api/node/join/*`, on the singleton primary: a new box asks to join as a spare. Each message
// after the hello is signed with the new box's node key and must come from an address its hello
// listed; the person compares the code on both screens before anything is sent.
import "./errors.js";
import { createPublicKey } from "node:crypto";
import { isIP, SocketAddress } from "node:net";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, isUuid } from "@waitron/shared";
import { nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import { readNodeMembership, type Database, type NodeDatabase } from "@waitron/db";
import { createErrorBoundary, readJsonBody } from "@waitron/server-kit";
import {
  JOIN_CANCEL_LABEL,
  JOIN_HELLO_LABEL,
  JOIN_POLL_LABEL,
  JOIN_PROTOCOL,
  JOIN_REVEAL_LABEL,
  helloMessageFields,
  revealAnswerFields,
  signJoinMessage,
  verifyJoinMessage,
} from "./box-join-code.js";
import {
  createBoxJoinRequests,
  type BoxJoinRequests,
  type HeldJoinRequest,
  type JoinEndReason,
  type JoinFull,
  type JoinHello,
} from "./box-join-requests.js";
import { sameBoxName } from "./box-name.js";
import { isBareOrigin } from "./config.js";
import type { Logger } from "./logger.js";
import { isStoreUrlOf, MAX_CLOCK_GAP_MS } from "./mirror-bundle-api.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { peerBodyLimit } from "./peer-route-limits.js";
import { requestAddress } from "./request-from-box.js";

const BODY_LIMIT = 65536;
const NONCE_BYTES = 32;
const MAX_ADDRESSES = 32;

export interface BoxJoinApiDeps {
  appDb: Database;
  node: NodeDatabase;
  ring: KeyRing;
  designated: { nodeId: string };
  requests?: BoxJoinRequests;
  now?: () => Date;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "mirror.standby_invalid": 400,
  "mirror.join_invalid": 400,
  "mirror.join_address_mismatch": 409,
  "mirror.clocks_apart": 409,
  "mirror.standby_name_taken": 409,
  "mirror.join_code_taken": 409,
  "mirror.join_not_found": 404,
  "mirror.join_full": 429,
};

const invalid = () => new AppError("mirror.join_invalid", {});

function keyOfType(value: unknown, type: "ed25519" | "x25519"): value is string {
  if (typeof value !== "string" || value === "") return false;
  try {
    const key = createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
    return key.asymmetricKeyType === type;
  } catch {
    return false;
  }
}

function nonceOf(value: unknown): Buffer {
  if (typeof value !== "string") throw invalid();
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== NONCE_BYTES || bytes.toString("base64") !== value) throw invalid();
  return bytes;
}

function seqOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw invalid();
  return value;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(new Date(value).getTime());
}

function parseHello(body: Record<string, unknown>): {
  hello: JoinHello;
  at: number;
  signature: string;
} {
  const { newNodeId, newPublicKey, encryptionKey, contactUrl, storeUrl, addresses, at } = body;
  if (
    typeof newNodeId !== "string" ||
    !isUuid(newNodeId) ||
    !keyOfType(newPublicKey, "ed25519") ||
    !keyOfType(encryptionKey, "x25519") ||
    typeof contactUrl !== "string" ||
    !isBareOrigin(contactUrl) ||
    !isStoreUrlOf(storeUrl, contactUrl) ||
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.length > MAX_ADDRESSES ||
    !addresses.every((a) => typeof a === "string" && isIP(a) !== 0) ||
    !isTime(at) ||
    typeof body.signature !== "string"
  )
    throw new AppError("mirror.standby_invalid", {});
  return {
    signature: body.signature,
    hello: {
      newNodeId,
      newPublicKey,
      encryptionKey,
      contactUrl,
      storeUrl: storeUrl as string,
      addresses: addresses as string[],
    },
    at,
  };
}

/** One spelling per address: no `%scope`, no IPv4-mapped prefix, IPv6 lower-case and compressed. */
function canonicalAddress(address: string): string {
  const bare = address.replace(/%.*$/, "");
  const compressed =
    isIP(bare) === 6 ? new SocketAddress({ address: bare, family: "ipv6" }).address : bare;
  const mapped = /^::ffff:(.*)$/i.exec(compressed)?.[1];
  return mapped !== undefined && isIP(mapped) === 4 ? mapped : compressed;
}

/** The request's source address, in canonical spelling, when the hello lists it. */
function listedSource(c: Context, addresses: readonly string[]): string {
  const raw = requestAddress(c);
  const from = raw === undefined ? undefined : canonicalAddress(raw);
  if (from === undefined || !addresses.some((a) => canonicalAddress(a) === from))
    throw new AppError("mirror.join_address_mismatch", {});
  return from;
}

function full(refusal: JoinFull): AppError {
  return new AppError("mirror.join_full", { limit: refusal.limit, retryAt: refusal.retryAt });
}

function endedRefusal(reason: JoinEndReason): AppError {
  if (reason === "code_taken") return new AppError("mirror.join_code_taken", {});
  if (reason === "invalid") return invalid();
  return new AppError("mirror.join_not_found", {});
}

function storeRefusal(refused: "not_found" | "invalid"): AppError {
  return refused === "not_found" ? new AppError("mirror.join_not_found", {}) : invalid();
}

export function mountBoxJoinApi(
  app: Hono,
  deps: BoxJoinApiDeps,
  log: Logger = () => {},
): BoxJoinRequests {
  const run = createErrorBoundary(STATUS, "mirror.join_failed");
  const requests = deps.requests ?? createBoxJoinRequests();
  const now = () => (deps.now ?? (() => new Date()))().getTime();

  const privateKey = () => readNodeIdentityKey(deps.node, deps.ring, deps.designated.nodeId);
  let publicKey: Promise<string> | undefined;
  const mainPublicKey = () => {
    publicKey ??= privateKey().then(nodeSigningPublicKey);
    // A failed read is tried again on the next hello.
    publicKey.catch(() => (publicKey = undefined));
    return publicKey;
  };

  /** The held request a signed message names, checked for its source address and signature. */
  async function signedRequest(
    c: Context,
    label: string,
    fields: (body: Record<string, unknown>) => Buffer[],
  ): Promise<{
    body: Record<string, unknown>;
    requestId: string;
    seq: number;
    held: HeldJoinRequest;
  }> {
    const body = await readJsonBody<Record<string, unknown>>(c);
    const { requestId, signature } = body;
    if (typeof requestId !== "string" || !isUuid(requestId) || typeof signature !== "string")
      throw invalid();
    const seq = seqOf(body.seq);
    const signed = fields(body);
    const held = requests.requestFor(requestId);
    if (held === null) throw new AppError("mirror.join_not_found", {});
    listedSource(c, held.hello.addresses);
    if (!verifyJoinMessage(label, requestId, seq, signed, signature, held.hello.newPublicKey)) {
      requests.endInvalid(requestId);
      throw invalid();
    }
    return { body, requestId, seq, held };
  }

  for (const path of ["hello", "reveal", "poll", "cancel"])
    app.use(`/api/node/join/${path}`, peerBodyLimit(BODY_LIMIT));

  app.post("/api/node/join/hello", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (body.protocol !== JOIN_PROTOCOL) throw invalid();
      const { hello, at, signature } = parseHello(body);
      const address = listedSource(c, hello.addresses);
      if (
        !verifyJoinMessage(
          JOIN_HELLO_LABEL,
          "",
          0,
          helloMessageFields(hello, at),
          signature,
          hello.newPublicKey,
        )
      )
        throw invalid();
      const limited = requests.admitHello(address);
      if (limited !== null) throw full(limited);
      const mainAt = now();
      if (Math.abs(mainAt - at) >= MAX_CLOCK_GAP_MS)
        throw new AppError("mirror.clocks_apart", {
          primaryAt: new Date(mainAt).toISOString(),
          standbyAt: new Date(at).toISOString(),
        });
      const held = await readNodeMembership(deps.appDb);
      if (
        sameBoxName(deps.designated.nodeId, hello.newNodeId) ||
        held?.body.nodes.some((n) => sameBoxName(n.nodeId, hello.newNodeId))
      )
        throw new AppError("mirror.standby_name_taken", {});

      const main = { nodeId: deps.designated.nodeId, publicKey: await mainPublicKey() };
      const answer = requests.openHello({
        address,
        hello,
        main,
        at: new Date(at).toISOString(),
      });
      if ("refused" in answer) throw full(answer);
      return c.json({
        requestId: answer.requestId,
        mainNodeId: main.nodeId,
        mainPublicKey: main.publicKey,
        commitment: answer.commitment.toString("base64"),
        expiresAt: answer.expiresAt,
      });
    }),
  );

  app.post("/api/node/join/reveal", (c) =>
    run(c, log, async () => {
      let newNonce: Buffer = Buffer.alloc(0);
      const { requestId, seq, held } = await signedRequest(c, JOIN_REVEAL_LABEL, (body) => {
        newNonce = nonceOf(body.newNonce);
        return [newNonce];
      });
      // The store signs only a first reveal, so a repeat needs no key unsealed.
      const key = held.revealed ? undefined : await privateKey();
      const answer = requests.reveal({
        requestId,
        newNonce,
        seq,
        signAnswer: (mainNonce) =>
          signJoinMessage(
            JOIN_REVEAL_LABEL,
            requestId,
            seq,
            revealAnswerFields(held.hello, newNonce, mainNonce),
            key!,
          ),
      });
      if ("refused" in answer) {
        if (answer.refused === "full") throw full(answer);
        if (answer.refused === "code_taken") throw new AppError("mirror.join_code_taken", {});
        if (answer.refused === "ended") throw endedRefusal(answer.reason);
        throw storeRefusal(answer.refused);
      }
      return c.json({
        mainNonce: answer.mainNonce.toString("base64"),
        signature: answer.signature,
      });
    }),
  );

  app.post("/api/node/join/poll", (c) =>
    run(c, log, async () => {
      let at = 0;
      const { requestId, seq } = await signedRequest(c, JOIN_POLL_LABEL, (body) => {
        if (!isTime(body.at)) throw invalid();
        at = body.at;
        return [Buffer.from(String(at))];
      });
      const answer = requests.poll({ requestId, seq, at: new Date(at).toISOString() });
      if ("refused" in answer) throw storeRefusal(answer.refused);
      return c.json(answer);
    }),
  );

  app.post("/api/node/join/cancel", (c) =>
    run(c, log, async () => {
      const { requestId, seq } = await signedRequest(c, JOIN_CANCEL_LABEL, () => []);
      const answer = requests.cancel({ requestId, seq });
      if ("refused" in answer) throw storeRefusal(answer.refused);
      return c.json(answer);
    }),
  );

  return requests;
}
