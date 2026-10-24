import { afterEach, expect, it, vi } from "vitest";
import * as setup from "./hour-setup-clock.js";
import { canSelectHour, clockRefusal, type HourClockObservation } from "./hour-clock.js";

const NOW = Date.parse("2026-10-16T11:40:00.000Z");
const PHONE = { onBox: false } as const;
const BOX = { onBox: true } as const;
afterEach(() => vi.restoreAllMocks());
function fixture() {
  let wall = NOW,
    mono = 10_000;
  const internet = vi.fn(async (): Promise<HourClockObservation> => ({
    source: "internet",
    result: "usable",
    instantMs: wall,
    uncertaintyMs: 500,
    wallStartedMs: wall,
    wallFinishedMs: wall,
    monotonicStartedMs: mono,
    monotonicFinishedMs: mono,
  }));
  const clock = setup.createSetupHourClock({
    wall: () => wall,
    monotonic: () => mono,
    internet,
    release: () => NOW - 86_400_000,
  });
  return {
    clock,
    internet,
    advance(ms: number) {
      wall += ms;
      mono += ms;
    },
    correct(ms: number) {
      wall += ms;
    },
  };
}
it("compares box, challenge-timed browser and authenticated internet observations together", async () => {
  const f = fixture();
  const challenge = f.clock.challenge("owned-scope");
  f.advance(100);
  const result = await f.clock.compare(
    "owned-scope",
    "production",
    {
      challengeId: challenge.id,
      instantMs: NOW + 50,
    },
    PHONE,
  );
  expect(result.clock.usable.map((value) => value.source)).toEqual(["browser", "internet", "box"]);
  expect(result.clock.usable.find((value) => value.source === "browser")).toEqual({
    source: "browser",
    lowerMs: NOW + 50,
    upperMs: NOW + 150,
  });
  expect(canSelectHour(f.clock.read("owned-scope", result.id).clock)).toBe(true);
  expect(f.internet).toHaveBeenCalledWith("production");
});
it("internet disagreement cannot be hidden by box and browser agreement", async () => {
  const f = fixture();
  f.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: NOW + 180_000,
    uncertaintyMs: 0,
    wallStartedMs: NOW,
    wallFinishedMs: NOW,
    monotonicStartedMs: 10_000,
    monotonicFinishedMs: 10_000,
  }));
  const challenge = f.clock.challenge("owned-scope");
  const displayed = await f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: challenge.id, instantMs: NOW },
    PHONE,
  );
  expect(displayed.clock.disagreement).toBe(true);
  const read = f.clock.read("owned-scope", displayed.id).clock;
  expect(canSelectHour(read)).toBe(false);
  expect(clockRefusal(read)).toBe("clock_disagreement");
});
it("a comparison for another frozen scope cannot be read under this one", async () => {
  const f = fixture();
  const a = await f.clock.compare("first", "preproduction", null, PHONE);
  await f.clock.compare("second", "preproduction", null, PHONE);
  expect(() => f.clock.read("second", a.id)).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "clock_stale" },
    }),
  );
  expect(canSelectHour(f.clock.read("first", a.id).clock)).toBe(true);
});
it("a forward clock correction invalidates a reading", async () => {
  const f = fixture();
  f.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const displayed = await f.clock.compare("owned-scope", "production", null, PHONE);
  f.correct(180_000);
  expect(() => f.clock.read("owned-scope", displayed.id)).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "clock_corrected" },
    }),
  );
});
it("an expired browser challenge is unavailable even when its uploaded time agrees", async () => {
  const f = fixture();
  const challenge = f.clock.challenge("owned-scope");
  f.advance(5001);
  const displayed = await f.clock.compare(
    "owned-scope",
    "preproduction",
    {
      challengeId: challenge.id,
      instantMs: NOW + 5001,
    },
    PHONE,
  );
  expect(displayed.clock.unavailable).toContainEqual(
    expect.objectContaining({ source: "browser", reason: "challenge" }),
  );
  expect(displayed.clock.usable.map((value) => value.source)).toEqual(["internet", "box"]);
});
it("a comparison which crosses the hour while awaiting internet uses the later box reading", async () => {
  const f = fixture();
  f.advance(1_199_000);
  f.internet.mockImplementation(async () => {
    f.advance(2000);
    return { source: "internet", result: "unavailable", reason: "network" };
  });
  const compared = await f.clock.compare("owned-scope", "preproduction", null, PHONE);
  const checked = f.clock.read("owned-scope", compared.id);
  expect(checked.clock.usable).toEqual([
    { source: "box", lowerMs: NOW + 1_201_000, upperMs: NOW + 1_201_000 },
  ]);
});

it("a clock correction permanently retires the old displayed comparison", async () => {
  const f = fixture();
  const displayed = await f.clock.compare("owned-scope", "production", null, PHONE);
  f.correct(180_000);
  expect(() => f.clock.read("owned-scope", displayed.id)).toThrow();
  f.correct(-180_000);
  expect(() => f.clock.read("owned-scope", displayed.id)).toThrowError(
    expect.objectContaining({ code: "sif.allocation_invalid", params: { reason: "clock_stale" } }),
  );
});
it("an older challenge stays usable beside a fresher one, for another page", async () => {
  const f = fixture();
  const first = f.clock.challenge("owned-scope");
  const fresh = f.clock.challenge("owned-scope");
  const old = await f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: first.id, instantMs: NOW },
    PHONE,
  );
  expect(old.clock.usable.map((value) => value.source)).toEqual(["browser", "internet", "box"]);
  const current = await f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: fresh.id, instantMs: NOW },
    PHONE,
  );
  expect(current.clock.usable.map((value) => value.source)).toEqual(["browser", "internet", "box"]);
});
it("keeps eight challenges and evicts the oldest", async () => {
  const f = fixture();
  const oldest = f.clock.challenge("owned-scope");
  const second = f.clock.challenge("owned-scope");
  for (let i = 0; i < 7; i += 1) f.clock.challenge("owned-scope");
  const evicted = await f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: oldest.id, instantMs: NOW },
    PHONE,
  );
  expect(evicted.clock.unavailable).toContainEqual(
    expect.objectContaining({ source: "browser", reason: "challenge" }),
  );
  const kept = await f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: second.id, instantMs: NOW },
    PHONE,
  );
  expect(kept.clock.usable.map((value) => value.source)).toContain("browser");
});
it("keeps eight readings and evicts the oldest", async () => {
  const f = fixture();
  const oldest = await f.clock.compare("owned-scope", "preproduction", null, PHONE);
  const second = await f.clock.compare("owned-scope", "preproduction", null, PHONE);
  for (let i = 0; i < 7; i += 1) await f.clock.compare("owned-scope", "preproduction", null, PHONE);
  expect(() => f.clock.read("owned-scope", oldest.id)).toThrowError(
    expect.objectContaining({ params: { reason: "clock_stale" } }),
  );
  expect(() => f.clock.read("owned-scope", second.id)).not.toThrow();
});
it.each([NaN, Infinity, NOW + 0.5])(
  "rejects malformed browser instant %s as unavailable",
  async (instantMs) => {
    const f = fixture();
    const challenge = f.clock.challenge("owned-scope");
    const result = await f.clock.compare(
      "owned-scope",
      "preproduction",
      {
        challengeId: challenge.id,
        instantMs,
      },
      PHONE,
    );
    expect(result.clock.unavailable).toContainEqual(
      expect.objectContaining({ source: "browser", reason: "challenge" }),
    );
  },
);
it("does not accept a challenge issued for a different frozen scope", async () => {
  const f = fixture();
  const challenge = f.clock.challenge("first");
  f.clock.challenge("second");
  const result = await f.clock.compare(
    "second",
    "preproduction",
    { challengeId: challenge.id, instantMs: NOW },
    PHONE,
  );
  expect(result.clock.unavailable).toContainEqual(
    expect.objectContaining({ source: "browser", reason: "challenge" }),
  );
});
it("a browser challenge is consumed once", async () => {
  const f = fixture();
  const challenge = f.clock.challenge("owned-scope");
  const browser = { challengeId: challenge.id, instantMs: NOW };
  await f.clock.compare("owned-scope", "preproduction", browser, PHONE);
  const result = await f.clock.compare("owned-scope", "preproduction", browser, PHONE);
  expect(result.clock.unavailable).toContainEqual(
    expect.objectContaining({ source: "browser", reason: "challenge" }),
  );
});
it("a reading older than thirty seconds cannot grant admission", async () => {
  const f = fixture();
  const displayed = await f.clock.compare("owned-scope", "preproduction", null, PHONE);
  f.advance(30_001);
  expect(() => f.clock.read("owned-scope", displayed.id)).toThrowError(
    expect.objectContaining({ code: "sif.allocation_invalid", params: { reason: "clock_stale" } }),
  );
});
it("projects surviving observations forward before selecting after an hour boundary", async () => {
  const f = fixture();
  f.advance(1_199_000);
  const compared = await f.clock.compare("owned-scope", "preproduction", null, PHONE);
  f.advance(2000);
  const reading = f.clock.read("owned-scope", compared.id);
  expect(reading.clock.usable).toContainEqual({
    source: "box",
    lowerMs: NOW + 1_201_000,
    upperMs: NOW + 1_201_000,
  });
  expect(canSelectHour(reading.clock)).toBe(true);
});
it("an unavailable immutable release floor blocks the name", async () => {
  const clock = setup.createSetupHourClock({
    wall: () => NOW,
    monotonic: () => 0,
    release: () => null,
    internet: async () => ({ source: "internet", result: "unavailable", reason: "tls" }),
  });
  const displayed = await clock.compare("owned-scope", "preproduction", null, PHONE);
  const read = clock.read("owned-scope", displayed.id);
  expect(read.clock.releaseBlocked).toBe(true);
  expect(canSelectHour(read.clock)).toBe(false);
  expect(clockRefusal(read.clock)).toBe("clock_unconfirmed");
});
it("a browser on the box itself is never the second clock", async () => {
  const f = fixture();
  f.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const onBox = f.clock.challenge("owned-scope");
  const boxResult = await f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: onBox.id, instantMs: NOW },
    BOX,
  );
  expect(boxResult.clock.secondClock).toBe(false);
  expect(boxResult.clock.unavailable).toContainEqual({
    source: "browser",
    result: "unavailable",
    reason: "same_machine",
  });
  expect(clockRefusal(boxResult.clock)).toBe("second_clock_missing");
  const phone = f.clock.challenge("owned-scope");
  const phoneResult = await f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: phone.id, instantMs: NOW },
    PHONE,
  );
  expect(phoneResult.clock.secondClock).toBe(true);
  expect(canSelectHour(phoneResult.clock)).toBe(true);
});
it("two comparisons in flight at once both keep their readings", async () => {
  const f = fixture();
  const finishes: ((value: HourClockObservation) => void)[] = [];
  f.internet.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      }),
  );
  const b = f.clock.challenge("owned-scope");
  const a = f.clock.challenge("owned-scope");
  const pageB = f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: b.id, instantMs: NOW },
    PHONE,
  );
  const pageA = f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: a.id, instantMs: NOW },
    BOX,
  );
  await vi.waitFor(() => expect(finishes).toHaveLength(2));
  finishes[1]!({ source: "internet", result: "unavailable", reason: "network" });
  const resultA = await pageA;
  finishes[0]!({ source: "internet", result: "unavailable", reason: "network" });
  const resultB = await pageB;
  expect(resultB.clock.secondClock).toBe(true);
  expect(resultA.clock.secondClock).toBe(false);
  expect(f.clock.read("owned-scope", resultB.id).clock.secondClock).toBe(true);
  expect(f.clock.read("owned-scope", resultA.id).clock.secondClock).toBe(false);
});
it("two pages keep their own readings", async () => {
  const f = fixture();
  f.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const b = f.clock.challenge("owned-scope");
  const a = f.clock.challenge("owned-scope");
  const resultB = await f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: b.id, instantMs: NOW },
    PHONE,
  );
  const resultA = await f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: a.id, instantMs: NOW },
    BOX,
  );
  f.clock.challenge("owned-scope");
  expect(f.clock.read("owned-scope", resultB.id).clock.secondClock).toBe(true);
  expect(f.clock.read("owned-scope", resultA.id).clock.secondClock).toBe(false);
});
it("a read with no comparison id uses the newest reading that admits a name", async () => {
  const f = fixture();
  const b = f.clock.challenge("owned-scope");
  await f.clock.compare(
    "owned-scope",
    "preproduction",
    { challengeId: b.id, instantMs: NOW },
    PHONE,
  );
  f.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const a = f.clock.challenge("owned-scope");
  await f.clock.compare("owned-scope", "preproduction", { challengeId: a.id, instantMs: NOW }, BOX);
  expect(canSelectHour(f.clock.read("owned-scope").clock)).toBe(true);
});
it("a read with no comparison id and only a box-only fresh reading refuses", async () => {
  const f = fixture();
  f.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const a = f.clock.challenge("owned-scope");
  await f.clock.compare("owned-scope", "preproduction", { challengeId: a.id, instantMs: NOW }, BOX);
  expect(clockRefusal(f.clock.read("owned-scope").clock)).toBe("second_clock_missing");
});
it("a read with no comparison id does not use a passing reading older than thirty seconds", async () => {
  const f = fixture();
  await f.clock.compare("owned-scope", "preproduction", null, PHONE);
  f.advance(30_001);
  expect(() => f.clock.read("owned-scope")).toThrowError(
    expect.objectContaining({ params: { reason: "clock_stale" } }),
  );
});
it("a stale passing reading leaves the newest fresh reading's refusal", async () => {
  const f = fixture();
  await f.clock.compare("owned-scope", "preproduction", null, PHONE);
  f.advance(30_001);
  f.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  await f.clock.compare("owned-scope", "preproduction", null, BOX);
  expect(clockRefusal(f.clock.read("owned-scope").clock)).toBe("second_clock_missing");
});
it("a read with no comparison id and no reading refuses clock_stale", () => {
  const f = fixture();
  expect(() => f.clock.read("owned-scope")).toThrowError(
    expect.objectContaining({ params: { reason: "clock_stale" } }),
  );
});
