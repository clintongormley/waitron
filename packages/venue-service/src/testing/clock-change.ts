// Test support: clock changes read from the runtime's own zone data.

/**
 * The first change of the zone's UTC offset after `from`, found by reading the runtime's own zone
 * data rather than asserting when a country changes its clocks. `before` and `after` are the wall
 * times either side of the change: on a forward change the minutes between them never occur, on a
 * backward one they occur twice.
 */
export function clockChangeAfter(
  timeZone: string,
  from: string,
  direction: "forward" | "backward",
) {
  const offset = (ms: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(ms))
        .map((part) => [part.type, part.value]),
    );
    return (
      (Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!) - ms) /
      60_000
    );
  };
  let ms = Date.parse(from);
  const changes = (span: number) => {
    const delta = offset(ms + span) - offset(ms);
    return delta !== 0 && delta > 0 === (direction === "forward");
  };
  while (!changes(3_600_000)) ms += 3_600_000;
  while (!changes(60_000)) ms += 60_000;
  const next = ms + 60_000;
  const wall = (at: number) => new Date(at + offset(at) * 60_000).toISOString();
  return {
    instant: new Date(next),
    date: wall(next).slice(0, 10),
    before: wall(ms).slice(11, 16),
    after: wall(next).slice(11, 16),
    deltaMinutes: Math.abs(offset(next) - offset(ms)),
  };
}

/** `time` moved by `minutes`, within one day. */
export const minutesAfter = (time: string, minutes: number) => {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
