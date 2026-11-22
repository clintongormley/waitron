import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { commitmentFor, drawDecoys, joinCode, type JoinHello } from "./box-join-code.js";
import type { LockedJoinBundle } from "./box-join-seal.js";

const MINUTE = 60_000;
const HELLO_REVEAL_MS = 30_000;
export const JOIN_REQUEST_TTL_MS = 15 * MINUTE;
export const ENDED_KEPT_MS = 2 * MINUTE;
const HELLO_WINDOW_MS = MINUTE;
const HELLOS_PER_ADDRESS = 5;
const HELLOS_IN_TOTAL = 20;
const LISTED_MAX = 3;
const REVEALS_MAX = 6;
const REVEAL_WINDOW_MS = 15 * MINUTE;
const STARTED_AGAIN_MS = 15 * MINUTE;

interface MainIdentity {
  nodeId: string;
  publicKey: string;
}

export const JOIN_LIMITS = ["address", "network", "listed", "recent"] as const;
export type JoinLimit = (typeof JOIN_LIMITS)[number];
export const JOIN_END_REASONS = [
  "wrong_code",
  "dismissed",
  "replaced",
  "cancelled",
  "code_taken",
  "invalid",
  "stopped",
] as const;
export type JoinEndReason = (typeof JOIN_END_REASONS)[number];

/** `max` requests in `minutes`; for `listed`, `max` listed at once, each for up to `minutes`. */
export type JoinFull = {
  refused: "full";
  limit: JoinLimit;
  retryAt: string;
  max: number;
  minutes: number;
};

const LIMIT_TERMS: Record<JoinLimit, { max: number; minutes: number }> = {
  address: { max: HELLOS_PER_ADDRESS, minutes: HELLO_WINDOW_MS / MINUTE },
  network: { max: HELLOS_IN_TOTAL, minutes: HELLO_WINDOW_MS / MINUTE },
  listed: { max: LISTED_MAX, minutes: JOIN_REQUEST_TTL_MS / MINUTE },
  recent: { max: REVEALS_MAX, minutes: REVEAL_WINDOW_MS / MINUTE },
};
type JoinNotFound = { refused: "not_found" };
type JoinInvalid = { refused: "invalid" };

export interface RevealAnswer {
  mainNonce: Buffer;
  signature: string;
}

type PollAnswer =
  | { state: "waiting" }
  | { state: "ended"; reason: JoinEndReason }
  | { state: "approved"; locked: LockedJoinBundle };

export interface ListedJoinRequest {
  id: string;
  address: string;
  askedAt: string;
  startedAgain: boolean;
}

export interface HeldJoinRequest {
  address: string;
  hello: JoinHello;
  main: MainIdentity;
  /** Whether a reveal was accepted, so a repeat needs no new signature. */
  revealed: boolean;
}

type Phase = "unrevealed" | "waiting" | "building" | "approved" | "ended";

interface Revealed {
  newNonce: Buffer;
  seq: number;
  answer: RevealAnswer;
  code: string;
  /** The three codes in the order Check shows them, drawn once. */
  choices: string[];
  startedAgain: boolean;
}

interface JoinRequest extends Omit<HeldJoinRequest, "revealed"> {
  id: string;
  mainNonce: Buffer;
  helloAt: number;
  /** A wall time taken once at the hello, so every read reports the same one. */
  askedAt: string;
  lastSeq: number;
  latestAt: string;
  latestAtReceived: number;
  phase: Phase;
  revealed?: Revealed;
  locked?: LockedJoinBundle;
  reason?: JoinEndReason;
  /** When an approved or ended request is forgotten. */
  keptUntil?: number;
}

interface Window {
  end: number;
  count: number;
}

interface BoxJoinRequestsOptions {
  /** Every duration is measured on this clock, so a wall-clock step cannot stretch one. */
  steadyNow?: () => number;
  /** Only for the times the answers report. */
  wallNow?: () => number;
  newId?: () => string;
  newMainNonce?: (requestId: string) => Buffer;
  drawCode?: () => string;
  /**
   * Called when a request joins or leaves the list. A request that runs out of time leaves it
   * unannounced, when the store next reads its requests.
   */
  changed?: () => void;
}

function shuffled(codes: string[]): string[] {
  const out = [...codes];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export type BoxJoinRequests = ReturnType<typeof createBoxJoinRequests>;

export function createBoxJoinRequests(options: BoxJoinRequestsOptions = {}) {
  const steadyNow = options.steadyNow ?? (() => performance.now());
  const wallNow = options.wallNow ?? (() => Date.now());
  const newId = options.newId ?? (() => randomUUID());
  const newMainNonce = options.newMainNonce ?? (() => randomBytes(32));
  const changed = options.changed ?? (() => {});

  const requests = new Map<string, JoinRequest>();
  const helloWindows = new Map<string, Window>();
  let totalWindow: Window = { end: -Infinity, count: 0 };
  /** Reveals still counted against the limit, oldest first. */
  let reveals: { at: number; requestId: string }[] = [];
  /** Per address, when a request from it last ended by a cancel or a replacement. */
  const startedAgainAt = new Map<string, number>();

  const wallAt = (steady: number) => new Date(wallNow() + (steady - steadyNow())).toISOString();
  const full = (limit: JoinLimit, at: number): JoinFull => ({
    refused: "full",
    limit,
    retryAt: wallAt(at),
    ...LIMIT_TERMS[limit],
  });
  const isListed = (r: JoinRequest) => r.phase === "waiting" || r.phase === "building";
  const listedRequests = () => [...requests.values()].filter(isListed);

  function sweep(now: number) {
    for (const [id, r] of requests) {
      const gone =
        r.phase === "unrevealed"
          ? now >= r.helloAt + HELLO_REVEAL_MS
          : isListed(r)
            ? now >= r.helloAt + JOIN_REQUEST_TTL_MS
            : now >= r.keptUntil!;
      if (gone) requests.delete(id);
    }
    for (const [address, w] of helloWindows) if (now >= w.end) helloWindows.delete(address);
    reveals = reveals.filter((entry) => now < entry.at + REVEAL_WINDOW_MS);
    for (const [address, at] of startedAgainAt) {
      if (now >= at + STARTED_AGAIN_MS) startedAgainAt.delete(address);
    }
  }

  function end(r: JoinRequest, reason: JoinEndReason, now: number) {
    const wasListed = isListed(r);
    r.phase = "ended";
    r.reason = reason;
    r.keptUntil = now + ENDED_KEPT_MS;
    delete r.locked;
    if (reason === "cancelled" || reason === "replaced") startedAgainAt.set(r.address, now);
    if (wasListed) changed();
  }

  /** A person looked at the request, so its reveal stops counting. */
  function freePlace(requestId: string) {
    reveals = reveals.filter((entry) => entry.requestId !== requestId);
  }

  function held(requestId: string): JoinRequest | undefined {
    sweep(steadyNow());
    return requests.get(requestId);
  }

  function acceptSeq(r: JoinRequest, seq: number): boolean {
    if (!(seq > r.lastSeq)) return false;
    r.lastSeq = seq;
    return true;
  }

  /**
   * Counts a hello from `address` against the hello limits, or refuses it. The route calls this
   * before its own refusals that read the venue, so a refused hello is slowed by the same limits.
   */
  function unrevealedFrom(address: string): JoinFull | null {
    for (const r of requests.values()) {
      if (r.address === address && r.phase === "unrevealed") {
        return full("address", r.helloAt + HELLO_REVEAL_MS);
      }
    }
    return null;
  }

  function admitHello(address: string): JoinFull | null {
    const now = steadyNow();
    sweep(now);
    const held = unrevealedFrom(address);
    if (held) return held;
    const fresh = { end: now + HELLO_WINDOW_MS, count: 0 };
    const byAddress = helloWindows.get(address) ?? fresh;
    if (byAddress.count >= HELLOS_PER_ADDRESS) return full("address", byAddress.end);
    if (now >= totalWindow.end) totalWindow = { ...fresh };
    if (totalWindow.count >= HELLOS_IN_TOTAL) return full("network", totalWindow.end);
    byAddress.count += 1;
    helloWindows.set(address, byAddress);
    totalWindow.count += 1;
    return null;
  }

  /**
   * Holds a hello {@link admitHello} has admitted. Checks the one unrevealed hello per address
   * again: the caller awaits between the two, so another hello from the address may be held by now.
   */
  function openHello(input: {
    address: string;
    hello: JoinHello;
    main: MainIdentity;
    at: string;
  }): { requestId: string; commitment: Buffer; expiresAt: string } | JoinFull {
    const now = steadyNow();
    sweep(now);
    const held = unrevealedFrom(input.address);
    if (held) return held;
    const id = newId();
    const mainNonce = newMainNonce(id);
    const expiresAt = wallAt(now + JOIN_REQUEST_TTL_MS);
    requests.set(id, {
      id,
      address: input.address,
      hello: input.hello,
      main: input.main,
      mainNonce,
      helloAt: now,
      askedAt: wallAt(now),
      lastSeq: 0,
      latestAt: input.at,
      latestAtReceived: now,
      phase: "unrevealed",
    });
    return {
      requestId: id,
      commitment: commitmentFor(id, mainNonce),
      expiresAt,
    };
  }

  return {
    admitHello,
    openHello,

    /** The caller has checked the reveal's signature. `signAnswer` is called once per request. */
    reveal(input: {
      requestId: string;
      newNonce: Buffer;
      seq: number;
      signAnswer: (mainNonce: Buffer) => string;
    }):
      | RevealAnswer
      | JoinFull
      | JoinNotFound
      | JoinInvalid
      | { refused: "code_taken" }
      | { refused: "ended"; reason: JoinEndReason } {
      const now = steadyNow();
      const r = held(input.requestId);
      if (!r) return { refused: "not_found" };
      if (r.phase === "ended") return { refused: "ended", reason: r.reason! };
      if (r.revealed) {
        // A second Nn would let a sender that has seen Nm search for a code of its choosing.
        if (r.revealed.newNonce.equals(input.newNonce) && r.revealed.seq === input.seq) {
          return r.revealed.answer;
        }
        end(r, "invalid", now);
        return { refused: "invalid" };
      }
      if (!acceptSeq(r, input.seq)) return { refused: "invalid" };

      if (reveals.length >= REVEALS_MAX) {
        requests.delete(r.id);
        return full("recent", reveals[0]!.at + REVEAL_WINDOW_MS);
      }
      const others = listedRequests().filter((other) => other.address !== r.address);
      if (others.length >= LISTED_MAX) {
        requests.delete(r.id);
        return full("listed", Math.min(...others.map((o) => o.helloAt + JOIN_REQUEST_TTL_MS)));
      }
      reveals.push({ at: now, requestId: r.id });

      const code = joinCode({
        ...r.hello,
        mainNodeId: r.main.nodeId,
        mainPublicKey: r.main.publicKey,
        newNonce: input.newNonce,
        mainNonce: r.mainNonce,
        requestId: r.id,
      });
      const shown = (list: JoinRequest[]) => list.flatMap((l) => l.revealed!.choices);
      // The real code cannot be redrawn, so a reveal whose code a listed request shows is refused.
      if (shown(listedRequests()).includes(code)) {
        end(r, "code_taken", now);
        return { refused: "code_taken" };
      }
      // An approved request from this address goes too. A new request from the same address is
      // taken as its box starting again, so the older one no longer holds back a tap on this one.
      // One from another address still does.
      for (const older of requests.values()) {
        if (older.address === r.address && (isListed(older) || older.phase === "approved"))
          end(older, "replaced", now);
      }
      const decoys = drawDecoys(code, shown(listedRequests()), options.drawCode);
      const answer = { mainNonce: r.mainNonce, signature: input.signAnswer(r.mainNonce) };
      r.revealed = {
        newNonce: input.newNonce,
        seq: input.seq,
        answer,
        code,
        choices: shuffled([code, ...decoys]),
        startedAgain: startedAgainAt.has(r.address),
      };
      r.phase = "waiting";
      changed();
      return answer;
    },

    /** The caller has checked the poll's signature. */
    poll(input: {
      requestId: string;
      seq: number;
      at: string;
    }): PollAnswer | JoinNotFound | JoinInvalid {
      const r = held(input.requestId);
      if (!r || r.phase === "unrevealed") return { refused: "not_found" };
      if (!acceptSeq(r, input.seq)) return { refused: "invalid" };
      r.latestAt = input.at;
      r.latestAtReceived = steadyNow();
      if (r.phase === "ended") return { state: "ended", reason: r.reason! };
      if (r.phase === "approved") return { state: "approved", locked: r.locked! };
      return { state: "waiting" };
    },

    /** The caller has checked the cancel's signature. */
    cancel(input: {
      requestId: string;
      seq: number;
    }): { cancelled: true } | JoinNotFound | JoinInvalid | { refused: "approving" } {
      const r = held(input.requestId);
      if (!r) return { refused: "not_found" };
      if (!acceptSeq(r, input.seq)) return { refused: "invalid" };
      // Once a right tap has begun, the approval decides: a cancel answered here never leaves the
      // chart listing a box that stopped asking. A stopped approval listed it, so a waiting new box
      // is kept polling until it reads that.
      if (
        r.phase === "building" ||
        r.phase === "approved" ||
        (r.phase === "ended" && r.reason === "stopped")
      )
        return { refused: "approving" };
      if (r.phase !== "ended") end(r, "cancelled", steadyNow());
      return { cancelled: true };
    },

    /** A message of this request failed its check. Its reveal still counts against the limit. */
    endInvalid(requestId: string): void {
      const r = held(requestId);
      if (r && r.phase !== "ended") end(r, "invalid", steadyNow());
    },

    /** What the caller needs to check a box-to-box request's address and signature. */
    requestFor(requestId: string): HeldJoinRequest | null {
      const r = held(requestId);
      return r
        ? { address: r.address, hello: r.hello, main: r.main, revealed: r.revealed !== undefined }
        : null;
    },

    listed(): ListedJoinRequest[] {
      sweep(steadyNow());
      return listedRequests().map((r) => ({
        id: r.id,
        address: r.address,
        askedAt: r.askedAt,
        startedAgain: r.revealed!.startedAgain,
      }));
    },

    /** The hello, the three codes in a random order, and the new box's latest clock reading. */
    check(
      requestId: string,
    ): { hello: JoinHello; choices: string[]; at: string; atReceivedAt: string } | JoinNotFound {
      const r = held(requestId);
      if (!r || !isListed(r)) return { refused: "not_found" };
      return {
        hello: r.hello,
        choices: [...r.revealed!.choices],
        at: r.latestAt,
        atReceivedAt: wallAt(r.latestAtReceived),
      };
    },

    dismiss(requestId: string): { dismissed: true } | JoinNotFound | { refused: "in_progress" } {
      const r = held(requestId);
      if (!r || !isListed(r)) return { refused: "not_found" };
      if (r.phase === "building") return { refused: "in_progress" };
      end(r, "dismissed", steadyNow());
      freePlace(r.id);
      return { dismissed: true };
    },

    approve: {
      /** Marks the request building before the caller's first await, so a second tap waits. */
      begin(
        requestId: string,
        code: string,
      ):
        | { encryptionKey: string }
        | JoinNotFound
        | { refused: "in_progress" }
        | { refused: "wrong_code" }
        | { refused: "other_approved" } {
        const r = held(requestId);
        if (!r || !isListed(r)) return { refused: "not_found" };
        if (r.phase === "building") return { refused: "in_progress" };
        if (code !== r.revealed!.code) {
          end(r, "wrong_code", steadyNow());
          freePlace(r.id);
          return { refused: "wrong_code" };
        }
        // The venue holds one pending pair link, so a second approval would take the first box's.
        // Once the first is forgotten, or a newer request from its address has ended it, a new
        // approval may replace its pair if it never finished.
        for (const other of requests.values()) {
          if (other.phase === "building" || other.phase === "approved")
            return { refused: "other_approved" };
        }
        r.phase = "building";
        return { encryptionKey: r.hello.encryptionKey };
      },

      /** False when the request ended or expired while its bundle was built. */
      finish(requestId: string, locked: LockedJoinBundle): boolean {
        const r = held(requestId);
        if (r?.phase !== "building") return false;
        r.phase = "approved";
        r.locked = locked;
        r.keptUntil = steadyNow() + ENDED_KEPT_MS;
        changed();
        return true;
      },

      /** The approval failed after the chart listed the spare, so the request cannot go back. */
      stop(requestId: string): void {
        const r = held(requestId);
        if (r?.phase === "building") end(r, "stopped", steadyNow());
      },

      /** A build refusal leaves the request waiting, so a right tap can be sent again. */
      abandon(requestId: string): void {
        const r = held(requestId);
        if (r?.phase === "building") r.phase = "waiting";
      },
    },
  };
}
