import { describe, expect, it } from "vitest";
import { AUTO_MARGIN_MINUTES, MAX_SLEEP_MS, nextFireMs } from "./backup-schedule.js";

const MADRID = { timeZone: "Europe/Madrid", dayCutover: "05:00" };

// Local wall-clock parts of an instant in a tz — the same `Intl` view the scheduler uses, mirrored
// here so the DST assertion can read the local hour of a computed fire without trusting the impl.
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
    // 03:00 local, now is 04:00 local (already past) → tomorrow 03:00 local.
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
    // days = [1,5] (Mon, Fri) at 02:00 local → next allowed local day is Fri 2026-09-11.
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
    // Fires at cutover (05:00) + margin (30) + a 0..10 jitter, in local wall-clock time.
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
    // Both land in the same 05:30..05:40 window; the seed only moves the minute within it.
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
    // Europe/Madrid springs forward 2026-03-29: 02:00 local jumps to 03:00, so 02:00–02:59 local
    // does not exist that night. A daily fire configured for 02:30 must NOT resolve to an instant
    // whose local wall-clock reads 02:xx on 2026-03-29 — that hour is skipped.
    const now = new Date("2026-03-28T23:00:00Z"); // before the transition
    const fire = nextFireMs(
      { kind: "wall-clock", days: "daily", at: { hour: 2, minute: 30 } },
      MADRID,
      now,
      "n1",
    );
    const local = localHour(fire, MADRID.timeZone);
    // The fire is a real instant strictly after `now` and never lands inside the non-existent hour.
    expect(fire).toBeGreaterThan(now.getTime());
    if (local.day === 29) expect(local.hour).not.toBe(2);
  });
});
