import { describe, expect, it } from "vitest";
import { CHALLENGE_MS, clockChallenges } from "./clock-challenges.js";

const WALL = Date.parse("2026-10-24T10:00:00.000Z");

function keeper() {
  const clocks = { steady: 1_000, wall: WALL };
  const challenges = clockChallenges({ steady: () => clocks.steady, wall: () => clocks.wall });
  const pass = (ms: number) => {
    clocks.steady += ms;
    clocks.wall += ms;
  };
  return { clocks, challenges, pass };
}

describe("the clock challenge keeper", () => {
  it("issues a challenge naming the box's wall time, and takes it once within 5 000 ms", () => {
    const k = keeper();
    const issued = k.challenges.issue("session-a");
    expect(issued).toEqual({ challengeId: expect.any(String), boxAt: WALL });
    k.pass(5_000);
    expect(k.challenges.take("session-a", issued.challengeId)).toEqual({ elapsedMs: 5_000 });
  });

  it("refuses a challenge answered after 5 001 ms on the steady clock", () => {
    const k = keeper();
    const { challengeId } = k.challenges.issue("session-a");
    k.clocks.steady += 5_001;
    expect(k.challenges.take("session-a", challengeId)).toBeNull();
  });

  it("measures on the steady clock, not the wall clock", () => {
    const k = keeper();
    const { challengeId } = k.challenges.issue("session-a");
    k.clocks.wall += 60_000;
    k.clocks.steady += 10;
    expect(k.challenges.take("session-a", challengeId)).toEqual({ elapsedMs: 10 });
  });

  it("refuses a challenge answered twice", () => {
    const k = keeper();
    const { challengeId } = k.challenges.issue("session-a");
    expect(k.challenges.take("session-a", challengeId)).not.toBeNull();
    expect(k.challenges.take("session-a", challengeId)).toBeNull();
  });

  it("refuses a challenge refused once for its age, even if asked again", () => {
    const k = keeper();
    const { challengeId } = k.challenges.issue("session-a");
    k.clocks.steady += 5_001;
    expect(k.challenges.take("session-a", challengeId)).toBeNull();
    k.clocks.steady -= 5_001;
    expect(k.challenges.take("session-a", challengeId)).toBeNull();
  });

  it("refuses an unknown challenge", () => {
    const k = keeper();
    k.challenges.issue("session-a");
    expect(k.challenges.take("session-a", "not-issued")).toBeNull();
  });

  it("refuses a challenge taken by a session other than the one it was issued to", () => {
    const k = keeper();
    const { challengeId } = k.challenges.issue("session-a");
    expect(k.challenges.take("session-b", challengeId)).toBeNull();
    expect(k.challenges.take("session-a", challengeId)).not.toBeNull();
  });

  it.each([Number.NaN, -1])(
    "refuses a challenge when the steady clock reads %d ms since it was issued",
    (step) => {
      const k = keeper();
      const { challengeId } = k.challenges.issue("session-a");
      k.clocks.steady += step;
      expect(k.challenges.take("session-a", challengeId)).toBeNull();
    },
  );

  it("issues a different id each time", () => {
    const k = keeper();
    const a = k.challenges.issue("session-a").challengeId;
    const b = k.challenges.issue("session-a").challengeId;
    expect(a).not.toBe(b);
  });

  it("drops expired challenges when it issues another, and keeps fresh ones", () => {
    const k = keeper();
    const old = k.challenges.issue("session-a").challengeId;
    k.challenges.issue("session-b");
    k.pass(CHALLENGE_MS + 1);
    const fresh = k.challenges.issue("session-c").challengeId;
    expect(k.challenges.size()).toBe(1);
    expect(k.challenges.take("session-a", old)).toBeNull();
    expect(k.challenges.take("session-c", fresh)).not.toBeNull();
    expect(k.challenges.size()).toBe(0);
  });

  it("holds a bounded number of challenges, dropping the oldest first", () => {
    const k = keeper();
    const first = k.challenges.issue("session-a").challengeId;
    const ids = [first];
    for (let i = 1; i <= 300; i += 1) ids.push(k.challenges.issue(`session-${i}`).challengeId);
    expect(k.challenges.size()).toBe(256);
    expect(k.challenges.take("session-a", first)).toBeNull();
    expect(k.challenges.take("session-300", ids.at(-1)!)).not.toBeNull();
  });

  it("holds at most 8 live challenges per session, dropping that session's own oldest", () => {
    const k = keeper();
    const other = k.challenges.issue("session-b").challengeId;
    const ids = Array.from({ length: 9 }, () => k.challenges.issue("session-a").challengeId);
    for (let i = 0; i < 300; i += 1) k.challenges.issue("session-a");
    expect(k.challenges.size()).toBe(9);
    expect(k.challenges.take("session-a", ids[0]!)).toBeNull();
    expect(k.challenges.take("session-b", other)).not.toBeNull();
  });

  it("keeps a session's eight newest challenges usable", () => {
    const k = keeper();
    const ids = Array.from({ length: 9 }, () => k.challenges.issue("session-a").challengeId);
    expect(k.challenges.take("session-a", ids[0]!)).toBeNull();
    for (const id of ids.slice(1)) expect(k.challenges.take("session-a", id)).not.toBeNull();
  });
});
