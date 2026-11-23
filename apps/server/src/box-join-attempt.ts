// The new box's side of a join by code: it asks the main box, shows the code, and waits for a
// person to tap it there. The attempt lives in memory only, so a restart forgets it.
import "./errors.js";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { AppError, type ErrorCode } from "@waitron/shared";
import {
  JOIN_CANCEL_LABEL,
  JOIN_POLL_LABEL,
  JOIN_PROTOCOL,
  JOIN_REVEAL_LABEL,
  commitmentMatches,
  joinCode,
  pollMessageFields,
  revealAnswerFields,
  revealMessageFields,
  signJoinHello,
  signJoinMessage,
  verifyJoinMessage,
  type JoinField,
  type JoinHello,
} from "./box-join-code.js";
import {
  JOIN_END_REASONS,
  JOIN_LIMITS,
  JOIN_REQUEST_TTL_MS,
  type JoinEndReason,
} from "./box-join-requests.js";
import { unlockJoinBundle, type LockedJoinBundle } from "./box-join-seal.js";
import { ownContactUrl, spareStoreUrl } from "./box-name.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import {
  boxExchange,
  fetchPrimaryCertificate,
  isIsoTime,
  isMirrorBundle,
  type BoxLookup,
} from "./mirror-bundle-fetch.js";
import { isRecord } from "./boot-peer-check.js";
import { assertSafePrimaryUrl, isLoopbackHost } from "./primary-url.js";
import { ownInterfaceAddresses } from "./request-from-box.js";
import { generateStandbyIdentity, type StandbyIdentity } from "./reserved-identity.js";

const POLL_EVERY_MS = 2_000;
const REVEAL_TRIES = 3;
// Each reveal try starts one slot after the last began and is cut off at its slot's end, so three
// end within the ten seconds the person waits for a code.
const TRY_LIMIT_MS = 3_000;

const RELAYED_BARE = [
  "mirror.join_address_mismatch",
  "mirror.standby_name_taken",
  "mirror.join_code_taken",
  "mirror.join_not_found",
  "mirror.join_invalid",
  "mirror.standby_invalid",
  "mirror.join_approving",
] as const satisfies readonly ErrorCode[];

export interface BoxJoinAttemptDeps {
  /** Its `ownContactUrl` is sent as this box's contact address, as adopt does. */
  advertisedOrigin: string;
  /** This box's store port; the store address is its contact name on this port. */
  spareStorePort: number;
  now: () => Date;
  /** The clock the time left is measured on, so a wall-clock step cannot change it. */
  steadyNow?: () => number;
  /** This box's own network addresses; by default every interface address that is not loopback. */
  addresses?: () => string[];
  /** How long after the reveal, and after each poll, the next poll is sent; 2 seconds by default. */
  pollEveryMs?: number;
  /** Every request to the main box, its certificate read included. */
  exchange?: typeof boxExchange;
  lookup?: BoxLookup;
}

export type JoinAttemptState =
  | { state: "waiting"; code: string; primaryUrl: string; timeLeftMs: number }
  | { state: "approved"; code: string }
  /** `unknown`: the main box ended the request for a reason this box does not know. */
  | { state: "ended"; reason: JoinEndReason | "unknown" }
  | { state: "failed"; error: ErrorCode };

/**
 * What an approved attempt hands adopt: the identity it joined under, the main box's bundle and the
 * store address its hello sent, which the main box recorded.
 */
export interface JoinedBox {
  identity: StandbyIdentity;
  bundle: MirrorBundle;
  storeUrl: string;
}

interface Attempt {
  base: URL;
  trust: Parameters<typeof boxExchange>[1]["trust"];
  requestId: string;
  identity: StandbyIdentity;
  hello: JoinHello;
  encryptionPrivateKey: string;
  mainNodeId: string;
  mainPublicKey: string;
  /** The last `seq` this attempt signed. */
  seq: number;
  /** The code this attempt shows, which a failed `state` does not carry. */
  code: string;
  /**
   * When the main box ends the request, on `steadyNow`: it ends one `JOIN_REQUEST_TTL_MS` after
   * the hello arrives, and this is measured from before it was sent, so it is never later.
   */
  deadline: number;
  state: JoinAttemptState;
  bundle?: MirrorBundle;
  timer?: ReturnType<typeof setTimeout>;
}

/** An attempt between its hello and its reveal, before it has a code to show. */
type Asking = Omit<Attempt, "code" | "state">;

const fetchFailed = () => new AppError("mirror.bundle_fetch_failed", {});

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The main box's refusal, rebuilt so nothing it wrote travels on beyond the checked parameters. */
function refusalOf(text: string): AppError {
  const body = jsonOf(text);
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const { code } = error;
  const params = isRecord(error.params) ? error.params : {};
  const bare = RELAYED_BARE.find((c) => c === code);
  if (bare !== undefined) return new AppError(bare, {});
  if (code === "mirror.clocks_apart" && isIsoTime(params.primaryAt) && isIsoTime(params.standbyAt))
    return new AppError(code, { primaryAt: params.primaryAt, standbyAt: params.standbyAt });
  const limit = JOIN_LIMITS.find((l) => l === params.limit);
  const { max, minutes } = params;
  if (
    code === "mirror.join_full" &&
    limit !== undefined &&
    isIsoTime(params.retryAt) &&
    isCount(max) &&
    isCount(minutes)
  )
    return new AppError(code, { limit, retryAt: params.retryAt, max, minutes });
  return fetchFailed();
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function slot(ms: number): { ended: Promise<void>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ended = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)));
  return { ended, clear: () => clearTimeout(timer) };
}

function strings<K extends string>(value: unknown, keys: readonly K[]): Record<K, string> | null {
  if (!isRecord(value) || !keys.every((k) => typeof value[k] === "string")) return null;
  return value as Record<K, string>;
}

function isLocked(value: unknown): value is LockedJoinBundle {
  return strings(value, ["oneUsePublicKey", "ciphertext", "signature"]) !== null;
}

export function createBoxJoinAttempt(deps: BoxJoinAttemptDeps) {
  const exchange: typeof boxExchange =
    deps.exchange ??
    ((url, options, maxBytes) => boxExchange(url, { ...options, lookup: deps.lookup }, maxBytes));
  const ownAddresses =
    deps.addresses ?? (() => ownInterfaceAddresses().filter((a) => !isLoopbackHost(a)));
  const steadyNow = deps.steadyNow ?? (() => performance.now());
  const timeLeft = (attempt: Pick<Attempt, "deadline">) =>
    Math.max(0, attempt.deadline - steadyNow());
  let current: Attempt | null = null;
  let starting: Promise<unknown> | null = null;
  /** Set while a cancel waits for the main box, which may yet answer that it is approving. */
  let cancelling: Promise<unknown> | null = null;

  async function send(
    to: Pick<Attempt, "base" | "trust">,
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRY_LIMIT_MS);
    try {
      return await exchange(new URL(`/api/node/join/${path}`, to.base.origin), {
        method: "POST",
        trust: to.trust,
        signal: controller.signal,
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function signed(attempt: Asking, label: string, fields: JoinField[]) {
    attempt.seq += 1;
    return {
      requestId: attempt.requestId,
      seq: attempt.seq,
      signature: signJoinMessage(
        label,
        attempt.requestId,
        attempt.seq,
        fields,
        attempt.identity.privateKey,
      ),
    };
  }

  /**
   * Best effort: a main box that never hears it ends the request by itself. True when the main box
   * refused it because it is approving the request, which then goes on.
   */
  async function sendCancel(attempt: Asking): Promise<boolean> {
    try {
      const answer = await send(attempt, "cancel", signed(attempt, JOIN_CANCEL_LABEL, []));
      return answer.status === 409 && refusalOf(answer.text).code === "mirror.join_approving";
    } catch {
      // Unreachable or lost: nothing more to do.
      return false;
    }
  }

  /** The bundle an approved answer locked for this attempt, or null when any check fails. */
  function collect(attempt: Attempt, locked: LockedJoinBundle): MirrorBundle | null {
    const opened = unlockJoinBundle({
      requestId: attempt.requestId,
      locked,
      encryptionKey: attempt.hello.encryptionKey,
      encryptionPrivateKey: attempt.encryptionPrivateKey,
      mainPublicKey: attempt.mainPublicKey,
    });
    const bundle = opened === null ? undefined : jsonOf(opened.toString("utf8"));
    if (
      !isMirrorBundle(bundle) ||
      bundle.primaryPublicKey !== attempt.mainPublicKey ||
      bundle.designated.nodeId !== attempt.mainNodeId
    )
      return null;
    return bundle;
  }

  async function poll(attempt: Attempt): Promise<void> {
    const at = deps.now().getTime();
    let sent: { status: number; text: string } | undefined;
    try {
      sent = await send(attempt, "poll", {
        ...signed(attempt, JOIN_POLL_LABEL, pollMessageFields(at)),
        at,
      });
    } catch {
      // A lost poll is asked again at the next one.
    }
    if (current !== attempt) return;
    const answer = sent === undefined ? undefined : jsonOf(sent.text);
    if (isRecord(answer) && answer.state === "approved" && isLocked(answer.locked)) {
      const bundle = collect(attempt, answer.locked);
      // No cancel: the main box has approved, so it would refuse one.
      if (bundle === null) {
        attempt.state = { state: "failed", error: "mirror.join_invalid" };
        return;
      }
      attempt.bundle = bundle;
      attempt.state = { state: "approved", code: attempt.code };
      return;
    }
    if (isRecord(answer) && answer.state === "ended") {
      const reason = JOIN_END_REASONS.find((r) => r === answer.reason) ?? "unknown";
      attempt.state = { state: "ended", reason };
      return;
    }
    if (sent?.status === 404 && refusalOf(sent.text).code === "mirror.join_not_found") {
      attempt.state = { state: "failed", error: "mirror.join_not_found" };
      return;
    }
    schedulePoll(attempt);
  }

  function schedulePoll(attempt: Attempt): void {
    attempt.timer = setTimeout(() => void poll(attempt), deps.pollEveryMs ?? POLL_EVERY_MS);
    attempt.timer.unref();
  }

  /** A cancel during a start waits for it, so the request the main box lists is the one ended. */
  async function cancel(): Promise<void> {
    await starting?.catch(() => {});
    const attempt = current;
    if (attempt === null) return;
    current = null;
    clearTimeout(attempt.timer);
    const sending = sendCancel(attempt);
    cancelling = sending;
    let approving: boolean;
    try {
      approving = await sending;
    } finally {
      if (cancelling === sending) cancelling = null;
    }
    // A join this box already holds the approved answer for has nothing more to hear: the person
    // starts over, and the main box's Servers page is where its listing of this box is removed.
    if (!approving || attempt.state.state !== "waiting") return;
    // The main box is approving: keep following it, unless another attempt has begun meanwhile.
    if (current === null) {
      current = attempt;
      schedulePoll(attempt);
    }
    throw new AppError("mirror.join_approving", {});
  }

  /** Hello and reveal; answers the code to show, or throws the refusal. Replaces an attempt that
   * has ended or failed. */
  async function start(primaryUrl: string) {
    const live = current?.state.state === "waiting" || current?.state.state === "approved";
    if (live || starting !== null || cancelling !== null)
      throw new AppError("mirror.join_waiting", {});
    const opening = open(primaryUrl);
    starting = opening;
    try {
      return await opening;
    } finally {
      starting = null;
    }
  }

  async function open(primaryUrl: string) {
    const base = assertSafePrimaryUrl(primaryUrl);
    const certificate = await fetchPrimaryCertificate(primaryUrl, {
      lookup: deps.lookup,
      exchange,
    });
    const trust = certificate === null ? {} : { ca: certificate.pem, rejectUnauthorized: true };

    const identity = generateStandbyIdentity();
    const encryption = generateKeyPairSync("x25519");
    const contactUrl = ownContactUrl(deps.advertisedOrigin, identity.nodeId);
    const hello: JoinHello = {
      newNodeId: identity.nodeId,
      newPublicKey: identity.publicKey,
      encryptionKey: encryption.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
      contactUrl,
      storeUrl: spareStoreUrl(deps.advertisedOrigin, identity.nodeId, deps.spareStorePort),
      addresses: ownAddresses(),
    };
    const at = deps.now().getTime();
    const deadline = steadyNow() + JOIN_REQUEST_TTL_MS;

    let helloAnswer: { status: number; text: string };
    try {
      helloAnswer = await send({ base, trust }, "hello", {
        protocol: JOIN_PROTOCOL,
        ...hello,
        at,
        signature: signJoinHello(hello, at, identity.privateKey),
      });
    } catch {
      throw fetchFailed();
    }
    if (helloAnswer.status !== 200) throw refusalOf(helloAnswer.text);
    const answered = strings(jsonOf(helloAnswer.text), [
      "requestId",
      "mainNodeId",
      "mainPublicKey",
      "commitment",
      "expiresAt",
    ]);
    if (answered === null || !isIsoTime(answered.expiresAt)) throw fetchFailed();

    const asking: Asking = {
      base,
      trust,
      requestId: answered.requestId,
      identity,
      hello,
      encryptionPrivateKey: encryption.privateKey
        .export({ format: "der", type: "pkcs8" })
        .toString("base64"),
      mainNodeId: answered.mainNodeId,
      mainPublicKey: answered.mainPublicKey,
      seq: 0,
      deadline,
    };
    const newNonce = randomBytes(32);
    // Every try is the same message, so the main box answers a repeat with its stored answer.
    const reveal = {
      ...signed(asking, JOIN_REVEAL_LABEL, revealMessageFields(newNonce)),
      newNonce: newNonce.toString("base64"),
    };
    let revealAnswer: { status: number; text: string } | undefined;
    for (let tries = 1; revealAnswer === undefined; tries++) {
      const trying = slot(TRY_LIMIT_MS);
      try {
        revealAnswer = await send(asking, "reveal", reveal);
      } catch {
        if (tries === REVEAL_TRIES) {
          await sendCancel(asking);
          throw fetchFailed();
        }
        await trying.ended;
      } finally {
        trying.clear();
      }
    }
    if (revealAnswer.status !== 200) throw refusalOf(revealAnswer.text);

    const revealed = strings(jsonOf(revealAnswer.text), ["mainNonce", "signature"]);
    const mainNonce = Buffer.from(revealed?.mainNonce ?? "", "base64");
    if (
      revealed === null ||
      !commitmentMatches(Buffer.from(answered.commitment, "base64"), asking.requestId, mainNonce) ||
      !verifyJoinMessage(
        JOIN_REVEAL_LABEL,
        asking.requestId,
        reveal.seq,
        revealAnswerFields(hello, newNonce, mainNonce),
        revealed.signature,
        asking.mainPublicKey,
      )
    ) {
      await sendCancel(asking);
      throw new AppError("mirror.join_invalid", {});
    }

    const code = joinCode({
      ...hello,
      mainNodeId: asking.mainNodeId,
      mainPublicKey: asking.mainPublicKey,
      newNonce,
      mainNonce,
      requestId: asking.requestId,
    });
    const attempt: Attempt = {
      ...asking,
      code,
      state: { state: "waiting", code, primaryUrl, timeLeftMs: 0 },
    };
    current = attempt;
    schedulePoll(attempt);
    return { code, timeLeftMs: timeLeft(attempt) };
  }

  return {
    start,
    cancel,
    current: (): JoinAttemptState | null =>
      current === null
        ? null
        : current.state.state === "waiting"
          ? { ...current.state, timeLeftMs: timeLeft(current) }
          : current.state,
    joined: (): JoinedBox | null =>
      current?.bundle === undefined
        ? null
        : { identity: current.identity, bundle: current.bundle, storeUrl: current.hello.storeUrl },
  };
}

export type BoxJoinAttempt = ReturnType<typeof createBoxJoinAttempt>;
