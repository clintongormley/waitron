import { afterEach, expect, it, vi } from "vitest";
import * as setup from "./hour-setup-clock.js";
import { canSelectHour, type HourClockObservation } from "./hour-clock.js";

const NOW = Date.parse("2026-10-16T11:40:00.000Z");
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
  const result = await f.clock.compare("owned-scope", "production", {
    challengeId: challenge.id,
    instantMs: NOW + 50,
  });
  expect(result.clock.usable.map((value) => value.source)).toEqual(["browser", "internet", "box"]);
  expect(result.clock.usable.find((value) => value.source === "browser")).toEqual({
    source: "browser",
    lowerMs: NOW + 50,
    upperMs: NOW + 150,
  });
  expect(canSelectHour(f.clock.read("owned-scope").clock)).toBe(true);
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
  const displayed = await f.clock.compare("owned-scope", "preproduction", {
    challengeId: challenge.id,
    instantMs: NOW,
  });
  expect(displayed.clock.disagreement).toBe(true);
  expect(canSelectHour(f.clock.read("owned-scope").clock)).toBe(false);
  const confirmed = f.clock.read("owned-scope", displayed.id);
  expect(canSelectHour(confirmed.clock, confirmed.confirmation)).toBe(true);
});
it("a comparison for another frozen scope cannot confirm the displayed clock", async () => {
  const f = fixture();
  f.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const a = await f.clock.compare("first", "preproduction", null);
  await f.clock.compare("second", "preproduction", null);
  expect(() => f.clock.read("second", a.id)).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "clock_confirmation_required" },
    }),
  );
  const checked = f.clock.read("first", a.id);
  expect(canSelectHour(checked.clock, checked.confirmation)).toBe(true);
});
it("a forward clock correction invalidates a displayed confirmation", async () => {
  const f = fixture();
  f.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const displayed = await f.clock.compare("owned-scope", "production", null);
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
  const displayed = await f.clock.compare("owned-scope", "preproduction", {
    challengeId: challenge.id,
    instantMs: NOW + 5001,
  });
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
  await f.clock.compare("owned-scope", "preproduction", null);
  const checked = f.clock.read("owned-scope");
  expect(checked.clock.usable).toEqual([
    { source: "box", lowerMs: NOW + 1_201_000, upperMs: NOW + 1_201_000 },
  ]);
});

it("a clock correction permanently retires the old displayed comparison", async () => {
  const f = fixture();
  const displayed = await f.clock.compare("owned-scope", "production", null);
  f.correct(180_000);
  expect(() => f.clock.read("owned-scope", displayed.id)).toThrow();
  f.correct(-180_000);
  expect(() => f.clock.read("owned-scope", displayed.id)).toThrowError(
    expect.objectContaining({ code: "sif.allocation_invalid", params: { reason: "clock_stale" } }),
  );
});
it("a timed-out browser answer cannot poison a subsequent fresh challenge", async () => {
  const f = fixture();
  const first = f.clock.challenge("owned-scope");
  const fresh = f.clock.challenge("owned-scope");
  const old = await f.clock.compare("owned-scope", "preproduction", {
    challengeId: first.id,
    instantMs: NOW,
  });
  expect(old.clock.unavailable).toContainEqual(
    expect.objectContaining({ source: "browser", reason: "challenge" }),
  );
  const current = await f.clock.compare("owned-scope", "preproduction", {
    challengeId: fresh.id,
    instantMs: NOW,
  });
  expect(current.clock.usable.map((value) => value.source)).toEqual(["browser", "internet", "box"]);
});
it.each([NaN, Infinity, NOW + 0.5])(
  "rejects malformed browser instant %s as unavailable",
  async (instantMs) => {
    const f = fixture();
    const challenge = f.clock.challenge("owned-scope");
    const result = await f.clock.compare("owned-scope", "preproduction", {
      challengeId: challenge.id,
      instantMs,
    });
    expect(result.clock.unavailable).toContainEqual(
      expect.objectContaining({ source: "browser", reason: "challenge" }),
    );
  },
);
it("does not accept a challenge issued for a different frozen scope", async () => {
  const f = fixture();
  const challenge = f.clock.challenge("first");
  f.clock.challenge("second");
  const result = await f.clock.compare("second", "preproduction", {
    challengeId: challenge.id,
    instantMs: NOW,
  });
  expect(result.clock.unavailable).toContainEqual(
    expect.objectContaining({ source: "browser", reason: "challenge" }),
  );
});
it("a browser challenge is consumed once", async () => {
  const f = fixture();
  const challenge = f.clock.challenge("owned-scope");
  const browser = { challengeId: challenge.id, instantMs: NOW };
  await f.clock.compare("owned-scope", "preproduction", browser);
  const result = await f.clock.compare("owned-scope", "preproduction", browser);
  expect(result.clock.unavailable).toContainEqual(
    expect.objectContaining({ source: "browser", reason: "challenge" }),
  );
});
it("a displayed comparison older than thirty seconds cannot grant admission", async () => {
  const f = fixture();
  const displayed = await f.clock.compare("owned-scope", "preproduction", null);
  f.advance(30_001);
  expect(() => f.clock.read("owned-scope", displayed.id)).toThrowError(
    expect.objectContaining({ code: "sif.allocation_invalid", params: { reason: "clock_stale" } }),
  );
});
it("projects surviving observations forward before selecting after an hour boundary", async () => {
  const f = fixture();
  f.advance(1_199_000);
  await f.clock.compare("owned-scope", "preproduction", null);
  f.advance(2000);
  const reading = f.clock.read("owned-scope");
  expect(reading.clock.usable).toContainEqual({
    source: "box",
    lowerMs: NOW + 1_201_000,
    upperMs: NOW + 1_201_000,
  });
  expect(canSelectHour(reading.clock)).toBe(true);
});
it("manual confirmation never overrides an unavailable immutable release floor", async () => {
  const clock = setup.createSetupHourClock({
    wall: () => NOW,
    monotonic: () => 0,
    release: () => null,
    internet: async () => ({ source: "internet", result: "unavailable", reason: "tls" }),
  });
  const displayed = await clock.compare("owned-scope", "preproduction", null);
  const confirmed = clock.read("owned-scope", displayed.id);
  expect(confirmed.clock.releaseBlocked).toBe(true);
  expect(canSelectHour(confirmed.clock, confirmed.confirmation)).toBe(false);
});
it("a late internet response cannot overwrite the more recent comparison", async () => {
  const f = fixture();
  let finish!: (value: HourClockObservation) => void;
  f.internet.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = f.clock.compare("owned-scope", "preproduction", null);
  const rejected = expect(first).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_stale" },
  });
  const second = await f.clock.compare("owned-scope", "preproduction", null);
  finish({ source: "internet", result: "unavailable", reason: "network" });
  await rejected;
  expect(() => f.clock.read("owned-scope", second.id)).not.toThrow();
});
