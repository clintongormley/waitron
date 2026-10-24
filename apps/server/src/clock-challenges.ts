import { randomUUID } from "node:crypto";

export const CHALLENGE_MS = 5_000;

/** Fresh challenges live 5 s, so this bounds a burst of asks rather than normal use. */
const MAX_HELD = 256;

interface Held {
  readonly session: string;
  readonly boxAt: number;
  readonly steadyAt: number;
}

export interface ClockChallenges {
  issue(session: string): { challengeId: string; boxAt: number };
  /** The challenge's issue, once, to the session it was issued to and within `CHALLENGE_MS` of
   * it on the steady clock; null otherwise. */
  take(session: string, challengeId: string): { boxAt: number; elapsedMs: number } | null;
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
      for (const [id, challenge] of held) {
        if (!fresh(steadyAt - challenge.steadyAt)) held.delete(id);
      }
      if (held.size >= MAX_HELD) held.delete(held.keys().next().value!);
      const challengeId = randomUUID();
      const boxAt = deps.wall();
      held.set(challengeId, { session, boxAt, steadyAt });
      return { challengeId, boxAt };
    },
    take(session, challengeId) {
      const challenge = held.get(challengeId);
      if (challenge === undefined || challenge.session !== session) return null;
      held.delete(challengeId);
      const elapsedMs = deps.steady() - challenge.steadyAt;
      return fresh(elapsedMs) ? { boxAt: challenge.boxAt, elapsedMs } : null;
    },
    size: () => held.size,
  };
}
