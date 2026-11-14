import { randomUUID } from "node:crypto";

export const CHALLENGE_MS = 5_000;

const PER_SESSION = 8;
/** Fresh challenges live 5 s, so this bounds a burst of asks rather than normal use. */
const MAX_HELD = 256;

interface Held {
  readonly session: string;
  readonly steadyAt: number;
  readonly wallAt: number;
}

/** The box's wall and steady clocks when a challenge was issued. */
export interface IssueReading {
  readonly wallMs: number;
  readonly monoMs: number;
}

export interface ClockChallenges {
  issue(session: string): { challengeId: string; boxAt: number };
  /** The steady time since the challenge's issue and the reading it was issued at, once, to the
   * session it was issued to and within `CHALLENGE_MS` of it; null otherwise. */
  take(session: string, challengeId: string): { elapsedMs: number; issuedAt: IssueReading } | null;
  size(): number;
}

/** Process-local: a restart forgets every challenge, which grants nothing. */
export function clockChallenges(deps: {
  steady: () => number;
  wall: () => number;
}): ClockChallenges {
  const held = new Map<string, Held>();
  const fresh = (elapsedMs: number) =>
    Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= CHALLENGE_MS;

  return {
    issue(session) {
      const steadyAt = deps.steady();
      let oldestOwn: string | undefined;
      let own = 0;
      for (const [id, challenge] of held) {
        if (!fresh(steadyAt - challenge.steadyAt)) held.delete(id);
        else if (challenge.session === session) {
          oldestOwn ??= id;
          own += 1;
        }
      }
      if (own >= PER_SESSION) held.delete(oldestOwn!);
      if (held.size >= MAX_HELD) held.delete(held.keys().next().value!);
      const challengeId = randomUUID();
      const wallAt = deps.wall();
      held.set(challengeId, { session, steadyAt, wallAt });
      return { challengeId, boxAt: wallAt };
    },
    take(session, challengeId) {
      const challenge = held.get(challengeId);
      if (challenge === undefined || challenge.session !== session) return null;
      held.delete(challengeId);
      const elapsedMs = deps.steady() - challenge.steadyAt;
      return fresh(elapsedMs)
        ? { elapsedMs, issuedAt: { wallMs: challenge.wallAt, monoMs: challenge.steadyAt } }
        : null;
    },
    size: () => held.size,
  };
}
