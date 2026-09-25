import { describe, expect, it } from "vitest";
import { AUTO_MARGIN_MINUTES, MAX_SLEEP_MS, nextFireMs } from "./backup-schedule.js";

const MADRID = { timeZone: "Europe/Madrid", dayCutover: "05:00" };

// Mirrors the scheduler's `Intl` view so an assertion does not trust the implementation.
function localHour(ms: number, timeZone: string): { hour: number; minute: number; day: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour), minute: Number(p.minute), day: Number(p.day) };
}

describe("nextFireMs", () => {
  it("interval mode fires now+ms", () => {
    const now = new Date("2026-09-09T10:00:00Z");
    expect(nextFireMs({ kind: "interval", ms: 3600000 }, MADRID, now, "n1")).toBe(
      now.getTime() + 3600000,
    );
  });

  it("daily fixed time picks the next local occurrence", () => {
    const now = new Date("2026-09-09T02:00:00Z"); // 04:00 Madrid (CEST, +2)
    const fire = new Date(
      nextFireMs(
        { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 0 } },
        MADRID,
        now,
        "n1",
      ),
    );
    expect(fire.toISOString()).toBe("2026-09-10T01:00:00.000Z"); // 03:00 Madrid next day
  });

  it("weekday subset skips to the next allowed local day", () => {
    const now = new Date("2026-09-09T00:00:00Z"); // Wed 02:00 Madrid
    const fireMs = nextFireMs(
      { kind: "wall-clock", days: [1, 5], at: { hour: 2, minute: 0 } },
      MADRID,
      now,
      "n1",
    );
    const local = localHour(fireMs, MADRID.timeZone);
    expect(local).toMatchObject({ hour: 2, minute: 0, day: 11 });
    expect(new Date(fireMs).toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  it("auto resolves to dayCutover + margin, jittered and node-stable", () => {
    const now = new Date("2026-09-09T00:00:00Z");
    const a = nextFireMs({ kind: "wall-clock", days: "daily", at: "auto" }, MADRID, now, "node-A");
    const b = nextFireMs({ kind: "wall-clock", days: "daily", at: "auto" }, MADRID, now, "node-A");
    expect(a).toBe(b); // stable for the same seed
    const local = localHour(a, MADRID.timeZone);
    expect(local.hour).toBe(5);
    expect(local.minute).toBeGreaterThanOrEqual(30);
    expect(local.minute).toBeLessThanOrEqual(40);
    expect(AUTO_MARGIN_MINUTES).toBe(30);
  });

  it("a different node's auto jitter can differ but is itself stable", () => {
    const now = new Date("2026-09-09T00:00:00Z");
    const a = nextFireMs({ kind: "wall-clock", days: "daily", at: "auto" }, MADRID, now, "node-A");
    const c = nextFireMs({ kind: "wall-clock", days: "daily", at: "auto" }, MADRID, now, "node-C");
    const cAgain = nextFireMs(
      { kind: "wall-clock", days: "daily", at: "auto" },
      MADRID,
      now,
      "node-C",
    );
    expect(c).toBe(cAgain);
    expect(localHour(a, MADRID.timeZone).hour).toBe(5);
    expect(localHour(c, MADRID.timeZone).hour).toBe(5);
  });

  it("a fixed time > MAX_SLEEP away is still returned as one absolute future instant", () => {
    const now = new Date("2026-09-09T02:00:00Z");
    const fire = nextFireMs(
      { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 0 } },
      MADRID,
      now,
      "n1",
    );
    expect(fire).toBeGreaterThan(now.getTime());
    expect(fire - now.getTime()).toBeGreaterThan(MAX_SLEEP_MS); // ~23h away, one instant
  });

  it("never fires in the skipped hour of the Madrid spring-forward night", () => {
    // Europe/Madrid springs forward on 2026-03-29, so 02:00–02:59 local does not exist that night.
    const now = new Date("2026-03-28T23:00:00Z"); // before the transition
    const fire = nextFireMs(
      { kind: "wall-clock", days: "daily", at: { hour: 2, minute: 30 } },
      MADRID,
      now,
      "n1",
    );
    expect(new Date(fire).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    const local = localHour(fire, MADRID.timeZone);
    expect(local).toMatchObject({ day: 29, hour: 3, minute: 30 });
  });

  it("a weekday schedule does not skip a week across the spring-forward night", () => {
    // Stepping by elapsed 24h from Saturday 23:30 lands on Monday 00:30 local, skipping the
    // spring-forward Sunday, and fires a week late.
    const now = new Date("2026-03-28T22:30:00Z"); // Sat 23:30 Madrid (CET, +1)
    const fire = nextFireMs(
      { kind: "wall-clock", days: [0], at: { hour: 3, minute: 30 } },
      MADRID,
      now,
      "n1",
    );
    expect(new Date(fire).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(localHour(fire, MADRID.timeZone)).toMatchObject({ day: 29, hour: 3, minute: 30 });
  });

  it("a non-DST night resolves 02:30 to exactly 02:30 local (the control direction)", () => {
    // The control for the spring-forward case: on an ordinary night 02:30 stays 02:30.
    const now = new Date("2026-06-01T00:00:00Z");
    const fire = nextFireMs(
      { kind: "wall-clock", days: "daily", at: { hour: 2, minute: 30 } },
      MADRID,
      now,
      "n1",
    );
    expect(new Date(fire).toISOString()).toBe("2026-06-01T00:30:00.000Z");
    expect(localHour(fire, MADRID.timeZone)).toMatchObject({ hour: 2, minute: 30 });
  });

  it("falls back to a day from now when no weekday is allowed", () => {
    const now = new Date("2026-09-09T10:00:00Z");
    expect(
      nextFireMs({ kind: "wall-clock", days: [], at: { hour: 3, minute: 0 } }, MADRID, now, "n1"),
    ).toBe(now.getTime() + 24 * 60 * 60 * 1000);
  });
});
